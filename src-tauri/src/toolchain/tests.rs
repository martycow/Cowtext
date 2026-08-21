use super::*;
use crate::project::CompileTarget;

// ── extract_version ────────────────────────────────────────────────────
// The rule is "first dotted numeric token"; these are the real shapes the
// five CLIs answer with, plus the ways the rule is allowed to give up.

#[test]
fn version_from_bare_number() {
    assert_eq!(extract_version("1.5.0").as_deref(), Some("1.5.0"));
}

#[test]
fn version_from_claude_banner() {
    assert_eq!(
        extract_version("2.1.237 (Claude Code)").as_deref(),
        Some("2.1.237")
    );
}

#[test]
fn version_skips_leading_words() {
    assert_eq!(
        extract_version("gh version 2.62.0 (2024-11-14)").as_deref(),
        Some("2.62.0")
    );
}

#[test]
fn version_strips_a_leading_v() {
    assert_eq!(extract_version("cursor v0.42.5").as_deref(), Some("0.42.5"));
}

#[test]
fn version_strips_surrounding_punctuation() {
    assert_eq!(extract_version("codex (1.2.3)").as_deref(), Some("1.2.3"));
}

#[test]
fn version_reads_only_the_first_nonblank_line() {
    // A banner whose second line carries a different number must not win.
    assert_eq!(
        extract_version("\n\ngemini 0.9.1\nnode 22.11.0").as_deref(),
        Some("0.9.1")
    );
}

#[test]
fn version_rejects_a_dateless_integer() {
    // No dot: not a version. Reported as found-without-version, not as "2024".
    assert_eq!(extract_version("built 2024"), None);
}

#[test]
fn version_rejects_a_hash_and_a_date() {
    assert_eq!(extract_version("build a1b2c3d"), None);
    assert_eq!(extract_version("released 2024-11-14"), None);
}

#[test]
fn version_of_empty_output_is_none() {
    assert_eq!(extract_version(""), None);
    assert_eq!(extract_version("   \n  "), None);
}

// ── the probe table ────────────────────────────────────────────────────

/// Every `id` must round-trip as a `CompileTarget`. A row whose id is not a
/// real target would show a tool the compiler cannot emit for.
#[test]
fn ids_match_compile_targets() {
    for p in PROBES {
        let json = format!("\"{}\"", p.id);
        serde_json::from_str::<CompileTarget>(&json)
            .unwrap_or_else(|e| panic!("probe id {:?} is not a CompileTarget: {e}", p.id));
    }
}

/// One row per target, no target missing and none listed twice.
#[test]
fn every_compile_target_has_exactly_one_probe() {
    let all = [
        CompileTarget::Claude,
        CompileTarget::Agents,
        CompileTarget::Cursor,
        CompileTarget::Copilot,
        CompileTarget::Gemini,
    ];
    assert_eq!(PROBES.len(), all.len());
    for t in all {
        let wire = serde_json::to_string(&t).unwrap();
        let wire = wire.trim_matches('"');
        assert_eq!(
            PROBES.iter().filter(|p| p.id == wire).count(),
            1,
            "target {wire} needs exactly one probe row"
        );
    }
}

#[test]
fn probe_rows_are_fully_populated() {
    for p in PROBES {
        assert!(!p.name.is_empty(), "{} has no display name", p.id);
        assert!(!p.cmd.is_empty(), "{} has no command", p.id);
        assert!(!p.emits.is_empty(), "{} emits nothing", p.id);
        assert!(!p.bin.is_empty(), "{} resolves no binary", p.id);
        assert!(!p.version_args.is_empty(), "{} has no version args", p.id);
    }
}

/// Copilot is a `gh` extension, so a resolved `gh` alone must NOT count as
/// Copilot being installed — it is the one row that needs its version call to
/// succeed. Guarding the flag keeps that reasoning from being edited away.
#[test]
fn only_copilot_requires_a_successful_version_call() {
    for p in PROBES {
        assert_eq!(
            p.needs_version_ok,
            p.id == "copilot",
            "{} has the wrong needs_version_ok",
            p.id
        );
    }
}

/// A missing tool must report absent on every field, never a stale path or a
/// version left over from the probe row.
#[tokio::test]
async fn an_unresolvable_binary_is_reported_absent() {
    static NOPE: Probe = Probe {
        id: "claude",
        name: "Not Installed",
        cmd: "cowtext-no-such-binary",
        emits: "NOTHING.md",
        bin: "cowtext-no-such-binary-xyzzy",
        version_args: &["--version"],
        needs_version_ok: false,
    };
    let got = detect_one(&NOPE).await;
    assert!(!got.found);
    assert_eq!(got.version, None);
    assert_eq!(got.path, None);
    // The identity fields still come back, so the panel can render the row.
    assert_eq!(got.name, "Not Installed");
    assert_eq!(got.emits, "NOTHING.md");
}

/// The command always answers with one row per target, in table order —
/// callers index by position and must never get a short list.
#[tokio::test]
async fn detect_returns_every_row_in_table_order() {
    let got = detect_ai_tools().await;
    assert_eq!(got.len(), PROBES.len());
    for (row, p) in got.iter().zip(PROBES.iter()) {
        assert_eq!(row.id, p.id);
        assert_eq!(row.emits, p.emits);
        // Whatever this machine has installed, the two must agree.
        assert_eq!(row.found, row.path.is_some());
    }
}
