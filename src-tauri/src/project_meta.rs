//! `.cowtext/project.json` — v1 sidecar carrying the project's own
//! properties, plus the scaffolder that makes a bare folder
//! "Cowtext-friendly" (INPUT_PROMPT 08/19 items 9 + 10, WO10 Lane 6).
//!
//! Until this landed, Cowtext knew a project's NAME (derived from the folder,
//! stored on the graph) and nothing else. Everything an agent actually needs
//! to be told up front — what this project is, what it must do, the rules it
//! must not break, who it is for — lived only in whatever `CLAUDE.md` the
//! user had hand-written, which is precisely the file Cowtext generates and
//! overwrites. So the first thing the compiler is supposed to own was the one
//! thing it could not see.
//!
//! Two commands hold the properties (`project_meta_read` /
//! `project_meta_write`) and one scaffolds (`project_init`).
//!
//! **The properties are not decoration.** `project_init` renders them into a
//! real, pinned `context/project.md` Memory Node, so they reach the agent
//! through the normal compile path rather than sitting in a sidecar nothing
//! reads. The sidecar is the STRUCTURED copy — what the wizard re-opens for
//! editing — and the markdown is the compiled copy.
//!
//! `.cowtext/` is a dot-directory, so `project::is_scannable_md` never
//! matches this file and no `fs://change` fires for it: every mutation must
//! reach the frontend through the command's own return value.

#[cfg(test)]
mod tests;

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::project::{checked_root, write_atomic};

pub const PROJECT_META_REL_PATH: &str = ".cowtext/project.json";
/// The rendered, compile-visible twin of the sidecar. Pinned, so it survives
/// every compile and is always in context.
pub const PROJECT_NODE_REL_PATH: &str = "context/project.md";

pub const PROJECT_META_VERSION: u32 = 1;

// `projectType` is free-form on the wire: an unknown value round-trips
// untouched. The label list lives in `src/project/types.ts`, on the side that
// renders the picker — a second copy here would be a second thing to keep in
// sync for no gain, since nothing in Rust branches on it.

/// `.cowtext/project.json` (v1). Field declaration order IS the wire order.
/// Mirrors `ProjectMeta` in `src/project/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub name: String,
    /// One-paragraph statement of what this project is.
    #[serde(default)]
    pub brief: String,
    #[serde(default)]
    pub project_type: String,
    /// What it must do. One entry per line in the wizard.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub requirements: Vec<String>,
    /// Optional. Constraints the agent must never violate — these compile
    /// into the strongest section of the rendered node.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hard_rules: Vec<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub target_audience: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub architecture: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub constraints: Vec<String>,
}

/// Envelope, so the file is self-describing and a future field can arrive
/// with a version bump rather than a guess.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetaFile {
    pub version: u32,
    #[serde(flatten)]
    pub meta: ProjectMeta,
}

/// Trim, drop blanks. Applied to every list on write so the rendered
/// markdown never grows an empty bullet from a stray newline in a textarea.
fn clean_list(items: &[String]) -> Vec<String> {
    items
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn normalize(meta: &ProjectMeta) -> ProjectMeta {
    ProjectMeta {
        name: meta.name.trim().to_string(),
        brief: meta.brief.trim().to_string(),
        project_type: meta.project_type.trim().to_string(),
        requirements: clean_list(&meta.requirements),
        hard_rules: clean_list(&meta.hard_rules),
        target_audience: meta.target_audience.trim().to_string(),
        architecture: meta.architecture.trim().to_string(),
        constraints: clean_list(&meta.constraints),
    }
}

/// Deterministic serialization: fixed field order (struct declaration order),
/// 2-space indent, LF, trailing newline, empty optional fields omitted. Same
/// contract as `serialize_graph` — a git-tracked file must not churn.
pub fn serialize_meta(meta: &ProjectMeta) -> String {
    let file = ProjectMetaFile {
        version: PROJECT_META_VERSION,
        meta: normalize(meta),
    };
    let mut s = serde_json::to_string_pretty(&file).unwrap_or_else(|_| "{}".to_string());
    s.push('\n');
    s
}

/// Render the properties as the markdown an agent actually reads.
///
/// Deliberately plain: headings and bullets, no frontmatter, no GENERATED
/// header. This is a Memory Node the user OWNS and may edit by hand — the
/// GENERATED header belongs on `CLAUDE.md`/`AGENTS.md`, which compile
/// overwrites, and stamping it here would tell the user not to touch their
/// own project description.
pub fn render_project_node(meta: &ProjectMeta) -> String {
    let m = normalize(meta);
    let mut out = String::new();
    let title = if m.name.is_empty() { "Project" } else { &m.name };
    out.push_str(&format!("# {title}\n"));
    if !m.brief.is_empty() {
        out.push_str(&format!("\n{}\n", m.brief));
    }

    let section = |out: &mut String, heading: &str, items: &[String]| {
        if items.is_empty() {
            return;
        }
        out.push_str(&format!("\n## {heading}\n\n"));
        for i in items {
            out.push_str(&format!("- {i}\n"));
        }
    };
    let prose = |out: &mut String, heading: &str, body: &str| {
        if body.is_empty() {
            return;
        }
        out.push_str(&format!("\n## {heading}\n\n{body}\n"));
    };

    section(&mut out, "Requirements", &m.requirements);
    // Hard rules go before the softer context on purpose: if the model reads
    // only the top of this file, these are the lines that must survive.
    section(&mut out, "Hard rules", &m.hard_rules);
    prose(&mut out, "Target audience", &m.target_audience);
    prose(&mut out, "Architecture", &m.architecture);
    section(&mut out, "Constraints", &m.constraints);
    out
}

/// Read `.cowtext/project.json`. `Ok(None)` when the project has none —
/// every project predating this feature, which must open normally.
///
/// Tolerant: an unparseable or wrong-version file also reads as `None`
/// rather than an error. A corrupt sidecar must not be able to stop a
/// project from opening — the wizard simply offers to write a fresh one.
#[tauri::command]
pub fn project_meta_read(root: String) -> Result<Option<ProjectMeta>, String> {
    let path = checked_root(&root)?.join(PROJECT_META_REL_PATH);
    let Ok(raw) = fs::read_to_string(&path) else {
        return Ok(None);
    };
    let Ok(file) = serde_json::from_str::<ProjectMetaFile>(&raw) else {
        return Ok(None);
    };
    if file.version == 0 || file.version > PROJECT_META_VERSION {
        return Ok(None);
    }
    Ok(Some(file.meta))
}

/// Write `.cowtext/project.json` atomically, and refresh the rendered
/// `context/project.md` when one already exists.
///
/// The refresh is deliberately conditional. Writing the markdown
/// unconditionally would silently overwrite a file the user may have edited
/// by hand since `project_init` created it; NOT refreshing an existing one
/// would leave the compiled copy stale the moment a property changes. So:
/// if the node exists, it is ours to keep current; if it does not, the user
/// removed it and we do not resurrect it.
#[tauri::command]
pub fn project_meta_write(root: String, meta: ProjectMeta) -> Result<(), String> {
    let root_path = checked_root(&root)?;
    write_atomic(
        &root_path.join(PROJECT_META_REL_PATH),
        &serialize_meta(&meta),
    )?;
    let node = root_path.join(PROJECT_NODE_REL_PATH);
    if node.exists() {
        write_atomic(&node, &render_project_node(&meta))?;
    }
    Ok(())
}

/// What `project_init` did, so the frontend can report it precisely rather
/// than claiming more than happened.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInitResult {
    /// Project-relative paths this call created, in the order created.
    pub written: Vec<String>,
    /// Paths that already existed and were therefore left alone.
    pub skipped: Vec<String>,
    /// Was this folder already a Cowtext project before the call? Sampled
    /// BEFORE anything is written, so the wizard can say "converted" vs
    /// "created" truthfully instead of guessing from what it asked for.
    pub already_project: bool,
}

/// Scaffold a Cowtext-friendly project: the `.cowtext/` sidecar directory,
/// a `context/` directory for Memory Nodes, `.claude/agents/` for agent
/// definitions, the project sidecar, and the rendered `context/project.md`.
///
/// **Never clobbers.** The sidecar is the one file this will overwrite (it is
/// ours, and re-running the wizard is how you edit it); every other path is
/// claimed with `create_new`, so a folder that already holds a
/// `context/project.md` keeps it and reports it as skipped. That makes this
/// safe to run on a directory that is already a project — which is exactly
/// what the "convert existing project" flow does.
///
/// The graph itself is NOT written here: `preset_apply` already owns that,
/// with its own atomic never-clobber guard and its own "project already has
/// a graph" check. Duplicating it would mean two writers with two opinions
/// about the same file.
#[tauri::command]
pub fn project_init(root: String, meta: ProjectMeta) -> Result<ProjectInitResult, String> {
    let root_path = checked_root(&root)?;
    let already_project = is_cowtext_project(&root_path);
    let mut written = Vec::new();
    let mut skipped = Vec::new();

    for dir in [".cowtext", "context", ".claude/agents"] {
        fs::create_dir_all(root_path.join(dir)).map_err(|e| format!("{dir}: {e}"))?;
    }

    // The sidecar is ours; re-running the wizard updates it.
    write_atomic(
        &root_path.join(PROJECT_META_REL_PATH),
        &serialize_meta(&meta),
    )?;
    written.push(PROJECT_META_REL_PATH.to_string());

    // The rendered node is the user's; claim the path or leave it be. Atomic
    // create_new, so a file appearing between a probe and a write cannot be
    // destroyed — same no-TOCTOU rule preset.rs applies to its stubs.
    let node_path = root_path.join(PROJECT_NODE_REL_PATH);
    if let Some(parent) = node_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    match fs::File::create_new(&node_path) {
        Ok(mut f) => {
            use std::io::Write;
            f.write_all(render_project_node(&meta).as_bytes())
                .map_err(|e| format!("{}: {e}", node_path.display()))?;
            written.push(PROJECT_NODE_REL_PATH.to_string());
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            skipped.push(PROJECT_NODE_REL_PATH.to_string());
        }
        Err(e) => return Err(format!("{}: {e}", node_path.display())),
    }

    Ok(ProjectInitResult {
        written,
        skipped,
        already_project,
    })
}

/// Is this folder already laid out the way Cowtext expects? Used by the
/// title-screen wizards to tell "new project" from "convert this one".
/// Deliberately a weak test — the presence of the graph is what makes a
/// folder a Cowtext project; everything else `project_init` can add.
pub fn is_cowtext_project(root: &Path) -> bool {
    root.join(".cowtext/graph.json").exists()
}
