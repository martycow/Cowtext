//! `cowtext-cli` — headless CI checks for a Cowtext project graph (WO03 Lane C).
//!
//! Two subcommands, both strictly read-only — this binary never writes a
//! file under any circumstance (it never calls `compile_write`):
//!
//! - `compile --check` — loads `.cowtext/graph.json`, migrates it to the
//!   current schema version in memory (mirrors what the app does on open;
//!   this binary has no webview, so it must do this itself), renders every
//!   configured compile target via [`compile_preview`], and diffs the
//!   result against what is on disk. Exit 0 = nothing drifted, exit 1 =
//!   drift or a validation error (cycle / missing file / dangling edge),
//!   exit 2 = usage error or infrastructure failure (missing/unreadable
//!   root or graph.json).
//! - `lint` — runs every check in [`lint_graph`] and prints findings
//!   grouped by severity. Policy: warnings alone never fail a CI job, only
//!   `error`-severity findings do. Exit 0 = no error-severity findings,
//!   exit 1 = at least one, exit 2 = usage/infrastructure failure.
//!
//! No `tauri::Builder` is ever constructed here. Every function this binary
//! calls (`project::{read_graph, migrate_graph, serialize_graph}`,
//! `compile::compile_preview`, `lint::lint_graph`) is a plain function that
//! happens to also be reachable as a `#[tauri::command]` from the GUI; none
//! of them take an `AppHandle`/`State`, so they run headless exactly like
//! any other pure Rust call.

use cowtext_lib::compile::{compile_preview, PreviewFile, ValidationError};
use cowtext_lib::lint::{lint_graph, LintItem, Severity};
use cowtext_lib::project::{migrate_graph, read_graph, serialize_graph};
use serde::Serialize;
use std::env;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

/// Exit code: success (compile: no drift; lint: no error-severity findings).
const OK_EXIT: u8 = 0;
/// Exit code: a real finding (compile: drift or validation error; lint: an
/// error-severity finding). This is the whole point of the CLI — a CI job
/// keys off this code.
const PROBLEM_EXIT: u8 = 1;
/// Exit code: usage error or infrastructure failure (bad flags, missing or
/// unreadable root/graph.json). Never a panic, never a raw stack trace.
const USAGE_EXIT: u8 = 2;

const TOP_HELP: &str = "\
cowtext-cli — headless CI checks for a Cowtext project graph

USAGE:
    cowtext-cli <COMMAND> [OPTIONS]

COMMANDS:
    compile --check     Verify generated files (CLAUDE.md, AGENTS.md,
                         .cursor/rules/*.mdc, .github/copilot-instructions.md,
                         GEMINI.md) match the current graph. Read-only.
    lint                 Run the graph linter and print findings.

OPTIONS (all commands):
    --root <PATH>        Project root containing .cowtext/graph.json
                          (default: current directory)
    --json                Machine-readable JSON output instead of text
    -h, --help            Show this help

EXIT CODES:
    0   success (compile: nothing drifted; lint: no error-severity findings)
    1   a problem was found (compile: drift or a validation error;
        lint: an error-severity finding)
    2   usage error or infrastructure failure (bad flags, missing or
        unreadable root/graph.json)

Run `cowtext-cli compile --help` or `cowtext-cli lint --help` for detail.";

const COMPILE_HELP: &str = "\
cowtext-cli compile --check — verify generated files match the graph

USAGE:
    cowtext-cli compile --check [--root <PATH>] [--json]

--check is required: this command only ever verifies, it never writes.
Loads .cowtext/graph.json, migrates it to the current schema version in
memory, renders every configured compile target, and diffs the result
against what is on disk.

EXIT CODES:
    0   every generated file matches the graph
    1   at least one generated file has drifted, OR the graph fails
        validation (a dependency cycle, a node pointing at a missing file,
        or a dangling edge) — in the validation case no files are compared
    2   usage error or infrastructure failure: no .cowtext/graph.json
        found, the file does not parse, or --root is not a directory";

const LINT_HELP: &str = "\
cowtext-cli lint — run the graph linter

USAGE:
    cowtext-cli lint [--root <PATH>] [--json]

Runs every lint check (cycle, missing-file, dangling-edge, conflicts-with,
duplicate-title, near-duplicate-content, README duplication,
stale-last-verified, superseded-but-pinned) against the project's current
graph and prints findings grouped by severity.

EXIT CODE POLICY: warnings alone never fail a CI job; only error-severity
findings do.
    0   no error-severity findings (there may still be warnings)
    1   at least one error-severity finding
    2   usage error or infrastructure failure (missing/unreadable root; an
        unparseable graph.json — a project with no graph yet is NOT an
        error, it simply has zero findings)";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Command {
    Compile,
    Lint,
}

#[derive(Debug, PartialEq)]
struct Invocation {
    command: Command,
    root: Option<String>,
    json: bool,
}

#[derive(Debug, PartialEq)]
enum ParseOutcome {
    Run(Invocation),
    /// Help text to print to stdout; exit 0.
    Help(&'static str),
    /// Usage message to print to stderr; exit 2.
    UsageError(String),
}

/// Hand-rolled argument parser (no CLI crate — stack is frozen). Pure and
/// side-effect free so it's directly unit-testable without touching a
/// filesystem or process environment.
fn parse_args(args: &[String]) -> ParseOutcome {
    if args.is_empty() || args[0] == "-h" || args[0] == "--help" {
        return ParseOutcome::Help(TOP_HELP);
    }

    let command = match args[0].as_str() {
        "compile" => Command::Compile,
        "lint" => Command::Lint,
        other => {
            return ParseOutcome::UsageError(format!(
                "unknown command: {other}\n\n{TOP_HELP}"
            ));
        }
    };
    let command_help = match command {
        Command::Compile => COMPILE_HELP,
        Command::Lint => LINT_HELP,
    };

    let mut root: Option<String> = None;
    let mut json = false;
    let mut check = false;
    let rest = &args[1..];
    let mut i = 0;
    while i < rest.len() {
        match rest[i].as_str() {
            "-h" | "--help" => return ParseOutcome::Help(command_help),
            "--json" => json = true,
            "--check" => check = true,
            "--root" => {
                i += 1;
                match rest.get(i) {
                    Some(v) => root = Some(v.clone()),
                    None => {
                        return ParseOutcome::UsageError(
                            "--root requires a path argument".to_string(),
                        )
                    }
                }
            }
            other => {
                return ParseOutcome::UsageError(format!(
                    "unknown argument: {other}\n\n{command_help}"
                ))
            }
        }
        i += 1;
    }

    if command == Command::Lint && check {
        return ParseOutcome::UsageError(format!(
            "--check is only valid for the compile command\n\n{command_help}"
        ));
    }
    if command == Command::Compile && !check {
        return ParseOutcome::UsageError(format!(
            "compile requires --check (cowtext-cli never writes generated files)\n\n{command_help}"
        ));
    }

    ParseOutcome::Run(Invocation { command, root, json })
}

fn resolve_root(root_arg: Option<&str>) -> Result<PathBuf, String> {
    match root_arg {
        Some(r) => Ok(PathBuf::from(r)),
        None => env::current_dir().map_err(|e| format!("cannot determine current directory: {e}")),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    match parse_args(&args) {
        ParseOutcome::Help(text) => {
            println!("{text}");
            ExitCode::from(OK_EXIT)
        }
        ParseOutcome::UsageError(msg) => {
            eprintln!("cowtext-cli: {msg}");
            ExitCode::from(USAGE_EXIT)
        }
        ParseOutcome::Run(inv) => {
            let root = match resolve_root(inv.root.as_deref()) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("cowtext-cli: {e}");
                    return ExitCode::from(USAGE_EXIT);
                }
            };
            let code = match inv.command {
                Command::Compile => cmd_compile_check(&root, inv.json),
                Command::Lint => cmd_lint(&root, inv.json),
            };
            ExitCode::from(code)
        }
    }
}

// ── compile --check ────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileStatus {
    rel_path: String,
    target: String,
    /// "unchanged" | "changed" | "new"
    status: &'static str,
}

fn file_status(f: &PreviewFile) -> FileStatus {
    let status = if f.unchanged {
        "unchanged"
    } else if f.old_content.is_none() {
        "new"
    } else {
        "changed"
    };
    FileStatus {
        rel_path: f.rel_path.clone(),
        target: f.target.clone(),
        status,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompileCheckReport {
    command: &'static str,
    root: String,
    /// "ok" | "drift" | "invalid" | "error"
    status: &'static str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    files: Vec<FileStatus>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    errors: Vec<ValidationError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn format_validation_error(e: &ValidationError) -> String {
    match e {
        ValidationError::Cycle { nodes } => {
            let path: Vec<&str> = nodes.iter().map(|n| n.title.as_str()).collect();
            format!("cycle: {}", path.join(" -> "))
        }
        ValidationError::MissingFile {
            node_id,
            title,
            file_path,
        } => format!("missing-file: \"{title}\" ({node_id}) -> {file_path}"),
        ValidationError::DanglingEdge {
            edge_id,
            edge_kind,
            missing_end,
        } => format!("dangling-edge: edge {edge_id} ({edge_kind}) -> missing end \"{missing_end}\""),
    }
}

fn compile_check_error(root: &str, json: bool, message: String) -> u8 {
    if json {
        let report = CompileCheckReport {
            command: "compile",
            root: root.to_string(),
            status: "error",
            files: Vec::new(),
            errors: Vec::new(),
            message: Some(message),
        };
        println!("{}", serde_json::to_string_pretty(&report).expect("report always serializes"));
    } else {
        eprintln!("cowtext-cli compile: {message}");
    }
    USAGE_EXIT
}

/// Pure classifier: given whether the graph has validation errors and how
/// many generated files drifted, what's the exit code? Split out from
/// [`cmd_compile_check`] so the policy is directly unit-testable without a
/// filesystem fixture.
fn compile_exit_code(has_validation_errors: bool, drifted: usize) -> u8 {
    if has_validation_errors || drifted > 0 {
        PROBLEM_EXIT
    } else {
        OK_EXIT
    }
}

fn cmd_compile_check(root: &Path, json: bool) -> u8 {
    let root_str = root.to_string_lossy().into_owned();

    let raw = match read_graph(root_str.clone()) {
        Ok(Some(raw)) => raw,
        Ok(None) => {
            return compile_check_error(
                &root_str,
                json,
                format!("no .cowtext/graph.json found under {root_str}"),
            )
        }
        Err(e) => return compile_check_error(&root_str, json, e),
    };

    let graph = match migrate_graph(&raw) {
        Ok(g) => g,
        Err(e) => return compile_check_error(&root_str, json, format!("invalid graph.json: {e}")),
    };

    let graph_json = serialize_graph(&graph);
    let preview = match compile_preview(root_str.clone(), graph_json) {
        Ok(p) => p,
        Err(e) => return compile_check_error(&root_str, json, e),
    };

    if !preview.errors.is_empty() {
        let code = compile_exit_code(true, 0);
        if json {
            let report = CompileCheckReport {
                command: "compile",
                root: root_str,
                status: "invalid",
                files: Vec::new(),
                errors: preview.errors,
                message: None,
            };
            println!(
                "{}",
                serde_json::to_string_pretty(&report).expect("report always serializes")
            );
        } else {
            println!(
                "VALIDATION FAILED — graph has {} problem(s); no files were checked.\n",
                preview.errors.len()
            );
            for e in &preview.errors {
                println!("  {}", format_validation_error(e));
            }
        }
        return code;
    }

    let statuses: Vec<FileStatus> = preview.files.iter().map(file_status).collect();
    let drifted = statuses.iter().filter(|s| s.status != "unchanged").count();
    let code = compile_exit_code(false, drifted);

    if json {
        let report = CompileCheckReport {
            command: "compile",
            root: root_str,
            status: if drifted == 0 { "ok" } else { "drift" },
            files: statuses,
            errors: Vec::new(),
            message: None,
        };
        println!(
            "{}",
            serde_json::to_string_pretty(&report).expect("report always serializes")
        );
    } else if drifted == 0 {
        println!(
            "OK — {} generated file(s) match the graph. No drift.",
            statuses.len()
        );
    } else {
        println!(
            "DRIFT DETECTED — {drifted} of {} generated file(s) differ from the graph:",
            statuses.len()
        );
        for s in &statuses {
            if s.status == "unchanged" {
                continue;
            }
            let tag = if s.status == "new" { "NEW    " } else { "CHANGED" };
            println!("  {tag}  {}  ({})", s.rel_path, s.target);
        }
        println!("\nRun Compile in the app (or `compile_write`) to bring these files up to date.");
    }
    code
}

// ── lint ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LintReport {
    command: &'static str,
    root: String,
    /// "ok" | "problems" | "error"
    status: &'static str,
    error_count: usize,
    warning_count: usize,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    items: Vec<LintItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn lint_error(root: &str, json: bool, message: String) -> u8 {
    if json {
        let report = LintReport {
            command: "lint",
            root: root.to_string(),
            status: "error",
            error_count: 0,
            warning_count: 0,
            items: Vec::new(),
            message: Some(message),
        };
        println!("{}", serde_json::to_string_pretty(&report).expect("report always serializes"));
    } else {
        eprintln!("cowtext-cli lint: {message}");
    }
    USAGE_EXIT
}

/// Pure classifier: error-severity findings fail a CI job, warnings alone
/// do not (contract-documented policy, also stated in `--help`).
fn lint_exit_code(error_count: usize) -> u8 {
    if error_count > 0 {
        PROBLEM_EXIT
    } else {
        OK_EXIT
    }
}

fn code_str(code: cowtext_lib::lint::LintCode) -> String {
    serde_json::to_value(code)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".to_string())
}

fn describe_item(i: &LintItem) -> String {
    let mut s = format!("[{}] {}", code_str(i.code), i.message);
    if !i.node_ids.is_empty() {
        s.push_str(&format!("  (nodes: {})", i.node_ids.join(", ")));
    }
    if !i.edge_ids.is_empty() {
        s.push_str(&format!("  (edges: {})", i.edge_ids.join(", ")));
    }
    if let Some(fp) = &i.file_path {
        s.push_str(&format!("  (file: {fp})"));
    }
    s
}

fn cmd_lint(root: &Path, json: bool) -> u8 {
    let root_str = root.to_string_lossy().into_owned();

    let raw = match read_graph(root_str.clone()) {
        Ok(v) => v,
        Err(e) => return lint_error(&root_str, json, e),
    };

    let items: Vec<LintItem> = match raw {
        Some(raw) => {
            let graph = match migrate_graph(&raw) {
                Ok(g) => g,
                Err(e) => return lint_error(&root_str, json, format!("invalid graph.json: {e}")),
            };
            lint_graph(root, &graph)
        }
        None => Vec::new(),
    };

    let error_count = items.iter().filter(|i| i.severity == Severity::Error).count();
    let warning_count = items.len() - error_count;
    let code = lint_exit_code(error_count);

    if json {
        let report = LintReport {
            command: "lint",
            root: root_str,
            status: if error_count > 0 { "problems" } else { "ok" },
            error_count,
            warning_count,
            items,
            message: None,
        };
        println!(
            "{}",
            serde_json::to_string_pretty(&report).expect("report always serializes")
        );
        return code;
    }

    if items.is_empty() {
        println!("No problems found.");
        return code;
    }

    println!("{} finding(s): {error_count} error(s), {warning_count} warning(s)\n", items.len());
    let errors: Vec<&LintItem> = items.iter().filter(|i| i.severity == Severity::Error).collect();
    let warnings: Vec<&LintItem> = items
        .iter()
        .filter(|i| i.severity == Severity::Warning)
        .collect();
    if !errors.is_empty() {
        println!("ERRORS");
        for i in &errors {
            println!("  {}", describe_item(i));
        }
    }
    if !warnings.is_empty() {
        if !errors.is_empty() {
            println!();
        }
        println!("WARNINGS");
        for i in &warnings {
            println!("  {}", describe_item(i));
        }
    }
    code
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    // ── argument parsing ────────────────────────────────────────────────

    #[test]
    fn no_args_prints_top_help() {
        assert_eq!(parse_args(&args(&[])), ParseOutcome::Help(TOP_HELP));
    }

    #[test]
    fn top_level_help_flags() {
        assert_eq!(parse_args(&args(&["-h"])), ParseOutcome::Help(TOP_HELP));
        assert_eq!(parse_args(&args(&["--help"])), ParseOutcome::Help(TOP_HELP));
    }

    #[test]
    fn unknown_command_is_usage_error() {
        match parse_args(&args(&["frobnicate"])) {
            ParseOutcome::UsageError(msg) => assert!(msg.contains("unknown command")),
            other => panic!("expected UsageError, got {other:?}"),
        }
    }

    #[test]
    fn compile_without_check_is_usage_error() {
        match parse_args(&args(&["compile"])) {
            ParseOutcome::UsageError(msg) => assert!(msg.contains("requires --check")),
            other => panic!("expected UsageError, got {other:?}"),
        }
    }

    #[test]
    fn compile_check_minimal() {
        assert_eq!(
            parse_args(&args(&["compile", "--check"])),
            ParseOutcome::Run(Invocation {
                command: Command::Compile,
                root: None,
                json: false,
            })
        );
    }

    #[test]
    fn compile_check_with_root_and_json() {
        assert_eq!(
            parse_args(&args(&["compile", "--check", "--root", "/tmp/proj", "--json"])),
            ParseOutcome::Run(Invocation {
                command: Command::Compile,
                root: Some("/tmp/proj".to_string()),
                json: true,
            })
        );
    }

    #[test]
    fn lint_minimal() {
        assert_eq!(
            parse_args(&args(&["lint"])),
            ParseOutcome::Run(Invocation {
                command: Command::Lint,
                root: None,
                json: false,
            })
        );
    }

    #[test]
    fn lint_with_check_is_usage_error() {
        match parse_args(&args(&["lint", "--check"])) {
            ParseOutcome::UsageError(msg) => assert!(msg.contains("only valid for the compile")),
            other => panic!("expected UsageError, got {other:?}"),
        }
    }

    #[test]
    fn root_missing_value_is_usage_error() {
        match parse_args(&args(&["lint", "--root"])) {
            ParseOutcome::UsageError(msg) => assert!(msg.contains("--root requires")),
            other => panic!("expected UsageError, got {other:?}"),
        }
    }

    #[test]
    fn unknown_flag_is_usage_error() {
        match parse_args(&args(&["lint", "--bogus"])) {
            ParseOutcome::UsageError(msg) => assert!(msg.contains("unknown argument")),
            other => panic!("expected UsageError, got {other:?}"),
        }
    }

    #[test]
    fn subcommand_help_short_circuits() {
        assert_eq!(
            parse_args(&args(&["compile", "--help"])),
            ParseOutcome::Help(COMPILE_HELP)
        );
        assert_eq!(parse_args(&args(&["lint", "-h"])), ParseOutcome::Help(LINT_HELP));
    }

    // ── exit-code policy ────────────────────────────────────────────────

    #[test]
    fn compile_exit_code_clean() {
        assert_eq!(compile_exit_code(false, 0), OK_EXIT);
    }

    #[test]
    fn compile_exit_code_drift() {
        assert_eq!(compile_exit_code(false, 1), PROBLEM_EXIT);
        assert_eq!(compile_exit_code(false, 3), PROBLEM_EXIT);
    }

    #[test]
    fn compile_exit_code_validation_error_wins_even_with_zero_drift() {
        assert_eq!(compile_exit_code(true, 0), PROBLEM_EXIT);
    }

    #[test]
    fn lint_exit_code_no_errors() {
        assert_eq!(lint_exit_code(0), OK_EXIT);
    }

    #[test]
    fn lint_exit_code_with_errors() {
        assert_eq!(lint_exit_code(1), PROBLEM_EXIT);
        assert_eq!(lint_exit_code(5), PROBLEM_EXIT);
    }

    // ── resolve_root ────────────────────────────────────────────────────

    #[test]
    fn resolve_root_uses_given_path() {
        let r = resolve_root(Some("/some/path")).expect("ok");
        assert_eq!(r, PathBuf::from("/some/path"));
    }

    #[test]
    fn resolve_root_defaults_to_cwd() {
        let r = resolve_root(None).expect("cwd should resolve in a test process");
        assert_eq!(r, env::current_dir().unwrap());
    }
}
