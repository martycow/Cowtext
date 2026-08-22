// Preset checkbox groups offered by the Git wizard's `.gitignore` composer
// (WO11 contract §5.10). Pure data — no invoke, no Rust dependency. Group
// labels are frozen exactly as named in the contract: "Node", "Rust /
// Cargo", "Tauri", "Editors & OS", "Cowtext". `.cowtext/` itself is
// deliberately never offered here — it is the project's source of truth
// and must stay tracked; the "Cowtext" group only ever ignores the atomic
// write module's own transient temp files inside it.

export interface GitignorePreset {
  key: string;
  label: string;
  lines: readonly string[];
}

export const GITIGNORE_PRESETS: GitignorePreset[] = [
  {
    key: "node",
    label: "Node",
    lines: [
      "node_modules/",
      "dist/",
      "npm-debug.log*",
      "yarn-debug.log*",
      "yarn-error.log*",
      "pnpm-debug.log*",
      ".npm",
      ".eslintcache",
      ".env",
      ".env.local",
    ],
  },
  {
    key: "rust",
    label: "Rust / Cargo",
    lines: ["target/", "**/*.rs.bk", "*.pdb"],
  },
  {
    key: "tauri",
    label: "Tauri",
    lines: [
      "src-tauri/target/",
      "src-tauri/gen/",
      "src-tauri/WixTools/",
      "*.appx",
      "*.msi",
      "*.dmg",
      "*.AppImage",
    ],
  },
  {
    key: "editors-os",
    label: "Editors & OS",
    lines: [".vscode/", ".idea/", "*.swp", ".DS_Store", "Thumbs.db", "desktop.ini"],
  },
  {
    key: "cowtext",
    label: "Cowtext",
    // The last three are the same lines `git_init(commit = true)` guarantees
    // before the first commit (WO15 §3.2 `COWTEXT_GITIGNORE_LINES`): local
    // Claude Code overrides and Cowtext's own cache are per-machine, never
    // shared. Kept identical on purpose — a user who runs the Git wizard
    // instead of the New Project wizard must end up with the same file, and
    // both writers skip a line that is already present.
    lines: [
      ".cowtext/*.tmp-*",
      ".cowtext/avatars/*.tmp-*",
      ".claude/settings.local.json",
      "CLAUDE.local.md",
      ".cowtext/cache/",
    ],
  },
];
