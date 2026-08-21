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
        "filePath": file_path, "readOrder": 1,
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
        always_in_context: false,
        read_order: 0,
        tags: Vec::new(),
        owner: String::new(),
        meta: serde_json::Map::new(),
        agent_facts: None,
        neighbors: vec![
            NeighborInfo {
                title: "Rules".to_string(),
                brief: "House rules".to_string(),
                role: "rules".to_string(),
                edge_kind: "imports".to_string(),
                outgoing: true,
            },
            NeighborInfo {
                title: "Notes".to_string(),
                brief: String::new(),
                role: "reference".to_string(),
                edge_kind: "references".to_string(),
                outgoing: false,
            },
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

// ── D5: extra graph-carried facts ───────────────────────────────────────

/// Golden-string regression: `test_job` carries no pinned/readOrder/tags/
/// owner/meta/agent — its prompt must stay byte-identical to the pre-D5
/// shape (same assertions as `prompt_assemble_has_brief_neighbors_and_
/// length_target`, plus explicit absence of every new facts line).
#[test]
fn ordinary_node_prompt_omits_empty_facts() {
    let p = build_prompt(&test_job(AssembleMode::Assemble, None), None);
    assert!(!p.contains("Always in context"));
    assert!(!p.contains("Read order:"));
    assert!(!p.contains("Tags:"));
    assert!(!p.contains("Owner:"));
    assert!(!p.contains("Meta:"));
    assert!(!p.contains("Agent:"));
    // Node line flows straight into Brief with no blank separator, exactly
    // as before D5.
    assert!(p.contains("Persona (role: persona).\nBrief: Who the agent is"));
}

#[test]
fn node_prompt_includes_facts_when_present() {
    let mut job = test_job(AssembleMode::Assemble, None);
    job.always_in_context = true;
    job.read_order = 5;
    job.tags = vec!["design".to_string(), "core".to_string()];
    job.owner = "marty".to_string();
    let mut meta = serde_json::Map::new();
    meta.insert(
        "source".to_string(),
        serde_json::Value::String("import".to_string()),
    );
    job.meta = meta;
    let p = build_prompt(&job, None);
    assert!(p.contains("Always in context: this file is included in every request."));
    assert!(p.contains("Read order: position 5 in the compiled read order."));
    assert!(p.contains("Tags: design, core."));
    assert!(p.contains("Owner: marty."));
    assert!(p.contains("Meta: source: import."));
}

// ── D11a: "always in context" comes from resolve_load, not the removed
// `pinned` field — a stale `pinned` read here always deserialized `false`,
// so the "Pinned: always in context." line had silently never fired for
// ANY node since the v5 migration. These exercise `build_job`'s real
// resolve_load-driven computation end to end (graph JSON in, `Job.
// always_in_context` out), not just `build_prompt`'s rendering of an
// already-set flag (covered above).

#[test]
fn build_job_marks_a_root_always_node_as_always_in_context() {
    let dir = temp_project("always-root");
    let node = json!({
        "id": "a", "title": "A", "role": "rules", "brief": "b",
        "filePath": "context/a.md", "readOrder": 1, "rootLoad": "always",
        "position": { "x": 0, "y": 0 }
    });
    let graph = graph_str(&[node], &[]);
    let job = build_job(
        dir.to_string_lossy().into_owned(),
        graph,
        "a".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap();
    assert!(job.always_in_context);
    assert!(build_prompt(&job, None)
        .contains("Always in context: this file is included in every request."));
}

/// resolve_load rule 2 (deprecated) outranks rule 5 (root-always) — a
/// deprecated node must not be reported as always-in-context just because
/// it still carries `rootLoad: "always"` on the wire.
#[test]
fn build_job_a_deprecated_root_always_node_is_not_always_in_context() {
    let dir = temp_project("always-deprecated");
    let node = json!({
        "id": "a", "title": "A", "role": "rules", "brief": "b",
        "filePath": "context/a.md", "readOrder": 1, "rootLoad": "always",
        "deprecated": { "replacedBy": "b" },
        "position": { "x": 0, "y": 0 }
    });
    let graph = graph_str(&[node], &[]);
    let job = build_job(
        dir.to_string_lossy().into_owned(),
        graph,
        "a".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap();
    assert!(!job.always_in_context);
}

/// resolve_load rule 3 (Amendment 1's `command` destination lock) outranks
/// rule 5 — a `command`-role node resolves to `on-invoke`, never `always`,
/// regardless of `rootLoad`.
#[test]
fn build_job_a_root_always_command_node_is_locked_to_on_invoke_not_always() {
    let dir = temp_project("always-command");
    let node = json!({
        "id": "a", "title": "A", "role": "command", "brief": "b",
        "filePath": "context/a.md", "readOrder": 1, "rootLoad": "always",
        "position": { "x": 0, "y": 0 }
    });
    let graph = graph_str(&[node], &[]);
    let job = build_job(
        dir.to_string_lossy().into_owned(),
        graph,
        "a".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap();
    assert!(!job.always_in_context);
}

/// The genuinely new case a `pinned`-keyed check could never have covered:
/// an unpinned node reached by an UNGUARDED `imports` edge from a
/// root-always node is itself always-in-context (resolve_load rule 6, the
/// "imported" closure) — the boot prompt now agrees with what compile
/// actually inlines into `## Always read`.
#[test]
fn build_job_a_node_reached_by_unguarded_imports_from_a_root_always_node_is_always_in_context() {
    let dir = temp_project("always-imported");
    let root_node = json!({
        "id": "a", "title": "A", "role": "rules", "brief": "b",
        "filePath": "context/a.md", "readOrder": 1, "rootLoad": "always",
        "position": { "x": 0, "y": 0 }
    });
    let target_node = node_json("b", "B", "brief b", "context/b.md");
    let edge = json!({ "id": "e1", "source": "a", "target": "b", "kind": "imports" });
    let graph = graph_str(&[root_node, target_node], &[edge]);
    let job = build_job(
        dir.to_string_lossy().into_owned(),
        graph,
        "b".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap();
    assert!(
        job.always_in_context,
        "b is pulled into the always closure via a's unguarded imports edge"
    );
}

/// THE single most dangerous invariant (WO13_CONTRACT.md §8.2's boxed
/// warning), exercised at this call site too: a GUARDED `imports` edge must
/// NOT propagate always-in-context, or a migrated `conditional` edge would
/// silently make the boot prompt claim every such target is always loaded.
#[test]
fn build_job_a_guarded_import_does_not_propagate_always_in_context() {
    let dir = temp_project("always-guarded");
    let root_node = json!({
        "id": "a", "title": "A", "role": "rules", "brief": "b",
        "filePath": "context/a.md", "readOrder": 1, "rootLoad": "always",
        "position": { "x": 0, "y": 0 }
    });
    let target_node = node_json("b", "B", "brief b", "context/b.md");
    let edge = json!({
        "id": "e1", "source": "a", "target": "b", "kind": "imports",
        "guard": { "type": "glob", "globs": ["*.md"] }
    });
    let graph = graph_str(&[root_node, target_node], &[edge]);
    let job = build_job(
        dir.to_string_lossy().into_owned(),
        graph,
        "b".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap();
    assert!(!job.always_in_context);
}

#[test]
fn prompt_neighbors_carry_role_kind_and_direction() {
    let p = build_prompt(&test_job(AssembleMode::Assemble, None), None);
    // Rules: outgoing `imports` edge, role "rules".
    assert!(p.contains("- Rules: House rules [-> imports, role: rules]"));
    // Notes: incoming `references` edge, role "reference", empty brief.
    assert!(p.contains("- Notes [<- references, role: reference]"));
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

    // WO13_CONTRACT.md §3.3: `status` still only ever takes these four
    // values, but a job now emits FIVE events, not three — "starting" and
    // "writing" both carry status "running", distinguished by `phase`.
    let events = [
        next_event(&mut rx).await,
        next_event(&mut rx).await,
        next_event(&mut rx).await,
        next_event(&mut rx).await,
        next_event(&mut rx).await,
    ];
    let statuses: Vec<&str> = events.iter().map(|e| e.status.as_str()).collect();
    assert_eq!(
        statuses,
        ["queued", "running", "running", "running", "assembled"]
    );
    let phases: Vec<&str> = events.iter().map(|e| e.phase.as_str()).collect();
    assert_eq!(
        phases,
        ["queued", "starting", "running", "writing", "done"]
    );
    // `startedAt` is absent for "queued" and present + IDENTICAL for every
    // event from "starting" onward — one stable origin per job.
    assert_eq!(events[0].started_at, None);
    let started_at = events[1].started_at.expect("starting carries startedAt");
    for e in &events[1..] {
        assert_eq!(e.started_at, Some(started_at));
    }
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

    // FailRunner errors from inside `runner.run`, which `run_job` calls
    // AFTER emitting "running" but before "writing" — so this job's
    // lifecycle is one event shorter than the success path's:
    // queued, starting, running, error (never "writing", nothing was ever
    // produced to write).
    let events = [
        next_event(&mut rx).await,
        next_event(&mut rx).await,
        next_event(&mut rx).await,
        next_event(&mut rx).await,
    ];
    let phases: Vec<&str> = events.iter().map(|e| e.phase.as_str()).collect();
    assert_eq!(phases, ["queued", "starting", "running", "error"]);
    assert_eq!(events[3].status, "error");
    assert_eq!(events[3].error.as_deref(), Some("boom"));
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
    assert_eq!(neighbors.len(), 2);
    assert_eq!(neighbors[0].title, "B");
    assert_eq!(neighbors[0].brief, "brief b");
    assert_eq!(neighbors[0].role, "rules");
    assert_eq!(neighbors[0].edge_kind, "references");
    assert!(neighbors[0].outgoing, "a -> b: a is the edge source");
    assert_eq!(neighbors[1].title, "C");
    assert_eq!(neighbors[1].brief, "brief c");
    assert!(!neighbors[1].outgoing, "c -> a: a is the edge target");
}

// ── Claude override seam (contract §1-S4) ─────────────────────────────

#[tokio::test]
async fn claude_override_routes_the_spawn_then_clears() {
    // The static is process-global; this is the only test that touches it,
    // and it restores None before finishing so ClaudeRunner tests elsewhere
    // (there are none today) would see auto-resolve again.
    let bogus = std::env::temp_dir().join(format!(
        "cowtext-no-such-claude-{}.exe",
        std::process::id()
    ));
    set_claude_override(Some(bogus.clone()));
    let runner = ClaudeRunner::default();
    let err = runner
        .run("prompt".to_string())
        .await
        .expect_err("bogus override path must fail to spawn");
    assert!(
        err.contains(&bogus.display().to_string()),
        "spawn error should mention the override path, got: {err}"
    );
    set_claude_override(None);
    assert!(claude_override().is_none());
}

// ── D5/F7: build_job (the enqueue/preview seam) ────────────────────────

/// `build_job` alone reproduces three of the four enqueue-time error
/// strings (dup detection needs live queue state and stays in `enqueue`);
/// the existing `enqueue_rejects_*` tests above cover all four end-to-end
/// and are unmodified by this refactor.
#[test]
fn build_job_errors_match_enqueue_error_strings() {
    let err = build_job(
        "Z:/definitely/not/a/dir".to_string(),
        four_node_graph(),
        "a".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap_err();
    assert!(err.starts_with("Not a directory: "));

    let dir = temp_project("buildjob-badgraph");
    let err = build_job(
        dir.to_string_lossy().into_owned(),
        "{ not json".to_string(),
        "a".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap_err();
    assert!(err.starts_with("graph.json: "));

    let dir2 = temp_project("buildjob-unknown");
    let err = build_job(
        dir2.to_string_lossy().into_owned(),
        four_node_graph(),
        "nope".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap_err();
    assert_eq!(err, "Unknown node: nope");
}

// ── D5: agent facts ──────────────────────────────────────────────────────

fn agent_frontmatter(model: &str, body: &str) -> String {
    format!(
        "---\nname: foo\ndescription: test agent\nmodel: {model}\ntools: Read, Grep\nskills: []\n---\n\n{body}\n"
    )
}

#[test]
fn agent_node_prompt_includes_agent_block() {
    let dir = temp_project("agentprompt");
    fs::create_dir_all(dir.join(".claude/agents")).unwrap();
    fs::write(
        dir.join(".claude/agents/foo.md"),
        agent_frontmatter("sonnet", "# Duties\n\nDo the thing."),
    )
    .unwrap();
    let graph = graph_str(
        &[node_json("a", "Foo", "brief", ".claude/agents/foo.md")],
        &[],
    );
    let job = build_job(
        dir.to_string_lossy().into_owned(),
        graph,
        "a".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap();
    let p = build_prompt(&job, None);
    assert!(p.contains("Agent:"));
    assert!(p.contains("- Model: sonnet"));
    assert!(p.contains("- Tools: Read, Grep"));
    assert!(p.contains("Do the thing."));
}

#[test]
fn agent_node_missing_agents_json_still_ok_with_frontmatter_facts() {
    let dir = temp_project("agentnometa");
    fs::create_dir_all(dir.join(".claude/agents")).unwrap();
    fs::write(
        dir.join(".claude/agents/foo.md"),
        agent_frontmatter("opus", "Body text."),
    )
    .unwrap();
    // No .cowtext/agents.json at all.
    let graph = graph_str(
        &[node_json("a", "Foo", "brief", ".claude/agents/foo.md")],
        &[],
    );
    let job = build_job(
        dir.to_string_lossy().into_owned(),
        graph,
        "a".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap();
    let facts = job.agent_facts.as_ref().expect("agent facts present");
    assert_eq!(facts.model.as_deref(), Some("opus"));
    assert_eq!(facts.nickname, None);
    assert_eq!(facts.priority, None);
    let p = build_prompt(&job, None);
    assert!(p.contains("- Model: opus"));
}

#[test]
fn agent_node_corrupt_agents_json_still_ok() {
    let dir = temp_project("agentbadmeta");
    fs::create_dir_all(dir.join(".claude/agents")).unwrap();
    fs::create_dir_all(dir.join(".cowtext")).unwrap();
    fs::write(
        dir.join(".claude/agents/foo.md"),
        agent_frontmatter("haiku", "Body."),
    )
    .unwrap();
    fs::write(dir.join(".cowtext/agents.json"), "{ not json").unwrap();
    let graph = graph_str(
        &[node_json("a", "Foo", "brief", ".claude/agents/foo.md")],
        &[],
    );
    let job = build_job(
        dir.to_string_lossy().into_owned(),
        graph,
        "a".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap();
    let facts = job.agent_facts.as_ref().expect("agent facts present");
    assert_eq!(facts.model.as_deref(), Some("haiku"));
    assert_eq!(facts.nickname, None);
}

/// WO13_CONTRACT.md §3.2 (D8): `influence` stays in the `.cowtext/agents.json`
/// sidecar (the slider still reads/writes it) but has NO Rust reader left —
/// `AgentFacts` carries no `influence` field and the boot prompt never
/// mentions it, which is what makes the `local only` badge on the slider a
/// true statement rather than an aspirational one. The sidecar fixture below
/// deliberately still carries `"influence": 80` to prove it is tolerated
/// (extra JSON key, ignored) rather than rejected.
#[test]
fn agent_node_reads_priority_from_sidecar_and_never_surfaces_influence() {
    let dir = temp_project("agentmeta");
    fs::create_dir_all(dir.join(".claude/agents")).unwrap();
    fs::create_dir_all(dir.join(".cowtext")).unwrap();
    fs::write(
        dir.join(".claude/agents/foo.md"),
        agent_frontmatter("sonnet", "Body."),
    )
    .unwrap();
    fs::write(
        dir.join(".cowtext/agents.json"),
        json!({
            "version": 1,
            "agents": { "foo.md": { "nickname": "Foo Bot", "priority": 1, "influence": 80 } }
        })
        .to_string(),
    )
    .unwrap();
    let graph = graph_str(
        &[node_json("a", "Foo", "brief", ".claude/agents/foo.md")],
        &[],
    );
    let job = build_job(
        dir.to_string_lossy().into_owned(),
        graph,
        "a".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap();
    let facts = job.agent_facts.as_ref().expect("agent facts present");
    assert_eq!(facts.nickname.as_deref(), Some("Foo Bot"));
    assert_eq!(facts.priority, Some(1));
    let p = build_prompt(&job, None);
    assert!(p.contains("- Priority: 1"));
    assert!(!p.contains("Influence"), "boot prompt must never mention influence: {p}");
}

#[test]
fn non_agent_node_has_no_agent_facts() {
    let dir = temp_project("notanagent");
    let job = build_job(
        dir.to_string_lossy().into_owned(),
        four_node_graph(),
        "a".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap();
    assert!(job.agent_facts.is_none());
}

// ── F7: assemble_preview ─────────────────────────────────────────────────

#[test]
fn preview_missing_target_is_ok_with_none_old_content() {
    let dir = temp_project("previewmissing");
    let graph = graph_str(
        &[node_json("a", "A", "brief a", "context/a.md")],
        &[],
    );
    let preview = assemble_preview(
        dir.to_string_lossy().into_owned(),
        graph,
        "a".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap();
    assert_eq!(preview.old_content, None);
    assert_eq!(preview.rel_path, "context/a.md");
    assert_eq!(preview.mode, AssembleMode::Assemble);
    assert!(preview.prompt.contains("Brief: brief a"));
}

#[test]
fn preview_existing_target_reads_old_content() {
    let dir = temp_project("previewexisting");
    fs::create_dir_all(dir.join("context")).unwrap();
    fs::write(dir.join("context/a.md"), "existing content\n").unwrap();
    let graph = graph_str(
        &[node_json("a", "A", "brief a", "context/a.md")],
        &[],
    );
    let preview = assemble_preview(
        dir.to_string_lossy().into_owned(),
        graph,
        "a".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap();
    assert_eq!(preview.old_content.as_deref(), Some("existing content\n"));
}

#[test]
fn preview_rejects_non_markdown() {
    let dir = temp_project("previewnonmd");
    let graph = graph_str(&[node_json("a", "A", "b", "context/a.txt")], &[]);
    let err = assemble_preview(
        dir.to_string_lossy().into_owned(),
        graph,
        "a".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap_err();
    assert_eq!(err, "Refusing to write non-markdown file: context/a.txt");
}

#[test]
fn preview_neighbors_are_titles() {
    let dir = temp_project("previewneighbors");
    let graph = graph_str(
        &[
            node_json("a", "A", "brief a", "context/a.md"),
            node_json("b", "B", "brief b", "context/b.md"),
        ],
        &[edge_json("a", "b")],
    );
    let preview = assemble_preview(
        dir.to_string_lossy().into_owned(),
        graph,
        "a".to_string(),
        AssembleMode::Assemble,
        None,
    )
    .unwrap();
    assert_eq!(preview.neighbors, vec!["B".to_string()]);
}

// ── D5: ONE_WRITER — agent target patches body only ─────────────────────

#[tokio::test]
async fn agent_target_patches_body_only_preserving_frontmatter() {
    let dir = temp_project("agentwrite");
    fs::create_dir_all(dir.join(".claude/agents")).unwrap();
    fs::write(
        dir.join(".claude/agents/foo.md"),
        "---\nname: foo\ndescription: test agent\nmodel: sonnet\ntools: Read, Grep\nskills: []\n---\n\n# Old body\n",
    )
    .unwrap();
    let graph = graph_str(
        &[node_json("a", "Foo", "brief", ".claude/agents/foo.md")],
        &[],
    );
    let queue = AssembleQueue::new(Arc::new(EchoRunner("New assembled body")));
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
    while last.status != "assembled" {
        last = next_event(&mut rx).await;
    }
    let written = fs::read_to_string(dir.join(".claude/agents/foo.md")).unwrap();
    assert!(written.starts_with("---\nname: foo\n"));
    assert!(written.contains("model: sonnet"));
    assert!(written.ends_with("New assembled body\n"));
}

#[tokio::test]
async fn agent_target_missing_file_still_writes_body_only() {
    let dir = temp_project("agentwritemissing");
    // No `.claude/agents/foo.md` on disk at all — the node references a
    // not-yet-created agent file.
    let graph = graph_str(
        &[node_json("a", "Foo", "brief", ".claude/agents/foo.md")],
        &[],
    );
    let queue = AssembleQueue::new(Arc::new(EchoRunner("Fresh body")));
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
    while last.status != "assembled" {
        last = next_event(&mut rx).await;
    }
    assert_eq!(
        fs::read_to_string(dir.join(".claude/agents/foo.md")).unwrap(),
        "Fresh body\n"
    );
}
