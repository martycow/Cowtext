// Vitest config — WO13_CONTRACT.md §15, the approved dependency exception.
// Deliberately separate from vite.config.ts, which stays clean for the
// Tauri build (`npm run build` = `tsc && vite build`, wired to
// tsconfig.json, which EXCLUDES `src/**/*.test.ts`; this file targets only
// those test files, via tsconfig.test.json). `environment: 'node'` — no
// jsdom, no testing-library. Pure-module tests only (§15's own rule).

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
