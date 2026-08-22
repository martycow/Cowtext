// Types for `scripts/truth.lib.mjs`, which `src/truth/truth.test.ts` imports.
//
// The lib is plain `.mjs` on purpose: `scripts/truth.mjs` must run under bare
// `node`, with no build step and no dependencies. That leaves `tsc` with a
// JS file it cannot read (`allowJs` is off, and tsconfig.json is frozen this
// work order), so the shapes are declared here instead. A wildcard ambient
// module is the one form that works from inside `src/`: a relative
// `declare module "../../scripts/…"` is a TS error, and there is no `paths`
// entry to hang this on.
//
// This file is the mirror; `scripts/truth.lib.mjs` is the original. Audit it
// against the JSDoc there, never the other way round.

declare module "*/truth.lib.mjs" {
  /** One drift hit. The caller adds the file name. */
  export interface Finding {
    /** 1-based. */
    line: number;
    /** The matched substring. */
    text: string;
    /** Why it is a finding, ready to print. */
    message: string;
  }

  export interface RustCounts {
    total: number;
    lib: number;
    cli: number;
    mcp: number;
  }

  export interface VitestCounts {
    tests: number;
    files: number;
  }

  export interface TruthCounts {
    invoke: number | null;
    rust: RustCounts | null;
    vitest: VitestCounts | null;
    graphVersion: number | null;
    compileTargets?: readonly string[];
  }

  /** The live numbers a count in prose is checked against. */
  export interface LiveCounts {
    invoke?: number | null;
    rustTests?: number | null;
    vitestTests?: number | null;
    graphVersion?: number | null;
  }

  export const AGENTS_MD_TITLE: string;
  export const AGENTS_MD_READER_LINE: string;
  export const TRUTH_BEGIN: string;
  export const TRUTH_END: string;
  export const TRUTH_ANCHOR_LINE: string;
  export const FORBIDDEN_STRINGS: readonly string[];
  export const STALE_PATTERNS: readonly { key: string; label: string; source: string }[];
  export const STATUS_PROSE_PATTERNS: readonly { label: string; source: string }[];

  export function renderAgentsMd(claudeMd: string): string;
  export function parseHandlerList(libRs: string): string[];
  export function extractTsInvokeNames(src: string): string[];
  export function extractGraphVersionRs(projectRs: string): number;
  export function extractGraphVersionTs(graphTs: string): number;
  export function extractCompileTargetsRs(projectRs: string): string[];
  export function extractCompileTargetsTs(graphTs: string): string[];
  export function findStaleNumbers(text: string, live: LiveCounts): Finding[];
  export function findForbidden(text: string): Finding[];
  export function renderTruthBlock(counts: TruthCounts, isoDate: string): string;
  export function parseTruthBlock(claudeMd: string): TruthCounts | null;
  export function replaceTruthBlock(claudeMd: string, block: string): string;
  export function findStatusProseCounts(claudeMd: string): Finding[];
}
