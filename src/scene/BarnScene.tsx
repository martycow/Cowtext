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

import { useEffect, useRef, useState, type ReactElement } from "react";
import { Application, Container } from "pixi.js";
import { useGraphStore, type MemoryNode } from "../store/graph";
import { useEventsStore } from "../store/events";
import { PALETTE } from "./palette";
import { buildLayout, COW_HOME_TILE } from "./sceneGraph";
import { Cow } from "./cow";
import { handleEvent } from "./mapper";
import { DemoPlayer, DEMO_NODES } from "./demo";
import type { BarnEvent, BarnEventSource } from "./types";

export interface BarnSceneProps {
  /** Start the scripted demo sequence on mount. */
  autoDemo?: boolean;
  /** Live event source (Phase 4 wiring); see note above. */
  connectEvents?: BarnEventSource;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const INITIAL_ZOOM = 2;

export function BarnScene({ autoDemo = false, connectEvents }: BarnSceneProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const demoRef = useRef<DemoPlayer | null>(null);
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
      host.appendChild(app.canvas);

      // ── scene graph ──
      const layout = buildLayout();
      const camera = new Container();
      camera.addChild(layout.world);
      app.stage.addChild(camera);
      camera.scale.set(INITIAL_ZOOM);
      const centerCamera = (): void => {
        camera.position.set(
          app.screen.width / 2 - layout.center.x * camera.scale.x,
          app.screen.height / 2 - layout.center.y * camera.scale.y,
        );
      };
      centerCamera();

      const cow = new Cow(COW_HOME_TILE);
      layout.objects.addChild(cow.view);

      // ── props from graph nodes (demo fallback when the graph is empty) ──
      const activeNodes = { list: [] as readonly MemoryNode[] };
      const applyNodes = (nodes: readonly MemoryNode[]): void => {
        activeNodes.list = nodes.length > 0 ? nodes : DEMO_NODES;
        layout.rebuildProps(activeNodes.list);
      };
      applyNodes(useGraphStore.getState().nodes);
      cleanups.push(
        useGraphStore.subscribe((s, prev) => {
          if (s.nodes !== prev.nodes) applyNodes(s.nodes);
        }),
      );

      // ── event intake: the events store is the ONE entry point.
      // Live hooks (barn://event → store) and the demo player both go
      // through useEventsStore.pushEvent; the scene only subscribes.
      const push = (e: BarnEvent): void => {
        if (!disposed) handleEvent(e, { cow, layout });
      };
      const connect = connectRef.current;
      if (connect !== undefined) {
        cleanups.push(connect(push));
      } else {
        cleanups.push(
          useEventsStore.subscribe((s, prev) => {
            if (s.events === prev.events) return;
            const last = s.events[s.events.length - 1];
            if (last !== undefined && last !== prev.events[prev.events.length - 1]) {
              push(last);
            }
          }),
        );
      }

      demoRef.current = new DemoPlayer(
        (e) => useEventsStore.getState().pushEvent(e),
        () => activeNodes.list.map((n) => n.filePath),
        (running) => {
          setDemoRunning(running);
          useEventsStore.getState().setDemoMode(running);
        },
      );
      cleanups.push(() => demoRef.current?.stop());
      if (autoDemoRef.current) demoRef.current.start();

      // ── camera: drag pan + wheel zoom (toward cursor) ──
      const canvas = app.canvas;
      canvas.style.touchAction = "none";
      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      const onDown = (ev: PointerEvent): void => {
        dragging = true;
        lastX = ev.clientX;
        lastY = ev.clientY;
        canvas.setPointerCapture(ev.pointerId);
      };
      const onMove = (ev: PointerEvent): void => {
        if (!dragging) return;
        camera.position.x += ev.clientX - lastX;
        camera.position.y += ev.clientY - lastY;
        lastX = ev.clientX;
        lastY = ev.clientY;
      };
      const onUp = (): void => {
        dragging = false;
      };
      const onWheel = (ev: WheelEvent): void => {
        ev.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        const oldZoom = camera.scale.x;
        const zoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, oldZoom * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)),
        );
        // keep the world point under the cursor fixed
        camera.position.x = px - ((px - camera.position.x) / oldZoom) * zoom;
        camera.position.y = py - ((py - camera.position.y) / oldZoom) * zoom;
        camera.scale.set(zoom);
      };
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointercancel", onUp);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      cleanups.push(() => {
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("wheel", onWheel);
      });

      // ── ticker ──
      app.ticker.add((ticker) => {
        cow.update(ticker.deltaMS);
        layout.tick(ticker.deltaMS);
      });

      setReady(true);
    })();

    return () => {
      disposed = true;
      for (const fn of cleanups.reverse()) fn();
      demoRef.current = null;
      setReady(false);
      if (initialized) app.destroy(true, { children: true, texture: true });
    };
  }, []);

  return (
    <div ref={hostRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      {ready && (
        <button
          type="button"
          onClick={() => {
            const demo = demoRef.current;
            if (demo === null) return;
            if (demo.running) demo.stop();
            else demo.start();
          }}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 1,
            padding: "4px 10px",
            fontFamily: "monospace",
            fontSize: 12,
            color: "#F4EFE7",
            background: demoRunning ? "#7E3226" : "#5A3F28",
            border: "1px solid #241A12",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          {demoRunning ? "Stop demo" : "Demo"}
        </button>
      )}
    </div>
  );
}
