---
name: wo15-popover-and-disabled-control-traps
description: Three recurring UI traps in this repo — capture-phase scroll closing its own portal popover, title tooltips dead on disabled controls, and a pending async probe that reads as a definitive "no"
metadata:
  type: feedback
---

Two traps that bite every time a Cowtext popover or "disabled but explained" control
is built. Both are invisible in review and only show up in the running app.

**1. A portal popover's `window.addEventListener("scroll", onClose, true)` also hears
its OWN scroller.** `RolePopup` (Inspector.tsx) is the idiom every popover here is
cloned from, and it had this: the list is 13 rows in a 380 px box, and roving-tabindex
`itemRefs[i].focus()` scrolls that box — so arrow-keying past the fold closed the menu.
Guard the handler: `if (popRef.current?.contains(e.target as Node)) return;`.

**Why:** capture-phase scroll is the only way to hear an ancestor scrolling the anchor
away, so the listener has to stay broad; the fix is filtering by target, not narrowing
the listener.

**How to apply:** any new portal popover/menu with an internal scroller — check this
before shipping. Same file also shows the rest of the idiom worth cloning: viewport
flip in `useLayoutEffect` before paint, Escape + outside-pointerdown close, focus
returned to the trigger by the caller's `onClose`.

**2. A `title` on a *disabled* input never renders a tooltip in Chromium** — the
browser suppresses the pointer event outright, so the explanation for why the control
is dead is unreachable exactly when it is needed. Put the `title` on the wrapping
element AND add `disabled:pointer-events-none` to the control so hit-testing falls
through to the wrapper.

**How to apply:** whenever a control is rendered disabled-with-a-reason (WO15 D-3's
Influence slider on memory nodes is the canonical case). Keep the `title` on the input
too — harmless, and it is what a literal-string acceptance grep looks for.

**3. A derived boolean off a still-pending probe reads exactly like a definitive
"no".** `gitOn = initGit && gitStatus.gitAvailable && !isRepo` in `ProjectWizard.tsx`
resolves to `false` for the whole flight of the `git_status` IPC, so clicking Create
early silently skipped the repo the user had just asked for (WO15 tester #9).

**Why:** `null` state means "unknown", but every `x !== null && x.flag` guard collapses
unknown into false. The bug is invisible on a fast machine and reproducible on a cold
PATH probe.

**How to apply:** wherever an async probe gates a WRITE, derive an explicit
`pending = result === null && !failed` and disable the primary button on it, with the
copy saying so (`Git: checking…`). A *failed* probe is a real answer — it must not
block. Don't put the explanation in a `title` on the disabled button (trap 2).
