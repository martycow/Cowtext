// Wire types for the git backend (WO11 contract §4.1), mirrored 1:1 from
// `src-tauri/src/git.rs`'s `GitStatus`. camelCase in TS, snake_case in Rust
// — Tauri converts.

export interface GitStatus {
  gitAvailable: boolean;
  gitVersion: string | null;
  isRepo: boolean;
  hasCommits: boolean;
  /** null on detached HEAD / no commits / not a repo / git unavailable. */
  branch: string | null;
  gitignoreExists: boolean;
  /** Verbatim file content; null when the file is absent. */
  gitignoreContent: string | null;
}
