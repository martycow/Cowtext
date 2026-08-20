---
name: wo11-verification
description: WO11 acceptance-walk-defects audit, two rounds (2026-08-20) — all four tester-found defects fixed and verified correct/deadlock-free, one coordinator-found HIGH (AGENT_FS mutex) verified sound, plus one NEW HIGH found by tester on re-verification (write_md_file/Markdown-tab bypasses the mutex entirely)
metadata:
  type: project
---

WO11 (Home/Git/Project/Avatars + acceptance-walk defects) verified in two
rounds on 2026-08-20, uncommitted tree on top of `ec7c1ba`. Round 1: 598 tests,
found HIGH (autosave rename/delete race), MAJOR (CRLF phantom diff in
GitWizard), MEDIUM (2 pre-existing path-comparison bugs via standing-rule
sweep), LOW (avatar read-before-cap). Round 2: coordinator reported all four
fixed, plus a HIGH tech-lead/R2 found independently (AGENT_FS mutex —
`write_atomic`'s TOCTOU could resurrect a renamed-away agent file as an
orphaned duplicate; my round-1 "fails cleanly" assessment was wrong, R2's
deeper read found the real gap). Gates re-confirmed round 2: tsc 0, lint 0
errors/7 warnings, build clean, clippy clean, cargo test 583 lib + 18 CLI =
601 0 failed, invoke 73/73.

**Round 2 verdicts, all independently verified by reading the diff (not
trusting the report):**

1. Autosave race — FIXED correctly. `src/store/agents.ts` replaced the
   promise/pendingAfterFlight tracking with a strict per-file FIFO chain
   (`AgentSaveQueueEntry{timer,tail}`); every `runAgentSave` call returns a
   promise for the turn it just enqueued, so `flushAgentSaveFor` can no
   longer resolve before the latest keystroke's write lands. Sound design,
   no remaining gap in this specific mechanism.

2. CRLF phantom diff — FIXED correctly. `composeGitignore`'s no-op branch now
   returns the literal original string (byte-identical to `status.
   gitignoreContent`), tripping `diffLines`'s pre-existing `oldText===newText`
   fast path before either side is line-split. When a REAL change is
   proposed against a CRLF file, the diff honestly shows every line changing
   (gitignore_write really does normalize to LF) — surfaced via a new
   `willNormalizeLineEndings` note rather than hidden. Good UX judgment call.

3. Path sweep — FIXED, all 3 (review.ts:81, tokens.ts:62/77, tokens.ts:88
   found by UI-D). Independently verified UI-D's judgment call that
   review.ts:145-148 is NOT an instance (both sides always trace to the same
   `change.relPath`, a Rust-canonical fs-watcher string, never a graph node's
   risky `filePath`) — judgment confirmed correct.

4. Avatar read-before-cap — FIXED. Stat-first via `fs::metadata` before
   `fs::read`. New test uses a genuinely sparse 2GB file, asserts <5s
   rejection — a real test, not just happy-path.

5. NEW HIGH (coordinator-reported, tech-lead/R2's finding) — AGENT_FS mutex
   in agents.rs, 16 commands guarded (verified: every #[tauri::command] in
   that file, no more no less), no re-entrancy (no guarded fn calls another
   as a plain Rust call), no early `drop(_guard)` anywhere (RAII holds
   through every early-return), tests use real `std::thread::spawn` (genuine
   OS concurrency, not cooperative async) with 25 trials each — legitimately
   proves the invariant, not a happy-path test. Verdict: SOUND.

6. NEW HIGH found BY ME on re-verification, still open at end of round 2 —
   `write_md_file`/`read_md_file` (`src-tauri/src/project.rs:713-728`) is a
   generic command that can target `.claude/agents/*.md` (only
   `.claude/settings.json` is special-cased) and takes NO lock — completely
   outside AGENT_FS's coverage since it lives in a different Rust module.
   Reachable via ordinary UI: `InspectorHeader`'s Properties/Markdown tab
   toggle and its "Open markdown tab" context-menu item
   (`src/inspector/Inspector.tsx:1952-1958,1980-1990`) render unconditionally
   for EVERY node type — the `isAgentFile` check only exists inside the
   "properties" branch (AgentNodePanel vs PropertiesTab), not gating the
   "markdown" branch at all (`:2062-2073`). `MarkdownTab` does its own
   independent read/write, uncoordinated with store/agents.ts's autosave
   queue. Because `read_md_file` (no lock, one syscall) is much cheaper than
   `agent_save` (lock + frontmatter patch + atomic write), it usually WINS
   a race against a flush-on-tab-switch — this is closer to a deterministic
   bug than a rare race: type in Agent tab, switch to Markdown before the
   500ms debounce lands, edit+Save there, and the original edit is silently
   discarded with no error anywhere. `tab` state also doesn't reset on node
   selection change, so a user habitually on the Markdown tab lands in this
   bypass with zero extra clicks just by clicking an agent node.

Manual updated: `docs/testing/WO11_TEST_MANUAL.md`, now 109 steps, section G
restructured into G.1-G.7 (G.3/G.6 are regression checks expected to pass
deterministically now; G.7 is the new open defect, expected to still repro).
Sign-off table has a dedicated "OPEN DEFECT" row for G.7 so it can't be
missed at sign-off time.

**Pattern worth remembering**: when a fix scopes a lock/guard to one Rust
module (here, agents.rs), always check whether an OLDER, MORE GENERIC command
in a DIFFERENT module can reach the same file surface unguarded — that's
exactly how this class of bug hides (write_md_file predates WO11 entirely,
nobody thought to ask "can the generic file-write command also hit this
path" when scoping the new mutex).
