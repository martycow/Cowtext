//! Assemble: expand node briefs into full files via headless `claude -p`
//! (plan §6). A FIFO queue drives at most two concurrent child processes.
//!
//! Invariants this module owns:
//! - **Err only at enqueue time**: commands return `Err` for the four
//!   enqueue-time failures (bad root, bad graph JSON, unknown node,
//!   duplicate). Everything after enqueue travels as `assemble://status`
//!   events — a job never produces a command error.
//! - **One write target**: a job writes ONLY to its node's `filePath`,
//!   resolved through `resolve_within_root`, and only when that path ends
//!   in `.md` (case-insensitive). No other write exists in this module.
//! - **Testable spawn**: the `claude -p` child sits behind the [`Runner`]
//!   trait so the queue logic runs under unit tests with a fake runner.

#[cfg(test)]
mod tests;

use crate::project::{checked_root, resolve_within_root, write_atomic};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, State};

/// Settings-provided absolute path to the claude binary (contract §1-S4).
static CLAUDE_OVERRIDE: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Settings-provided absolute path to the claude binary. None = auto-resolve.
pub fn set_claude_override(p: Option<PathBuf>) {
    *CLAUDE_OVERRIDE.lock().unwrap() = p;
}

fn claude_override() -> Option<PathBuf> {
    CLAUDE_OVERRIDE.lock().unwrap().clone()
}

/// Hard cap on concurrent `claude -p` children (plan §6).
const MAX_CONCURRENT: usize = 2;

/// Tauri event channel for job progress.
const STATUS_EVENT: &str = "assemble://status";

// ── Wire types (camelCase, mirrored in src/assemble/types.ts) ─────────

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum AssembleMode {
    Assemble,
    Refine,
    Summarize,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AssembleJobInfo {
    pub node_id: String,
    pub mode: AssembleMode,
    pub status: JobStatus,
}

/// Emitted on every job transition: queued → running → assembled | error.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssembleProgress {
    pub node_id: String,
    /// "queued" | "running" | "assembled" | "error"
    pub status: String,
    /// Set only when `status == "error"`; serialized as `null` otherwise
    /// (the TS mirror declares `error: string | null` — contract §1.1).
    pub error: Option<String>,
}

// ── Input model (tolerant subset of graph.json, plan §4) ──────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphIn {
    #[serde(default)]
    project_name: String,
    #[serde(default)]
    nodes: Vec<NodeIn>,
    #[serde(default)]
    edges: Vec<EdgeIn>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NodeIn {
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    role: String,
    #[serde(default)]
    brief: String,
    file_path: String,
}

#[derive(Deserialize)]
struct EdgeIn {
    source: String,
    target: String,
}

// ── Queue core ────────────────────────────────────────────────────────

/// Everything a job needs after enqueue; the graph snapshot is not kept.
struct Job {
    node_id: String,
    mode: AssembleMode,
    root: PathBuf,
    file_path: String,
    project_name: String,
    title: String,
    role: String,
    brief: String,
    /// (title, brief) of 1-hop neighbors, in graph node order.
    neighbors: Vec<(String, String)>,
    /// Refine only.
    instruction: Option<String>,
}

#[derive(Default)]
struct Inner {
    queued: VecDeque<Job>,
    running: Vec<(String, AssembleMode)>,
}

/// Progress consumer. Commands wrap `app.emit`; tests capture into a channel.
pub type Sink = Arc<dyn Fn(AssembleProgress) + Send + Sync>;

/// The `claude -p` seam. Production uses [`ClaudeRunner`]; tests inject fakes.
pub trait Runner: Send + Sync {
    fn run(&self, prompt: String) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + '_>>;
}

/// Managed Tauri state: FIFO queue + the runner behind it.
pub struct AssembleQueue {
    inner: Arc<Mutex<Inner>>,
    runner: Arc<dyn Runner>,
}

impl AssembleQueue {
    pub fn new(runner: Arc<dyn Runner>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
            runner,
        }
    }

    /// Validate, build the job, queue it, emit "queued", pump.
    /// The four `Err` cases here are the ONLY command errors in this module.
    fn enqueue(
        &self,
        sink: Sink,
        root: String,
        graph_json: String,
        node_id: String,
        mode: AssembleMode,
        instruction: Option<String>,
    ) -> Result<(), String> {
        let root_path = checked_root(&root)?;
        let graph: GraphIn =
            serde_json::from_str(&graph_json).map_err(|e| format!("graph.json: {e}"))?;
        let node = graph
            .nodes
            .iter()
            .find(|n| n.id == node_id)
            .ok_or_else(|| format!("Unknown node: {node_id}"))?;

        let project_name = if graph.project_name.is_empty() {
            root_path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| root.clone())
        } else {
            graph.project_name.clone()
        };
        let job = Job {
            node_id: node_id.clone(),
            mode,
            root: root_path,
            file_path: node.file_path.clone(),
            project_name,
            title: node.title.clone(),
            role: node.role.clone(),
            brief: node.brief.clone(),
            neighbors: neighbors_of(&graph, &node_id),
            instruction,
        };

        {
            let mut inner = self.inner.lock().expect("assemble queue mutex");
            let dup = inner.queued.iter().any(|j| j.node_id == node_id)
                || inner.running.iter().any(|(id, _)| *id == node_id);
            if dup {
                return Err(format!("Node already queued: {node_id}"));
            }
            inner.queued.push_back(job);
        }
        sink(AssembleProgress {
            node_id,
            status: "queued".to_string(),
            error: None,
        });
        pump(self.inner.clone(), self.runner.clone(), sink);
        Ok(())
    }

    /// Running jobs (start order) then queued jobs (FIFO order).
    fn status(&self) -> Vec<AssembleJobInfo> {
        let inner = self.inner.lock().expect("assemble queue mutex");
        let mut out = Vec::with_capacity(inner.running.len() + inner.queued.len());
        for (id, mode) in &inner.running {
            out.push(AssembleJobInfo {
                node_id: id.clone(),
                mode: *mode,
                status: JobStatus::Running,
            });
        }
        for j in &inner.queued {
            out.push(AssembleJobInfo {
                node_id: j.node_id.clone(),
                mode: j.mode,
                status: JobStatus::Queued,
            });
        }
        out
    }

    /// Remove a queued (not yet running) job. Running jobs are not killed.
    fn cancel(&self, node_id: &str) -> bool {
        let mut inner = self.inner.lock().expect("assemble queue mutex");
        let before = inner.queued.len();
        inner.queued.retain(|j| j.node_id != node_id);
        inner.queued.len() != before
    }
}

/// 1-hop neighbors of `node_id` over edges of any kind, either direction,
/// deduped, in graph node order (deterministic prompts).
fn neighbors_of(graph: &GraphIn, node_id: &str) -> Vec<(String, String)> {
    graph
        .nodes
        .iter()
        .filter(|n| {
            n.id != node_id
                && graph.edges.iter().any(|e| {
                    (e.source == node_id && e.target == n.id)
                        || (e.target == node_id && e.source == n.id)
                })
        })
        .map(|n| (n.title.clone(), n.brief.clone()))
        .collect()
}

/// Start queued jobs while a concurrency slot is free. Each finished job
/// re-pumps, so the queue drains without a scheduler task.
fn pump(inner: Arc<Mutex<Inner>>, runner: Arc<dyn Runner>, sink: Sink) {
    loop {
        let job = {
            let mut guard = inner.lock().expect("assemble queue mutex");
            if guard.running.len() >= MAX_CONCURRENT {
                return;
            }
            let Some(job) = guard.queued.pop_front() else {
                return;
            };
            guard.running.push((job.node_id.clone(), job.mode));
            job
        };
        let inner2 = inner.clone();
        let runner2 = runner.clone();
        let sink2 = sink.clone();
        tauri::async_runtime::spawn(async move {
            sink2(AssembleProgress {
                node_id: job.node_id.clone(),
                status: "running".to_string(),
                error: None,
            });
            let outcome = run_job(&job, runner2.as_ref()).await;
            // Free the slot before the terminal event so `assemble_status`
            // never reports a finished job as running.
            inner2
                .lock()
                .expect("assemble queue mutex")
                .running
                .retain(|(id, _)| *id != job.node_id);
            sink2(match outcome {
                Ok(()) => AssembleProgress {
                    node_id: job.node_id.clone(),
                    status: "assembled".to_string(),
                    error: None,
                },
                Err(e) => AssembleProgress {
                    node_id: job.node_id.clone(),
                    status: "error".to_string(),
                    error: Some(e),
                },
            });
            pump(inner2, runner2, sink2);
        });
    }
}

/// Guard the path, build the prompt, run claude, write the result.
async fn run_job(job: &Job, runner: &dyn Runner) -> Result<(), String> {
    if !job.file_path.to_lowercase().ends_with(".md") {
        return Err(format!(
            "Refusing to write non-markdown file: {}",
            job.file_path
        ));
    }
    let target = resolve_within_root(&job.root, &job.file_path)?;
    let current = if job.mode == AssembleMode::Summarize {
        Some(fs::read_to_string(&target).map_err(|e| format!("{}: {e}", job.file_path))?)
    } else {
        None
    };
    let prompt = build_prompt(job, current.as_deref());
    let mut content = runner.run(prompt).await?;
    if !content.ends_with('\n') {
        content.push('\n');
    }
    write_atomic(&target, &content)
}

/// Prompt per plan §6: project name, node role + title, brief (or, for
/// Summarize, the current file content with a compress instruction),
/// titles+briefs of 1-hop neighbors, target ≤ 60 lines. Refine appends
/// the user instruction.
fn build_prompt(job: &Job, current_content: Option<&str>) -> String {
    let mut lines: Vec<String> = vec![
        format!(
            "You are writing `{}`, one context file of the project \"{}\".",
            job.file_path, job.project_name
        ),
        format!("Node: {} (role: {}).", job.title, job.role),
    ];
    if job.mode == AssembleMode::Summarize {
        lines.push(
            "Compress the current file content below: keep every rule and fact that matters, \
             drop filler and redundancy."
                .to_string(),
        );
        lines.push(String::new());
        lines.push("Current file content:".to_string());
        lines.push(current_content.unwrap_or("").trim_end().to_string());
    } else {
        lines.push(format!("Brief: {}", job.brief));
    }
    if !job.neighbors.is_empty() {
        lines.push(String::new());
        lines.push("Neighboring nodes in the context graph (1 hop):".to_string());
        for (title, brief) in &job.neighbors {
            lines.push(if brief.is_empty() {
                format!("- {title}")
            } else {
                format!("- {title}: {brief}")
            });
        }
    }
    if let Some(instruction) = &job.instruction {
        lines.push(String::new());
        lines.push(format!("Additional instruction: {instruction}"));
    }
    lines.push(String::new());
    lines.push(
        "Write the complete markdown file content, at most 60 lines. \
         Output only the file content — no preamble, no code fences."
            .to_string(),
    );
    lines.join("\n")
}

// ── Production runner: headless `claude -p` ───────────────────────────

/// Spawns `claude -p --output-format json` with the prompt piped over
/// stdin. Windows-safe: resolves the claude binary via `where claude` at
/// first use (cached, `.exe` preferred over `.cmd`); falls back to
/// `cmd /C claude ...`. Never spawns bare `"claude"` on Windows
/// (CreateProcess will not find a `.cmd`). The prompt must NOT travel as
/// an argv argument: Rust rejects `.cmd`/`.bat` arguments containing
/// newlines (CVE-2024-24576 hardening) and every prompt is multi-line.
#[derive(Default)]
pub struct ClaudeRunner {
    resolved: OnceLock<Option<PathBuf>>,
}

impl ClaudeRunner {
    fn claude_path(&self) -> Option<PathBuf> {
        self.resolved.get_or_init(resolve_claude).clone()
    }
}

#[cfg(windows)]
fn resolve_claude() -> Option<PathBuf> {
    where_probe("claude")
}

/// `where <name>` probe, `.exe` preferred over `.cmd`. Shared with
/// settings.rs, which resolves a bare-name override the same way (a bare
/// name in `claudeBinaryPath` would otherwise never find an npm `.cmd`
/// shim — CreateProcess only appends `.exe`).
#[cfg(windows)]
pub(crate) fn where_probe(name: &str) -> Option<PathBuf> {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("where")
        .arg(name)
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW — no console flash in release
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    // Prefer a native .exe over the npm .cmd shim: batch files carry the
    // CVE-2024-24576 argument restrictions and an extra cmd.exe hop.
    lines
        .iter()
        .find(|l| l.to_lowercase().ends_with(".exe"))
        .or_else(|| lines.iter().find(|l| l.to_lowercase().ends_with(".cmd")))
        .or_else(|| lines.first())
        .map(PathBuf::from)
}

#[cfg(not(windows))]
fn resolve_claude() -> Option<PathBuf> {
    let out = std::process::Command::new("which")
        .arg("claude")
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(PathBuf::from)
}

impl Runner for ClaudeRunner {
    fn run(&self, prompt: String) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + '_>> {
        // Settings override wins outright: no `where` probe, no OnceLock
        // cache — a bad path surfaces as the normal spawn error.
        let program = claude_override().or_else(|| self.claude_path());
        Box::pin(async move {
            let mut cmd = match &program {
                Some(path) => tokio::process::Command::new(path),
                None => {
                    #[cfg(windows)]
                    {
                        let mut c = tokio::process::Command::new("cmd");
                        c.arg("/C").arg("claude");
                        c
                    }
                    #[cfg(not(windows))]
                    {
                        tokio::process::Command::new("claude")
                    }
                }
            };
            // No positional prompt: `claude -p` reads it from stdin. See the
            // ClaudeRunner doc comment for why argv is not an option here.
            cmd.arg("-p")
                .arg("--output-format")
                .arg("json")
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            #[cfg(windows)]
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
            let mut child = cmd.spawn().map_err(|e| match &program {
                Some(p) => format!("failed to spawn claude ({}): {e}", p.display()),
                None => format!("failed to spawn claude: {e}"),
            })?;
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| "failed to open claude stdin".to_string())?;
            // Write concurrently with output collection so a prompt larger
            // than the pipe buffer cannot deadlock against a full stdout
            // pipe. Write errors (child exited early) are deliberately
            // ignored — exit status and stderr carry the real diagnosis.
            let writer = tauri::async_runtime::spawn(async move {
                use tokio::io::AsyncWriteExt;
                let _ = stdin.write_all(prompt.as_bytes()).await;
                let _ = stdin.shutdown().await;
            });
            let output = child
                .wait_with_output()
                .await
                .map_err(|e| format!("failed to run claude: {e}"))?;
            let _ = writer.await;
            parse_claude_output(&output.stdout, &output.stderr, output.status.success())
        })
    }
}

/// Parse the `--output-format json` stdout: take the `result` string field.
/// Non-zero exit, unparseable JSON, or missing `result` → one-line error
/// with a stderr tail of at most 200 chars.
fn parse_claude_output(stdout: &[u8], stderr: &[u8], success: bool) -> Result<String, String> {
    let tail = stderr_tail(stderr);
    let with_tail = |msg: &str| -> String {
        if tail.is_empty() {
            msg.to_string()
        } else {
            format!("{msg}: {tail}")
        }
    };
    if !success {
        return Err(with_tail("claude exited with an error"));
    }
    let value: serde_json::Value = serde_json::from_slice(stdout)
        .map_err(|_| with_tail("claude output was not valid JSON"))?;
    match value.get("result").and_then(|r| r.as_str()) {
        Some(s) => Ok(s.to_string()),
        None => Err(with_tail("claude output had no \"result\" field")),
    }
}

/// Last ≤ 200 chars of stderr, flattened to one line.
fn stderr_tail(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let one_line = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let chars: Vec<char> = one_line.chars().collect();
    let start = chars.len().saturating_sub(200);
    chars[start..].iter().collect()
}

// ── Commands ──────────────────────────────────────────────────────────

fn emit_sink(app: AppHandle) -> Sink {
    Arc::new(move |p: AssembleProgress| {
        let _ = app.emit(STATUS_EVENT, &p);
    })
}

#[tauri::command]
pub async fn assemble_node(
    app: AppHandle,
    state: State<'_, AssembleQueue>,
    root: String,
    graph_json: String,
    node_id: String,
) -> Result<(), String> {
    state.enqueue(
        emit_sink(app),
        root,
        graph_json,
        node_id,
        AssembleMode::Assemble,
        None,
    )
}

#[tauri::command]
pub async fn refine_node(
    app: AppHandle,
    state: State<'_, AssembleQueue>,
    root: String,
    graph_json: String,
    node_id: String,
    instruction: String,
) -> Result<(), String> {
    state.enqueue(
        emit_sink(app),
        root,
        graph_json,
        node_id,
        AssembleMode::Refine,
        Some(instruction),
    )
}

#[tauri::command]
pub async fn summarize_node(
    app: AppHandle,
    state: State<'_, AssembleQueue>,
    root: String,
    graph_json: String,
    node_id: String,
) -> Result<(), String> {
    state.enqueue(
        emit_sink(app),
        root,
        graph_json,
        node_id,
        AssembleMode::Summarize,
        None,
    )
}

#[tauri::command]
pub fn assemble_status(state: State<'_, AssembleQueue>) -> Result<Vec<AssembleJobInfo>, String> {
    Ok(state.status())
}

#[tauri::command]
pub fn assemble_cancel(state: State<'_, AssembleQueue>, node_id: String) -> Result<bool, String> {
    Ok(state.cancel(&node_id))
}
