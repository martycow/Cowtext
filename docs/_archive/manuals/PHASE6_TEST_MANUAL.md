# Phase 6 manual test — Presets & Handoff (Lane D)

Prereqs: `npm run tauri dev`; a scratch project folder with a few nodes, and a
second EMPTY scratch folder for preset-apply. `claude` on PATH (or set the
binary in Settings) for handoff generation.

## A. Presets — save / list

1. Open a project with ≥2 nodes → top bar **Presets**. Modal opens, list says
   "No presets yet" on first run.
2. Type a name with spaces/caps ("My Preset!"), **Save current graph** → row
   appears with the original name, node-count badge, today's date.
   - On disk: `%AppData%\Roaming\com.mooexe.cowtext\presets\my-preset.cowtext-preset.json`.
   - File carries `nodes` with `id/title/role/brief/filePath/readOrder/pinned/position`
     — **no file content, no `lastVerified`** anywhere.
3. Save again under the same name → silently overwrites (one row, newer date).
4. Empty graph or blank name → Save button disabled ("The graph is empty").

## B. Presets — export / import

5. Row → download icon → OS save dialog (default name pre-filled). Pick a name
   *without* the extension → file lands with `.cowtext-preset.json` appended.
6. **Import…** → pick the exported file → row appears (name from the file's
   `name` field). Pick a non-preset `.json` → error banner "Not a Cowtext
   preset", nothing imported.

## C. Presets — apply (never-clobber)

7. With the current (non-empty) project open: **Apply** is disabled, title
   "Open an empty project first".
8. Open the empty scratch folder → Presets → Apply on a row → confirmation
   screen lists every `context/*.md` stub + `.cowtext/graph.json`; footer says
   "Creates N files in <root>. Existing files are never overwritten."
9. Pre-create one of the listed `context/*.md` files with custom text, reopen
   Apply → that row is struck through "will be skipped". Confirm → done screen
   lists only actually-written paths; your file kept its bytes; graph loads
   into the canvas; stubs are `# <Title>` (user content, **no** GENERATED
   header).
10. Apply again onto the same folder → error "project already has a graph".

## D. Handoff — generate / preview / write

11. Top bar **Handoff** (disabled when the graph is empty). Idle screen,
    consequence line "Runs claude -p …" → **Generate handoff** → amber pixel
    march (never a spinner).
12. Result: "HANDOFF.md — new file" well; content line 1 is the GENERATED
    header, then `# HANDOFF`, then the model's four `##` sections (Current
    state / Decisions made / Open threads / Next actions).
13. Nothing on disk yet (trust boundary) — check the project root.
    **Write HANDOFF.md** → footer "wrote HANDOFF.md"; file exists at the root.
14. Generate again → stacked "current" and "new" wells show old vs new.
15. Close the modal mid-generate → no error, no write (wait abandoned).
16. Demo events: run the barn demo, then generate — demo rows must NOT appear
    in the handoff activity (only live events feed the prompt).

## E. Handoff — copy variants

17. From the preview: three copy buttons (Chat / Code / Design). Each flashes
    "Copied"; paste shows the right preamble line before the handoff body.
18. Clipboard-denied fallback (hard to force; code path): a read-only textarea
    with "Copy failed — select and copy manually" appears instead of a toast.

## F. Gates

- `npx tsc --noEmit` — no errors in `src/preset/**`, `src/handoff/**`.
- `src-tauri`: `cargo clippy --all-targets -- -D warnings` clean;
  `cargo test preset:: handoff::` → 21 tests green.
