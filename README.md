# HexLife Explorer

**Live Demo:** [Try HexLife Explorer](https://sidem.github.io/HexLife/)

HexLife Explorer is an interactive, high-performance web-based cellular automaton simulator that operates on a hexagonal grid. It allows users to discover and explore complex emergent behaviors by defining custom rulesets. The simulation leverages WebGL2 for efficient rendering and employs Web Workers to run multiple, concurrent "worlds," each with its own unique state and rules. The core simulation logic is written in Rust and compiled to WebAssembly (Wasm) for maximum performance.

## Core Concepts

  * **Hexagonal Grid:** The simulation takes place on a "flat-top, odd-r" hexagonal grid where each cell has six direct neighbors. The grid wraps toroidally, connecting opposite edges.
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

### 3\. Interactive Controls & UI

  * **Responsive Mobile UI:** Features a distinct mobile interface with a bottom tab bar, quick-action FABs, and touch-friendly controls for a seamless experience on any device.
  * **Advanced Analysis & Onboarding:** Includes an interactive tour system (`OnboardingManager.js`) to guide new users, a plugin-based analysis panel for visualizing simulation metrics, and a real-time rule ranking panel to understand automaton dynamics.
  * **Toolbar & Popouts:** A vertical toolbar provides quick access to primary functions. Most controls are housed in popout panels (`PopoutPanel.js`) that appear next to their trigger button, keeping the interface clean.
  * **Playback & Speed (⏩):** Globally play/pause the simulation (`P` key) and adjust the target Ticks Per Second (TPS) for all worlds.
  * **Brush Interaction (🖌️):** Draw on the main world's canvas to toggle cell states. Brush size can be adjusted with a slider or the mouse wheel (`Ctrl + Wheel`). The simulation can automatically pause during a drawing stroke for precise edits.
  * **Ruleset Management:**
      * **Generate New Rules (✨):** Create new rulesets using different modes: **Random** (with a configurable bias), **N-Count** (based on the number of active neighbors), or **R-Sym** (based on rotational symmetry groups).
      * **Set/Copy Ruleset (\#️⃣):** Directly input a 32-character hex string to apply a ruleset, or copy the current world's ruleset to the clipboard.
      * **Content Library (📚):** Access the Library of pre-discovered rulesets and patterns.
  * **State Management & Sharing:**
      * **Save/Load (💾/📂):** Save the complete state of the selected world (cell states, ruleset, and tick count) to a JSON file. Load a previously saved state to continue a simulation.
      * **Share Link (🔗):** Generate a unique URL that encodes the current setup (rulesets, densities, selected world, camera position) to share with others.
  * **Reset/Clear (🔄):** Reset worlds to their initial random density or clear them completely to an active or inactive state.

### 4\. Advanced Draggable Panels

  * **Ruleset Editor (📝):** A powerful interface for viewing and modifying rulesets with multiple modes.
      * **Modes:** View and edit rules individually (**Detailed**), grouped by neighbor count (**Neighbor Count**), or grouped by rotational symmetry (**Rotational Symmetry**), which is the default.
      * **Interactive Editing:** Click on rule visualizations to toggle their output state. Changes can be applied to the selected world or all worlds, with an option to auto-reset upon change.
  * **World Setup Panel (🌐):** Configure the initial density and enabled/disabled state for each of the 9 worlds individually. Includes a "Use Main Ruleset" button to quickly propagate the selected world's ruleset to another world.
  * **Analysis Panel (📈):** Houses a plugin system for data visualization and analysis.
      * **Ratio History Plot:** Visualizes the history of the active cell ratio for the selected world.
      * **Entropy Plot:** Visualizes the history of **Binary Entropy** (based on activity ratio) or **Block Entropy** (based on 7-cell hexagonal patterns). Includes controls to enable/disable entropy sampling and adjust the sampling rate.
  * **Rule Rank Panel (🏆):** Provides a real-time ranking of which rules are being used most frequently. It features a dual-column layout to separately rank rules that cause cells to become **active** versus those that cause them to become **inactive**, offering deep insight into the automaton's dynamics.

### 5\. Keyboard Shortcuts

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
| **History** | | |
| `Ctrl`+`Z` | **Undo** ruleset change | For the selected world. |
| `Ctrl`+`Shift`+`Z` | **Redo** ruleset change | For the selected world. |