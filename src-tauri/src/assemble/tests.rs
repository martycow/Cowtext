use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use tokio::sync::Semaphore;
use tokio::time::{timeout, Duration};

// ── Helpers ───────────────────────────────────────────────────────────

fn temp_project(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cowtext-assemble-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn node_json(id: &str, title: &str, brief: &str, file_path: &str) -> serde_json::Value {
    json!({
        "id": id, "title": title, "role": "rules", "brief": brief,
        "filePath": file_path, "readOrder": 1, "pinned": false,
        "position": { "x": 0, "y": 0 }
    })
}

fn edge_json(source: &str, target: &str) -> serde_json::Value {
    json!({ "id": format!("e-{source}-{target}"), "source": source, "target": target,
            "kind": "references" })
}

fn graph_str(nodes: &[serde_json::Value], edges: &[serde_json::Value]) -> String {
    json!({ "version": 1, "projectName": "TestProj", "nodes": nodes, "edges": edges }).to_string()
}

/// Four independent nodes a..d, `context/<id>.md` each.
fn four_node_graph() -> String {
    graph_str(
        &[
            node_json("a", "A", "brief a", "context/a.md"),
            node_json("b", "B", "brief b", "context/b.md"),
            node_json("c", "C", "brief c", "context/c.md"),
            node_json("d", "D", "brief d", "context/d.md"),
        ],
        &[],
    )
}

fn sink_channel() -> (Sink, UnboundedReceiver<AssembleProgress>) {
    let (tx, rx) = unbounded_channel();
    let sink: Sink = Arc::new(move |p: AssembleProgress| {
        let _ = tx.send(p);
    });
    (sink, rx)
}

async fn next_event(rx: &mut UnboundedReceiver<AssembleProgress>) -> AssembleProgress {
    timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("timed out waiting for assemble event")
        .expect("event channel closed")
}

fn test_job(mode: AssembleMode, instruction: Option<String>) -> Job {
    Job {
        node_id: "a".to_string(),
        mode,
        root: PathBuf::from("."),
        file_path: "context/a.md".to_string(),
        project_name: "TestProj".to_string(),
        title: "Persona".to_string(),
        role: "persona".to_string(),
        brief: "Who the agent is".to_string(),
        neighbors: vec![
            ("Rules".to_string(), "House rules".to_string()),
            ("Notes".to_string(), String::new()),
        ],
        instruction,
    }
}

// ── Fake runners ──────────────────────────────────────────────────────

/// Resolves immediately with a fixed result.
struct EchoRunner(&'static str);

impl Runner for EchoRunner {
    fn run(&self, _prompt: String) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + '_>> {
        let out = self.0.to_string();
        Box::pin(async move { Ok(out) })
    }
}

/// Fails immediately.
struct FailRunner;

impl Runner for FailRunner {
    fn run(&self, _prompt: String) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + '_>> {
        Box::pin(async move { Err("boom".to_string()) })
    }
}

/// Records prompts, resolves immediately.
struct CaptureRunner {
    prompts: Mutex<Vec<String>>,
}

impl Runner for CaptureRunner {
    fn run(&self, prompt: String) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + '_>> {
        self.prompts.lock().unwrap().push(prompt);
        Box::pin(async move { Ok("captured result".to_string()) })
    }
}

/// Announces each start on a channel, then blocks until the test releases
/// one semaphore permit per job. Tracks peak concurrency.
struct GateRunner {
    sem: Arc<Semaphore>,
    started: UnboundedSender<String>,
    active: AtomicUsize,
    max_seen: AtomicUsize,
}

impl GateRunner {
    fn new(started: UnboundedSender<String>) -> Arc<Self> {
        Arc::new(Self {
            sem: Arc::new(Semaphore::new(0)),
            started,
            active: AtomicUsize::new(0),
            max_seen: AtomicUsize::new(0),
        })
    }
}

impl Runner for GateRunner {
    fn run(&self, prompt: String) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + '_>> {
        let n = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.max_seen.fetch_max(n, Ordering::SeqCst);
        let _ = self.started.send(prompt);
        let sem = self.sem.clone();
        Box::pin(async move {
            sem.acquire().await.expect("semaphore closed").forget();
            self.active.fetch_sub(1, Ordering::SeqCst);
            Ok("gated result".to_string())
        })
    }
}

// ── Prompt build ──────────────────────────────────────────────────────

#[test]
fn prompt_assemble_has_brief_neighbors_and_length_target() {
    let p = build_prompt(&test_job(AssembleMode::Assemble, None), None);
    assert!(p.contains("TestProj"));
    assert!(p.contains("`context/a.md`"));
    assert!(p.contains("Persona (role: persona)"));
    assert!(p.contains("Brief: Who the agent is"));
    assert!(p.contains("- Rules: House rules"));
    assert!(p.contains("- Notes"));
    assert!(p.contains("at most 60 lines"));
    assert!(!p.contains("Additional instruction"));
}

#[test]
fn prompt_refine_appends_instruction() {
    let p = build_prompt(
        &test_job(AssembleMode::Refine, Some("make it shorter".to_string())),
        None,
    );
    assert!(p.contains("Brief: Who the agent is"));
    assert!(p.contains("Additional instruction: make it shorter"));
}

#[test]
fn prompt_summarize_sends_content_instead_of_brief() {
    let p = build_prompt(
        &test_job(AssembleMode::Summarize, None),
        Some("old file content here\n"),
    );
    assert!(p.contains("old file content here"));
    assert!(p.contains("Compress"));
    assert!(!p.contains("Brief:"));
}

#[test]
fn prompt_no_neighbors_omits_section() {
    let mut job = test_job(AssembleMode::Assemble, None);
    job.neighbors.clear();
    let p = build_prompt(&job, None);
    assert!(!p.contains("Neighboring nodes"));
}

// ── claude output parsing ─────────────────────────────────────────────

#[test]
fn parse_output_takes_result_field() {
    let out = parse_claude_output(br#"{"result":"hello world","cost":1}"#, b"", true);
    assert_eq!(out.unwrap(), "hello world");
}

#[test]
fn parse_output_nonzero_exit_is_one_line_with_tail() {
    let stderr = format!("line one\nline two\n{}", "x".repeat(300));
    let err = parse_claude_output(b"", stderr.as_bytes(), false).unwrap_err();
    assert!(err.starts_with("claude exited with an error"));
    assert!(!err.contains('\n'));
    // tail capped at 200 chars
    assert!(err.len() <= "claude exited with an error: ".len() + 200);
}

#[test]
fn parse_output_bad_json() {
    let err = parse_claude_output(b"not json at all", b"warn", true).unwrap_err();
    assert!(err.contains("not valid JSON"));
    assert!(err.contains("warn"));
}

#[test]
fn parse_output_missing_result() {
    let err = parse_claude_output(br#"{"foo": 1}"#, b"", true).unwrap_err();
    assert!(err.contains("result"));
}

// ── Enqueue-time errors ───────────────────────────────────────────────

#[tokio::test]
async fn enqueue_rejects_bad_root() {
    let (sink, _rx) = sink_channel();
    let queue = AssembleQueue::new(Arc::new(EchoRunner("x")));
    let err = queue
        .enqueue(
            sink,
            "Z:/definitely/not/a/dir".to_string(),
            four_node_graph(),
            "a".to_string(),
            AssembleMode::Assemble,
            None,
        )
        .unwrap_err();
    assert!(err.starts_with("Not a directory: "));
}

#[tokio::test]
async fn enqueue_rejects_bad_graph_json() {
    let dir = temp_project("badgraph");
    let (sink, _rx) = sink_channel();
    let queue = AssembleQueue::new(Arc::new(EchoRunner("x")));
    let err = queue
        .enqueue(
            sink,
            dir.to_string_lossy().into_owned(),
            "{ not json".to_string(),
            "a".to_string(),
            AssembleMode::Assemble,
            None,
        )
        .unwrap_err();
    assert!(err.starts_with("graph.json: "));
}

#[tokio::test]
async fn enqueue_rejects_unknown_node() {
    let dir = temp_project("unknown");
    let (sink, _rx) = sink_channel();
    let queue = AssembleQueue::new(Arc::new(EchoRunner("x")));
    let err = queue
        .enqueue(
            sink,
            dir.to_string_lossy().into_owned(),
            four_node_graph(),
            "nope".to_string(),
            AssembleMode::Assemble,
            None,
        )
        .unwrap_err();
    assert_eq!(err, "Unknown node: nope");
}

#[tokio::test]
async fn enqueue_rejects_duplicate_node() {
    let dir = temp_project("dup");
    let root = dir.to_string_lossy().into_owned();
    let (started_tx, mut started_rx) = unbounded_channel();
    let runner = GateRunner::new(started_tx);
    let queue = AssembleQueue::new(runner.clone());
    let (sink, _rx) = sink_channel();

    queue
        .enqueue(
            sink.clone(),
            root.clone(),
            four_node_graph(),
            "a".to_string(),
            AssembleMode::Assemble,
            None,
        )
        .unwrap();
    // Wait until the job is actually running, then try again.
    timeout(Duration::from_secs(10), started_rx.recv())
        .await
        .expect("job never started")
        .expect("started channel closed");
    let err = queue
        .enqueue(
            sink,
            root,
            four_node_graph(),
            "a".to_string(),
            AssembleMode::Assemble,
            None,
        )
        .unwrap_err();
    assert_eq!(err, "Node already queued: a");
    runner.sem.add_permits(1);
}

// ── Queue behavior ────────────────────────────────────────────────────

#[tokio::test]
async fn queue_caps_at_two_and_drains_fifo() {
    let dir = temp_project("fifo");
    let root = dir.to_string_lossy().into_owned();
    let (started_tx, mut started_rx) = unbounded_channel();
    let runner = GateRunner::new(started_tx);
    let queue = AssembleQueue::new(runner.clone());
    let (sink, mut rx) = sink_channel();

    for id in ["a", "b", "c", "d"] {
        queue
            .enqueue(
                sink.clone(),
                root.clone(),
                four_node_graph(),
                id.to_string(),
                AssembleMode::Assemble,
                None,
            )
            .unwrap();
    }

    // First two starts are a and b (in either task order).
    let first = next_started(&mut started_rx).await;
    let second = next_started(&mut started_rx).await;
    let mut first_two = [first, second];
    first_two.sort();
    assert_eq!(first_two, ["a".to_string(), "b".to_string()]);

    // Snapshot: 2 running, c and d queued in FIFO order.
    let info = queue.status();
    assert_eq!(info.len(), 4);
    assert_eq!(
        info.iter().filter(|i| i.status == JobStatus::Running).count(),
        2
    );
    let queued: Vec<&str> = info
        .iter()
        .filter(|i| i.status == JobStatus::Queued)
        .map(|i| i.node_id.as_str())
        .collect();
    assert_eq!(queued, ["c", "d"]);

    // Release one slot → c must start before d.
    runner.sem.add_permits(1);
    assert_eq!(next_started(&mut started_rx).await, "c");
    runner.sem.add_permits(1);
    assert_eq!(next_started(&mut started_rx).await, "d");
    runner.sem.add_permits(2);

    // Drain: exactly four "assembled" events arrive, and concurrency
    // never exceeded 2.
    let mut assembled = 0;
    while assembled < 4 {
        if next_event(&mut rx).await.status == "assembled" {
            assembled += 1;
        }
    }
    assert!(runner.max_seen.load(Ordering::SeqCst) <= 2);
    assert!(queue.status().is_empty());
}

async fn next_started(rx: &mut UnboundedReceiver<String>) -> String {
    let prompt = timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("timed out waiting for a job start")
        .expect("started channel closed");
    for id in ["a", "b", "c", "d"] {
        if prompt.contains(&format!("context/{id}.md")) {
            return id.to_string();
        }
    }
    panic!("prompt matches no known node: {prompt}");
}

#[tokio::test]
async fn cancel_removes_queued_but_not_running() {
    let dir = temp_project("cancel");
    let root = dir.to_string_lossy().into_owned();
    let (started_tx, mut started_rx) = unbounded_channel();
    let runner = GateRunner::new(started_tx);
    let queue = AssembleQueue::new(runner.clone());
    let (sink, _rx) = sink_channel();

    for id in ["a", "b", "c"] {
        queue
            .enqueue(
                sink.clone(),
                root.clone(),
                four_node_graph(),
                id.to_string(),
                AssembleMode::Assemble,
                None,
            )
            .unwrap();
    }
    next_started(&mut started_rx).await;
    next_started(&mut started_rx).await;

    assert!(queue.cancel("c"), "queued job must be cancellable");
    assert!(!queue.cancel("a"), "running job must not be cancellable");
    assert!(!queue.cancel("zz"), "unknown id is a no-op");
    assert_eq!(queue.status().len(), 2);
    runner.sem.add_permits(2);
}

// ── Job execution ─────────────────────────────────────────────────────

#[tokio::test]
async fn job_writes_result_with_trailing_newline_and_reports_lifecycle() {
    let dir = temp_project("write");
    let root = dir.to_string_lossy().into_owned();
    let queue = AssembleQueue::new(Arc::new(EchoRunner("assembled body")));
    let (sink, mut rx) = sink_channel();

    queue
        .enqueue(
            sink,
            root,
            four_node_graph(),
            "a".to_string(),
            AssembleMode::Assemble,
            None,
        )
        .unwrap();

    let statuses = [
        next_event(&mut rx).await.status,
        next_event(&mut rx).await.status,
        next_event(&mut rx).await.status,
    ];
    assert_eq!(statuses, ["queued", "running", "assembled"]);
    let written = fs::read_to_string(dir.join("context/a.md")).unwrap();
    assert_eq!(written, "assembled body\n");
}

#[tokio::test]
async fn runner_failure_becomes_error_event_not_err() {
    let dir = temp_project("fail");
    let queue = AssembleQueue::new(Arc::new(FailRunner));
    let (sink, mut rx) = sink_channel();

    queue
        .enqueue(
            sink,
            dir.to_string_lossy().into_owned(),
            four_node_graph(),
            "a".to_string(),
            AssembleMode::Assemble,
            None,
        )
        .unwrap();

    let last = [
        next_event(&mut rx).await,
        next_event(&mut rx).await,
        next_event(&mut rx).await,
    ];
    assert_eq!(last[2].status, "error");
    assert_eq!(last[2].error.as_deref(), Some("boom"));
    assert!(!dir.join("context/a.md").exists());
}

#[tokio::test]
async fn non_markdown_target_errors_without_writing() {
    let dir = temp_project("nonmd");
    let graph = graph_str(&[node_json("a", "A", "b", "context/a.txt")], &[]);
    let queue = AssembleQueue::new(Arc::new(EchoRunner("x")));
    let (sink, mut rx) = sink_channel();

    queue
        .enqueue(
            sink,
            dir.to_string_lossy().into_owned(),
            graph,
            "a".to_string(),
            AssembleMode::Assemble,
            None,
        )
        .unwrap();
    let mut last = next_event(&mut rx).await;
    while last.status != "error" {
        last = next_event(&mut rx).await;
    }
    assert_eq!(
        last.error.as_deref(),
        Some("Refusing to write non-markdown file: context/a.txt")
    );
    assert!(!dir.join("context/a.txt").exists());
}

#[tokio::test]
async fn escaping_file_path_errors_via_event() {
    let dir = temp_project("escape");
    let graph = graph_str(&[node_json("a", "A", "b", "../evil.md")], &[]);
    let queue = AssembleQueue::new(Arc::new(EchoRunner("x")));
    let (sink, mut rx) = sink_channel();

    queue
        .enqueue(
            sink,
            dir.to_string_lossy().into_owned(),
            graph,
            "a".to_string(),
            AssembleMode::Assemble,
            None,
        )
        .unwrap();
    let mut last = next_event(&mut rx).await;
    while last.status != "error" {
        last = next_event(&mut rx).await;
    }
    assert!(last.error.as_deref().unwrap().contains("escapes project root"));
}

#[tokio::test]
async fn summarize_reads_current_file_into_prompt() {
    let dir = temp_project("sum");
    fs::create_dir_all(dir.join("context")).unwrap();
    fs::write(dir.join("context/a.md"), "existing long content\n").unwrap();
    let runner = Arc::new(CaptureRunner {
        prompts: Mutex::new(Vec::new()),
    });
    let queue = AssembleQueue::new(runner.clone());
    let (sink, mut rx) = sink_channel();

    queue
        .enqueue(
            sink,
            dir.to_string_lossy().into_owned(),
            four_node_graph(),
            "a".to_string(),
            AssembleMode::Summarize,
            None,
        )
        .unwrap();
    let mut last = next_event(&mut rx).await;
    while last.status != "assembled" {
        last = next_event(&mut rx).await;
    }
    let prompts = runner.prompts.lock().unwrap();
    assert_eq!(prompts.len(), 1);
    assert!(prompts[0].contains("existing long content"));
    assert!(!prompts[0].contains("Brief:"));
    drop(prompts);
    assert_eq!(
        fs::read_to_string(dir.join("context/a.md")).unwrap(),
        "captured result\n"
    );
}

#[tokio::test]
async fn neighbors_come_from_edges_both_directions() {
    let graph_json_str = graph_str(
        &[
            node_json("a", "A", "brief a", "context/a.md"),
            node_json("b", "B", "brief b", "context/b.md"),
            node_json("c", "C", "brief c", "context/c.md"),
            node_json("d", "D", "brief d", "context/d.md"),
        ],
        &[edge_json("a", "b"), edge_json("c", "a")],
    );
    let graph: GraphIn = serde_json::from_str(&graph_json_str).unwrap();
    let neighbors = neighbors_of(&graph, "a");
    assert_eq!(
        neighbors,
        vec![
            ("B".to_string(), "brief b".to_string()),
            ("C".to_string(), "brief c".to_string())
        ]
    );
}
