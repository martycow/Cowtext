//! AI toolchain detection — which agent CLIs are actually installed on this
//! machine.
//!
//! Feeds the title screen's "AI toolchain" panel. Every entry maps 1:1 onto a
//! [`crate::project::CompileTarget`] wire value, so "Cursor is installed" and
//! "Compile writes `.cursor/rules`" are two halves of the same row — the user
//! never has to translate between a tool they run and a file Cowtext emits.
//!
//! Detection is deliberately shallow and side-effect free: resolve the binary
//! on PATH, then ask it for its version. Nothing is written, no config is
//! read, and a tool that is absent is reported as absent rather than being
//! installed or repaired.
//!
//! The scan runs on title-screen mount and again on **Rescan** (WO15 Block
//! 5a). Spawning five child processes at mount is only acceptable because the
//! whole thing is time-boxed and off the render path: every probe is capped at
//! [`VERSION_TIMEOUT`], all five run concurrently, and the panel renders its
//! rows immediately — the screen is never blocked and the user can open a
//! project while the scan is still in flight. Each row carries the wall time
//! its own probe took ([`AiTool::elapsed_ms`]) so a slow machine is visible
//! rather than merely felt.

use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;

/// How long a single `--version` call may take before it is abandoned. A CLI
/// that has not answered in three seconds is reported found-but-versionless
/// rather than being allowed to hold the whole panel hostage. Three, not four:
/// the scan now starts on title-screen mount (WO15 Block 5a), so the worst
/// case is something the user watches rather than something they asked for.
const VERSION_TIMEOUT: Duration = Duration::from_secs(3);

/// One row of the panel: a tool Cowtext can compile for, and what the scan
/// learned about it. `id` is the `CompileTarget` wire value, NOT a tool name —
/// `"agents"` is the AGENTS.md target that Codex reads.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTool {
    pub id: &'static str,
    pub name: &'static str,
    /// The binary as a user would type it — shown verbatim in the panel.
    pub cmd: &'static str,
    /// The file this target compiles to, for the same row.
    pub emits: &'static str,
    pub found: bool,
    /// `None` when the tool is absent, or present but did not answer in time.
    pub version: Option<String>,
    /// Absolute path the probe resolved, `None` when absent.
    pub path: Option<String>,
    /// Wall time for this row's probe (PATH resolve + `--version`), ms.
    pub elapsed_ms: u64,
}

struct Probe {
    id: &'static str,
    name: &'static str,
    cmd: &'static str,
    emits: &'static str,
    /// The executable to resolve on PATH — differs from `cmd` where the tool
    /// is a subcommand of another binary (Copilot is a `gh` extension).
    bin: &'static str,
    version_args: &'static [&'static str],
    /// When true, a resolved binary is not enough: the version call must also
    /// succeed. This is how a `gh` install without the Copilot extension is
    /// correctly reported as "not found" rather than as Copilot.
    needs_version_ok: bool,
}

/// The five compile targets, in the order the panel shows them. Kept in step
/// with `CompileTarget` in `project.rs` and `COMPILE_TARGETS` in
/// `src/store/graph.ts` — `ids_match_compile_targets` guards the Rust half.
const PROBES: &[Probe] = &[
    Probe {
        id: "claude",
        name: "Claude Code",
        cmd: "claude",
        emits: "CLAUDE.md",
        bin: "claude",
        version_args: &["--version"],
        needs_version_ok: false,
    },
    Probe {
        id: "agents",
        name: "Codex CLI",
        cmd: "codex",
        emits: "AGENTS.md",
        bin: "codex",
        version_args: &["--version"],
        needs_version_ok: false,
    },
    Probe {
        id: "cursor",
        name: "Cursor",
        cmd: "cursor",
        emits: ".cursor/rules/*.mdc",
        bin: "cursor",
        version_args: &["--version"],
        needs_version_ok: false,
    },
    Probe {
        id: "copilot",
        name: "GitHub Copilot",
        cmd: "gh copilot",
        emits: ".github/copilot-instructions.md",
        bin: "gh",
        version_args: &["copilot", "--version"],
        needs_version_ok: true,
    },
    Probe {
        id: "gemini",
        name: "Gemini CLI",
        cmd: "gemini",
        emits: "GEMINI.md",
        bin: "gemini",
        version_args: &["--version"],
        needs_version_ok: false,
    },
];

/// Resolve a bare binary name against PATH. Windows reuses `assemble.rs`'s
/// `where` probe (which prefers a native `.exe` over an npm `.cmd` shim, and
/// suppresses the console flash); elsewhere it is a plain `which`.
fn probe_binary(name: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        crate::assemble::where_probe(name)
    }
    #[cfg(not(windows))]
    {
        let out = std::process::Command::new("which").arg(name).output().ok()?;
        if !out.status.success() {
            return None;
        }
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .map(PathBuf::from)
    }
}

/// Pull a version out of arbitrary `--version` chatter.
///
/// CLIs answer in no common shape: `2.1.237 (Claude Code)`, `gh version
/// 2.62.0 (2024-11-14)`, `cursor 0.42.5`, a bare `1.5.0`. The rule is
/// deliberately dumb and predictable: the first whitespace-separated token
/// that starts with a digit and contains a dot, stripped of surrounding
/// punctuation and any leading `v`. Anything unrecognisable yields `None`,
/// which the panel renders as found-without-a-version — never as absent.
fn extract_version(output: &str) -> Option<String> {
    output
        .lines()
        .find(|l| !l.trim().is_empty())?
        .split_whitespace()
        .map(|tok| tok.trim_matches(|c: char| !c.is_ascii_alphanumeric()))
        .map(|tok| tok.strip_prefix('v').unwrap_or(tok))
        .find(|tok| {
            tok.starts_with(|c: char| c.is_ascii_digit())
                && tok.contains('.')
                && tok.chars().all(|c| c.is_ascii_digit() || c == '.')
        })
        .map(str::to_string)
}

/// Run `<path> <args>` and return its trimmed stdout, or `None` on spawn
/// failure, non-zero exit, or timeout.
async fn run_version(path: &PathBuf, args: &[&str]) -> Option<String> {
    let mut cmd = tokio::process::Command::new(path);
    cmd.args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        // Inherent on tokio's Command — no `std::os::windows::process::CommandExt`
        // import (that trait is for std's Command, and importing it here is an
        // unused-import warning).
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — no console flash
    }
    let out = tokio::time::timeout(VERSION_TIMEOUT, cmd.output())
        .await
        .ok()?
        .ok()?;
    if !out.status.success() {
        return None;
    }
    // Some CLIs print the banner to stderr; fall back rather than report a
    // versionless install for a tool that did answer.
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if stderr.is_empty() {
            return None;
        }
        return Some(stderr);
    }
    Some(stdout)
}

/// The row for a tool that is not installed — identity fields only, so the
/// panel can still render it. Every "absent" answer comes from here, whether
/// the binary was missing or the probe task itself died. `elapsed_ms` is `0`:
/// this base row has measured nothing, and every caller that *did* measure
/// overwrites it.
fn absent(p: &'static Probe) -> AiTool {
    AiTool {
        id: p.id,
        name: p.name,
        cmd: p.cmd,
        emits: p.emits,
        found: false,
        version: None,
        path: None,
        elapsed_ms: 0,
    }
}

async fn detect_one(p: &'static Probe) -> AiTool {
    let started = std::time::Instant::now();
    let Some(path) = probe_binary(p.bin) else {
        return AiTool {
            elapsed_ms: elapsed_ms(started),
            ..absent(p)
        };
    };
    let banner = run_version(&path, p.version_args).await;
    if banner.is_none() && p.needs_version_ok {
        // `gh` is installed but `gh copilot` is not an extension it has.
        return AiTool {
            elapsed_ms: elapsed_ms(started),
            ..absent(p)
        };
    }
    AiTool {
        found: true,
        version: banner.as_deref().and_then(extract_version),
        path: Some(path.to_string_lossy().into_owned()),
        elapsed_ms: elapsed_ms(started),
        ..absent(p)
    }
}

/// Milliseconds since `started`, saturating. A probe cannot plausibly take
/// 5.8e8 years, but a `u128 as u64` truncation would report a fast probe if
/// one somehow did — saturating says "very slow", which is at least true.
fn elapsed_ms(started: std::time::Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// Scan for every AI tool Cowtext can compile for. Always returns one entry
/// per target, in `PROBES` order, whether found or not — the panel is a fixed
/// list of rows whose status changes, not a list that grows.
#[tauri::command]
pub async fn detect_ai_tools() -> Vec<AiTool> {
    // Concurrently: five sequential `--version` calls at the timeout each
    // would be a 20-second worst case for what the user reads as one scan.
    let handles: Vec<_> = PROBES
        .iter()
        .map(|p| tokio::spawn(async move { detect_one(p).await }))
        .collect();
    let mut out = Vec::with_capacity(PROBES.len());
    for (h, p) in handles.into_iter().zip(PROBES.iter()) {
        // A JoinError here means the probe task panicked; the row is reported
        // absent rather than dropped, so the list is never short.
        out.push(h.await.unwrap_or(absent(p)));
    }
    out
}

#[cfg(test)]
mod tests;
