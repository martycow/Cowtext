// Wire types for the git backend (WO11 contract §4.1), mirrored 1:1 from
// `src-tauri/src/git.rs`'s `GitStatus`. camelCase in TS, snake_case in Rust
// — Tauri converts.

export interface GitStatus {
  gitAvailable: boolean;
  gitVersion: string | null;
  /** True only when the probed root itself is a git work tree's toplevel —
   *  not merely nested somewhere inside one (WO13). */
  isRepo: boolean;
  hasCommits: boolean;
  /** null on detached HEAD / not a repo / git unavailable. Populated even
   *  before the first commit — an unborn branch (fresh `git init`, or an
   *  explicit branch choice at init time) still has a name (WO13). */
  branch: string | null;
  gitignoreExists: boolean;
  /** Verbatim file content; null when the file is absent. */
  gitignoreContent: string | null;
}
