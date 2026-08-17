import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Keep Vite's preload helper out of vendor chunks — if it lands in
          // vendor-pixi (pixi does internal dynamic imports), every lazy()
          // in index statically imports the 500 kB pixi chunk at startup.
          if (id.includes("vite/preload-helper")) return "preload-helper";
          // Split vendor libraries into their own chunks
          if (id.includes("node_modules")) {
            if (id.includes("@xyflow")) return "vendor-xyflow";
            // Icons are shared by index AND the lazy inspector chunk; without
            // an explicit home rollup co-locates them into "inspector", making
            // index statically import it (and thus CodeMirror) at startup.
            if (id.includes("lucide-react")) return "vendor-icons";
            if (id.includes("@codemirror")) return "vendor-codemirror";
            if (id.includes("pixi.js")) return "vendor-pixi";
            if (id.includes("howler")) return "vendor-sfx";
          }
          // Shared utilities (used by multiple chunks)
          if (id.includes("src/compile/diff.ts")) return "utils-diff";
          // Shared by canvas (eager) and Inspector (lazy); without an explicit
          // home rollup co-locates it into "inspector", forcing index to
          // statically import that chunk (and CodeMirror with it).
          if (id.includes("src/canvas/RoleGlyphs")) return "role-glyphs";
          // Scene module (BarnScene + related scene code) into separate chunk
          if (id.includes("/src/scene/")) {
            // sfx stays in its own chunk when imported by scene
            if (id.includes("scene/sfx.ts")) return "sfx";
            return "scene";
          }
          // Inspector (CodeMirror editor) into separate chunk — only the
          // editor-heavy modules; EventLog/HooksModal are statically imported
          // by App.tsx and must not drag CodeMirror into the startup path.
          if (
            id.includes("/src/inspector/Inspector") ||
            id.includes("/src/inspector/CodeMirrorEditor")
          )
            return "inspector";
          // Modals into their own chunks (excluding shared utils)
          if (id.includes("/src/compile/") && !id.includes("compile/diff")) return "compile";
          if (id.includes("/src/settings/")) return "settings";
          if (id.includes("/src/preset/")) return "preset";
          if (id.includes("/src/handoff/")) return "handoff";
        },
      },
    },
  },
}));
