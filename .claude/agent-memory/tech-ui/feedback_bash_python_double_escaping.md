---
name: feedback-bash-python-double-escaping
description: on this Windows/Git Bash setup, python3 -c "..." (double-quoted) double-processes backslash escapes and corrupts JS/TS \n literals — prefer the Edit tool for source edits containing escape sequences
metadata:
  type: feedback
---

Tried to patch a `.tsx` file's `"\n"`-containing lines via
`python3 -c "..."` with a double-quoted `-c` argument, doing an exact
string-replace for a source block containing JS string literals like
`"\n"`. Bash's double-quote processing collapses `\\n` to `\n` before python
ever sees it, and python's own string-literal parser then re-interprets that
single `\n` as an actual newline character — two layers of escape
processing silently corrupting the intended literal backslash-n text. A
`python3 - << 'PYEOF' ... PYEOF` heredoc with a **quoted** delimiter avoids
bash's layer (quoted heredocs pass content byte-for-byte), but is still easy
to get wrong when the target string spans multiple lines with several `\n`
occurrences — one such attempt failed an `assert old in text` and correctly
aborted rather than writing anything corrupt.

**Why:** source files with embedded escape sequences (`\n`, `\r`, `\"`) are
exactly the case where shell-based multi-layer text substitution
(bash → python, or bash → sed) is most likely to silently mismatch or
corrupt content, and unlike the Edit tool's exact-string-match-then-replace,
a python script with a subtly wrong pattern can either silently no-op
(assert catches it, as it did here) or — worse, if the assert is missing —
write corrupted output.

**How to apply:** for surgical edits to files containing JS/TS string
escapes, regex patterns, or other backslash-heavy content, prefer the `Edit`
tool over Bash/sed/python one-liners, even though the environment's general
guidance favors Bash-first. Bash-first is right for shell-native work (git,
file listing, running builds); it is the wrong tool for byte-exact text
surgery on escape-sequence-heavy source. Verify with a failing assert (or
equivalent) before ever trusting a scripted find-replace on source code —
this session's failed attempt correctly caught itself rather than writing
bad output, which is the behavior to keep replicating.
