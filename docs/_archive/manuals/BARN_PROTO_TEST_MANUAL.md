# Barn Prototype Manual Test Script — Scene, Toggle, Demo Mode

Hand-run test manual for the early PixiJS barn prototype: the Canvas ⇄ Barn view
toggle, the placeholder-graphics scene (programmatic shapes — sprites land in Phase 5),
demo mode, camera pan/zoom, and cow interruption behavior. Run it top to bottom;
sections C–G reuse section B's project. Written against the code as of 2026-08-16
(`src/App.tsx` ViewToggle/Workspace, `src/scene/BarnScene.tsx`, `src/scene/demo.ts`,
`src/scene/mapper.ts`, `src/scene/cow.ts`). Every step names the real control and the
exact expected result — if reality differs, that is a bug (or this manual is stale;
either way, note it).

**Time budget:** ~25 min full pass.

---

## A. Preconditions

1. Free ports 1420/4923 and start the app from the repo root:

   ```powershell
   npm run tauri dev
   ```

2. *Expected on the empty "Open a project" state:* the top bar has **NO** Canvas/Barn
   toggle — the segmented control only exists while a project is open.
3. **Make a throwaway test project:**

   ```powershell
   mkdir C:\_cowtestb
   ```

4. **Open folder** → `C:\_cowtestb`. *Expected:* the workspace opens on the **canvas**
   view, and a segmented control appears **centered in the top bar**: a 2 px framed
   pill with two segments, **Canvas** (active — raised surface, medium weight) and
   **Barn** (muted). Hover tooltips: "Edit the context graph" / "Watch the agent in
   the barn".

---

## B. Empty-graph barn — the demo fallback scene

5. Click **Barn**. *Expected:*
   - The Barn segment becomes active; the canvas area is replaced by a Pixi scene on a
     dark night-blue background: an isometric 2:1 diamond floor grid, a **dev desk**
     and a **side desk** near the front, and a small pixel **cow** standing idle near
     the desks. All graphics are flat programmatic shapes (no sprite art yet — that is
     Phase 5, not a bug).
   - Because the graph has **zero nodes**, the barn renders its built-in **6 demo
     props** (cabinets / bookshelves / crates along the back walls) — the scene must
     never be empty.
   - The right-hand **Inspector is gone** in Barn view; the **file rail** (left) and
     the **event feed** strip (bottom) remain.
   - A small **Demo** button overlays the scene's top-right corner.
6. *Expected in the top bar:* Compile, save indicator, and Open folder are all still
   present and functional-looking — the toggle changes the workspace only.

---

## C. Camera — pan and zoom

7. **Drag** anywhere on the scene (left button, hold and move). *Expected:* the whole
   barn pans with the pointer, keeps up with fast moves, and releases cleanly outside
   the window edge (pointer capture).
8. **Wheel-zoom in** with the cursor held over the cow. *Expected:* the view zooms
   **toward the cow** — the point under the cursor stays fixed. Zoom is stepped and
   smooth, capped at **4×**; further wheel-up does nothing.
9. **Wheel-zoom out** fully. *Expected:* capped at **1×**; the page itself must NOT
   scroll while the cursor is over the scene (wheel is consumed).
10. Pan far away, then toggle **Canvas → Barn** again (two clicks). *Expected:* the
    scene comes back re-centered at the default 2× zoom (the prototype scene is rebuilt
    on mount; camera state is not persisted — note it, don't fail it).

---

## D. Demo mode walkthrough

11. Press **Demo** (top-right overlay). *Expected immediately:*
    - The button relabels to **Stop demo** and turns a reddish tint.
    - The bottom **event feed** header lights an amber **DEMO** badge, and scripted
      events start appearing as rows (session id `demo`) — demo events flow through
      the same store as live ones.
12. Watch one full scripted turn (~20 s). *Expected sequence, looping:*
    1. **prompt** — the cow pops a "**!**" speech bubble in place.
    2. **read** ×2 — the cow **walks tile-to-tile** to a prop, the prop does a short
       open/bounce **flash**, and a bubble shows the file name (long paths truncated
       with `…`, max ~24 chars).
    3. **grep** — the cow sniffs around: short walks to two props with "**?**" bubbles.
    4. more **read**s and a **glob** (another "?" volley).
    5. **edit** then **write** — the cow walks to the **side desk** and stays busy
       there ~1 s (typewriter bob), bubble = file name.
    6. **stop** — the cow breaks off and walks to stand beside the **dev desk** with a
       "**✓**" bubble. A beat later the next turn's prompt begins.
13. **Walk quality:** every walk is tile-to-tile along the grid (no diagonal
    teleports); even a cross-barn walk completes in ≤ ~1.5 s (long walks speed up
    rather than drag).
14. **Depth sorting:** while the cow walks between props, it renders **behind** props
    on lower rows and **in front** of props on higher rows — no prop ever draws
    through the cow's feet.
15. Press **Stop demo**. *Expected:* the button reverts to **Demo**, event rows stop
    arriving, the **DEMO badge disappears** from the event feed, and the cow finishes
    its current motion then idles.

---

## E. Demo mode ↔ rest of the app

16. Start **Demo** again, then toggle to **Canvas** while it runs. *Expected:* leaving
    the Barn unmounts the scene and **stops the demo** — no new rows arrive on the
    canvas view and the DEMO badge clears. (Demo events already in the feed remain —
    the feed is a log, not a filter.)
17. Now build a real graph: on the Canvas, double-click to create nodes titled
    `Rules` (role `rules`) and `Task` (role `task`); wait for **saved**. Toggle to
    **Barn**. *Expected:* the 6 placeholder demo props are **gone**, replaced by
    exactly one prop per real node at stable deterministic slots — a **cabinet** for
    the rules node, a **crate** for the task node.
18. Press **Demo** with the real graph loaded. The moment the cow performs a **read**
    of a real node file (bubble names it), toggle to **Canvas** within ~3 s.
    *Expected:* that node's **card is still pulsing amber** (live-read pulse lasts
    ~3.2 s) — demo events drive the canvas pulse exactly like live hook events. (The
    demo itself stops on toggle, per step 16 — the pulse you see is the tail of the
    last event.)
19. While the demo runs, expand the event feed. *Expected rows:* the demo reads/edits
    name the REAL node file paths (`context/rules.md`, `context/task.md`), with role
    dots — the demo script borrows the loaded graph's files.

---

## F. Interruption behavior

The cow runs an interruptible task queue: `stop` throws away everything queued;
an interrupt lands only after the in-flight tile step finishes.

20. **Scripted interrupt:** in the demo loop, watch the moment **stop** fires while
    the cow is still mid-walk (it happens most loops — stop follows a read by ~1.8 s).
    *Expected:* the cow abandons its remaining route and any queued visits and heads
    straight for the dev desk ("✓"). It **completes the single tile-step it was
    mid-way through first** — no snap, no teleport, no moonwalk frame.
21. **Live interrupt (synthetic):** stop the demo. With the Barn view open, fire a
    walk and then an immediate interrupt through the real event pipeline
    (hooks server on :4923 — app must be running):

    ```powershell
    '{"hook_event_name":"PostToolUse","tool_name":"Read","session_id":"m","tool_input":{"file_path":"C:\\_cowtestb\\context\\rules.md"}}' |
      curl.exe -s -X POST --data-binary "@-" http://127.0.0.1:4923/event
    Start-Sleep -Milliseconds 300
    '{"hook_event_name":"Stop","session_id":"m"}' |
      curl.exe -s -X POST --data-binary "@-" http://127.0.0.1:4923/event
    ```

    *Expected:* the cow starts toward the `Rules` cabinet, is cut off ~0.3 s in, and
    diverts to the dev desk with "✓". The abandoned read leaves no stuck bubble.
22. **Queue (non-interrupt) behavior:** send three **read** events for different node
    files back-to-back (repeat the first command of step 21 with each path, no Stop).
    *Expected:* the cow visits the props **one after another in order** — reads queue,
    they do not interrupt each other.
23. **Unknown-path event:** send a read for `C:\\_cowtestb\\nope.md`. *Expected:* the
    cow does **not** move (unknown paths are feed-only), while the event feed shows
    the accent-tinted "not on graph" row.

---

## G. Lifecycle robustness

24. Toggle **Canvas ⇄ Barn** rapidly ten times. *Expected:* no crash, no white flash
    of a dead canvas, no console errors in the `tauri dev` terminal (Pixi init is
    async — a destroyed-before-ready scene must clean up silently), and memory does
    not visibly balloon.
25. While in Barn view, pan the React-Flow canvas first: go to **Canvas**, drag the
    viewport somewhere distinctive, toggle **Barn**, then back to **Canvas**.
    *Expected:* the graph viewport is **exactly where you left it** — the canvas stays
    mounted (hidden) under the barn; toggling must never reset React Flow.
26. Open a different folder (**Open folder** → any other scratch dir) while sitting in
    **Barn** view. *Expected:* the app returns to **Canvas** view automatically — a
    new project always opens on the canvas.
27. Close the app while the Barn + demo are running. *Expected:* clean exit, no
    error dialog, no orphaned process (check Task Manager for a leftover
    `cowtext`/`app` process).

---

## Cleanup

28. Delete the scratch project:

    ```powershell
    Remove-Item -Recurse -Force C:\_cowtestb
    ```

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions | | |
| B Empty-graph barn | | |
| C Pan/zoom | | |
| D Demo walkthrough | | |
| E Demo ↔ app integration | | |
| F Interruption | | |
| G Lifecycle | | |

Tester: ____________  Date: ____________  Build/commit: ____________
