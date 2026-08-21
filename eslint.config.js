import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "src-tauri/**", "node_modules/**", "*.config.*"],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // eslint-plugin-react-hooks@7's "recommended" preset bundles the full
      // React Compiler rule set (refs/purity/set-state-in-effect/immutability/
      // etc.), not just classic hooks linting. Enabling all of it here would
      // force behavioral refactors of already-landed, not-yet-accepted code
      // (latest-ref patterns, effect-driven setState) — out of scope for
      // adding lint tooling. Scoped to the classic two rules instead.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  // WO13_CONTRACT.md §15: Vitest test files get the vitest globals
  // (describe/it/expect/vi/...) on top of the browser globals above —
  // `no-explicit-any` stays ON, same as every other file (§15's own rule).
  {
    files: ["src/**/*.test.ts"],
    languageOptions: {
      globals: globals.vitest,
    },
  },
);
