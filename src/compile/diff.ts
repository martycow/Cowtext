// Hand-rolled line diff (Phase 2 spec §2.4) — no libraries. Standard DP LCS
// over line arrays, then ops grouped into unified-style hunks with N context
// lines. Pathological sizes (m*n > 1e6) fall back to one whole-file hunk.

export interface DiffOp {
  type: "context" | "add" | "del";
  text: string;
  oldLine: number | null; // 1-based; null for "add"
  newLine: number | null; // 1-based; null for "del"
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  ops: DiffOp[];
}

/** Split on \n; a trailing newline does not produce a phantom empty line. */
function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function lcsOps(a: string[], b: string[]): DiffOp[] {
  const m = a.length;
  const n = b.length;
  const w = n + 1;
  // dp[i*w + j] = LCS length of a[i..] vs b[j..]; last row/col stay 0.
  const dp = new Uint32Array((m + 1) * w);
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i * w + j] =
        a[i] === b[j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: "context", text: a[i], oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      ops.push({ type: "del", text: a[i], oldLine: i + 1, newLine: null });
      i += 1;
    } else {
      ops.push({ type: "add", text: b[j], oldLine: null, newLine: j + 1 });
      j += 1;
    }
  }
  for (; i < m; i += 1) ops.push({ type: "del", text: a[i], oldLine: i + 1, newLine: null });
  for (; j < n; j += 1) ops.push({ type: "add", text: b[j], oldLine: null, newLine: j + 1 });
  return ops;
}

/** Guard path for pathological files: everything deleted, then everything added. */
function wholeFileOps(a: string[], b: string[]): DiffOp[] {
  const ops: DiffOp[] = a.map((text, k) => ({
    type: "del",
    text,
    oldLine: k + 1,
    newLine: null,
  }));
  for (let k = 0; k < b.length; k += 1) {
    ops.push({ type: "add", text: b[k], oldLine: null, newLine: k + 1 });
  }
  return ops;
}

function groupHunks(ops: DiffOp[], context: number): DiffHunk[] {
  // Ranges of op indices around changes, merged when context regions touch.
  const ranges: Array<{ start: number; end: number }> = [];
  for (let k = 0; k < ops.length; k += 1) {
    if (ops[k].type === "context") continue;
    const start = Math.max(0, k - context);
    const end = Math.min(ops.length, k + context + 1);
    const last = ranges[ranges.length - 1];
    if (last !== undefined && start <= last.end) {
      last.end = end;
    } else {
      ranges.push({ start, end });
    }
  }

  const hunks: DiffHunk[] = [];
  let idx = 0;
  let oldSeen = 0; // old lines consumed before idx
  let newSeen = 0;
  for (const r of ranges) {
    for (; idx < r.start; idx += 1) {
      if (ops[idx].type !== "add") oldSeen += 1;
      if (ops[idx].type !== "del") newSeen += 1;
    }
    const slice = ops.slice(r.start, r.end);
    let oldCount = 0;
    let newCount = 0;
    for (const op of slice) {
      if (op.type !== "add") oldCount += 1;
      if (op.type !== "del") newCount += 1;
    }
    hunks.push({
      // Unified convention: an empty side reports the line BEFORE the hunk.
      oldStart: oldCount > 0 ? oldSeen + 1 : oldSeen,
      oldCount,
      newStart: newCount > 0 ? newSeen + 1 : newSeen,
      newCount,
      ops: slice,
    });
    for (; idx < r.end; idx += 1) {
      if (ops[idx].type !== "add") oldSeen += 1;
      if (ops[idx].type !== "del") newSeen += 1;
    }
  }
  return hunks;
}

export function diffLines(
  oldText: string | null,
  newText: string,
  context = 3,
): DiffHunk[] {
  const newLines = splitLines(newText);
  if (oldText === null) {
    if (newLines.length === 0) return [];
    return [
      {
        oldStart: 0,
        oldCount: 0,
        newStart: 1,
        newCount: newLines.length,
        ops: newLines.map((text, k) => ({
          type: "add" as const,
          text,
          oldLine: null,
          newLine: k + 1,
        })),
      },
    ];
  }
  if (oldText === newText) return [];
  const oldLines = splitLines(oldText);
  const ops =
    oldLines.length * newLines.length > 1_000_000
      ? wholeFileOps(oldLines, newLines)
      : lcsOps(oldLines, newLines);
  return groupHunks(ops, context);
}
