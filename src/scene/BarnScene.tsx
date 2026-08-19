// ── BarnScene — integration note (for the UI Coder; see also docs/design/BARN_PROTOTYPE.md) ──
//
//   import { BarnScene } from "./scene/BarnScene";
//   <BarnScene />                          // mount inside any sized container;
//                                          // the Pixi canvas fills the parent
//   <BarnScene autoDemo />                 // start demo mode on mount
//   <BarnScene connectEvents={source} />   // optional override of the event
//                                          // source (tests); by default the
//                                          // scene subscribes to useEventsStore
//                                          // itself, so live hook events AND
//                                          // demo events arrive the same way.
//
// Expectations: the parent element must have a real height (flex-1 / 100%).
// The scene reads useGraphStore (subscribe, read-only) to place props; when
// the graph has no nodes it renders built-in demo props so it works with no
// project open and no backend. It never imports React Flow, src/canvas/,
// src/compile/, or src/inspector/; its only store writes are the sanctioned
// DemoPlayer pushEvent/setDemoMode calls (contract §4).
// Demo mode: the "Demo" button (top-right overlay) toggles a scripted
// BarnEvent sequence; `autoDemo` starts it automatically.
// ─────────────────────────────────────────────────────────────────────────────

// MUST come before any other pixi.js import: patches the renderer to use
// static uniform sync so Pixi works under the production CSP (no 'unsafe-eval').
import "pixi.js/unsafe-eval";
import { useEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { Application, Container } from "pixi.js";
import { useGraphStore, type MemoryNode } from "../store/graph";
import { useEventsStore } from "../store/events";
import { useSettingsStore } from "../store/settings";
import { PALETTE } from "./palette";
import { buildLayout, COW_HOME_TILE } from "./sceneGraph";
import { Cow, type IdleStage } from "./cow";
import { CalfHerd } from "./calf";
import { AgentHerd, type AgentSpriteInput } from "./agentHerd";
import { handleEvent, resolveProp } from "./mapper";
import { HoverController } from "./hover";
import { reducedMotion } from "./motion";
import { tileToScreen } from "./iso";
import * as sfx from "./sfx";
import { DemoPlayer, DEMO_NODES } from "./demo";
import type { BarnEvent, BarnEventSource } from "./types";
// WO01 Block F barn tie-in (lane B, §9.1): live agent sessions get one
// existing calf sprite each. Read-only store subscription, same idiom as
// useGraphStore below — the scene never writes to useSessionsStore.
import { useSessionsStore, type Session } from "../store/sessions";

export interface BarnSceneProps {
  /** Start the scripted demo sequence on mount. */
  autoDemo?: boolean;
  /** Live event source (Phase 4 wiring); see note above. */
  connectEvents?: BarnEventSource;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const INITIAL_ZOOM = 2;

// E5 waiting choreography thresholds + idle FPS throttle (§7.3/§7.4)
const IDLE_COFFEE_MS = 5_000;
const IDLE_LIE_MS = 30_000;
const IDLE_SLEEP_MS = 300_000;
const IDLE_FPS_AFTER_MS = 10_000;
const Z_MOTE_GAP_MS = 8_000;

function idleStageFor(idleMs: number): IdleStage {
  if (idleMs >= IDLE_SLEEP_MS) return 3;
  if (idleMs >= IDLE_LIE_MS) return 2;
  if (idleMs >= IDLE_COFFEE_MS) return 1;
  return 0;
}

/** Bottom-left session totals — non-demo events only (§7.6). Amber is the
 *  agent's colour; Silkscreen is sanctioned in the barn HUD. */
function SessionTicker(): ReactElement {
  const events = useEventsStore((s) => s.events);
  let reads = 0;
  let writes = 0;
  let turns = 0;
  for (const e of events) {
    if (e.demo === true) continue;
    if (e.kind === "read") reads += 1;
    else if (e.kind === "edit" || e.kind === "write") writes += 1;
    else if (e.kind === "stop") turns += 1;
  }
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-[1] font-pixel text-2xs text-[var(--amber)]">
      R {reads} · W {writes} · ✓ {turns}
    </div>
  );
}

/** WO02 #7 — Barn FPS overlay (§7.4). Samples app.ticker.FPS on a 500 ms
 *  interval, active only while showFps && ready, so it costs nothing when
 *  off: no interval, no state updates, no extra ticker work (gate 11). */
function FpsOverlay({ appRef, ready }: { appRef: RefObject<Application | null>; ready: boolean }): ReactElement | null {
  const showFps = useSettingsStore((s) => s.showFps);
  const [fps, setFps] = useState(0);
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!showFps || !ready) return;
    const app = appRef.current;
    if (app === null) return;
    const sample = (): void => {
      setFps(Math.round(app.ticker.FPS));
      setIdle(app.ticker.maxFPS === 12);
    };
    sample();
    const id = setInterval(sample, 500);
    return () => clearInterval(id);
  }, [showFps, ready, appRef]);

  if (!showFps || !ready) return null;
  return (
    <div className="absolute left-2 top-2 z-[1] font-pixel text-2xs text-[var(--amber)]">
      {fps} fps{idle ? " · idle" : ""}
    </div>
  );
}

export function BarnScene({ autoDemo = false, connectEvents }: BarnSceneProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const demoRef = useRef<DemoPlayer | null>(null);
  const appRef = useRef<Application | null>(null);
  const connectRef = useRef<BarnEventSource | undefined>(connectEvents);
  connectRef.current = connectEvents;
  const autoDemoRef = useRef(autoDemo);
  const [demoRunning, setDemoRunning] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let disposed = false;
    let initialized = false;
    const cleanups: Array<() => void> = [];
    const app = new Application();

    void (async () => {
      await app.init({
        background: PALETTE.night,
        resizeTo: host,
        antialias: false,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });
      if (disposed) {
        app.destroy(true, { children: true, texture: true });
        return;
      }
      initialized = true;
      appRef.current = app;
      host.appendChild(app.canvas);
      sfx.setSceneMounted(true);
      cleanups.push(() => sfx.setSceneMounted(false));

      // ── scene graph ──
      const layout = buildLayout();
      const camera = new Container();
      camera.addChild(layout.world);
      // Barn hover bubbles (Task-Board §9) — added after layout.world so the
      // bubble always renders above ground/props/particles, no matter which
      // object it's attached to this frame.
      const hover = new HoverController();
      camera.addChild(hover.view);
      cleanups.push(() => hover.destroy());
      app.stage.addChild(camera);
      camera.scale.set(INITIAL_ZOOM);
      const centerCamera = (): void => {
        // integer camera positions — sub-pixel pans break the 16-bit spell
        camera.position.set(
          Math.round(app.screen.width / 2 - layout.center.x * camera.scale.x),
          Math.round(app.screen.height / 2 - layout.center.y * camera.scale.y),
        );
      };
      centerCamera();

      const cow = new Cow(COW_HOME_TILE);
      layout.objects.addChild(cow.view);
      // J7 — dust puff per footfall (pooled, palette-locked, calm-gated)
      cow.onStep = (tile) => {
        if (reducedMotion()) return;
        const p = tileToScreen(tile.tx, tile.ty);
        layout.spawnDust(p.x, p.y);
      };

      // Named Calves (AGENTS_SUITE_CONTRACT §7.5) — calf.ts does not import
      // sfx.ts (see its header), so the two cues are wired here from the
      // herd's lifecycle callbacks; a cap-dropped spawn never fires onSpawn.
      const herd = new CalfHerd(layout.objects);
      herd.onSpawn = () => sfx.play("calf_spawn");
      herd.onDespawn = () => sfx.play("calf_despawn");
      cleanups.push(() => herd.destroy());

      // WO01 Block F §9.1/§9.3 — one AgentHerd sprite per LIVE session;
      // killed (alive=false) and dismissed (removed from the array) sessions
      // both fall out of this filter, so both despawn their animal via the
      // same sync() diff, no separate lifecycle wiring needed. No sfx here
      // (contract: session lifecycle has no cue in Block F).
      const agents = new AgentHerd(layout.objects);
      const toAgentInputs = (sessions: readonly Session[]): AgentSpriteInput[] =>
        sessions
          .filter((s) => s.alive)
          .map((s) => ({ id: s.id, name: s.name, status: s.status, currentTool: s.currentTool }));
      agents.sync(toAgentInputs(useSessionsStore.getState().sessions));
      cleanups.push(
        useSessionsStore.subscribe((s, prev) => {
          if (s.sessions !== prev.sessions) agents.sync(toAgentInputs(s.sessions));
        }),
      );
      cleanups.push(() => agents.destroy());

      // J5 — re-derive ajar props from the event ring, so accumulation
      // survives remounts and prop rebuilds (it is information, not decor).
      const applyOpened = (): void => {
        for (const e of useEventsStore.getState().events) {
          if (e.kind !== "read" || e.filePath === undefined) continue;
          const prop = resolveProp(e.filePath, layout.props);
          if (prop !== null) layout.setPropOpened(prop.nodeId);
        }
      };

      // ── props from graph nodes (demo fallback when the graph is empty) ──
      const activeNodes = { list: [] as readonly MemoryNode[] };
      const applyNodes = (nodes: readonly MemoryNode[]): void => {
        activeNodes.list = nodes.length > 0 ? nodes : DEMO_NODES;
        layout.rebuildProps(activeNodes.list);
        applyOpened();
      };
      applyNodes(useGraphStore.getState().nodes);
      cleanups.push(
        useGraphStore.subscribe((s, prev) => {
          if (s.nodes !== prev.nodes) applyNodes(s.nodes);
        }),
      );
      // J5 — paper stack replays completed writes once at mount
      layout.setPaperCount(
        useEventsStore.getState().events.filter((e) => e.kind === "edit" || e.kind === "write")
          .length,
      );

      // ── event intake: the events store is the ONE entry point.
      // Live hooks (barn://event → store) and the demo player both go
      // through useEventsStore.pushEvent; the scene only subscribes.
      // Idle clock — ms since the last BarnEvent; drives the ambient bed
      // (sfx.tickAmbient) and, later, waiting choreography + idle FPS (Lane C).
      let lastEventTs = performance.now();
      const push = (e: BarnEvent): void => {
        lastEventTs = performance.now();
        app.ticker.maxFPS = 60; // leave the idle throttle instantly (§7.4)
        if (!disposed) handleEvent(e, { cow, layout, herd });
      };
      const connect = connectRef.current;
      if (connect !== undefined) {
        cleanups.push(connect(push));
      } else {
        cleanups.push(
          useEventsStore.subscribe((s, prev) => {
            if (s.events === prev.events) return;
            // A shrink is a purge (demo stop §7.5 / clear), never an arrival —
            // replaying the surviving tail would re-animate a stale event
            // ("late sound is wrong sound"). Ring overflow at the 200 cap
            // keeps length equal and still changes the tail, so it dispatches.
            if (s.events.length < prev.events.length) return;
            const last = s.events[s.events.length - 1];
            if (last !== undefined && last !== prev.events[prev.events.length - 1]) {
              push(last);
            }
          }),
        );
      }

      demoRef.current = new DemoPlayer(
        (e) => useEventsStore.getState().pushEvent(e, { demo: true }),
        () => activeNodes.list.map((n) => n.filePath),
        (running) => {
          setDemoRunning(running);
          useEventsStore.getState().setDemoMode(running);
          if (!running && !disposed) {
            // Demo stop purged the ring (§7.5) — J5 accumulation is
            // information derived from the log, so re-derive it too: drop
            // queued demo tasks (their callbacks would re-pollute state),
            // then rebuild papers + ajar props from the surviving events.
            cow.cancelAll();
            layout.setPaperCount(
              useEventsStore
                .getState()
                .events.filter((e) => e.kind === "edit" || e.kind === "write").length,
            );
            layout.rebuildProps(activeNodes.list); // clears opened flags
            applyOpened();
          }
        },
      );
      cleanups.push(() => demoRef.current?.stop());
      if (autoDemoRef.current) demoRef.current.start();

      // ── camera: drag pan + wheel zoom (toward cursor) ──
      const canvas = app.canvas;
      canvas.style.touchAction = "none";
      let dragging = false;
      let userMoved = false; // once true, resize never recenters (§7.7)
      let lastX = 0;
      let lastY = 0;
      const onDown = (ev: PointerEvent): void => {
        dragging = true;
        lastX = ev.clientX;
        lastY = ev.clientY;
        canvas.setPointerCapture(ev.pointerId);
      };
      const onMove = (ev: PointerEvent): void => {
        if (dragging) {
          userMoved = true;
          // whole-pixel commits — sub-pixel camera positions shimmer 16-bit art
          camera.position.x = Math.round(camera.position.x + (ev.clientX - lastX));
          camera.position.y = Math.round(camera.position.y + (ev.clientY - lastY));
          lastX = ev.clientX;
          lastY = ev.clientY;
          hover.setPointer(null); // suppress bubbles while panning
          return;
        }
        const rect = canvas.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        hover.setPointer({
          x: (px - camera.position.x) / camera.scale.x,
          y: (py - camera.position.y) / camera.scale.y,
        });
      };
      const onUp = (): void => {
        dragging = false;
      };
      const onLeave = (): void => hover.setPointer(null);
      const onWheel = (ev: WheelEvent): void => {
        ev.preventDefault();
        userMoved = true;
        const rect = canvas.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        const oldZoom = camera.scale.x;
        // integer zoom ladder (1→2→3→4): fractional scale shimmers the
        // pixel art even at whole-pixel positions
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom + (ev.deltaY < 0 ? 1 : -1)));
        if (zoom === oldZoom) return;
        // keep the world point under the cursor fixed — float math, then a
        // whole-pixel commit
        camera.position.x = Math.round(px - ((px - camera.position.x) / oldZoom) * zoom);
        camera.position.y = Math.round(py - ((py - camera.position.y) / oldZoom) * zoom);
        camera.scale.set(zoom);
      };
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointercancel", onUp);
      canvas.addEventListener("pointerleave", onLeave);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      cleanups.push(() => {
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("pointerleave", onLeave);
        canvas.removeEventListener("wheel", onWheel);
      });
      // re-center on host resize — only until the user has panned/zoomed
      const onResize = (): void => {
        if (!userMoved) centerCamera();
      };
      app.renderer.on("resize", onResize);
      cleanups.push(() => {
        app.renderer.off("resize", onResize);
      });

      // ── pause when hidden + idle FPS throttle (§7.4) ──
      app.ticker.maxFPS = 60;
      const onVisibility = (): void => {
        if (document.hidden) app.ticker.stop();
        else app.ticker.start();
      };
      document.addEventListener("visibilitychange", onVisibility);
      cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));

      // ── ticker ──
      let throttled = false;
      let lastZTs = 0;
      app.ticker.add((ticker) => {
        const now = performance.now();
        const idleMs = now - lastEventTs;
        const reduced = reducedMotion();
        // E5 waiting choreography: escalation stage + coffee + Z-motes
        cow.setIdleStage(idleStageFor(idleMs));
        layout.setCoffee(idleMs >= IDLE_COFFEE_MS, !reduced);
        if (idleMs >= IDLE_SLEEP_MS && !reduced && now - lastZTs >= Z_MOTE_GAP_MS) {
          lastZTs = now;
          layout.spawnZ(cow.view.position.x + 8, cow.view.position.y - 24);
        }
        cow.update(ticker.deltaMS);
        layout.tick(ticker.deltaMS, reduced);
        herd.tick(ticker.deltaMS, reduced);
        agents.tick(ticker.deltaMS, reduced);
        hover.sync({ cow, layout, agents });
        hover.tick(ticker.deltaMS);
        sfx.tickAmbient(now - lastEventTs);
        // all idle-loop holds are ≥120 ms, so 12 fps loses nothing
        const wantThrottle = idleMs > IDLE_FPS_AFTER_MS;
        if (wantThrottle !== throttled) {
          throttled = wantThrottle;
          app.ticker.maxFPS = wantThrottle ? 12 : 60;
        }
      });

      setReady(true);
    })();

    return () => {
      disposed = true;
      for (const fn of cleanups.reverse()) fn();
      demoRef.current = null;
      appRef.current = null;
      setReady(false);
      if (initialized) app.destroy(true, { children: true, texture: true });
    };
  }, []);

  return (
    <div ref={hostRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <FpsOverlay appRef={appRef} ready={ready} />
      {ready && (
        <>
          <button
            type="button"
            onClick={() => {
              const demo = demoRef.current;
              if (demo === null) return;
              if (demo.running) demo.stop();
              else demo.start();
            }}
            className={`absolute right-2 top-2 z-[1] h-7 rounded border px-3 text-sm transition-colors duration-fast ${
              demoRunning
                ? "border-amber-border bg-amber-surface text-amber-text hover:bg-surface-3"
                : "border-border bg-surface-2 text-content hover:bg-surface-3"
            }`}
          >
            {demoRunning ? "Stop demo" : "Demo"}
          </button>
          <SessionTicker />
        </>
      )}
    </div>
  );
}
