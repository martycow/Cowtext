# Cowtext

**Cowtext is a context compiler for AI coding agents.** Your agent context is a typed visual graph of Memory Nodes (`.md` files from your project); **Compile** generates production-grade `CLAUDE.md`, `AGENTS.md` (the 30+-agent industry standard), and `.cursor/rules` from that single source of truth. **Assemble** nodes on demand via headless `claude -p`, run headless agent sessions with real token telemetry, and watch live Claude Code hooks drive a 16-bit isometric barn scene. Orchestration is a feature; the compiler is the product.

Cowtext compiles context for multiple AI coding agents. Assemble, Run and live hooks currently use Claude Code.

**Compile targets** — one graph, five files: `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md` and `GEMINI.md`. Copilot and Gemini are off by default; nothing is ever written without a diff preview you approve.

Built on Tauri 2, React 19, PixiJS 8, and Rust.
