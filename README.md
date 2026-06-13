# HexLife Explorer

**Live Demo:** [Try HexLife Explorer](https://sidem.github.io/HexLife/)

HexLife Explorer is an interactive, high-performance web-based cellular automaton simulator that operates on a hexagonal grid. It allows users to discover and explore complex emergent behaviors by defining custom rulesets. The simulation leverages WebGL2 for efficient rendering and employs Web Workers to run multiple, concurrent "worlds," each with its own unique state and rules. The core simulation logic is written in Rust and compiled to WebAssembly (Wasm) for maximum performance.

## Highlights

  * 🧭 **Auto-Explore** — an automated evolutionary search that hunts for "interesting" rulesets across a suite of initial conditions, scores them on spatial structure / entropy / criticality, and banks the best finds in a persistent, **visual gallery with live thumbnails**. Pause/resume the hunt, cap it to a generation budget, and re-test any find on demand.
  * 🔬 **Nine concurrent worlds** running independent Rust/Wasm simulations in parallel Web Workers, composed with one instanced WebGL2 draw call per world.
  * ⏪ **State-history scrub-back** — pause and rewind the selected world up to a few hundred ticks to replay "what just happened," step-by-step or by dragging a timeline.
  * 🎥 **Media export** — grab a full-resolution **PNG** snapshot of the selected world or record the live composited canvas to an animated **WebM** video, both saved straight to disk.
  * ✂️ **Hex-aware pattern capture & copy/paste** — marquee-select live cells and stamp them back anywhere; placement preserves the grid's column-stagger phase so patterns never distort (`Ctrl`+`C` / `Ctrl`+`V`).
  * 🧪 **Guided experiments & onboarding tours** in the Learning Hub teach the core loops hands-on.
  * 🔗 **Shareable everything** — rulesets are 32-char hex strings with human-friendly mnemonic names; full setups encode into a single share link.
  * ⚡ **Engineered for performance** — bit-packed state buffers, transfer-back buffer pools, dirty-flag-gated rendering, and a zero-GPU-work idle path.

## Core Concepts

  * **Hexagonal Grid:** The simulation takes place on a flat-top hexagonal grid where each cell has six direct neighbors and **consecutive columns are staggered by half a hex** (odd columns dropped half a row). The grid wraps toroidally, connecting opposite edges. Because offset coordinates are not translation-invariant on a staggered grid, pattern placement converts through axial coordinates to preserve a captured shape's phase.
  * **Cellular Automata:** Each cell exists in one of two states: active (alive) or inactive (dead). A cell's state in the next generation (tick) is determined by its current state and the states of its six neighbors, according to a 128-bit ruleset.
  * **Rulesets:** The automaton's behavior is defined by a ruleset of 128 rules. Each rule corresponds to a unique local configuration (the center cell's state and its 6 neighbors, 2^7 = 128 possibilities). The ruleset is represented as a 32-character hexadecimal string that can be easily shared and modified.

## Architecture Overview

HexLife Explorer is built on a modern, decoupled architecture designed for performance and maintainability.

  * **Wasm Simulation Core:** The most computationally intensive task—the simulation tick logic—is executed in WebAssembly. The `run_tick` function, written in Rust, iterates over every cell, calculates its next state based on the provided ruleset, and updates the state buffers with maximum efficiency.
  * **Multi-Worker Simulation:** The application runs 9 concurrent simulation "worlds," arranged in a 3x3 grid. Each world's logic, including its Wasm instance, runs in a dedicated Web Worker (`WorldWorker.js`). This ensures parallel computation and a responsive, non-blocking UI.
  * **Main Thread Orchestration:**
      * `WorldManager.js`: The central controller that manages the lifecycle of all `WorldProxy` instances, handles global settings (speed, pause state, brush size), and processes UI commands via an `EventBus`.
      * `WorldProxy.js`: A main-thread interface (Proxy Pattern) for each `WorldWorker`, facilitating message passing for commands and receiving state and statistics updates.
  * **High-Performance Rendering Engine (WebGL2):**
      * `renderer.js`: Manages all WebGL2 operations. It employs a **render-to-texture** technique where each world is first drawn into an offscreen Framebuffer Object (FBO). These textures are then composed onto the main canvas.
      * **Instanced Rendering:** All hexagons within a world are drawn in a single, highly efficient draw call using instanced rendering, defined in the vertex shader (`vertex.glsl.txt`).
      * **GLSL Shaders:** Custom shaders handle hexagon positioning, dynamic cell coloring based on the rule that determined its state, and hover effects (`fragment.glsl.txt`).
  * **Component-Based UI & State Management:**
      * `UIManager.js` / `PanelManager.js`: These classes initialize and manage all UI components, popouts, and draggable panels, binding them to the `EventBus` for communication.
      * **Draggable Panels:** The UI features draggable panels (`DraggablePanel.js`) for major features like the Ruleset Editor, World Setup, and Analysis tools, providing a flexible user workspace.
      * `EventBus.js`: A publish/subscribe system that decouples all major components, from UI controls to the World Manager, enhancing maintainability.
      * `PersistenceService.js`: Manages saving and loading of user settings—including rulesets, world configurations, and UI panel states—to `localStorage`.

## Key Features

### 1\. Multi-World Simulation

  * **Concurrent Worlds:** Run 9 simulations simultaneously, allowing for direct comparison of how different rulesets or initial conditions evolve.
  * **Per-World Configuration:** Each of the 9 worlds can have its own distinct ruleset, initial density of active cells, and can be individually enabled or disabled via the **World Setup Panel**.
  * **Visual Layout:** A large main view displays the selected world, while a 3x3 mini-map provides an overview and allows for quick selection.

### 2\. Dynamic Cell Coloring & Visualization

  * **Rule-Based Coloring:** Cells are colored based on the specific rule (0-127) that determined their current state. This provides a "fingerprint" of the automaton's activity, with the color spectrum defined in `ruleVizUtils.js` and applied in the fragment shader via a Color Look-Up Table (LUT).
  * **State & Hover Differentiation:** The fragment shader differentiates cell states (active vs. inactive) by adjusting color saturation and brightness. It also applies a highlight effect to cells under the mouse cursor.
  * **Minimap Status Badges:** Each minimap can show an at-a-glance status badge — **extinct** (died out), **saturated** (fully active), or **cycling** (`↻N`, a detected period-`N` loop) — computed from each world's live statistics. Toggle them with the "Show Status Badges" option.

### 3\. Interactive Controls & UI

  * **Responsive Mobile UI:** Features a distinct mobile interface with a bottom tab bar, quick-action FABs, and touch-friendly controls for a seamless experience on any device.
  * **Learning Hub & Onboarding:** An interactive tour system (`OnboardingManager.js`) walks new users through every panel — simulation controls, ruleset actions, the editor, world setup, analysis tools, rule-usage ranking, history, and reset/clear. The Hub also offers hands-on **Experiments** — guided, input-agnostic missions such as the *evolution loop* (mutate → pick → repeat) and *spark of life* (clear → draw → play) — that teach the core creative loops by doing.
  * **Toolbar & Popouts:** A vertical toolbar provides quick access to primary functions. Most controls are housed in popout panels (`PopoutPanel.js`) that appear next to their trigger button, keeping the interface clean.
  * **Playback & Speed (⏩):** Globally play/pause the simulation (`P` key) and adjust the target Ticks Per Second (TPS) for all worlds.
  * **Brush Interaction (🖌️):** Draw on the main world's canvas to toggle cell states. Brush size can be adjusted with a slider or the mouse wheel (`Ctrl + Wheel`). The simulation can automatically pause during a drawing stroke for precise edits.
  * **Ruleset Management:**
      * **Generate New Rules (✨):** Create new rulesets using different modes: **Random** (with a configurable bias), **N-Count** (based on the number of active neighbors), or **R-Sym** (based on rotational symmetry groups).
      * **Set/Copy Ruleset (\#️⃣):** Directly input a 32-character hex string to apply a ruleset, or copy the current world's ruleset to the clipboard.
      * **Mutate & Clone (🧬):** Clone the selected ruleset to the other worlds, optionally mutating each copy. Mutation rate and mode are configurable, making it easy to spawn a family of variations from one promising rule.
      * **Breed Worlds (🧬):** Cross two parent worlds' rulesets (uniform or rotational-symmetry crossover, with optional post-mutation) and inject the offspring into the remaining worlds — a manual companion to Auto-Explore's automated breeding.
      * **Content Library (📚):** Access the Library of pre-discovered rulesets and patterns.
  * **State Management & Sharing:**
      * **Save/Load (💾/📂):** Save the complete state of the selected world (cell states, ruleset, and tick count) to a JSON file. Load a previously saved state to continue a simulation.
      * **Share Link (🔗):** Generate a unique URL that encodes the current setup (rulesets, densities, selected world, camera position) to share with others.
      * **Export PNG (📷) / Record Video (🎥):** Snapshot the selected world to a full-resolution PNG, or record the live canvas to a WebM clip (see **Media Export** below).
  * **Reset/Clear (🔄):** Reset worlds to their initial random density or clear them completely to an active or inactive state.
  * **Patterns (✂️):** Capture a region of live cells and reuse it elsewhere.
      * **Copy region (`Ctrl`+`C`):** Drag a marquee over active cells to copy them to an in-memory clipboard.
      * **Paste (`Ctrl`+`V`):** Stamp the copied pattern under the cursor. Placement is **hex-phase-aware** — the captured shape is reproduced exactly at any anchor, regardless of column parity, by translating through axial coordinates.
      * **Capture & Save:** Name a captured region and store it in your personal pattern library (persisted to `localStorage`). Saved patterns show a true-to-grid hexagon thumbnail and can be re-placed at any time.

### 4\. Auto-Explore (🧭)

An automated, evolutionary search for interesting rulesets — point it at the grid and let it evolve rulesets worth looking at.

  * **Two-stage evaluation (screen → confirm):** every candidate is first *screened* with short Wasm evaluation bursts across a suite of initial conditions (chaos / sparse / seed). Only candidates that clear the find threshold pay for a longer *confirmation* burst that filters out transients and labels long-period cyclers (tagged `↻N` in the gallery) — so the cheap screening pass stays fast while the finds you keep are real.
  * **Interestingness score:** a pure, tunable objective combining σ≈1 criticality, mid-band block entropy, **spatial-structure** and **heterogeneity** terms (a join-count statistic that rewards real structure over homogeneous churn), rule-usage diversity, and activity fluctuation — with hard kills for extinct / saturated / frozen / short-cycle behaviors. Every knob lives in an exported config object.
  * **Generation loop:** champion + mutated and crossover-bred offspring evolve over generations with deterministic per-(generation, world, IC) seeding, while a MAP-Elites-style **behavior archive** keeps a diverse gallery — a near-identical hex sibling must out-score its family or it's rejected, so the gallery never fills with duplicates.
  * **Visual gallery:** banked finds persist across sessions, each shown with a **rendered thumbnail** plus per-component score bars, and can be applied, saved, shared, or bred further. Per-world score badges surface the search live on the minimaps, and killed candidates show their kill reason on hover.
  * **Loop controls:** **Pause / Resume** the hunt without losing progress, set an optional **generation budget** to stop automatically (with a "best find" summary toast), and **re-test (🔄)** any gallery entry to re-confirm its score on demand.

#### Initial-condition suite

Each candidate is judged not on one starting grid but on a **suite of initial conditions (ICs)**, because the same ruleset can be lifeless from one seed and teeming from another. All ICs are deterministically seeded, so a find is exactly reproducible. The panel's IC toggles let you run any subset:

| IC | Mode | What it probes |
| :--- | :--- | :--- |
| **Chaos** | Uniform random, density **0.5** | Behavior emerging from a fully-mixed, high-energy soup. |
| **Sparse** | Uniform random, density **0.05** | Whether structure can *grow* from near-emptiness (favors gliders/replicators). |
| **Seed** | A single **compact cluster** (~6-cell Gaussian blob) | Whether one small blob organizes, spreads, or collapses. |
| **Clusters** | **Several** scattered clusters (5 blobs, ~8 cells each) | Whether separate seeds collide, merge, or launch travelling structures. |

The **Seed** and **Clusters** ICs drop Gaussian-falloff blobs into an otherwise empty grid (not a literal single center cell — a lone cell rarely does anything under most rules); Chaos and Sparse are uniform-noise fields covering the opposite end of the spectrum.

> **Fixed in this version:** the cluster ICs were previously declared with the wrong strategy key (`'cluster'` vs the engine's `'clusters'`), so they **silently fell back to a fully-saturated `density: 1.0` grid** that was instantly killed — the "seed" condition was effectively dead weight. They now place real clusters, and a dedicated multi-cluster **Clusters** IC was added.

The per-IC scores are combined into one headline number with a **soft-max** (temperature 0.15, so the combine leans toward the world's *best* IC) plus a small (0.2) plain-mean robustness bonus — a ruleset that shines under one IC isn't dragged down by being dull under another, but consistency across ICs is still rewarded.

#### Evaluation length (tick budgets)

There is **no fixed cap on how long a candidate runs**. (The "400" elsewhere in the codebase is the longest *cycle period* the detector can recognize — `CYCLE_DETECTION_MAX_PERIOD` — not an evaluation length.) The two stages run for:

  * **Screening burst — the "Ticks / Evaluation" slider, default 160, now adjustable up to 5000 ticks** (after a 20-tick warm-up that's discarded so start-up transients don't pollute the metrics). Cheap, run on all nine candidates every generation; raise it when you want behavior that only emerges over a longer horizon to be visible to the screen itself.
  * **Confirmation burst — 600 ticks** (and automatically scaled up so it's never shorter than the screening burst), run only on candidates that clear the find threshold. Its job is to expose long-horizon fates the short screen can't see — a quiet death, a late saturation, or settling into a long cycle. A cycle of period ≤ 120 found here tags the find `↻N` and penalizes (but keeps) it.

#### How a candidate is scored — the seven component values

The gallery's per-component bars expose the raw ingredients of the interestingness score. Each is normalized to **[0, 1]**, then combined with the weights shown (criticality is dropped and the rest renormalized if no damage-probe ran; the two spatial terms and the temporal-variance term are likewise dropped for legacy gallery entries that predate them):

| Value | Weight | How it's measured | What a high value means |
| :--- | :---: | :--- | :--- |
| **σ** (criticality) | 0.18 | A **damage-spreading probe**: the grid is cloned, one cell is flipped, and both copies run side-by-side while the Hamming distance between them is tracked over a 64-tick window. σ = `exp(slope)` of a log-linear fit to that distance — the average per-tick growth factor of a one-cell perturbation. The term is a Gaussian peaked at **σ = 1** (in log space, τ = 0.6). | The automaton sits at the **edge of chaos**: σ < 1 = perturbations heal (frozen/ordered), σ > 1 = they explode (full chaos), σ ≈ 1 = information propagates without dying or blowing up — where the most interesting computation lives. |
| **Entropy** (entropy band) | 0.08 | Mean **block entropy**: for every cell, take its 7-cell neighborhood (center + 6 neighbors → one of 2⁷ = 128 patterns), build the histogram of those patterns across the grid, and take its Shannon entropy normalized to [0, 1]. Scored as a Gaussian peaked at a **mid-band target of 0.4** (τ = 0.18). | The grid is **structured but not noise**. Entropy near 0 = uniform/repetitive (dull); near 1 = maximal randomness (TV static); the mid-band is where recognizable, varied local patterns coexist. |
| **Flux** (fluctuation) | 0.04 | The **coefficient of variation** (std ÷ mean) of the *changed-cell count* — how many cells flip state each tick — across the burst. Scored by half-saturation: `cv / (cv + 0.3)`. | Activity comes in **bursts rather than a steady hum** — large fluctuations in how much is changing are a hallmark of susceptibility near a critical point (avalanches, sweeping fronts) rather than uniform churn. |
| **Diversity** (rule diversity) | 0.08 | Every tick, each cell's next state is decided by exactly one of the 128 rules; the engine tallies how often each rule fires (a 128-bin histogram). This is the **Shannon entropy of that histogram**, normalized by log₂(128). | The dynamics draw on a **rich rule vocabulary**. Near 0 = one or two rules do all the work (monotonous); near 1 = many distinct local situations arise and are handled differently (complex behavior). |
| **Structure** (spatial structure) | 0.35 | A **join-count statistic** (`spatial_order`): it compares how often neighboring cells share the same state against what pure random mixing would produce. ~0 = well-mixed; **positive = clustering** (like-with-like domains); **negative = anti-correlation** (checkerboard/stripes). The score rewards *deviation in either direction*, half-saturating at 0.12. | The grid has **genuine spatial organization** — domains, fronts, gliders, lattices — rather than salt-and-pepper noise. This is the **most heavily weighted term**: it's the one signal that reliably separates a structured glider soup from homogeneous high-activity "churn" (which maxes out σ/entropy/flux but is visually boring). |
| **Heterog.** (spatial heterogeneity) | 0.12 | The **across-cell variance** of each cell's block-entropy surprisal (−log₂p ÷ 7), averaged over the burst (`block_entropy_stats` returns mean *and* this variance). Half-saturates at 0.02. | **Order and disorder coexist in different regions** at the same time — calm zones beside busy ones, rather than the whole grid behaving identically. Spatially uniform behavior (everywhere-ordered or everywhere-chaotic) scores low; a patchwork scores high. |
| **Temporal** (temporal entropy variance) | 0.15 | The variance of the grid's **block entropy over *time*** — the spread of the per-sample entropy values across the burst (the temporal sibling of Heterog., which measures variance across *space*). Half-saturates at 0.005. | The automaton's order/disorder balance **swings as it runs** rather than holding steady. This is Wuensche's complex-rule discriminator: *ordered* rules settle to a low stable entropy and *chaotic* rules sit at a high stable one — only **complex** rules (the glider-bearing ones) show large entropy *swings*. It reinforces Structure rather than competing with it. (It's only safe to reward because the confirmation burst hard-penalizes long cyclers downstream, which would otherwise inflate it.) |

Before any of this is computed, four **hard kills** zero the score outright: **extinct** (died out), **saturated** (≥99% active), **frozen** (≤0.5 cells changing per tick on average), and **short-cycle** (a detected period ≤ 4 — blinkers and fixed points). These weed out the degenerate regimes cheaply so the six graded terms only ever rank the survivors.

> **Measure any world on demand:** the same seven values can be computed for the selected world from the **Analysis panel → Interestingness Metrics** plugin. Click **Measure** and it runs one non-destructive evaluation burst (snapshotting and restoring the world afterwards) and renders the component bars + composite score. The σ damage probe is the expensive part, so it's behind a toggle, and the burst length is adjustable — measurement is opt-in precisely because it's heavier than the live stats. See [§8 Advanced Draggable Panels](#8-advanced-draggable-panels).

> **Design note — a possible σ variant.** Today's σ perturbs one **cell** and measures how that damage spreads through *state space* (the edge-of-chaos signal). A complementary idea is to perturb one **rule** instead — flip a single bit of the 128-entry ruleset, run the original and mutated rulesets side by side, and measure how fast their grids diverge. That measures something different: not edge-of-chaos dynamics but the ruleset's **mutational brittleness** — how sensitive its behavior is to a one-rule change, which is exactly the perturbation the evolutionary loop applies. It's noted here as a future direction; it isn't implemented yet.

#### Generation budget

A **generation** is one full round of the evolutionary loop: the nine worlds each evaluate a candidate (the reigning champion plus mutated and crossover-bred offspring), the best is banked, and a new champion + runner-up are chosen to breed the next round. By default the loop runs **unlimited** until you stop it. Setting a **generation budget** (the panel's numeric input) caps it: the search tracks the best score seen and, once it has completed that many generations, **stops automatically and toasts a summary** (e.g. *"Explored 50 generations — best 0.86 Frosted-Willow"*). Use it to bound a hands-off run or to get a reproducible, fixed-effort sweep.

### 5\. State History Scrub-Back (⏪)

Pause the simulation and rewind the selected world to see exactly how it got to where it is.

  * **Replay the recent past:** the selected world records a rolling ring of its last few hundred ticks (bit-packed frames). While paused, a **scrub bar** appears with a timeline slider (oldest → present), ±1 / ±10 step buttons, a live tick label, and a **Live** button to snap back to the present.
  * **Step with the keyboard:** `←` and `→` step one tick backward / forward while paused.
  * **Branch from the past:** stepping the simulation forward (or drawing) from a scrubbed-back point truncates the discarded future and continues from there — useful for "what if I'd nudged it here?" exploration.
  * **Focused & cheap:** history is captured for the selected world only (so memory stays bounded to one world's ring), and it cleanly resets on any state discontinuity — reset, load, or ruleset change.

### 6\. Media Export (🎥 / 📷)

Capture what you've discovered and take it with you.

  * **PNG snapshot (📷):** export the selected world at full render resolution to a PNG, named `hexlife-<mnemonic>-t<tick>.png` so the ruleset and tick are baked into the filename.
  * **WebM video (🎥):** record the **live composited canvas** — exactly what you see, selected view plus minimap — to an animated WebM via `MediaRecorder`. Toggle the toolbar button (it pulses red while recording); stopping saves `hexlife-<mnemonic>-t<tick>.webm` to disk. Codec negotiation prefers VP9 > VP8 > generic WebM based on browser support.

### 7\. Advanced Draggable Panels

  * **Ruleset Editor (📝):** A powerful interface for viewing and modifying rulesets with multiple modes.
      * **Modes:** View and edit rules individually (**Detailed**), grouped by neighbor count (**Neighbor Count**), or grouped by rotational symmetry (**Rotational Symmetry**), which is the default.
      * **Interactive Editing:** Click on rule visualizations to toggle their output state. Changes can be applied to the selected world or all worlds, with an option to auto-reset upon change.
  * **World Setup Panel (🌐):** Configure the **grid size** (shared across all worlds), plus the initial density and enabled/disabled state for each of the 9 worlds individually. Includes a "Use Main Ruleset" button to quickly propagate the selected world's ruleset to another world, and bulk actions for applying settings across worlds at once.
  * **Analysis Panel (📈):** Houses a plugin system for data visualization and analysis.
      * **Ratio History Plot:** Visualizes the history of the active cell ratio for the selected world.
      * **Entropy Plot:** Visualizes the history of **Binary Entropy** (based on activity ratio) or **Block Entropy** (based on 7-cell hexagonal patterns). Includes controls to enable/disable entropy sampling and adjust the sampling rate.
      * **Interestingness Metrics:** On-demand measurement of the selected world's dynamics across the seven Auto-Explore score components (σ / Entropy / Flux / Diversity / Structure / Heterog. / Temporal) plus the composite score. Click **Measure** to run one short, non-destructive evaluation burst (the world is snapshotted and restored); the σ damage probe and the burst length are adjustable since they're compute-intensive. The result renders as the same component bars used in the Explore gallery.
  * **Rule Rank Panel (🏆):** Provides a real-time ranking of which rules are being used most frequently. It features a dual-column layout to separately rank rules that cause cells to become **active** versus those that cause them to become **inactive**, offering deep insight into the automaton's dynamics.

### 8\. Keyboard Shortcuts

A rich set of keyboard shortcuts enhances usability for power users.

| Keys | Action | Scope / Notes |
| :--- | :--- | :--- |
| **Global Controls** | | |
| `P` | Play / Pause Simulation | Global |
| `Escape` | Close active popout or panel | Global |
| `1` - `9` | Select World 1 through 9 | Follows numpad layout |
| `Shift` + `1`-`9` | Toggle World's Enabled State | Follows numpad layout |
| | | |
| **Actions & Panels** | | |
| `N` | Toggle **Ruleset Actions** panel | |
| `E` | Toggle **Ruleset Editor** panel | |
| `S` | Toggle **World Setup** panel | |
| `A` | Toggle **Analysis** panel | |
| `G` | **Generate** new ruleset | Uses settings from the ✨ panel. |
| `M` | **Clone & Mutate** all other worlds | Uses settings from the 🧬 panel. |
| `Shift`+`M` | **Mutate** selected/all worlds | Uses settings from the 🧬 panel. |
| `O` | **Clone** selected ruleset to all others | |
| `I` | **Invert** the selected world's ruleset | |
| | | |
| **Reset & Clear** | | |
| `R` | **Reset** all enabled worlds | Reseeds with configured initial densities. |
| `Shift`+`R` | **Reset** the selected world only | |
| `C` | **Clear** all enabled worlds | |
| `Shift`+`C` | **Clear** the selected world only | |
| `D` | **Reset Densities** to default & Reset All | |
| `Shift`+`D` | **Apply Selected Density to All** & Reset All | |
| | | |
| **Patterns** | | |
| `Ctrl`+`C` | **Copy** a region of cells as a pattern | Drag a marquee to capture. Ignored while page text is selected. |
| `Ctrl`+`V` | **Paste** the copied pattern | Phase-preserving placement under the cursor. |
| | | |
| **State Scrub** | | |
| `←` | **Step back** one tick | While paused; opens the scrub bar. |
| `→` | **Step forward** one tick | While paused. |
| | | |
| **History** | | |
| `Ctrl`+`Z` | **Undo** ruleset change | For the selected world. |
| `Ctrl`+`Shift`+`Z` | **Redo** ruleset change | For the selected world. |