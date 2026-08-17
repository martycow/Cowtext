// Scene-local wire types. BarnEvent mirrors the frozen Phase-3/4 contract §2
// (docs/design/PHASE34_BARN_CONTRACT.md) byte-for-byte so that when the
// Multifunctional Coder lands src/store/events.ts its BarnEvent is assignable
// to this one with zero adaptation. The scene deliberately does NOT import
// that store yet — it does not exist; events reach the scene through the
// `connectEvents` prop on <BarnScene/> (see BarnScene.tsx integration note).

export type BarnEventKind =
  | "prompt"
  | "read"
  | "edit"
  | "write"
  | "grep"
  | "glob"
  | "stop"
  | "subagent_stop"
  | "other";

export interface BarnEvent {
  kind: BarnEventKind;
  /** Verbatim from hook (may be absolute); omitted if absent. */
  filePath?: string;
  /** Set when kind === "other" (raw tool_name), else omitted. */
  toolName?: string;
  /** Hook session_id, "" if absent. */
  sessionId: string;
  /** Unix millis, assigned by Rust at receipt (demo player fakes it). */
  ts: number;
}

/**
 * External event source hookup: caller receives a push callback and returns
 * an unsubscribe. This is the seam where `src/store/events.ts` plugs in later:
 *   connectEvents={(push) => useEventsStore.subscribe(...pipe new events to push)}
 */
export type BarnEventSource = (push: (e: BarnEvent) => void) => () => void;
