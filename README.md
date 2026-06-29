<div align="center">

<img src="favicon.svg" alt="HexLife Explorer logo" width="96" height="96" />

# HexLife Explorer

**An interactive, high-performance cellular automaton playground on a hexagonal grid.**

Design rulesets, draw life into the grid, and watch complex behavior emerge across nine worlds at once.

[**▶ Try the Live Demo**](https://sidem.github.io/HexLife/)

![License](https://img.shields.io/badge/license-MIT-blue)
![Rust](https://img.shields.io/badge/Rust-WebAssembly-orange?logo=rust&logoColor=white)
![WebGL2](https://img.shields.io/badge/WebGL2-instanced-990000?logo=webgl&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)

</div>

---

HexLife runs **nine concurrent worlds** side-by-side, each a hexagonal cellular automaton with its own ruleset and state. The simulation core is written in **Rust → WebAssembly**, every world ticks in its own **Web Worker**, and rendering is a single **instanced WebGL2** draw call per world. The result stays smooth enough to evolve, mutate, and compare rulesets in real time.

## ✨ Features

- 🔬 **Nine concurrent worlds** — compare how different rulesets or seeds evolve, all at once.
- 🎨 **Rule-based coloring** — cells are tinted by *which rule* set their state, turning the dynamics into a visible fingerprint.
- ⏪ **Scrub-back history** — pause and rewind the selected world hundreds of ticks to replay what just happened, then branch from any point.
- ✂️ **Pattern copy/paste** — marquee-select live cells and stamp them anywhere; placement is hex-phase-aware so shapes never distort (`Ctrl`+`C` / `Ctrl`+`V`).
- 🧬 **Ruleset toolkit** — generate (random / neighbor-count / symmetry), hand-edit, mutate, clone, and breed rulesets.
- 🎥 **Media export** — full-resolution **PNG** snapshots and live **WebM** recordings, straight to disk.
- 🔗 **Shareable everything** — rulesets are 32-char hex strings with friendly mnemonic names; whole setups encode into one share link.
- 📱 **Responsive** — a dedicated mobile UI with a bottom tab bar and touch controls.
- 🎓 **Guided onboarding** — interactive tours and hands-on experiments in the Learning Hub.
- 🧭 **Auto-Explore** *(experimental / alpha)* — an evolutionary search that hunts for "interesting" rulesets automatically. [More below ↓](#-auto-explore-experimental)

## 🚀 Getting Started

**Prerequisites:** [Node.js](https://nodejs.org/) 18+ and a browser with **WebGL2 + hardware acceleration** enabled.

```bash
git clone https://github.com/Sidem/HexLife.git
cd HexLife
npm install
npm run dev          # → http://localhost:5173
```

The compiled Wasm engine is checked into the repo, so `npm run dev` works **without a Rust toolchain**. You only need Rust if you want to rebuild the engine.

| Command | What it does |
| :--- | :--- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Rebuild Wasm + production build into `dist/` |
| `npm run test:run` | Run the JS test suites once (Vitest) |
| `npm run lint` | Lint the codebase (ESLint) |
| `npm run typecheck` | Type-check opt-in files (`tsc --noEmit`) |

<details>
<summary>Rebuilding the Rust/Wasm engine</summary>

Requires [Rust](https://rustup.rs/) and [`wasm-pack`](https://rustwasm.github.io/wasm-pack/). Then:

```bash
npm run build:wasm                                  # rebuild the Wasm binary
cargo test --manifest-path hexlife-wasm/Cargo.toml  # run the Rust tick-engine tests
```

</details>

## 🧠 Core Concepts

- **Hexagonal grid** — a flat-top hex grid where each cell has six neighbors and consecutive columns are staggered by half a hex. The grid wraps toroidally (opposite edges connect).
- **Two-state cells** — every cell is *active* or *inactive*. Its next state depends on its own state plus its six neighbors.
- **128-bit rulesets** — a center cell + 6 neighbors give 2⁷ = 128 possible local configurations, so a ruleset is exactly 128 bits, written as a **32-character hex string** that's trivial to share and edit.

## 🏗️ Architecture

A decoupled, performance-first design:

- **Simulation core** — `run_tick` in Rust/Wasm; all per-cell buffers live in Wasm linear memory, bit-packed (8 cells/byte).
- **Concurrency** — one Web Worker per world (9 total) for parallel, non-blocking computation.
- **Rendering** — `renderer.js` draws each world into its own FBO with one instanced WebGL2 draw call, composed into the selected view + 3×3 minimap; redraws are gated by dirty flags.
- **Orchestration** — `WorldManager` (central controller) drives one `WorldProxy` per worker; UI ↔ logic communicate through a publish/subscribe `EventBus`.
- **Persistence** — settings, rulesets, world configs, and panel layouts are saved to `localStorage`.

<details>
<summary>Key modules</summary>

| Module | Role |
| :--- | :--- |
| `hexlife-wasm/src/lib.rs` | Rust tick engine (`World::run_tick`) |
| `src/core/WorldWorker.js` | Per-world worker; holds typed-array views into Wasm memory |
| `src/core/WorldProxy.js` | Main-thread proxy for one worker |
| `src/core/WorldManager.js` | Central controller; settings, scope resolution, commands |
| `src/rendering/renderer.js` | WebGL2 render-to-texture + instanced drawing |
| `src/services/EventBus.js` | Pub/sub event catalog decoupling UI from logic |
| `src/core/AutoExploreService.js` | Evolutionary search loop + behavior archive |

</details>

## 🧭 Auto-Explore (Experimental)

> ⚠️ **Alpha — untested and under active development.** This automated search is a work in progress; treat its finds as exploratory and expect rough edges.

An optional evolutionary search that hunts for "interesting" rulesets on its own: it screens candidates with short evaluation bursts, confirms the promising ones, and banks survivors into a deduplicated gallery — with thumbnails and per-component score bars — that you can apply, save, share, or breed further.

<details>
<summary>How candidates are scored</summary>

<br>

Each candidate is judged across a **suite of initial conditions** (Chaos, Sparse, Seed, Clusters), because one ruleset can be lifeless from one seed and teeming from another. Four **hard kills** zero the score outright — *extinct*, *saturated* (≥99% active), *frozen* (≤0.5 cells changing/tick), and *short-cycle* (period ≤ 4) — then survivors are ranked on the weighted, normalized terms below (terms are dropped and renormalized for entries that lack them, so each candidate is judged only on the terms it has).

| Term | Weight | Measures |
| :--- | :---: | :--- |
| **Structure** | 0.31 | Join-count spatial order — domains, fronts, gliders vs. salt-and-pepper noise *(most weighted)* |
| **σ (criticality)** | 0.16 | Damage-spreading probe; peaks at the edge of chaos (σ ≈ 1) |
| **Temporal** | 0.13 | Variance of block entropy over time — Wuensche's complex-rule discriminator |
| **Transport** | 0.11 | Drift of the active-cell centroid — coherently moving structure (gliders) |
| **Heterog.** | 0.11 | Order and disorder coexisting in different regions at once |
| **Novelty** | 0.12 | *Optional, off by default.* CLIP-embedding trajectory novelty ([ASAL-style](https://arxiv.org/abs/2412.17799)) |
| **Entropy** | 0.07 | Block-entropy mid-band — structured but not pure noise |
| **Diversity** | 0.07 | Shannon entropy of rule-usage — a rich rule vocabulary |
| **Flux** | 0.04 | Activity arriving in bursts (avalanches) rather than steady churn |

Per-IC scores are combined with a soft-max (favoring each world's best IC) plus a small plain-mean robustness bonus. The same components can be measured for any world on demand from the **Analysis → Interestingness Metrics** panel.

</details>

## ⌨️ Keyboard Shortcuts

<details>
<summary>Full shortcut reference</summary>

<br>

| Keys | Action |
| :--- | :--- |
| `P` | Play / pause |
| `Escape` | Close active popout or panel |
| `1`–`9` | Select world (numpad layout) |
| `Shift`+`1`–`9` | Toggle world's enabled state |
| `N` / `E` / `S` / `A` | Toggle Ruleset Actions / Editor / World Setup / Analysis panel |
| `G` | Generate new ruleset |
| `M` / `Shift`+`M` | Clone & mutate others / mutate selected |
| `O` / `I` | Clone selected ruleset to all / invert it |
| `R` / `Shift`+`R` | Reset all worlds / selected world |
| `C` / `Shift`+`C` | Clear all worlds / selected world |
| `D` / `Shift`+`D` | Reset densities & reset all / apply selected density to all |
| `Ctrl`+`C` / `Ctrl`+`V` | Copy / paste a cell-region pattern |
| `←` / `→` | Step back / forward one tick (while paused) |
| `Ctrl`+`Z` / `Ctrl`+`Shift`+`Z` | Undo / redo ruleset change |

</details>

## 📄 License

Released under the [MIT License](LICENSE) — © 2025 Sidem.
