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
  /** `git config --get user.name`, trimmed; null when unset, empty, or git
   *  is unavailable. Read fresh on every probe, never cached — the user may
   *  fix their identity in another window and retry (WO15 §3.1). */
  identityName: string | null;
  /** `git config --get user.email`, same rules. */
  identityEmail: string | null;
}

/** Result of `git_init` (WO15 §3.2). `git_init(commit=false)` reproduces the
 *  pre-WO15 behaviour exactly, wrapped in this envelope. */
export interface GitInitResult {
  status: GitStatus;
  /** This call created the initial commit. */
  committed: boolean;
  /** `git rev-list --count HEAD` after the call; 0 when unborn or not a repo. */
  commitCount: number;
  /** `root` was already a repo toplevel: nothing was initialised, written or
   *  committed, whatever `commit` said (D-15). */
  skippedExistingRepo: boolean;
}
