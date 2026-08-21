//! `cowtext-mcp` — stdio MCP server exposing Cowtext's graph/compile/task
//! operations to Claude Code (F8, WO12). Full contract and per-tool
//! rationale: `docs/design/MCP_SERVER.md`.
//!
//! Same rule as `cowtext-cli` (`src/bin/cowtext_cli.rs`): no `tauri::Builder`
//! is ever constructed here. Every function this binary calls
//! (`project::*`, `compile::*`, `lint::lint_run`, `tasks::*`,
//! `taskctx::task_context_preview`, `agents::agents_scan`) is a plain
//! function that happens to also be reachable as a `#[tauri::command]` from
//! the GUI; none of them take an `AppHandle`/`State`, so they run headless.
//!
//! Transport: MCP stdio is JSON-RPC 2.0 as newline-delimited JSON — one
//! message per line, NOT LSP `Content-Length` framing. `serde_json` plus
//! plain `std::io` covers it; no tokio, no axum, no MCP crate (the stack is
//! frozen and every delegated call is synchronous).
//!
//! **Nothing may `println!` except the one response writer in `main`** —
//! `windows_subsystem = "windows"` (used by the GUI's `main.rs`) does not
//! apply to bin targets, so this binary keeps the default console
//! subsystem and a stray print anywhere in a delegated call path would
//! corrupt the stdout stream a client is reading as JSON-RPC. All
//! diagnostics go to stderr; stdout is flushed after every response.
//!
//! Root binding: taken once at launch from `--root <PATH>`, falling back to
//! `$COWTEXT_ROOT`, then `env::current_dir()`. Omitted from every tool's
//! JSON schema so the model cannot steer a write at another directory;
//! `checked_root`/`resolve_within_root` inside the delegated commands still
//! enforce the boundary per call as a second layer.
//!
//! The frozen tool list is exactly 14 — see [`tool_manifest`]. Excluded,
//! and why: assemble/refine/summarize/handoff_generate shell out to
//! `claude -p` (the MCP client IS Claude; a second Claude writing text for
//! the first is pure token waste) and are additionally unreachable — their
//! modules stay private `mod`s in `lib.rs`. sessions/settings/preset_*/
//! reveal_path are `AppHandle`/`State`-bound to the GUI process.
//! `hooks_write` is the `.claude/settings.json` trust boundary — an MCP
//! tool call has no diff-preview UI. `agent_delete`/`skill_delete`/
//! `import_apply`/`project_init` are destructive without a preview.

use cowtext_lib::{agents, compile, lint, project, taskctx, tasks};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let root = match resolve_root(&args) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("cowtext-mcp: {e}");
            std::process::exit(2);
        }
    };

    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!("cowtext-mcp: stdin read error: {e}");
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        if let Some(response) = handle_line(&root, &line) {
            if writeln!(stdout, "{response}").is_err() || stdout.flush().is_err() {
                break;
            }
        }
    }
}

// ── root resolution ─────────────────────────────────────────────────────

/// Hand-rolled `--root <PATH>` scan (no CLI crate — mirrors
/// `cowtext_cli.rs`'s `parse_args`). Pure and side-effect free.
fn parse_root_arg(args: &[String]) -> Option<String> {
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--root" {
            return args.get(i + 1).cloned();
        }
        i += 1;
    }
    None
}

/// argv `--root` -> `$COWTEXT_ROOT` -> `env::current_dir()`.
fn resolve_root(args: &[String]) -> Result<PathBuf, String> {
    if let Some(r) = parse_root_arg(args) {
        return Ok(PathBuf::from(r));
    }
    if let Ok(r) = env::var("COWTEXT_ROOT") {
        if !r.trim().is_empty() {
            return Ok(PathBuf::from(r));
        }
    }
    env::current_dir().map_err(|e| format!("cannot determine current directory: {e}"))
}

// ── JSON-RPC plumbing ───────────────────────────────────────────────────

/// Parses one newline-delimited JSON-RPC message and dispatches it.
/// `None` means "no response line" — either a notification (no `id`) or a
/// message this server has nothing to say back about.
fn handle_line(root: &Path, line: &str) -> Option<String> {
    match serde_json::from_str::<Value>(line) {
        Ok(value) => handle_message(root, value),
        // Can't recover an id from unparseable JSON — per JSON-RPC 2.0,
        // a parse error response carries `id: null`.
        Err(e) => Some(error_response(Value::Null, -32700, format!("Parse error: {e}"))),
    }
}

/// Pure core of the JSON-RPC layer: given a parsed message, decide what (if
/// anything) to send back. Split out of [`handle_line`] so it's directly
/// unit-testable without a stdio round-trip.
fn handle_message(root: &Path, value: Value) -> Option<String> {
    let obj = value.as_object();
    // A request has an `id` member (even `null` counts as present); a
    // notification does not have the member at all (JSON-RPC 2.0 §4.1).
    let id = obj.and_then(|o| o.get("id")).cloned();
    let method = obj.and_then(|o| o.get("method")).and_then(Value::as_str).unwrap_or("");
    let params = obj.and_then(|o| o.get("params")).cloned().unwrap_or(Value::Null);

    match method {
        // A notification: MUST NOT be responded to.
        "notifications/initialized" => None,
        "initialize" => Some(success_response(id?, handle_initialize(&params))),
        "ping" => Some(success_response(id?, json!({}))),
        "tools/list" => Some(success_response(id?, json!({ "tools": tool_manifest(root) }))),
        "tools/call" => {
            let id = id?;
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            let result = dispatch(root, name, arguments);
            Some(success_response(id, to_call_result(result)))
        }
        // Unknown method: an id means it was a request, so it gets a
        // proper JSON-RPC error; no id means it was a notification we
        // don't understand, which gets silently dropped.
        other => id.map(|id| error_response(id, -32601, format!("Method not found: {other}"))),
    }
}

fn success_response(id: Value, result: Value) -> String {
    serde_json::to_string(&json!({ "jsonrpc": "2.0", "id": id, "result": result }))
        .expect("response envelope always serializes")
}

fn error_response(id: Value, code: i64, message: String) -> String {
    serde_json::to_string(&json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }))
        .expect("error envelope always serializes")
}

/// Negotiates the protocol version and reports the fixed server identity.
const SUPPORTED_PROTOCOL_VERSIONS: [&str; 2] = ["2025-06-18", "2024-11-05"];
const DEFAULT_PROTOCOL_VERSION: &str = "2025-06-18";

fn handle_initialize(params: &Value) -> Value {
    let requested = params.get("protocolVersion").and_then(Value::as_str);
    let protocol_version = match requested {
        Some(v) if SUPPORTED_PROTOCOL_VERSIONS.contains(&v) => v.to_string(),
        _ => DEFAULT_PROTOCOL_VERSION.to_string(),
    };
    json!({
        "protocolVersion": protocol_version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": "cowtext", "version": "0.1.0" }
    })
}

/// Wraps every `Result<Value, String>` from [`dispatch`] uniformly.
/// `isError: true` is the channel for every delegated `Err(String)` — a
/// tool error the model can read and retry. JSON-RPC error objects are
/// reserved for protocol faults (bad method, bad JSON), never for a graph
/// validation error or a rejected write.
fn to_call_result(result: Result<Value, String>) -> Value {
    match result {
        Ok(v) => {
            let text = serde_json::to_string_pretty(&v).unwrap_or_else(|e| e.to_string());
            json!({ "content": [{ "type": "text", "text": text }], "isError": false })
        }
        Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
    }
}

// ── tool manifest ───────────────────────────────────────────────────────

#[derive(Serialize)]
struct ToolSpec {
    name: &'static str,
    description: &'static str,
    #[serde(rename = "inputSchema")]
    input_schema: Value,
}

fn empty_schema() -> Value {
    json!({ "type": "object", "properties": {}, "additionalProperties": false })
}

fn rel_path_only_schema(desc: &str) -> Value {
    json!({
        "type": "object",
        "properties": { "relPath": { "type": "string", "description": desc } },
        "required": ["relPath"],
        "additionalProperties": false
    })
}

/// `cowtext_task_append`'s `relPath` enum is the *live* set of convention
/// paths from [`tasks::tasks_scan`] rather than a hardcoded list — the real
/// allowlist is five convention names under the project root, `docs/`, or
/// `docs/tasks/`, and `tasks_scan` already computes exactly that (it always
/// reports 5 entries, existing or not). Falls back to a plain (enum-less)
/// string schema if the root can't be scanned yet, rather than hardcoding a
/// duplicate list that could drift from `tasks.rs`'s own `CONVENTION_NAMES`/
/// `CONVENTION_DIRS`.
fn task_append_schema(root: &Path) -> Value {
    let root_str = root.to_string_lossy().into_owned();
    let names: Vec<String> = tasks::tasks_scan(root_str)
        .map(|scan| scan.files.into_iter().map(|f| f.rel_path).collect())
        .unwrap_or_default();
    let rel_path_prop = if names.is_empty() {
        json!({
            "type": "string",
            "description": "One of the five task convention files (TASKS.md, SPRINT.md, BACKLOG.md, ROADMAP.md, BUGS.md), under the project root, docs/, or docs/tasks/"
        })
    } else {
        json!({
            "type": "string",
            "enum": names,
            "description": "One of the five task convention files"
        })
    };
    json!({
        "type": "object",
        "properties": {
            "relPath": rel_path_prop,
            "text": { "type": "string", "description": "Task text to append" }
        },
        "required": ["relPath", "text"],
        "additionalProperties": false
    })
}

/// The frozen 14-tool list (F8), byte-exact names. Root is bound at launch
/// and omitted from every schema below.
fn tool_manifest(root: &Path) -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "cowtext_scan",
            description: "Recursively scan the project root for .md files (relative path, size, mtime). Read-only.",
            input_schema: empty_schema(),
        },
        ToolSpec {
            name: "cowtext_graph_read",
            description: "Read .cowtext/graph.json, migrated to the current schema version — the model never sees a stale v1/v2/v3 shape. Errors if no graph exists yet; use cowtext_graph_write to create one.",
            input_schema: empty_schema(),
        },
        ToolSpec {
            name: "cowtext_graph_write",
            description: "Validate (migrate) and atomically write .cowtext/graph.json. Replaces the whole graph — read with cowtext_graph_read first, edit, then write the full result back.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "graph": { "type": "string", "description": "Full graph.json contents, as a JSON string" }
                },
                "required": ["graph"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "cowtext_node_read",
            description: "Read one Memory Node's backing .md file by project-relative path.",
            input_schema: rel_path_only_schema("Project-relative path to the .md file, forward slashes"),
        },
        ToolSpec {
            name: "cowtext_node_write",
            description: "Write one Memory Node's backing .md file, creating parent directories as needed. Refuses .claude/settings.json (trust boundary — use Install Hooks in the GUI) and .claude/agents/*.md (ONE_WRITER doctrine — agent files are only writable via agent_save in the GUI).",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "relPath": { "type": "string", "description": "Project-relative path, forward slashes" },
                    "content": { "type": "string" }
                },
                "required": ["relPath", "content"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "cowtext_compile_preview",
            description: "Validate the current graph and render every configured compile target (CLAUDE.md, AGENTS.md, .cursor/rules/*.mdc, copilot-instructions.md, GEMINI.md) in memory, diffed against what's on disk. Read-only; never writes.",
            input_schema: empty_schema(),
        },
        ToolSpec {
            name: "cowtext_compile_write",
            description: "Write approved compile-preview files to disk. Enforces the compile-output write allowlist and the GENERATED header; refuses anything outside the five compile targets.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "files": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "relPath": { "type": "string" },
                                "content": { "type": "string" }
                            },
                            "required": ["relPath", "content"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["files"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "cowtext_lint",
            description: "Run every lint check (cycles, duplication, stale lastVerified, contradicts) against the current graph and report findings by severity. Read-only.",
            input_schema: empty_schema(),
        },
        ToolSpec {
            name: "cowtext_tasks_scan",
            description: "Scan the five task convention files (TASKS.md, SPRINT.md, BACKLOG.md, ROADMAP.md, BUGS.md) and compute the task dependency DAG (cycles, duplicate ids, unresolved deps). Read-only.",
            input_schema: empty_schema(),
        },
        ToolSpec {
            name: "cowtext_task_append",
            description: "Append a task to one of the five convention task files, using the target-form-aware write rule (table row / checklist line / fresh canonical table, matching whatever the file already has). Writes are gated to the five convention files only.",
            input_schema: task_append_schema(root),
        },
        ToolSpec {
            name: "cowtext_task_update",
            description: "Patch an existing task's fields, addressed by (relPath, line). Every patch field is optional; an absent/null field clears it, except name (an update that would leave the name empty errors instead).",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "relPath": { "type": "string" },
                    "line": { "type": "integer", "minimum": 1, "description": "1-based line number from cowtext_tasks_scan" },
                    "patch": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string" },
                            "description": { "type": "string" },
                            "tags": { "type": "array", "items": { "type": "string" } },
                            "priority": { "type": "string" },
                            "phase": { "type": "string" },
                            "taskType": { "type": "string" },
                            "agent": { "type": "string" },
                            "status": { "type": "string" },
                            "done": { "type": "boolean" }
                        },
                        "additionalProperties": false
                    }
                },
                "required": ["relPath", "line", "patch"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "cowtext_task_toggle",
            description: "Toggle a checklist task's done state, addressed by (relPath, line). Errors if that line is a table row rather than a checklist item.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "relPath": { "type": "string" },
                    "line": { "type": "integer", "minimum": 1 },
                    "done": { "type": "boolean" }
                },
                "required": ["relPath", "line", "done"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "cowtext_task_context",
            description: "The single highest-value tool: compiles the exact subgraph for one task (its tasklinks seeds, parent-goal ancestry, and every globally root-always node, closed over imports edges) into a CLAUDE.md-shaped body. Read-only.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "taskId": {
                        "type": "string",
                        "pattern": "^t-[0-9a-z]{6}$",
                        "description": "Stable task id (minted via task_id_ensure in the GUI)"
                    }
                },
                "required": ["taskId"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "cowtext_agents_scan",
            description: "Scan .claude/agents/*.md and .claude/skills/*/SKILL.md plus the .cowtext/agents.json sidecar. Read-only.",
            input_schema: empty_schema(),
        },
    ]
}

// ── dispatch ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelPathArg {
    rel_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NodeWriteArgs {
    rel_path: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphWriteArgs {
    graph: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompileWriteArgs {
    files: Vec<compile::ApprovedFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskAppendArgs {
    rel_path: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskUpdateArgs {
    rel_path: String,
    line: usize,
    patch: tasks::TaskPatch,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskToggleArgs {
    rel_path: String,
    line: usize,
    done: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskContextArgs {
    task_id: String,
}

fn to_value<T: Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

fn parse_tool_args<T: serde::de::DeserializeOwned>(args: Value) -> Result<T, String> {
    serde_json::from_value(args).map_err(|e| format!("invalid arguments: {e}"))
}

/// Reads `.cowtext/graph.json` and migrates it to the current schema.
/// `Err` when there is no graph yet — every tool that needs one (compile
/// preview, task context, graph read) surfaces the same clear message.
fn current_graph(root_str: &str) -> Result<project::BarnGraph, String> {
    let raw = project::read_graph(root_str.to_string())?.ok_or_else(|| {
        format!("no .cowtext/graph.json found under {root_str} — use cowtext_graph_write to create one")
    })?;
    project::migrate_graph(&raw)
}

/// Copies `cowtext-cli`'s idiom (`cowtext_cli.rs:324-345`): `read_graph` ->
/// `migrate_graph` -> `serialize_graph`, because `compile_preview` and
/// `task_context_preview` both take `graph_json: String`, not a path.
fn current_graph_json(root_str: &str) -> Result<String, String> {
    let graph = current_graph(root_str)?;
    Ok(project::serialize_graph(&graph))
}

/// Pure core of `tools/call`: delegates to the one Cowtext command each
/// tool name maps to. Split out of [`handle_message`] so it's directly
/// unit-testable without a stdio round-trip. An unknown tool name is a
/// data-shaped `Err`, not a protocol fault — it surfaces via `isError:
/// true`, same as every other delegated failure.
fn dispatch(root: &Path, name: &str, args: Value) -> Result<Value, String> {
    let root_str = root.to_string_lossy().into_owned();
    match name {
        "cowtext_scan" => to_value(project::scan_root(root_str)?),
        "cowtext_graph_read" => to_value(current_graph(&root_str)?),
        "cowtext_graph_write" => {
            let a: GraphWriteArgs = parse_tool_args(args)?;
            let graph = project::migrate_graph(&a.graph)?;
            let serialized = project::serialize_graph(&graph);
            project::write_graph(root_str, serialized)?;
            to_value(graph)
        }
        "cowtext_node_read" => {
            let a: RelPathArg = parse_tool_args(args)?;
            Ok(Value::String(project::read_md_file(root_str, a.rel_path)?))
        }
        "cowtext_node_write" => {
            let a: NodeWriteArgs = parse_tool_args(args)?;
            project::write_md_file(root_str, a.rel_path.clone(), a.content)?;
            Ok(json!({ "written": true, "relPath": a.rel_path }))
        }
        "cowtext_compile_preview" => {
            let graph_json = current_graph_json(&root_str)?;
            to_value(compile::compile_preview(root_str, graph_json, Vec::new())?)
        }
        "cowtext_compile_write" => {
            let a: CompileWriteArgs = parse_tool_args(args)?;
            to_value(compile::compile_write(root_str, a.files)?)
        }
        "cowtext_lint" => to_value(lint::lint_run(root_str)?),
        "cowtext_tasks_scan" => to_value(tasks::tasks_scan(root_str)?),
        "cowtext_task_append" => {
            let a: TaskAppendArgs = parse_tool_args(args)?;
            to_value(tasks::task_append(root_str, a.rel_path, a.text)?)
        }
        "cowtext_task_update" => {
            let a: TaskUpdateArgs = parse_tool_args(args)?;
            to_value(tasks::task_update(root_str, a.rel_path, a.line, a.patch)?)
        }
        "cowtext_task_toggle" => {
            let a: TaskToggleArgs = parse_tool_args(args)?;
            to_value(tasks::task_toggle(root_str, a.rel_path, a.line, a.done)?)
        }
        "cowtext_task_context" => {
            let a: TaskContextArgs = parse_tool_args(args)?;
            let graph_json = current_graph_json(&root_str)?;
            to_value(taskctx::task_context_preview(root_str, a.task_id, graph_json)?)
        }
        "cowtext_agents_scan" => to_value(agents::agents_scan(root_str)?),
        other => Err(format!("Unknown tool: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cowtext-mcp-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // ── root resolution ────────────────────────────────────────────────

    #[test]
    fn parse_root_arg_finds_flag() {
        let args: Vec<String> = vec!["--root".into(), "/some/path".into()];
        assert_eq!(parse_root_arg(&args), Some("/some/path".to_string()));
    }

    #[test]
    fn parse_root_arg_missing_is_none() {
        let args: Vec<String> = vec!["--json".into()];
        assert_eq!(parse_root_arg(&args), None);
    }

    #[test]
    fn resolve_root_prefers_argv() {
        let args: Vec<String> = vec!["--root".into(), "/argv/path".into()];
        assert_eq!(resolve_root(&args).unwrap(), PathBuf::from("/argv/path"));
    }

    #[test]
    fn resolve_root_defaults_to_cwd() {
        let r = resolve_root(&[]).expect("cwd should resolve in a test process");
        assert_eq!(r, env::current_dir().unwrap());
    }

    // ── (a) tool_manifest ─────────────────────────────────────────────

    #[test]
    fn tool_manifest_has_exactly_14_tools_with_valid_schemas() {
        let dir = temp_project("manifest");
        let tools = tool_manifest(&dir);
        assert_eq!(tools.len(), 14);

        let names: Vec<&str> = tools.iter().map(|t| t.name).collect();
        assert_eq!(
            names,
            [
                "cowtext_scan",
                "cowtext_graph_read",
                "cowtext_graph_write",
                "cowtext_node_read",
                "cowtext_node_write",
                "cowtext_compile_preview",
                "cowtext_compile_write",
                "cowtext_lint",
                "cowtext_tasks_scan",
                "cowtext_task_append",
                "cowtext_task_update",
                "cowtext_task_toggle",
                "cowtext_task_context",
                "cowtext_agents_scan",
            ]
        );

        for t in &tools {
            assert!(!t.description.is_empty(), "{} has an empty description", t.name);
            assert!(t.input_schema.is_object(), "{} schema is not an object", t.name);
            assert_eq!(
                t.input_schema.get("type").and_then(Value::as_str),
                Some("object"),
                "{} schema is not type=object",
                t.name
            );
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── (b) initialize ──────────────────────────────────────────────────

    #[test]
    fn initialize_negotiates_supported_protocol_version() {
        let dir = temp_project("init");
        let req = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "protocolVersion": "2024-11-05" } });
        let response = handle_message(&dir, req).expect("initialize always responds");
        let parsed: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(parsed["id"], json!(1));
        assert_eq!(parsed["result"]["protocolVersion"], json!("2024-11-05"));
        assert_eq!(parsed["result"]["serverInfo"]["name"], json!("cowtext"));
        assert_eq!(parsed["result"]["capabilities"]["tools"]["listChanged"], json!(false));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn initialize_falls_back_to_default_protocol_version_when_unsupported() {
        let dir = temp_project("init-fallback");
        let req = json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize",
            "params": { "protocolVersion": "1999-01-01" } });
        let response = handle_message(&dir, req).unwrap();
        let parsed: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(parsed["result"]["protocolVersion"], json!(DEFAULT_PROTOCOL_VERSION));
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── (c) notifications/initialized ───────────────────────────────────

    #[test]
    fn notifications_initialized_produces_no_output() {
        let dir = temp_project("notif");
        let notif = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
        assert_eq!(handle_message(&dir, notif), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── (d) unknown method ───────────────────────────────────────────────

    #[test]
    fn unknown_method_with_id_is_method_not_found() {
        let dir = temp_project("unknown-with-id");
        let req = json!({ "jsonrpc": "2.0", "id": 3, "method": "frobnicate" });
        let response = handle_message(&dir, req).expect("should respond");
        let parsed: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(parsed["error"]["code"], json!(-32601));
        assert!(parsed.get("result").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_method_without_id_produces_no_output() {
        let dir = temp_project("unknown-without-id");
        let notif = json!({ "jsonrpc": "2.0", "method": "frobnicate" });
        assert_eq!(handle_message(&dir, notif), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── (e) tools/call unknown tool ─────────────────────────────────────

    #[test]
    fn tools_call_unknown_tool_is_is_error_not_rpc_error() {
        let dir = temp_project("call-unknown");
        let req = json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call",
            "params": { "name": "cowtext_does_not_exist", "arguments": {} } });
        let response = handle_message(&dir, req).unwrap();
        let parsed: Value = serde_json::from_str(&response).unwrap();
        assert!(parsed.get("error").is_none(), "expected no top-level JSON-RPC error");
        assert_eq!(parsed["result"]["isError"], json!(true));
        assert!(parsed["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("Unknown tool"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── (f) delegated Err(String) -> isError:true ───────────────────────

    #[test]
    fn dispatch_err_maps_to_is_error_with_message() {
        let dir = temp_project("dispatch-err");
        let result = dispatch(&dir, "cowtext_node_read", json!({ "relPath": "missing.md" }));
        assert!(result.is_err());
        let wrapped = to_call_result(result);
        assert_eq!(wrapped["isError"], json!(true));
        assert!(!wrapped["content"][0]["text"].as_str().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn dispatch_unknown_tool_is_err_not_panic() {
        let dir = temp_project("dispatch-unknown");
        let result = dispatch(&dir, "not_a_real_tool", json!({}));
        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── (g) cowtext_graph_read round-trip ───────────────────────────────

    #[test]
    fn graph_write_then_read_round_trips_through_migration() {
        let dir = temp_project("graph-roundtrip");
        let v1_graph = json!({
            "version": 1,
            "projectName": "fixture",
            "nodes": [],
            "edges": [],
            "compileTargets": ["claude"]
        })
        .to_string();

        let written = dispatch(&dir, "cowtext_graph_write", json!({ "graph": v1_graph }));
        assert!(written.is_ok(), "graph_write failed: {written:?}");

        let read = dispatch(&dir, "cowtext_graph_read", json!({})).expect("graph_read should succeed");
        assert_eq!(read["projectName"], json!("fixture"));
        assert_eq!(read["nodes"], json!([]));
        assert!(read["version"].as_u64().unwrap() >= 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn graph_read_without_a_graph_yet_is_err() {
        let dir = temp_project("graph-missing");
        let result = dispatch(&dir, "cowtext_graph_read", json!({}));
        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── tasks_scan-derived enum in task_append's schema ─────────────────

    #[test]
    fn task_append_schema_enumerates_five_convention_files() {
        let dir = temp_project("task-append-schema");
        let schema = task_append_schema(&dir);
        let names = schema["properties"]["relPath"]["enum"].as_array().expect("enum present");
        assert_eq!(names.len(), 5);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
