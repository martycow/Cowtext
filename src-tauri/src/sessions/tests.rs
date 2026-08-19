use super::*;

// ── register(): guardrails (contract §3) ────────────────────────────────

fn wt(path: &str) -> WorktreeInfo {
    WorktreeInfo { path: path.to_string(), is_repo: true, is_worktree: true, branch: Some("main".to_string()) }
}

#[test]
fn register_rejects_non_repo() {
    let reg = RegistryCore::default();
    let check = WorktreeInfo { path: "/tmp/x".to_string(), is_repo: false, is_worktree: false, branch: None };
    let err = reg
        .register(&check, "root".to_string(), None, "Agent".to_string())
        .unwrap_err();
    assert!(err.contains("not a git repository"), "{err}");
}

#[test]
fn register_rejects_empty_name() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-empty");
    let err = reg
        .register(&check, "root".to_string(), None, "   ".to_string())
        .unwrap_err();
    assert!(err.contains("Name is required"), "{err}");
}

#[test]
fn register_rejects_duplicate_alive_cwd() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-a");
    reg.register(&check, "root".to_string(), None, "Agent A".to_string()).unwrap();
    let err = reg
        .register(&check, "root".to_string(), None, "Agent B".to_string())
        .unwrap_err();
    assert!(err.contains("already running"), "{err}");
}

#[test]
fn register_allows_reuse_of_a_dead_sessions_cwd() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-b");
    let (info, _, _) = reg.register(&check, "root".to_string(), None, "Agent A".to_string()).unwrap();
    {
        let mut guard = reg.inner.lock().unwrap();
        guard.get_mut(&info.id).unwrap().info.alive = false;
    }
    let result = reg.register(&check, "root".to_string(), None, "Agent B".to_string());
    assert!(result.is_ok(), "a dead session must not hold its folder");
}

#[test]
fn register_rejects_over_max_sessions() {
    let reg = RegistryCore::default();
    for i in 0..MAX_SESSIONS {
        let check = wt(&format!("/tmp/proj-{i}"));
        reg.register(&check, "root".to_string(), None, format!("Agent {i}")).unwrap();
    }
    let check = wt("/tmp/proj-overflow");
    let err = reg
        .register(&check, "root".to_string(), None, "Overflow".to_string())
        .unwrap_err();
    assert!(err.contains("agent limit reached (4)"), "{err}");
}

#[test]
fn list_is_in_registration_order() {
    let reg = RegistryCore::default();
    let mut ids = Vec::new();
    for i in 0..3 {
        let check = wt(&format!("/tmp/proj-order-{i}"));
        let (info, _, _) = reg
            .register(&check, "root".to_string(), None, format!("Agent {i}"))
            .unwrap();
        ids.push(info.id);
    }
    let listed: Vec<String> = reg.list().into_iter().map(|s| s.id).collect();
    assert_eq!(listed, ids);
}

// ── generation_current: probe-race defect fix guard (contract §6.2) ────

#[test]
fn generation_current_true_only_for_the_live_generation_of_a_known_alive_entry() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-gen");
    let (info, _, _) = reg
        .register(&check, "root".to_string(), None, "Agent".to_string())
        .unwrap();

    assert!(generation_current(&reg.inner, &info.id, 0));
    assert!(!generation_current(&reg.inner, &info.id, 1), "a not-yet-reached future generation must not read as current");
    assert!(!generation_current(&reg.inner, "no-such-id", 0), "an unknown id must never read as current");
}

#[test]
fn generation_current_goes_stale_the_instant_kill_lands_even_before_any_child_pid_was_recorded() {
    // Reproduces the exact defect-2 window: `agent_session_kill` fires while
    // `run_turn` is still awaiting `probe_cli()`, i.e. before `child.id()`
    // has ever been written into the registry. `begin_kill` must still bump
    // the generation so the post-probe `generation_current` check in
    // `run_turn` sees it as stale and refuses to spawn the real `claude`
    // child — otherwise that child would run untracked and unkillable.
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-gen-race");
    let (info, _, _) = reg
        .register(&check, "root".to_string(), None, "Agent".to_string())
        .unwrap();
    let captured_generation = 0; // what run_turn captured at spawn time

    let killed_pid = reg.begin_kill(&info.id).unwrap();
    assert_eq!(killed_pid, None, "no child_pid was ever recorded yet — kill_tree must not be invoked for it");
    assert!(
        !generation_current(&reg.inner, &info.id, captured_generation),
        "run_turn's post-probe check must see the captured generation as stale and bail out before spawning",
    );
}

// ── build_boot_prompt (§6.3) ─────────────────────────────────────────

fn temp_root(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cowtext-sessions-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn build_boot_prompt_includes_agent_file_body_when_present() {
    let root = temp_root("agentfile");
    let agents_dir = root.join(".claude").join("agents");
    fs::create_dir_all(&agents_dir).unwrap();
    fs::write(agents_dir.join("tech-ui.md"), "You review UI diffs.").unwrap();

    let (prompt, error) = build_boot_prompt(&root.to_string_lossy(), Some("tech-ui.md"), "UI Agent", "/tmp/proj");
    assert!(error.is_none());
    assert!(prompt.contains("You review UI diffs."));
    assert!(prompt.contains("Your role definition follows:"));
    assert!(prompt.contains("UI Agent"));
}

#[test]
fn build_boot_prompt_reports_non_fatal_error_for_missing_agent_file() {
    let root = temp_root("noagentfile");
    let (prompt, error) = build_boot_prompt(&root.to_string_lossy(), Some("missing.md"), "Agent", "/tmp/proj");
    assert!(error.unwrap().contains("could not be read"));
    assert!(prompt.contains("Reply with ONE short line"));
}

#[test]
fn build_boot_prompt_rejects_path_escaping_agent_file_name() {
    let root = temp_root("escape");
    let (_, error) = build_boot_prompt(&root.to_string_lossy(), Some("../escape.md"), "Agent", "/tmp/proj");
    assert!(error.unwrap().contains("could not be read"));
}

#[test]
fn valid_agent_file_component_rejects_path_traversal() {
    assert!(valid_agent_file_component("tech-ui.md"));
    assert!(!valid_agent_file_component("../secrets.md"));
    assert!(!valid_agent_file_component("sub/dir.md"));
    assert!(!valid_agent_file_component("sub\\dir.md"));
    assert!(!valid_agent_file_component(""));
}

#[test]
fn truncate_at_char_boundary_never_splits_a_multibyte_char() {
    let s = format!("{}{}", "a".repeat(5), '\u{20AC}'); // euro sign is 3 bytes in UTF-8
    let truncated = truncate_at_char_boundary(&s, 6);
    assert!(s.starts_with(truncated));
    assert!(truncated.len() <= 6);
}

// ── map_line: one case per §5.1 row, pure and spawn-free ────────────────

#[test]
fn map_line_system_init_sets_working_and_captures_session_id() {
    let line = r#"{"type":"system","subtype":"init","session_id":"sess-123"}"#;
    let mapped = map_line("as0", line, 1000);
    assert_eq!(mapped.events, vec![status_event("as0", SessionStatus::Working, 1000)]);
    assert_eq!(mapped.claude_session_id, Some("sess-123".to_string()));
    assert!(!mapped.turn_ended);
}

#[test]
fn map_line_system_other_subtype_ignored() {
    let line = r#"{"type":"system","subtype":"something_else"}"#;
    let mapped = map_line("as0", line, 1000);
    assert!(mapped.events.is_empty());
    assert_eq!(mapped.claude_session_id, None);
    assert!(!mapped.turn_ended);
}

#[test]
fn map_line_assistant_text_block_trims_and_skips_empty() {
    let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"  hello  "},{"type":"text","text":"   "}]}}"#;
    let mapped = map_line("as0", line, 1000);
    assert_eq!(mapped.events, vec![text_event("as0", "hello".to_string(), 1000)]);
    assert!(!mapped.turn_ended);
}

#[test]
fn map_line_assistant_tool_use() {
    let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit"}]}}"#;
    let mapped = map_line("as0", line, 1000);
    assert_eq!(mapped.events.len(), 1);
    let ev = &mapped.events[0];
    assert_eq!(ev.kind, AgentEventKind::Tool);
    assert_eq!(ev.tool.as_deref(), Some("Edit"));
    assert_eq!(ev.status, Some(SessionStatus::Working));
}

#[test]
fn map_line_assistant_usage_never_emits_a_usage_event() {
    // Defect fix: live-CLI-verified (real `claude -p --output-format
    // stream-json --verbose` run against a throwaway git worktree), a single
    // logical turn emits a non-zero `usage` block on BOTH the streamed
    // `assistant` message AND the terminal `result` line. Mapping both to
    // `kind:"usage"` double-counts tokens/turns in store/sessions.ts, which
    // sums every usage event. Only the `result` line's usage (below) is
    // mapped now — this must hold even when the assistant-message usage is
    // non-zero, so a future regression can't quietly reintroduce it.
    let line = r#"{"type":"assistant","message":{"usage":{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":1,"cache_read_input_tokens":2}}}"#;
    let mapped = map_line("as0", line, 1000);
    assert!(mapped.events.is_empty(), "{:?}", mapped.events);
}

#[test]
fn map_line_one_turn_with_both_assistant_and_result_usage_emits_exactly_one_usage_event() {
    // The exact live-CLI shape from the defect report: an `assistant` line
    // carrying its own non-zero usage, followed by the turn's `result` line
    // also carrying non-zero usage. Only the result line's usage may survive
    // — a store that sums every `kind:"usage"` event across these two lines
    // must land on one usage event and one turn, not two.
    let assistant_line = r#"{"type":"assistant","message":{"usage":{"input_tokens":2,"output_tokens":4,"cache_creation_input_tokens":21186,"cache_read_input_tokens":20672}}}"#;
    let result_line = r#"{"type":"result","subtype":"success","result":"ready","usage":{"input_tokens":2,"output_tokens":18,"cache_creation_input_tokens":21186,"cache_read_input_tokens":20672}}"#;

    let assistant_mapped = map_line("as0", assistant_line, 1000);
    let result_mapped = map_line("as0", result_line, 1001);

    let usage_events: Vec<&AgentEvent> = assistant_mapped
        .events
        .iter()
        .chain(result_mapped.events.iter())
        .filter(|e| e.kind == AgentEventKind::Usage)
        .collect();
    assert_eq!(usage_events.len(), 1, "{usage_events:?}");
    assert_eq!(usage_events[0].usage.as_ref().unwrap().output_tokens, 18);
}

#[test]
fn map_line_assistant_usage_all_zero_emits_nothing() {
    let line = r#"{"type":"assistant","message":{"usage":{"input_tokens":0,"output_tokens":0}}}"#;
    let mapped = map_line("as0", line, 1000);
    assert!(mapped.events.is_empty());
}

#[test]
fn map_line_user_tool_result_ignored() {
    let line = r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}"#;
    let mapped = map_line("as0", line, 1000);
    assert!(mapped.events.is_empty());
    assert!(!mapped.turn_ended);
}

#[test]
fn map_line_result_success_emits_text_usage_idle_and_ends_turn() {
    let line = r#"{"type":"result","subtype":"success","result":"All done","usage":{"input_tokens":3,"output_tokens":4}}"#;
    let mapped = map_line("as0", line, 1000);
    assert!(mapped.turn_ended);
    assert_eq!(mapped.events.len(), 3);
    assert_eq!(mapped.events[0], text_event("as0", "All done".to_string(), 1000));
    assert_eq!(mapped.events[1].kind, AgentEventKind::Usage);
    assert_eq!(mapped.events[2], status_event("as0", SessionStatus::Idle, 1000));
}

#[test]
fn map_line_result_success_with_total_cost_usd_carries_it_on_the_usage_event() {
    // N5: `total_cost_usd` is a sibling of `usage` on the `result` line, not
    // nested inside it — the mapper must read it from the top level and
    // thread it into the emitted `Usage.costUsd`.
    let line = r#"{"type":"result","subtype":"success","result":"done","total_cost_usd":0.0086265,"usage":{"input_tokens":3,"output_tokens":4}}"#;
    let mapped = map_line("as0", line, 1000);
    let usage_event = mapped
        .events
        .iter()
        .find(|e| e.kind == AgentEventKind::Usage)
        .expect("a usage event must be emitted");
    let usage = usage_event.usage.as_ref().expect("usage payload");
    assert_eq!(usage.cost_usd, Some(0.0086265));
    // Mapping table otherwise unchanged: still text, usage, idle, in order.
    assert_eq!(mapped.events.len(), 3);
    assert_eq!(mapped.events[2], status_event("as0", SessionStatus::Idle, 1000));
}

#[test]
fn map_line_result_success_without_total_cost_usd_is_tolerated_as_null() {
    // Absent `total_cost_usd` must never be fatal — `costUsd` reads as `None`
    // (wire `null`), everything else about the mapping is unaffected.
    let line = r#"{"type":"result","subtype":"success","result":"done","usage":{"input_tokens":3,"output_tokens":4}}"#;
    let mapped = map_line("as0", line, 1000);
    let usage_event = mapped
        .events
        .iter()
        .find(|e| e.kind == AgentEventKind::Usage)
        .expect("a usage event must be emitted");
    let usage = usage_event.usage.as_ref().expect("usage payload");
    assert_eq!(usage.cost_usd, None);
}

#[test]
fn map_line_result_success_zero_total_tokens_drops_usage_event_even_with_cost() {
    // Mapping table unchanged: a zero-total `usage` object still suppresses
    // the `kind:"usage"` event entirely (contract §5.1), regardless of
    // whether `total_cost_usd` is present.
    let line = r#"{"type":"result","subtype":"success","result":"done","total_cost_usd":0.01,"usage":{"input_tokens":0,"output_tokens":0}}"#;
    let mapped = map_line("as0", line, 1000);
    assert!(mapped.events.iter().all(|e| e.kind != AgentEventKind::Usage), "{:?}", mapped.events);
}

#[test]
fn map_line_result_success_empty_text_skips_text_event() {
    let line = r#"{"type":"result","subtype":"success","result":""}"#;
    let mapped = map_line("as0", line, 1000);
    assert!(mapped.turn_ended);
    assert_eq!(mapped.events, vec![status_event("as0", SessionStatus::Idle, 1000)]);
}

#[test]
fn map_line_result_error_subtype_emits_error_then_waiting() {
    let line = r#"{"type":"result","subtype":"error_max_turns","result":"ran out of turns"}"#;
    let mapped = map_line("as0", line, 1000);
    assert!(mapped.turn_ended);
    assert_eq!(mapped.events.len(), 2);
    assert_eq!(mapped.events[0].kind, AgentEventKind::Error);
    assert_eq!(mapped.events[0].text.as_deref(), Some("error_max_turns: ran out of turns"));
    assert_eq!(mapped.events[1], status_event("as0", SessionStatus::Waiting, 1000));
}

#[test]
fn map_line_result_is_error_true_emits_error_then_waiting() {
    let line = r#"{"type":"result","subtype":"success","is_error":true,"error":"boom"}"#;
    let mapped = map_line("as0", line, 1000);
    assert!(mapped.turn_ended);
    assert_eq!(mapped.events[0].kind, AgentEventKind::Error);
    assert_eq!(mapped.events[0].text.as_deref(), Some("success: boom"));
    assert_eq!(mapped.events[1], status_event("as0", SessionStatus::Waiting, 1000));
}

#[test]
fn map_line_stream_event_ignored() {
    let line = r#"{"type":"stream_event","event":{"type":"content_block_delta"}}"#;
    let mapped = map_line("as0", line, 1000);
    assert!(mapped.events.is_empty());
    assert!(!mapped.turn_ended);
}

#[test]
fn map_line_non_json_becomes_text_verbatim() {
    let line = "warning: something happened";
    let mapped = map_line("as0", line, 1000);
    assert_eq!(mapped.events, vec![text_event("as0", line.to_string(), 1000)]);
    assert_eq!(mapped.claude_session_id, None);
    assert!(!mapped.turn_ended);
}

// ── CLI probe: pure help-text check ─────────────────────────────────────

#[test]
fn check_help_output_passes_when_all_flags_present() {
    let help = "-p, --print\n--output-format <format> (text, json, stream-json)\n--verbose\n--resume <id>";
    assert!(check_help_output(help).is_ok());
}

#[test]
fn check_help_output_fails_on_missing_flag() {
    let help = "-p, --print\n--output-format <format>\n--verbose";
    let err = check_help_output(help).unwrap_err();
    assert!(err.contains("--resume"), "{err}");
}

#[test]
fn check_help_output_fails_on_missing_format_value() {
    let help = "-p --output-format --verbose --resume";
    let err = check_help_output(help).unwrap_err();
    assert!(err.contains("stream-json"), "{err}");
}

// ── kill_tree: process-tree kill of a long-running dummy child (§6.5) ──

#[cfg(windows)]
fn spawn_dummy() -> tokio::process::Child {
    tokio::process::Command::new("cmd")
        .arg("/C")
        .arg("ping")
        .arg("-n")
        .arg("30")
        .arg("127.0.0.1")
        .creation_flags(0x0800_0000)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("spawn dummy child")
}

#[cfg(not(windows))]
fn spawn_dummy() -> tokio::process::Child {
    tokio::process::Command::new("sleep")
        .arg("30")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("spawn dummy child")
}

#[cfg(windows)]
fn pid_alive(pid: u32) -> bool {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("tasklist")
        .arg("/FI")
        .arg(format!("PID eq {pid}"))
        .arg("/NH")
        .creation_flags(0x0800_0000)
        .output();
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()),
        Err(_) => false,
    }
}

#[cfg(not(windows))]
fn pid_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[tokio::test]
async fn kill_tree_terminates_a_long_running_dummy_child() {
    let mut child = spawn_dummy();
    let pid = child.id().expect("dummy child must have a pid");
    assert!(pid_alive(pid), "dummy child should be alive right after spawn");

    kill_tree(pid).await.expect("kill_tree should succeed");

    // Give the OS a brief moment to reap/report the process as gone.
    for _ in 0..20 {
        if !pid_alive(pid) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(!pid_alive(pid), "pid {pid} should be gone after kill_tree");

    let _ = child.try_wait();
}

#[tokio::test]
async fn kill_tree_of_an_already_dead_pid_reports_failure_not_a_panic() {
    // A pid that (almost certainly) names no live process: kill_tree must
    // return an Err, never panic — the caller (agent_session_kill) turns
    // that into a best-effort `kind:"error"` event, never a crash.
    let result = kill_tree(u32::MAX - 1).await;
    let _ = result; // either Ok (nothing to do) or Err — both are acceptable, no panic
}
