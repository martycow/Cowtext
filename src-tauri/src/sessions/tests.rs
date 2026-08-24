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
        .register(&check, "root".to_string(), None, "Agent".to_string(), None, None, None)
        .unwrap_err();
    assert!(err.contains("not a git repository"), "{err}");
}

#[test]
fn register_rejects_empty_name() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-empty");
    let err = reg
        .register(&check, "root".to_string(), None, "   ".to_string(), None, None, None)
        .unwrap_err();
    assert!(err.contains("Name is required"), "{err}");
}

#[test]
fn register_rejects_duplicate_alive_cwd() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-a");
    reg.register(&check, "root".to_string(), None, "Agent A".to_string(), None, None, None).unwrap();
    let err = reg
        .register(&check, "root".to_string(), None, "Agent B".to_string(), None, None, None)
        .unwrap_err();
    assert!(err.contains("already running"), "{err}");
}

#[test]
fn register_allows_reuse_of_a_dead_sessions_cwd() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-b");
    let (info, _, _) = reg.register(&check, "root".to_string(), None, "Agent A".to_string(), None, None, None).unwrap();
    {
        let mut guard = reg.inner.lock().unwrap();
        guard.get_mut(&info.id).unwrap().info.alive = false;
    }
    let result = reg.register(&check, "root".to_string(), None, "Agent B".to_string(), None, None, None);
    assert!(result.is_ok(), "a dead session must not hold its folder");
}

#[test]
fn register_rejects_over_max_sessions() {
    let reg = RegistryCore::default();
    for i in 0..MAX_SESSIONS {
        let check = wt(&format!("/tmp/proj-{i}"));
        reg.register(&check, "root".to_string(), None, format!("Agent {i}"), None, None, None).unwrap();
    }
    let check = wt("/tmp/proj-overflow");
    let err = reg
        .register(&check, "root".to_string(), None, "Overflow".to_string(), None, None, None)
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
            .register(&check, "root".to_string(), None, format!("Agent {i}"), None, None, None)
            .unwrap();
        ids.push(info.id);
    }
    let listed: Vec<String> = reg.list().into_iter().map(|s| s.id).collect();
    assert_eq!(listed, ids);
}

// ── register(): §4.3 spawn guard + §5.1 ceiling normalization ──────────

#[test]
fn register_rejects_task_id_with_no_task_context() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-taskguard-none");
    let err = reg
        .register(&check, "root".to_string(), None, "Agent".to_string(), Some("t-abc123".to_string()), None, None)
        .unwrap_err();
    assert!(err.contains("task context"), "{err}");
}

#[test]
fn register_rejects_task_id_with_whitespace_only_task_context() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-taskguard-blank");
    let err = reg
        .register(
            &check,
            "root".to_string(),
            None,
            "Agent".to_string(),
            Some("t-abc123".to_string()),
            Some("   ".to_string()),
            None,
        )
        .unwrap_err();
    assert!(err.contains("task context"), "{err}");
}

#[test]
fn register_rejects_task_id_guard_before_mutating_the_registry() {
    // The spawn guard must behave like every other guardrail in `register`:
    // `Err` never mutates. A rejected task-session registration must not
    // consume a MAX_SESSIONS slot or leave a half-registered entry behind.
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-taskguard-nomutate");
    let _ = reg.register(&check, "root".to_string(), None, "Agent".to_string(), Some("t-abc123".to_string()), None, None);
    assert!(reg.list().is_empty(), "a rejected spawn must register nothing");
}

#[test]
fn register_allows_task_id_with_nonempty_task_context_and_injects_it() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-taskguard-ok");
    let (info, prompt, _agent_file_error) = reg
        .register(
            &check,
            "root".to_string(),
            None,
            "Agent".to_string(),
            Some("t-abc123".to_string()),
            Some("the compiled subgraph body".to_string()),
            Some(5000),
        )
        .unwrap();
    assert_eq!(info.token_ceiling, Some(5000));
    assert!(prompt.contains("--- BEGIN TASK CONTEXT (Cowtext, task t-abc123) ---"));
    assert!(prompt.contains("the compiled subgraph body"));
    assert!(prompt.contains("--- END TASK CONTEXT ---"));
}

#[test]
fn register_without_a_task_id_never_needs_a_task_context() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-notask");
    let result = reg.register(&check, "root".to_string(), None, "Agent".to_string(), None, None, None);
    assert!(result.is_ok());
}

#[test]
fn register_normalizes_zero_ceiling_to_unlimited() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-zeroceiling");
    let (info, _, _) = reg
        .register(&check, "root".to_string(), None, "Agent".to_string(), None, None, Some(0))
        .unwrap();
    assert_eq!(info.token_ceiling, None, "Some(0) from the caller must normalize to unlimited (contract §5.1)");
}

#[test]
fn register_absent_ceiling_stays_unlimited() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-noceiling");
    let (info, _, _) = reg.register(&check, "root".to_string(), None, "Agent".to_string(), None, None, None).unwrap();
    assert_eq!(info.token_ceiling, None);
}

#[test]
fn register_preserves_a_nonzero_ceiling() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-realceiling");
    let (info, _, _) = reg
        .register(&check, "root".to_string(), None, "Agent".to_string(), None, None, Some(200_000))
        .unwrap();
    assert_eq!(info.token_ceiling, Some(200_000));
}

// ── resolve_ceiling: D9 fix — global default inheritance ───────────────
// WO06_AUDIT.md D9: the global-default deliverable never shipped, so every
// session launched unbounded unless a caller passed an explicit per-task
// ceiling every time. `resolve_ceiling` is the fix's entire decision point.

#[test]
fn resolve_ceiling_with_no_explicit_choice_inherits_the_global_default() {
    assert_eq!(resolve_ceiling(None, 200_000), Some(200_000));
}

#[test]
fn resolve_ceiling_explicit_nonzero_overrides_the_global_default() {
    assert_eq!(resolve_ceiling(Some(75_000), 200_000), Some(75_000));
    // Even when the explicit choice is HIGHER than the global default —
    // "explicit always wins", not "explicit wins only if it is stricter".
    assert_eq!(resolve_ceiling(Some(500_000), 200_000), Some(500_000));
}

#[test]
fn resolve_ceiling_explicit_zero_is_a_genuine_opt_out_never_falling_back() {
    // The per-task equivalent of setting the global default itself to 0 —
    // must NOT silently inherit the (non-zero) global default instead.
    assert_eq!(resolve_ceiling(Some(0), 200_000), Some(0));
}

#[test]
fn resolve_ceiling_no_explicit_choice_and_global_default_zero_is_unbounded() {
    // The whole-app opt-out: global default itself set to 0, no per-task
    // override — must resolve to unbounded, not fall back to any baked-in
    // number.
    assert_eq!(resolve_ceiling(None, 0), Some(0));
}

// ── D9 end-to-end: inherited ceiling still hard-stops exactly once, and
// restart still resets tokens_used (no regression of the D3 fix) ────────

#[test]
fn a_session_with_no_explicit_ceiling_inherits_the_global_default_through_register() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-d9-inherit");
    let ceiling = resolve_ceiling(/* explicit */ None, /* global default */ 50_000);
    let (info, _, _) = reg
        .register(&check, "root".to_string(), None, "Agent".to_string(), None, None, ceiling)
        .unwrap();
    assert_eq!(info.token_ceiling, Some(50_000), "must inherit the global default, not launch unbounded");
}

#[test]
fn an_explicit_per_task_ceiling_still_overrides_the_global_default_through_register() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-d9-override");
    let ceiling = resolve_ceiling(/* explicit */ Some(10_000), /* global default */ 200_000);
    let (info, _, _) = reg
        .register(&check, "root".to_string(), None, "Agent".to_string(), None, None, ceiling)
        .unwrap();
    assert_eq!(info.token_ceiling, Some(10_000));
}

#[test]
fn explicit_opt_out_gives_genuinely_unbounded_behavior_not_just_a_high_number() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-d9-optout");
    let ceiling = resolve_ceiling(/* explicit opt-out */ Some(0), /* global default */ 200_000);
    let (info, _, _) = reg
        .register(&check, "root".to_string(), None, "Agent".to_string(), None, None, ceiling)
        .unwrap();
    assert_eq!(info.token_ceiling, None, "an opted-out session must be stored as unlimited");
    // Prove it via the real enforcement path too, not just the stored value:
    // an enormous observed total must never stop an unlimited session.
    assert_eq!(charge(&reg.inner, &info.id, 0, u64::MAX / 2), ChargeVerdict::Ok);
}

#[test]
fn inherited_global_default_hard_stops_exactly_once_and_restart_resets_tokens_used() {
    // Reuses the exact D3-regression shape (`restart_after_a_budget_stop_
    // clears_tokens_used_so_the_new_turn_is_not_re_stopped` above), but with
    // a ceiling that arrived via inheritance (no explicit per-task value)
    // instead of an explicit one — proving the D9 fix rides the same,
    // unmodified enforcement path rather than a second mechanism.
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-d9-hardstop");
    let ceiling = resolve_ceiling(None, 1_000);
    let (info, _, _) = reg
        .register(&check, "root".to_string(), None, "Agent".to_string(), None, None, ceiling)
        .unwrap();
    assert_eq!(info.token_ceiling, Some(1_000));

    let stop = charge(&reg.inner, &info.id, 0, 1_200);
    assert_eq!(stop, ChargeVerdict::Stop { pid: None, spent: 1_200, ceiling: 1_000 });

    // Exactly once: a second charge on the same (now-stale) generation.
    let second = charge(&reg.inner, &info.id, 0, 9_999);
    assert_eq!(second, ChargeVerdict::Stale);

    // Restart resets tokens_used — the D3 fix must still hold for a
    // ceiling that came from the global default, not just an explicit one.
    let (restarted_info, _pid, _prompt, new_generation) = reg.begin_restart(&info.id).unwrap();
    assert_eq!(restarted_info.tokens_used, 0);
    assert!(restarted_info.alive);

    let after_restart = charge(&reg.inner, &info.id, new_generation, 50);
    assert_eq!(after_restart, ChargeVerdict::Ok, "a fresh budget must not immediately re-stop");
}

// ── generation_current: probe-race defect fix guard (contract §6.2) ────

#[test]
fn generation_current_true_only_for_the_live_generation_of_a_known_alive_entry() {
    let reg = RegistryCore::default();
    let check = wt("/tmp/proj-gen");
    let (info, _, _) = reg
        .register(&check, "root".to_string(), None, "Agent".to_string(), None, None, None)
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
        .register(&check, "root".to_string(), None, "Agent".to_string(), None, None, None)
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

    let (prompt, error) = build_boot_prompt(&root.to_string_lossy(), Some("tech-ui.md"), "UI Agent", "/tmp/proj", None, None);
    assert!(error.is_none());
    assert!(prompt.contains("You review UI diffs."));
    assert!(prompt.contains("Your role definition follows:"));
    assert!(prompt.contains("UI Agent"));
}

#[test]
fn build_boot_prompt_reports_non_fatal_error_for_missing_agent_file() {
    let root = temp_root("noagentfile");
    let (prompt, error) = build_boot_prompt(&root.to_string_lossy(), Some("missing.md"), "Agent", "/tmp/proj", None, None);
    assert!(error.unwrap().contains("could not be read"));
    assert!(prompt.contains("Reply with ONE short line"));
}

#[test]
fn build_boot_prompt_rejects_path_escaping_agent_file_name() {
    let root = temp_root("escape");
    let (_, error) = build_boot_prompt(&root.to_string_lossy(), Some("../escape.md"), "Agent", "/tmp/proj", None, None);
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

// ── build_boot_prompt: task-context injection (contract §4.3) ──────────

#[test]
fn build_boot_prompt_inserts_task_context_after_agent_body_and_before_tail() {
    let root = temp_root("taskctx-order");
    let agents_dir = root.join(".claude").join("agents");
    fs::create_dir_all(&agents_dir).unwrap();
    fs::write(agents_dir.join("tech-ui.md"), "You review UI diffs.").unwrap();

    let (prompt, error) = build_boot_prompt(
        &root.to_string_lossy(),
        Some("tech-ui.md"),
        "UI Agent",
        "/tmp/proj",
        Some("t-abc123"),
        Some("CONTEXT BODY HERE"),
    );
    assert!(error.is_none());
    let agent_pos = prompt.find("You review UI diffs.").unwrap();
    let ctx_pos = prompt.find("CONTEXT BODY HERE").unwrap();
    let tail_pos = prompt.find("Reply with ONE short line").unwrap();
    assert!(agent_pos < ctx_pos, "task context must come after the agent-file body");
    assert!(ctx_pos < tail_pos, "task context must come before BOOT_PROMPT_TAIL");
    assert!(prompt.contains("--- BEGIN TASK CONTEXT (Cowtext, task t-abc123) ---"));
    assert!(prompt.contains("--- END TASK CONTEXT ---"));
}

#[test]
fn build_boot_prompt_omits_task_context_block_when_absent() {
    let root = temp_root("taskctx-absent");
    let (prompt, _) = build_boot_prompt(&root.to_string_lossy(), None, "Agent", "/tmp/proj", None, None);
    assert!(!prompt.contains("BEGIN TASK CONTEXT"));
    assert!(!prompt.contains("END TASK CONTEXT"));
}

#[test]
fn build_boot_prompt_truncates_task_context_at_max_bytes_with_a_notice() {
    let root = temp_root("taskctx-trunc");
    let huge = "x".repeat(crate::taskctx::TASK_CONTEXT_MAX_BYTES + 500);
    let (prompt, _) = build_boot_prompt(&root.to_string_lossy(), None, "Agent", "/tmp/proj", Some("t-abc123"), Some(&huge));
    assert!(
        prompt.contains(&format!("[truncated at {} bytes", crate::taskctx::TASK_CONTEXT_MAX_BYTES)),
        "must carry the truncation notice"
    );
    assert!(!prompt.contains(&huge), "the full untruncated body must not appear");
}

#[test]
fn build_boot_prompt_does_not_truncate_a_task_context_under_the_cap() {
    let root = temp_root("taskctx-notrunc");
    let small = "short task context body";
    let (prompt, _) = build_boot_prompt(&root.to_string_lossy(), None, "Agent", "/tmp/proj", Some("t-abc123"), Some(small));
    assert!(prompt.contains(small));
    assert!(!prompt.contains("truncated at"));
}

// ── map_line: one case per §5.1 row, pure and spawn-free ────────────────

#[test]
fn map_line_system_init_sets_working_and_captures_session_id() {
    let line = r#"{"type":"system","subtype":"init","session_id":"sess-123"}"#;
    let mapped = map_line("as0", line, 1000, None);
    assert_eq!(mapped.events, vec![status_event("as0", SessionStatus::Working, 1000)]);
    assert_eq!(mapped.claude_session_id, Some("sess-123".to_string()));
    assert!(!mapped.turn_ended);
}

#[test]
fn map_line_system_other_subtype_ignored() {
    let line = r#"{"type":"system","subtype":"something_else"}"#;
    let mapped = map_line("as0", line, 1000, None);
    assert!(mapped.events.is_empty());
    assert_eq!(mapped.claude_session_id, None);
    assert!(!mapped.turn_ended);
}

#[test]
fn map_line_assistant_text_block_trims_and_skips_empty() {
    let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"  hello  "},{"type":"text","text":"   "}]}}"#;
    let mapped = map_line("as0", line, 1000, None);
    assert_eq!(mapped.events, vec![text_event("as0", "hello".to_string(), 1000)]);
    assert!(!mapped.turn_ended);
}

#[test]
fn map_line_assistant_tool_use() {
    let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit"}]}}"#;
    let mapped = map_line("as0", line, 1000, None);
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
    let mapped = map_line("as0", line, 1000, None);
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

    let assistant_mapped = map_line("as0", assistant_line, 1000, None);
    let result_mapped = map_line("as0", result_line, 1001, None);

    let usage_events: Vec<&AgentEvent> = assistant_mapped
        .events
        .iter()
        .chain(result_mapped.events.iter())
        .filter(|e| e.kind == AgentEventKind::Usage)
        .collect();
    assert_eq!(usage_events.len(), 1, "{usage_events:?}");
    assert_eq!(usage_events[0].usage.as_ref().unwrap().output_tokens, 18);
}

// ── WO16 bug 1: cache_read must not be charged to the budget ────────────

#[test]
fn map_usage_excludes_cache_read_from_the_total_but_still_reports_it() {
    // A mid-conversation turn: the whole prompt comes back from cache, and
    // only a handful of tokens are actually new. Before WO16 this line
    // charged 100,721 against the ceiling; the cached 100,000 had already
    // been charged on the turn that created them.
    let line = r#"{"type":"result","subtype":"success","result":"ok","usage":{"input_tokens":7,"output_tokens":14,"cache_creation_input_tokens":700,"cache_read_input_tokens":100000}}"#;
    let mapped = map_line("as0", line, 1000, None);
    let u = mapped.observed_usage.expect("usage");
    assert_eq!(u.total_tokens, 7 + 14 + 700, "cache_read must not be summed in");
    assert_eq!(u.cache_read_tokens, 100_000, "…but it must still be reported");
    assert_eq!(u.input_tokens, 7);
    assert_eq!(u.output_tokens, 14);
}

#[test]
fn map_usage_charges_each_context_token_once_across_a_conversation() {
    // Turn 1 writes a 48k prompt into cache; turns 2 and 3 re-read it and add
    // little. The ceiling should see ≈48k, not ≈144k — the regression that
    // made a 60k ceiling stop a session on its own boot turn.
    let turn1 = r#"{"type":"result","subtype":"success","result":"a","usage":{"input_tokens":10,"output_tokens":40,"cache_creation_input_tokens":48000,"cache_read_input_tokens":0}}"#;
    let turn2 = r#"{"type":"result","subtype":"success","result":"b","usage":{"input_tokens":5,"output_tokens":30,"cache_creation_input_tokens":0,"cache_read_input_tokens":48000}}"#;
    let turn3 = r#"{"type":"result","subtype":"success","result":"c","usage":{"input_tokens":5,"output_tokens":30,"cache_creation_input_tokens":0,"cache_read_input_tokens":48050}}"#;
    let charged: u64 = [turn1, turn2, turn3]
        .iter()
        .map(|l| map_line("as0", l, 1000, None).observed_usage.unwrap().total_tokens)
        .sum();
    assert_eq!(charged, 48_050 + 35 + 35);
    assert!(charged < 60_000, "a 60k ceiling must survive three turns, got {charged}");
}

#[test]
fn map_usage_with_only_cache_read_reports_no_spend() {
    // Nothing new was sent or generated: no usage event, nothing charged.
    let line = r#"{"type":"assistant","message":{"usage":{"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":9000}}}"#;
    let mapped = map_line("as0", line, 1000, None);
    assert!(mapped.observed_usage.is_none());
    assert!(mapped.events.is_empty());
}

#[test]
fn map_line_assistant_usage_all_zero_emits_nothing() {
    let line = r#"{"type":"assistant","message":{"usage":{"input_tokens":0,"output_tokens":0}}}"#;
    let mapped = map_line("as0", line, 1000, None);
    assert!(mapped.events.is_empty());
}

// ── WO16 bug 2: the result line repeats the streamed answer ─────────────

#[test]
fn map_line_result_text_identical_to_the_streamed_text_is_not_emitted_twice() {
    // What a real turn looks like: the answer streams as an assistant text
    // block, then the terminal result line repeats it verbatim. Before WO16
    // both were emitted and every answer appeared twice in the transcript.
    let assistant = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Nested is fine."}]}}"#;
    let result = r#"{"type":"result","subtype":"success","result":"Nested is fine.","usage":{"input_tokens":1,"output_tokens":4}}"#;

    let a = map_line("as0", assistant, 1000, None);
    assert_eq!(a.last_text.as_deref(), Some("Nested is fine."));
    let texts_a: Vec<&str> =
        a.events.iter().filter(|e| e.kind == AgentEventKind::Text).map(|e| e.text.as_deref().unwrap()).collect();
    assert_eq!(texts_a, vec!["Nested is fine."]);

    let r = map_line("as0", result, 1001, a.last_text.as_deref());
    let texts_r: Vec<&str> =
        r.events.iter().filter(|e| e.kind == AgentEventKind::Text).map(|e| e.text.as_deref().unwrap()).collect();
    assert!(texts_r.is_empty(), "the duplicate must be suppressed, got {texts_r:?}");
    // Everything else the result line owes is unaffected.
    assert!(r.turn_ended);
    assert!(r.events.iter().any(|e| e.kind == AgentEventKind::Usage));
    assert!(r.events.iter().any(|e| e.kind == AgentEventKind::Status));
}

#[test]
fn map_line_result_text_that_differs_is_still_emitted() {
    // Never assume the repeat: a result that says something else, or a turn
    // that streamed no assistant text at all, must still reach the transcript.
    let result = r#"{"type":"result","subtype":"success","result":"Actually, nested.","usage":{"input_tokens":1,"output_tokens":4}}"#;
    let differs = map_line("as0", result, 1000, Some("Nested is fine."));
    assert!(differs
        .events
        .iter()
        .any(|e| e.kind == AgentEventKind::Text && e.text.as_deref() == Some("Actually, nested.")));

    let no_prior = map_line("as0", result, 1000, None);
    assert!(no_prior
        .events
        .iter()
        .any(|e| e.kind == AgentEventKind::Text && e.text.as_deref() == Some("Actually, nested.")));
}

#[test]
fn carry_text_survives_lines_that_emit_no_text_of_their_own() {
    // The regression this exists for, replayed as the CLI actually emits it:
    // the answer streams, THEN a rate-limit line and a thinking-tokens line
    // arrive, THEN the result repeats the answer. Carrying only the previous
    // *line's* text lost the comparand on those two and the duplicate came
    // back — which is exactly what a live session showed.
    let stream = [
        r#"{"type":"assistant","message":{"content":[{"type":"text","text":"T1"}]}}"#,
        r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}"#,
        r#"{"type":"system","subtype":"thinking_tokens","estimated_tokens":50}"#,
        r#"{"type":"result","subtype":"success","result":"T1","usage":{"input_tokens":1,"output_tokens":2}}"#,
    ];

    let mut prev: Option<String> = None;
    let mut emitted: Vec<String> = Vec::new();
    for line in stream {
        let mapped = map_line("as0", line, 1000, prev.as_deref());
        for e in mapped.events.iter().filter(|e| e.kind == AgentEventKind::Text) {
            emitted.push(e.text.clone().unwrap());
        }
        prev = carry_text(prev, &mapped);
    }

    assert_eq!(emitted, vec!["T1".to_string()], "the answer must appear exactly once");
    assert!(prev.is_none(), "the turn boundary resets the comparand");
}

#[test]
fn carry_text_resets_at_the_turn_boundary() {
    // Two turns in one stream (what the persistent-session channel will look
    // like): turn 2's first line must not be compared against turn 1's text.
    let a1 = map_line("as0", r#"{"type":"assistant","message":{"content":[{"type":"text","text":"same"}]}}"#, 1, None);
    let prev = carry_text(None, &a1);
    assert_eq!(prev.as_deref(), Some("same"));
    let r1 = map_line("as0", r#"{"type":"result","subtype":"success","result":"same","usage":{"input_tokens":1,"output_tokens":1}}"#, 2, prev.as_deref());
    assert!(!r1.events.iter().any(|e| e.kind == AgentEventKind::Text), "turn 1 dedupes");
    let prev = carry_text(prev, &r1);
    assert!(prev.is_none());

    // Turn 2 says the same thing again — a new turn, so it must be emitted.
    let a2 = map_line("as0", r#"{"type":"assistant","message":{"content":[{"type":"text","text":"same"}]}}"#, 3, prev.as_deref());
    assert!(a2.events.iter().any(|e| e.kind == AgentEventKind::Text && e.text.as_deref() == Some("same")));
}

#[test]
fn map_line_deduped_result_still_asks_its_question() {
    // The dedupe must never swallow a COWTEXT_ASK: the question event is
    // emitted from the result text whether or not its Text twin survives.
    let text = "Here is my read.\nCOWTEXT_ASK: flat or nested?";
    let result = format!(
        r#"{{"type":"result","subtype":"success","result":{},"usage":{{"input_tokens":1,"output_tokens":4}}}}"#,
        serde_json::to_string(text).unwrap()
    );
    let mapped = map_line("as0", &result, 1000, Some(text));
    assert!(
        !mapped.events.iter().any(|e| e.kind == AgentEventKind::Text),
        "duplicate text suppressed"
    );
    let q = mapped
        .events
        .iter()
        .find(|e| e.kind == AgentEventKind::Question)
        .expect("question survives the dedupe");
    assert_eq!(q.text.as_deref(), Some("flat or nested?"));
}

// ── observed_usage: budget accounting only (WO06 §5.2) ──────────────────

#[test]
fn map_line_assistant_usage_populates_observed_usage_without_emitting_an_event() {
    // This is what makes the hard-stop mid-turn rather than end-of-turn
    // (§5.2): the assistant streaming line already carries usage today, it
    // is only the *emitted* event that stays suppressed.
    let line = r#"{"type":"assistant","message":{"usage":{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":1,"cache_read_input_tokens":2}}}"#;
    let mapped = map_line("as0", line, 1000, None);
    assert!(mapped.events.is_empty(), "the emitted stream must stay unchanged");
    let usage = mapped.observed_usage.expect("observed_usage must be populated for budget accounting");
    // WO16: was 18 (input+output+cache_creation+cache_read). `cache_read` is
    // no longer charged — those tokens were charged on the turn that created
    // them — so the total is 16 and the 2 re-read tokens are reported apart.
    assert_eq!(usage.total_tokens, 16);
    assert_eq!(usage.cache_read_tokens, 2);
}

#[test]
fn map_line_assistant_zero_usage_observed_usage_is_none() {
    let line = r#"{"type":"assistant","message":{"usage":{"input_tokens":0,"output_tokens":0}}}"#;
    let mapped = map_line("as0", line, 1000, None);
    assert!(mapped.observed_usage.is_none());
}

#[test]
fn map_line_result_success_observed_usage_matches_the_emitted_usage_event() {
    let line = r#"{"type":"result","subtype":"success","result":"done","usage":{"input_tokens":3,"output_tokens":4}}"#;
    let mapped = map_line("as0", line, 1000, None);
    let emitted = mapped.events.iter().find(|e| e.kind == AgentEventKind::Usage).expect("usage event");
    assert_eq!(mapped.observed_usage.as_ref().map(|u| u.total_tokens), emitted.usage.as_ref().map(|u| u.total_tokens));
    assert_eq!(mapped.observed_usage.as_ref().map(|u| u.total_tokens), Some(7));
}

#[test]
fn map_line_lines_with_no_usage_have_no_observed_usage() {
    for line in [
        r#"{"type":"system","subtype":"init","session_id":"sess-123"}"#,
        r#"{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}"#,
        r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}"#,
        r#"{"type":"stream_event","event":{"type":"content_block_delta"}}"#,
        "not json at all",
    ] {
        let mapped = map_line("as0", line, 1000, None);
        assert!(mapped.observed_usage.is_none(), "{line}");
    }
}

#[test]
fn map_line_user_tool_result_ignored() {
    let line = r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}"#;
    let mapped = map_line("as0", line, 1000, None);
    assert!(mapped.events.is_empty());
    assert!(!mapped.turn_ended);
}

#[test]
fn map_line_result_success_emits_text_usage_idle_and_ends_turn() {
    let line = r#"{"type":"result","subtype":"success","result":"All done","usage":{"input_tokens":3,"output_tokens":4}}"#;
    let mapped = map_line("as0", line, 1000, None);
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
    let mapped = map_line("as0", line, 1000, None);
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
    let mapped = map_line("as0", line, 1000, None);
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
    let mapped = map_line("as0", line, 1000, None);
    assert!(mapped.events.iter().all(|e| e.kind != AgentEventKind::Usage), "{:?}", mapped.events);
}

#[test]
fn map_line_result_success_empty_text_skips_text_event() {
    let line = r#"{"type":"result","subtype":"success","result":""}"#;
    let mapped = map_line("as0", line, 1000, None);
    assert!(mapped.turn_ended);
    assert_eq!(mapped.events, vec![status_event("as0", SessionStatus::Idle, 1000)]);
}

// ── COWTEXT_ASK marker: agent question surface (F2) ────────────────────

#[test]
fn map_line_result_with_cowtext_ask_marker_emits_text_and_question() {
    let line = r#"{"type":"result","subtype":"success","result":"Here is my plan.\nCOWTEXT_ASK: Should I use Postgres or SQLite?"}"#;
    let mapped = map_line("as0", line, 1000, None);
    let text = mapped.events.iter().find(|e| e.kind == AgentEventKind::Text).expect("text event must survive");
    assert_eq!(text.text.as_deref(), Some("Here is my plan.\nCOWTEXT_ASK: Should I use Postgres or SQLite?"));
    let question = mapped.events.iter().find(|e| e.kind == AgentEventKind::Question).expect("question event");
    assert_eq!(question.text.as_deref(), Some("Should I use Postgres or SQLite?"));
}

#[test]
fn map_line_result_without_cowtext_ask_marker_emits_no_question() {
    let line = r#"{"type":"result","subtype":"success","result":"All done, no questions."}"#;
    let mapped = map_line("as0", line, 1000, None);
    assert!(mapped.events.iter().all(|e| e.kind != AgentEventKind::Question), "{:?}", mapped.events);
}

#[test]
fn map_line_result_with_two_marker_lines_emits_only_the_first_question() {
    let line = r#"{"type":"result","subtype":"success","result":"COWTEXT_ASK: First question?\nCOWTEXT_ASK: Second question?"}"#;
    let mapped = map_line("as0", line, 1000, None);
    let questions: Vec<&AgentEvent> = mapped.events.iter().filter(|e| e.kind == AgentEventKind::Question).collect();
    assert_eq!(questions.len(), 1, "{questions:?}");
    assert_eq!(questions[0].text.as_deref(), Some("First question?"));
}

#[test]
fn map_line_result_cowtext_ask_marker_trims_surrounding_whitespace_but_keeps_trailing_period() {
    let line = r#"{"type":"result","subtype":"success","result":"   COWTEXT_ASK:   Should I proceed with the migration.   "}"#;
    let mapped = map_line("as0", line, 1000, None);
    let question = mapped.events.iter().find(|e| e.kind == AgentEventKind::Question).expect("question event");
    assert_eq!(question.text.as_deref(), Some("Should I proceed with the migration."));
}

#[test]
fn agent_event_kind_question_serializes_to_question() {
    assert_eq!(serde_json::to_string(&AgentEventKind::Question).unwrap(), "\"question\"");
}

#[test]
fn map_line_result_error_subtype_emits_error_then_waiting() {
    let line = r#"{"type":"result","subtype":"error_max_turns","result":"ran out of turns"}"#;
    let mapped = map_line("as0", line, 1000, None);
    assert!(mapped.turn_ended);
    assert_eq!(mapped.events.len(), 2);
    assert_eq!(mapped.events[0].kind, AgentEventKind::Error);
    assert_eq!(mapped.events[0].text.as_deref(), Some("error_max_turns: ran out of turns"));
    assert_eq!(mapped.events[1], status_event("as0", SessionStatus::Waiting, 1000));
}

#[test]
fn map_line_result_is_error_true_emits_error_then_waiting() {
    let line = r#"{"type":"result","subtype":"success","is_error":true,"error":"boom"}"#;
    let mapped = map_line("as0", line, 1000, None);
    assert!(mapped.turn_ended);
    assert_eq!(mapped.events[0].kind, AgentEventKind::Error);
    assert_eq!(mapped.events[0].text.as_deref(), Some("success: boom"));
    assert_eq!(mapped.events[1], status_event("as0", SessionStatus::Waiting, 1000));
}

#[test]
fn map_line_stream_event_ignored() {
    let line = r#"{"type":"stream_event","event":{"type":"content_block_delta"}}"#;
    let mapped = map_line("as0", line, 1000, None);
    assert!(mapped.events.is_empty());
    assert!(!mapped.turn_ended);
}

#[test]
fn map_line_non_json_becomes_text_verbatim() {
    let line = "warning: something happened";
    let mapped = map_line("as0", line, 1000, None);
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

// ── charge: the atomic hard-stop primitive (contract §5.3, Gate 6) ─────

fn registered_with_ceiling(reg: &RegistryCore, tag: &str, ceiling: Option<u64>) -> SessionInfo {
    let check = wt(&format!("/tmp/proj-charge-{tag}"));
    let (info, _, _) = reg
        .register(&check, "root".to_string(), None, "Agent".to_string(), None, None, ceiling)
        .unwrap();
    info
}

#[test]
fn charge_under_ceiling_returns_ok_and_leaves_the_session_alive() {
    let reg = RegistryCore::default();
    let info = registered_with_ceiling(&reg, "under", Some(1000));
    assert_eq!(charge(&reg.inner, &info.id, 0, 500), ChargeVerdict::Ok);
    let guard = reg.inner.lock().unwrap();
    let entry = guard.get(&info.id).unwrap();
    assert!(entry.info.alive);
    assert!(entry.busy);
    assert_eq!(entry.turn_tokens, 500);
    assert_eq!(entry.tokens_used, 0);
}

#[test]
fn charge_exactly_at_ceiling_stops() {
    let reg = RegistryCore::default();
    let info = registered_with_ceiling(&reg, "exact", Some(1000));
    let verdict = charge(&reg.inner, &info.id, 0, 1000);
    assert_eq!(verdict, ChargeVerdict::Stop { pid: None, spent: 1000, ceiling: 1000 });
}

#[test]
fn charge_over_ceiling_stops() {
    let reg = RegistryCore::default();
    let info = registered_with_ceiling(&reg, "over", Some(1000));
    let verdict = charge(&reg.inner, &info.id, 0, 1500);
    assert_eq!(verdict, ChargeVerdict::Stop { pid: None, spent: 1500, ceiling: 1000 });
}

#[test]
fn charge_stale_generation_returns_stale_and_mutates_nothing() {
    let reg = RegistryCore::default();
    let info = registered_with_ceiling(&reg, "stalegen", Some(1000));
    // 5 was never a generation this session reached — a turn task racing a
    // kill/restart it doesn't know about yet.
    assert_eq!(charge(&reg.inner, &info.id, 5, 999), ChargeVerdict::Stale);
    let guard = reg.inner.lock().unwrap();
    let entry = guard.get(&info.id).unwrap();
    assert_eq!(entry.turn_tokens, 0, "a stale charge must not touch turn_tokens");
    assert_eq!(entry.generation, 0);
    assert!(entry.info.alive);
}

#[test]
fn charge_on_unknown_id_returns_stale() {
    let reg = RegistryCore::default();
    assert_eq!(charge(&reg.inner, "no-such-id", 0, 999), ChargeVerdict::Stale);
}

#[test]
fn charge_stops_exactly_once_a_second_charge_on_the_captured_generation_is_stale() {
    let reg = RegistryCore::default();
    let info = registered_with_ceiling(&reg, "once", Some(100));
    let captured_generation = 0;

    let first = charge(&reg.inner, &info.id, captured_generation, 150);
    assert_eq!(first, ChargeVerdict::Stop { pid: None, spent: 150, ceiling: 100 });

    let second = charge(&reg.inner, &info.id, captured_generation, 999);
    assert_eq!(
        second,
        ChargeVerdict::Stale,
        "a second charge on the same captured generation must be Stale — exactly one Stop per session"
    );

    let guard = reg.inner.lock().unwrap();
    let entry = guard.get(&info.id).unwrap();
    assert_eq!(entry.generation, 1, "generation must have advanced by exactly one Stop, not two");
    assert_eq!(entry.tokens_used, 150, "the second, stale charge must not have re-mutated tokens_used");
}

#[test]
fn charge_stop_folds_spend_into_tokens_used_and_the_wire_copy_and_clears_turn_tokens() {
    // "usage accounting is correct at the boundary": since `finish_turn`
    // never runs on a budget stop (§5.3 step 3), `charge`'s Stop branch is
    // the only place the final spend can be folded — this proves it is.
    let reg = RegistryCore::default();
    let info = registered_with_ceiling(&reg, "foldstop", Some(1000));
    let verdict = charge(&reg.inner, &info.id, 0, 1200);
    assert_eq!(verdict, ChargeVerdict::Stop { pid: None, spent: 1200, ceiling: 1000 });

    let guard = reg.inner.lock().unwrap();
    let entry = guard.get(&info.id).unwrap();
    assert_eq!(entry.tokens_used, 1200);
    assert_eq!(entry.turn_tokens, 0);
    assert_eq!(entry.info.tokens_used, 1200, "the wire-visible SessionInfo copy must also be folded");
    assert!(!entry.info.alive);
    assert!(!entry.busy);
}

#[test]
fn charge_stop_takes_the_recorded_child_pid() {
    let reg = RegistryCore::default();
    let info = registered_with_ceiling(&reg, "takespid", Some(10));
    {
        let mut guard = reg.inner.lock().unwrap();
        guard.get_mut(&info.id).unwrap().child_pid = Some(4242);
    }
    let verdict = charge(&reg.inner, &info.id, 0, 50);
    assert_eq!(verdict, ChargeVerdict::Stop { pid: Some(4242), spent: 50, ceiling: 10 });
    let guard = reg.inner.lock().unwrap();
    assert_eq!(guard.get(&info.id).unwrap().child_pid, None, "child_pid must be taken, not merely read");
}

#[test]
fn charge_zero_ceiling_is_unlimited() {
    let reg = RegistryCore::default();
    let info = registered_with_ceiling(&reg, "zero", Some(0));
    assert_eq!(charge(&reg.inner, &info.id, 0, u64::MAX / 2), ChargeVerdict::Ok);
}

#[test]
fn charge_absent_ceiling_is_unlimited() {
    let reg = RegistryCore::default();
    let info = registered_with_ceiling(&reg, "absent", None);
    assert_eq!(charge(&reg.inner, &info.id, 0, u64::MAX / 2), ChargeVerdict::Ok);
}

#[test]
fn charge_turn_tokens_is_monotonically_non_decreasing_within_a_turn() {
    let reg = RegistryCore::default();
    let info = registered_with_ceiling(&reg, "monotone", Some(10_000));
    assert_eq!(charge(&reg.inner, &info.id, 0, 100), ChargeVerdict::Ok);
    // A lower reading must never regress turn_tokens (§5.2 named assumption).
    assert_eq!(charge(&reg.inner, &info.id, 0, 80), ChargeVerdict::Ok);
    {
        let guard = reg.inner.lock().unwrap();
        assert_eq!(guard.get(&info.id).unwrap().turn_tokens, 100);
    }
    assert_eq!(charge(&reg.inner, &info.id, 0, 250), ChargeVerdict::Ok);
    let guard = reg.inner.lock().unwrap();
    assert_eq!(guard.get(&info.id).unwrap().turn_tokens, 250);
}

#[test]
fn restart_after_a_budget_stop_clears_tokens_used_so_the_new_turn_is_not_re_stopped() {
    // Regression for D3 (WO06 audit): begin_restart used to bump generation
    // without resetting tokens_used, so the very first charge on the new
    // generation still saw `spent >= ceiling` from the stopped turn and
    // stopped again immediately — restart was permanently broken after the
    // first stop, burning a real paid turn on every press. Contract §5.5.2:
    // "restart resets tokens_used to 0 — a restart is a new budget."
    let reg = RegistryCore::default();
    let info = registered_with_ceiling(&reg, "restart-after-stop", Some(1000));

    // Drive the session to a Stop, exactly as `run_turn` would.
    let stop = charge(&reg.inner, &info.id, 0, 1200);
    assert_eq!(stop, ChargeVerdict::Stop { pid: None, spent: 1200, ceiling: 1000 });
    {
        let guard = reg.inner.lock().unwrap();
        let entry = guard.get(&info.id).unwrap();
        assert_eq!(entry.tokens_used, 1200);
        assert!(!entry.info.alive);
    }

    // User presses Restart. `charge`'s Stop branch already bumped the
    // generation once (0 -> 1); begin_restart bumps it again (1 -> 2).
    let (restarted_info, _pid, _prompt, new_generation) = reg.begin_restart(&info.id).unwrap();
    assert_eq!(new_generation, 2, "restart must bump the generation fence past the Stop's own bump");
    assert_eq!(restarted_info.tokens_used, 0, "the wire-visible copy must reset too");
    {
        let guard = reg.inner.lock().unwrap();
        let entry = guard.get(&info.id).unwrap();
        assert_eq!(entry.tokens_used, 0);
        assert_eq!(entry.turn_tokens, 0);
        assert!(entry.info.alive);
    }

    // The new turn's first (small) usage line must NOT immediately re-stop
    // the session — this is the actual regression.
    let after_restart = charge(&reg.inner, &info.id, new_generation, 50);
    assert_eq!(after_restart, ChargeVerdict::Ok, "a fresh budget must not re-stop on the first small charge");
}

// ── end_turn / two-turn accumulator fixture (contract §5.2) ────────────

#[test]
fn end_turn_folds_turn_tokens_into_tokens_used_and_clears_busy_and_child_pid() {
    let reg = RegistryCore::default();
    let info = registered_with_ceiling(&reg, "endturn", Some(10_000));
    assert_eq!(charge(&reg.inner, &info.id, 0, 300), ChargeVerdict::Ok);
    {
        let mut guard = reg.inner.lock().unwrap();
        guard.get_mut(&info.id).unwrap().child_pid = Some(777);
    }
    assert!(end_turn(&reg.inner, &info.id, 0));
    let guard = reg.inner.lock().unwrap();
    let entry = guard.get(&info.id).unwrap();
    assert_eq!(entry.tokens_used, 300);
    assert_eq!(entry.turn_tokens, 0);
    assert_eq!(entry.info.tokens_used, 300);
    assert!(!entry.busy);
    assert_eq!(entry.child_pid, None);
}

#[test]
fn end_turn_on_a_stale_generation_returns_false_and_mutates_nothing() {
    let reg = RegistryCore::default();
    let info = registered_with_ceiling(&reg, "endturnstale", Some(10_000));
    assert_eq!(charge(&reg.inner, &info.id, 0, 300), ChargeVerdict::Ok);
    assert!(!end_turn(&reg.inner, &info.id, 7));
    let guard = reg.inner.lock().unwrap();
    let entry = guard.get(&info.id).unwrap();
    assert_eq!(entry.tokens_used, 0, "a stale end_turn must not fold anything");
    assert_eq!(entry.turn_tokens, 300);
}

#[test]
fn two_turn_accumulator_folds_tokens_used_between_turns() {
    // §5.2's named assumption, pinned end-to-end: within a turn, observed
    // totals are non-decreasing; between turns, the fold accumulates.
    let reg = RegistryCore::default();
    let info = registered_with_ceiling(&reg, "twoturn", Some(10_000));

    // Turn 1: two lines, second higher than the first.
    assert_eq!(charge(&reg.inner, &info.id, 0, 100), ChargeVerdict::Ok);
    assert_eq!(charge(&reg.inner, &info.id, 0, 300), ChargeVerdict::Ok);
    assert!(end_turn(&reg.inner, &info.id, 0));
    {
        let guard = reg.inner.lock().unwrap();
        let entry = guard.get(&info.id).unwrap();
        assert_eq!(entry.tokens_used, 300);
        assert_eq!(entry.turn_tokens, 0);
    }

    // Turn 2 (same generation — no kill/restart happened): starts fresh at
    // turn_tokens=0 and folds on top of turn 1's total.
    assert_eq!(charge(&reg.inner, &info.id, 0, 150), ChargeVerdict::Ok);
    {
        let guard = reg.inner.lock().unwrap();
        let entry = guard.get(&info.id).unwrap();
        assert_eq!(entry.tokens_used, 300, "turn 2 must not be folded until it ends");
        assert_eq!(entry.turn_tokens, 150);
    }
    assert!(end_turn(&reg.inner, &info.id, 0));
    let guard = reg.inner.lock().unwrap();
    let entry = guard.get(&info.id).unwrap();
    assert_eq!(entry.tokens_used, 450, "300 (turn 1) + 150 (turn 2)");
    assert_eq!(entry.info.tokens_used, 450);
}

// ── format_thousands / budget_event: wire-shape helpers (contract §5.4) ─

#[test]
fn format_thousands_groups_by_three() {
    assert_eq!(format_thousands(0), "0");
    assert_eq!(format_thousands(999), "999");
    assert_eq!(format_thousands(1000), "1,000");
    assert_eq!(format_thousands(200_000), "200,000");
    assert_eq!(format_thousands(1_234_567), "1,234,567");
}

#[test]
fn budget_event_text_matches_the_contract_example() {
    let ev = budget_event("as2", None, 200_431, 200_000, 1755);
    assert_eq!(ev.kind, AgentEventKind::Budget);
    assert_eq!(ev.id, "as2");
    assert_eq!(ev.text.as_deref(), Some("token ceiling 200,000 reached — session stopped"));
    let usage = ev.usage.as_ref().expect("budget event must carry usage");
    assert_eq!(usage.total_tokens, 200_431);
}

#[test]
fn budget_event_carries_the_triggering_lines_input_output_and_cost_but_spent_as_total() {
    let line_usage = Usage { input_tokens: 40, output_tokens: 12, total_tokens: 52, cache_read_tokens: 0, context_window: None, cost_usd: Some(0.01) };
    let ev = budget_event("as1", Some(&line_usage), 9999, 5000, 1);
    let usage = ev.usage.unwrap();
    assert_eq!(usage.input_tokens, 40);
    assert_eq!(usage.output_tokens, 12);
    assert_eq!(usage.cost_usd, Some(0.01));
    assert_eq!(usage.total_tokens, 9999, "total_tokens is the accumulated spend, not the triggering line's own total");
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

// ── Integration: a real child is tree-killed by the Stop path (Gate 6) ──

#[tokio::test]
async fn a_budget_stop_verdict_tree_kills_a_real_dummy_child() {
    // Reuses the exact seam `kill_tree_terminates_a_long_running_dummy_child`
    // uses above — no fake `claude`, no real claude either — to prove the
    // pid `charge`'s `Stop` verdict hands back is the one that actually gets
    // torn down, exactly as `run_turn`'s Stop branch does it.
    let reg = RegistryCore::default();
    let info = registered_with_ceiling(&reg, "treekill", Some(10));

    let mut child = spawn_dummy();
    let pid = child.id().expect("dummy child must have a pid");
    assert!(pid_alive(pid), "dummy child should be alive right after spawn");
    {
        let mut guard = reg.inner.lock().unwrap();
        guard.get_mut(&info.id).unwrap().child_pid = Some(pid);
    }

    let verdict = charge(&reg.inner, &info.id, 0, 50);
    let ChargeVerdict::Stop { pid: stop_pid, spent, ceiling } = verdict else {
        panic!("expected Stop, got {verdict:?}");
    };
    assert_eq!(stop_pid, Some(pid));
    assert_eq!((spent, ceiling), (50, 10));

    kill_tree(stop_pid.unwrap()).await.expect("kill_tree should succeed");

    for _ in 0..20 {
        if !pid_alive(pid) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(!pid_alive(pid), "the dummy child named by the Stop verdict's pid should be gone");

    // And the registry itself reflects a single, clean stop.
    let guard = reg.inner.lock().unwrap();
    let entry = guard.get(&info.id).unwrap();
    assert!(!entry.info.alive);
    assert!(!entry.busy);
    assert_eq!(entry.child_pid, None);
    drop(guard);

    let _ = child.try_wait();
}
