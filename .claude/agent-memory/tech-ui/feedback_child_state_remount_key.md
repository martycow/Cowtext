---
name: wo15-controlled-child-state-remount
description: When a parent writes a child's props behind its back (presets, prefills), remount with a nonce key — several Cowtext field components derive local state from props ONCE
metadata:
  type: feedback
---

Several Cowtext field components derive local UI state from their props in a
`useState` **initialiser** and never resync: `ToolPicker`'s `ToolsField`
(inherit/restrict radio from `tools`), `ModelPicker`'s custom-id box, the old
`ModelPicker`'s pin draft. A parent that fills those props programmatically
(an agent preset, a wizard prefill, a "reset" button) leaves the child showing
the previous mode.

**Why:** it is the codebase's existing idiom — `AgentEditor` already remounts
its children with `key={doc.fileName}` on selection change, and rewriting the
children into fully controlled components would mean re-deriving mode rules in
two places (the child and every caller).

**How to apply:** keep a `nonce` in the parent, bump it in the same handler
that writes the props, and pass `key={`tools-${nonce}`}`. Do this rather than
adding a `useEffect` that syncs state to props — that reintroduces the
controlled-textarea caret trap recorded in [[wo11-ui-a-wizards]].
