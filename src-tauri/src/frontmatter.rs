//! Hand-rolled, lossless frontmatter grammar (subset) and read-patch-write
//! emitter (AGENTS_SUITE_CONTRACT.md §3). Pure: no IO, no Tauri types.
//!
//! The core invariant: `emit(parse(content)) == content` for every input —
//! parsing never loses a byte. `patch` re-parses, mutates only the known
//! keys / body a caller actually supplies, and re-emits; everything else
//! (unknown keys, comments, blank lines, list-form, per-line EOL) survives
//! untouched.

#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};

/// Known-key subset of the frontmatter. A total value: callers always send
/// all ten (contract §4, extended WO13_CONTRACT.md §14.4) — `None` / empty
/// means "delete this key".
///
/// WO13 §14.4 promotes five new known keys, in this canonical append order
/// after `skills`: `disallowedTools` (list) · `permissionMode` (scalar) ·
/// `maxTurns` (numeric scalar, rendered unquoted — the general scalar
/// renderer already emits a plain digit string unquoted, so no special
/// case is needed) · `memory` (scalar, enum `user|project|local` per the
/// docs verdict, WO13_CONTRACT.md §3.0 — validated by the caller, not
/// here) · `color` (scalar, enum `red|blue|green|yellow|purple|orange|
/// pink|cyan`, same non-validation stance as `model`). `mcpServers`,
/// `hooks`, `background`, `effort`, `isolation`, `initialPrompt` stay
/// backlogged and must keep round-tripping as `FmLine::Extra` — see
/// `frontmatter/tests.rs`'s round-trip fixture for all eleven keys at once.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FmFields {
    pub name: Option<String>,
    pub description: Option<String>,
    pub model: Option<String>,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub disallowed_tools: Vec<String>,
    pub permission_mode: Option<String>,
    pub max_turns: Option<String>,
    pub memory: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KnownKey {
    Name,
    Description,
    Model,
    Tools,
    Skills,
    DisallowedTools,
    PermissionMode,
    MaxTurns,
    Memory,
    Color,
}

impl KnownKey {
    /// Canonical append order (contract §3.2.5, extended §14.4).
    const ORDER: [KnownKey; 10] = [
        KnownKey::Name,
        KnownKey::Description,
        KnownKey::Model,
        KnownKey::Tools,
        KnownKey::Skills,
        KnownKey::DisallowedTools,
        KnownKey::PermissionMode,
        KnownKey::MaxTurns,
        KnownKey::Memory,
        KnownKey::Color,
    ];

    fn as_str(self) -> &'static str {
        match self {
            KnownKey::Name => "name",
            KnownKey::Description => "description",
            KnownKey::Model => "model",
            KnownKey::Tools => "tools",
            KnownKey::Skills => "skills",
            KnownKey::DisallowedTools => "disallowedTools",
            KnownKey::PermissionMode => "permissionMode",
            KnownKey::MaxTurns => "maxTurns",
            KnownKey::Memory => "memory",
            KnownKey::Color => "color",
        }
    }

    fn from_str(s: &str) -> Option<Self> {
        match s {
            "name" => Some(KnownKey::Name),
            "description" => Some(KnownKey::Description),
            "model" => Some(KnownKey::Model),
            "tools" => Some(KnownKey::Tools),
            "skills" => Some(KnownKey::Skills),
            "disallowedTools" => Some(KnownKey::DisallowedTools),
            "permissionMode" => Some(KnownKey::PermissionMode),
            "maxTurns" => Some(KnownKey::MaxTurns),
            "memory" => Some(KnownKey::Memory),
            "color" => Some(KnownKey::Color),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LineEol {
    Lf,
    Crlf,
    /// Last line of the document, no trailing terminator.
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ListForm {
    Bracket,
    Comma,
}

#[derive(Debug, Clone, PartialEq)]
struct LineRec {
    /// Line content, terminator excluded.
    text: String,
    eol: LineEol,
}

#[derive(Debug, Clone, PartialEq)]
struct KnownLineRec {
    key: KnownKey,
    /// The whole original (or, once patched, freshly rendered) line.
    line: LineRec,
    /// Captured value group (the raw remainder after `key:` and any
    /// immediately-following spaces/tabs), as first parsed. Kept so list
    /// form and scalar values can be recomputed without re-parsing text.
    value_raw: String,
}

#[derive(Debug, Clone, PartialEq)]
enum FmLine {
    Known(KnownLineRec),
    Extra(LineRec),
}

#[derive(Debug, Clone, PartialEq)]
enum Structure {
    /// First line was not exactly `---`: no frontmatter at all.
    NoFrontmatter,
    /// Unterminated fence or block-style YAML: whole content is body.
    Raw,
    Parsed {
        open: LineRec,
        lines: Vec<FmLine>,
        close: LineRec,
    },
}

/// Parsed view of a frontmatter document (contract §3.1).
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedDoc {
    pub raw: bool,
    pub parse_error: Option<String>,
    pub body: String,
    dominant_eol: LineEol,
    structure: Structure,
}

impl ParsedDoc {
    /// Extract the known-key fields as a total `FmFields` value. Empty /
    /// `None` for every key that is absent (contract §3.1: "no frontmatter
    /// ... fields empty"; raw docs likewise expose nothing usable).
    pub(crate) fn fields(&self) -> FmFields {
        let mut out = FmFields::default();
        if let Structure::Parsed { lines, .. } = &self.structure {
            for line in lines {
                if let FmLine::Known(k) = line {
                    match k.key {
                        KnownKey::Name => out.name = Some(scalar_value(&k.value_raw)),
                        KnownKey::Description => out.description = Some(scalar_value(&k.value_raw)),
                        KnownKey::Model => out.model = Some(scalar_value(&k.value_raw)),
                        KnownKey::Tools => out.tools = list_value(&k.value_raw).0,
                        KnownKey::Skills => out.skills = list_value(&k.value_raw).0,
                        KnownKey::DisallowedTools => out.disallowed_tools = list_value(&k.value_raw).0,
                        KnownKey::PermissionMode => out.permission_mode = Some(scalar_value(&k.value_raw)),
                        KnownKey::MaxTurns => out.max_turns = Some(scalar_value(&k.value_raw)),
                        KnownKey::Memory => out.memory = Some(scalar_value(&k.value_raw)),
                        KnownKey::Color => out.color = Some(scalar_value(&k.value_raw)),
                    }
                }
            }
        }
        out
    }
}

/// Split the next line out of `s`. Returns (content w/o terminator, the
/// terminator kind, byte length consumed including the terminator).
fn next_line(s: &str) -> (&str, LineEol, usize) {
    match s.find('\n') {
        Some(pos) => {
            if pos > 0 && s.as_bytes()[pos - 1] == b'\r' {
                (&s[..pos - 1], LineEol::Crlf, pos + 1)
            } else {
                (&s[..pos], LineEol::Lf, pos + 1)
            }
        }
        None => (s, LineEol::None, s.len()),
    }
}

/// Dominant EOL per contract §3.1: CRLF if the doc has at least one `\r\n`
/// and CRLF lines are at least half of all line terminators, else LF.
fn detect_dominant_eol(content: &str) -> LineEol {
    let bytes = content.as_bytes();
    let mut crlf = 0usize;
    let mut lf = 0usize;
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'\n' {
            if i > 0 && bytes[i - 1] == b'\r' {
                crlf += 1;
            } else {
                lf += 1;
            }
        }
    }
    let total = crlf + lf;
    if crlf > 0 && crlf * 2 >= total {
        LineEol::Crlf
    } else {
        LineEol::Lf
    }
}

fn is_fence_text(s: &str) -> bool {
    s.trim_end_matches(['\r', ' ', '\t']) == "---"
}

fn is_block_style(text: &str) -> bool {
    text.starts_with(' ') || text.starts_with('\t') || text.starts_with("- ")
}

fn is_key_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

/// `^([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.*)$`, hand-rolled (no regex crate).
fn match_key_line(line: &str) -> Option<(String, String)> {
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() && is_key_char(bytes[i]) {
        i += 1;
    }
    if i == 0 {
        return None;
    }
    let key = line[..i].to_string();
    let mut j = i;
    while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t') {
        j += 1;
    }
    if j >= bytes.len() || bytes[j] != b':' {
        return None;
    }
    j += 1;
    while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t') {
        j += 1;
    }
    Some((key, line[j..].to_string()))
}

/// Scalar value = raw remainder, trimmed; one matching quote pair stripped.
fn strip_one_quote_pair(s: &str) -> String {
    let b = s.as_bytes();
    if b.len() >= 2 {
        let first = b[0];
        let last = b[b.len() - 1];
        if (first == b'"' || first == b'\'') && first == last {
            return s[1..s.len() - 1].to_string();
        }
    }
    s.to_string()
}

fn scalar_value(value_raw: &str) -> String {
    strip_one_quote_pair(value_raw.trim())
}

/// Parse a list value, both bracket and bare-comma forms. Items trimmed,
/// one quote pair stripped, empty items dropped.
fn list_value(value_raw: &str) -> (Vec<String>, ListForm) {
    let trimmed = value_raw.trim();
    let (form, inner) = if trimmed.len() >= 2 && trimmed.starts_with('[') && trimmed.ends_with(']') {
        (ListForm::Bracket, &trimmed[1..trimmed.len() - 1])
    } else {
        (ListForm::Comma, trimmed)
    };
    (split_list_items(inner), form)
}

fn split_list_items(inner: &str) -> Vec<String> {
    if inner.trim().is_empty() {
        return Vec::new();
    }
    inner
        .split(',')
        .map(|s| strip_one_quote_pair(s.trim()))
        .filter(|s| !s.is_empty())
        .collect()
}

/// Parse `content` into a [`ParsedDoc`]. Never fails — unparseable input
/// becomes `raw: true` with a `parse_error`, per contract §3.1.
pub(crate) fn parse(content: &str) -> ParsedDoc {
    let dominant_eol = detect_dominant_eol(content);
    let (first_text, first_eol, first_len) = next_line(content);
    if !is_fence_text(first_text) {
        return ParsedDoc {
            raw: false,
            parse_error: None,
            body: content.to_string(),
            dominant_eol,
            structure: Structure::NoFrontmatter,
        };
    }
    let open = LineRec {
        text: first_text.to_string(),
        eol: first_eol,
    };
    let mut offset = first_len;
    let mut fm_lines: Vec<FmLine> = Vec::new();
    let mut seen: Vec<KnownKey> = Vec::new();

    loop {
        if offset >= content.len() {
            return ParsedDoc {
                raw: true,
                parse_error: Some("Unterminated frontmatter".to_string()),
                body: content.to_string(),
                dominant_eol,
                structure: Structure::Raw,
            };
        }
        let (text, eol, len) = next_line(&content[offset..]);
        if is_fence_text(text) {
            let close = LineRec {
                text: text.to_string(),
                eol,
            };
            let body_start = offset + len;
            return ParsedDoc {
                raw: false,
                parse_error: None,
                body: content[body_start..].to_string(),
                dominant_eol,
                structure: Structure::Parsed {
                    open,
                    lines: fm_lines,
                    close,
                },
            };
        }
        if is_block_style(text) {
            return ParsedDoc {
                raw: true,
                parse_error: Some(
                    "Block-style YAML is not supported — edit as raw text".to_string(),
                ),
                body: content.to_string(),
                dominant_eol,
                structure: Structure::Raw,
            };
        }
        if let Some((key_str, value_raw)) = match_key_line(text) {
            if let Some(k) = KnownKey::from_str(&key_str) {
                if !seen.contains(&k) {
                    seen.push(k);
                    fm_lines.push(FmLine::Known(KnownLineRec {
                        key: k,
                        line: LineRec {
                            text: text.to_string(),
                            eol,
                        },
                        value_raw,
                    }));
                    offset += len;
                    continue;
                }
            }
        }
        fm_lines.push(FmLine::Extra(LineRec {
            text: text.to_string(),
            eol,
        }));
        offset += len;
    }
}

fn push_line(out: &mut String, rec: &LineRec) {
    out.push_str(&rec.text);
    match rec.eol {
        LineEol::Lf => out.push('\n'),
        LineEol::Crlf => out.push_str("\r\n"),
        LineEol::None => {}
    }
}

/// Re-emit a [`ParsedDoc`]. `emit(parse(content)) == content` always.
fn emit(doc: &ParsedDoc) -> String {
    match &doc.structure {
        Structure::NoFrontmatter | Structure::Raw => doc.body.clone(),
        Structure::Parsed { open, lines, close } => {
            let mut out = String::new();
            push_line(&mut out, open);
            for line in lines {
                match line {
                    FmLine::Known(k) => push_line(&mut out, &k.line),
                    FmLine::Extra(l) => push_line(&mut out, l),
                }
            }
            push_line(&mut out, close);
            out.push_str(&doc.body);
            out
        }
    }
}

fn blank_line_str(eol: LineEol) -> &'static str {
    match eol {
        LineEol::Crlf => "\r\n",
        _ => "\n",
    }
}

fn contains_colon_space(v: &str) -> bool {
    v.as_bytes().windows(2).any(|w| w[0] == b':' && w[1] == b' ')
}

/// Scalar emission per contract §3.2.7: verbatim, unquoted, unless it needs
/// wrapping (leading `[{#"'` or a `: ` sequence) — such values are quoted
/// with `"`, or rejected if they themselves contain a `"`.
fn render_scalar_value(v: &str) -> Result<String, String> {
    let needs_quote = v.starts_with(['[', '{', '#', '"', '\'']) || contains_colon_space(v);
    if needs_quote {
        if v.contains('"') {
            return Err(format!(
                "Value cannot be safely quoted (contains a double quote): {v:?}"
            ));
        }
        Ok(format!("\"{v}\""))
    } else {
        Ok(v.to_string())
    }
}

/// `None` = key absent/cleared (per contract §3.2.4: null, empty-after-trim
/// → delete). `Some(err)` bubbles a quoting failure.
fn scalar_new_value(v: Option<&str>) -> Result<Option<String>, String> {
    let Some(v) = v else { return Ok(None) };
    if v.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(render_scalar_value(v)?))
}

fn render_list_item(item: &str) -> String {
    if item.contains(',') || item.starts_with(' ') || item.ends_with(' ') {
        format!("\"{item}\"")
    } else {
        item.to_string()
    }
}

fn list_new_value(items: &[String], form: ListForm) -> Option<String> {
    if items.is_empty() {
        return None;
    }
    let joined = items
        .iter()
        .map(|s| render_list_item(s))
        .collect::<Vec<_>>()
        .join(", ");
    Some(match form {
        ListForm::Bracket => format!("[{joined}]"),
        ListForm::Comma => joined,
    })
}

/// The list form already on disk for `key`, or `Bracket` (the "newly
/// appended" default, contract §3.2.6) when the key doesn't exist yet.
fn find_list_form(lines: &[FmLine], key: KnownKey) -> ListForm {
    for l in lines {
        if let FmLine::Known(k) = l {
            if k.key == key {
                return list_value(&k.value_raw).1;
            }
        }
    }
    ListForm::Bracket
}

fn rendered_new_value(key: KnownKey, f: &FmFields, lines: &[FmLine]) -> Result<Option<String>, String> {
    match key {
        KnownKey::Name => scalar_new_value(f.name.as_deref()),
        KnownKey::Description => scalar_new_value(f.description.as_deref()),
        KnownKey::Model => scalar_new_value(f.model.as_deref()),
        KnownKey::Tools => Ok(list_new_value(&f.tools, find_list_form(lines, key))),
        KnownKey::Skills => Ok(list_new_value(&f.skills, find_list_form(lines, key))),
        KnownKey::DisallowedTools => {
            Ok(list_new_value(&f.disallowed_tools, find_list_form(lines, key)))
        }
        // `maxTurns` renders unquoted: a plain digit string never starts
        // with `[{#"'` and never contains `: `, so `render_scalar_value`'s
        // existing quoting rule already leaves it bare — no special case.
        KnownKey::PermissionMode => scalar_new_value(f.permission_mode.as_deref()),
        KnownKey::MaxTurns => scalar_new_value(f.max_turns.as_deref()),
        KnownKey::Memory => scalar_new_value(f.memory.as_deref()),
        KnownKey::Color => scalar_new_value(f.color.as_deref()),
    }
}

fn has_any_nonempty(f: &FmFields) -> bool {
    [
        &f.name,
        &f.description,
        &f.model,
        &f.permission_mode,
        &f.max_turns,
        &f.memory,
        &f.color,
    ]
    .iter()
    .any(|v| v.as_deref().is_some_and(|s| !s.trim().is_empty()))
        || !f.tools.is_empty()
        || !f.skills.is_empty()
        || !f.disallowed_tools.is_empty()
}

/// The value for `key` already on disk, in the same parsed/trimmed shape
/// [`ParsedDoc::fields`] exposes to callers. `None` when the key is absent.
fn current_scalar(lines: &[FmLine], key: KnownKey) -> Option<String> {
    lines.iter().find_map(|l| match l {
        FmLine::Known(k) if k.key == key => Some(scalar_value(&k.value_raw)),
        _ => None,
    })
}

/// The list value for `key` already on disk. Empty when the key is absent.
fn current_list(lines: &[FmLine], key: KnownKey) -> Vec<String> {
    lines
        .iter()
        .find_map(|l| match l {
            FmLine::Known(k) if k.key == key => Some(list_value(&k.value_raw).0),
            _ => None,
        })
        .unwrap_or_default()
}

fn scalar_changed(incoming: Option<&str>, lines: &[FmLine], key: KnownKey) -> bool {
    let incoming_effective = incoming
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    current_scalar(lines, key) != incoming_effective
}

/// The existing `Known` line's raw value text is already wrapped in a
/// matching quote pair (mirrors the check in [`strip_one_quote_pair`]).
fn existing_value_is_quoted(lines: &[FmLine], key: KnownKey) -> bool {
    lines.iter().any(|l| match l {
        FmLine::Known(k) if k.key == key => {
            let s = k.value_raw.trim();
            let b = s.as_bytes();
            b.len() >= 2 && (b[0] == b'"' || b[0] == b'\'') && b[0] == b[b.len() - 1]
        }
        _ => false,
    })
}

/// Whether `key`'s line must actually be touched this save. The UI always
/// sends the full `FmFields` object back (contract §4), so a present value
/// that didn't change must normally be left byte-identical — otherwise every
/// save re-derives quoting for every known line (contract §3.2.7) and
/// silently rewrites lines whose *content* didn't change, e.g. a
/// `description:` containing ": " mid-sentence gaining quotes it never had
/// on an unrelated save.
///
/// The one deliberate exception: a scalar already wrapped in a redundant
/// quote pair on disk is still re-emitted unquoted even when unchanged
/// (contract §3.3 test 13 — quoted scalars normalize on any patch). That
/// direction never *adds* quoting, so it can't reproduce the defect above.
fn should_touch_key(key: KnownKey, f: &FmFields, lines: &[FmLine]) -> bool {
    match key {
        KnownKey::Name => scalar_changed(f.name.as_deref(), lines, key) || existing_value_is_quoted(lines, key),
        KnownKey::Description => {
            scalar_changed(f.description.as_deref(), lines, key) || existing_value_is_quoted(lines, key)
        }
        KnownKey::Model => scalar_changed(f.model.as_deref(), lines, key) || existing_value_is_quoted(lines, key),
        KnownKey::Tools => current_list(lines, key) != f.tools,
        KnownKey::Skills => current_list(lines, key) != f.skills,
        KnownKey::DisallowedTools => current_list(lines, key) != f.disallowed_tools,
        KnownKey::PermissionMode => {
            scalar_changed(f.permission_mode.as_deref(), lines, key) || existing_value_is_quoted(lines, key)
        }
        KnownKey::MaxTurns => {
            scalar_changed(f.max_turns.as_deref(), lines, key) || existing_value_is_quoted(lines, key)
        }
        KnownKey::Memory => scalar_changed(f.memory.as_deref(), lines, key) || existing_value_is_quoted(lines, key),
        KnownKey::Color => scalar_changed(f.color.as_deref(), lines, key) || existing_value_is_quoted(lines, key),
    }
}

/// Apply `f` to `doc` in place, per contract §3.2 points 3–6. A known key
/// whose effective value is unchanged from disk is left byte-identical —
/// see [`should_touch_key`].
fn apply_fields(doc: &mut ParsedDoc, f: &FmFields) -> Result<(), String> {
    if matches!(doc.structure, Structure::NoFrontmatter) {
        if !has_any_nonempty(f) {
            return Ok(());
        }
        let dominant = doc.dominant_eol;
        doc.body = format!("{}{}", blank_line_str(dominant), doc.body);
        doc.structure = Structure::Parsed {
            open: LineRec {
                text: "---".to_string(),
                eol: dominant,
            },
            lines: Vec::new(),
            close: LineRec {
                text: "---".to_string(),
                eol: dominant,
            },
        };
    }

    let dominant = doc.dominant_eol;
    let Structure::Parsed { lines, .. } = &mut doc.structure else {
        return Ok(());
    };

    for key in KnownKey::ORDER {
        if !should_touch_key(key, f, lines) {
            continue;
        }
        let new_value = rendered_new_value(key, f, lines)?;
        let idx = lines.iter().position(|l| matches!(l, FmLine::Known(k) if k.key == key));
        match (idx, new_value) {
            (Some(i), Some(val)) => {
                if let FmLine::Known(k) = &mut lines[i] {
                    k.line = LineRec {
                        text: format!("{}: {val}", key.as_str()),
                        eol: dominant,
                    };
                    k.value_raw = val;
                }
            }
            (Some(i), None) => {
                lines.remove(i);
            }
            (None, Some(val)) => {
                let value_raw = val.clone();
                lines.push(FmLine::Known(KnownLineRec {
                    key,
                    line: LineRec {
                        text: format!("{}: {val}", key.as_str()),
                        eol: dominant,
                    },
                    value_raw,
                }));
            }
            (None, None) => {}
        }
    }
    Ok(())
}

/// Read-patch-write emitter (contract §3.2). `content` is the file's
/// current bytes (the caller must have re-read it fresh, never a stale
/// client copy). `fields` and/or `body` are applied; either or both may be
/// `None`. Errors when `fields` is supplied against a `raw` document.
pub(crate) fn patch(
    content: &str,
    fields: Option<&FmFields>,
    body: Option<&str>,
) -> Result<String, String> {
    let mut doc = parse(content);
    if doc.raw && fields.is_some() {
        return Err("This file must be edited as raw text".to_string());
    }
    if let Some(f) = fields {
        apply_fields(&mut doc, f)?;
    }
    if let Some(b) = body {
        doc.body = if doc.dominant_eol == LineEol::Crlf {
            b.replace("\r\n", "\n").replace('\n', "\r\n")
        } else {
            b.to_string()
        };
    }
    Ok(emit(&doc))
}
