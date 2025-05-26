# HexLife Explorer

**Live Demo:** [Try HexLife Explorer](https://sidem.github.io/HexLife/)

HexLife Explorer is an interactive web-based cellular automaton simulator that operates on a hexagonal grid. It allows users to explore complex emergent behaviors by defining and manipulating rulesets that govern the life and death of cells. The simulation leverages WebGL2 for high-performance rendering and employs Web Workers to run multiple "worlds" concurrently, each potentially with its own unique ruleset and initial conditions.

## Core Concepts

  * **Hexagonal Grid:** The simulation takes place on a "flat-top, odd-r" hexagonal grid. Each cell has six direct neighbors. The grid wraps toroidally, meaning edges connect to the opposite side.
  * **Cellular Automata:** Each cell can be in one of two states: active (alive) or inactive (dead). The state of a cell in the next generation (tick) is determined by its current state and the states of its six neighbors, according to a defined ruleset.
  * **Rulesets:**
      * The behavior of the automaton is defined by a ruleset consisting of 128 individual rules.
      * Each rule corresponds to a unique configuration: 1 bit for the center cell's current state and 6 bits for the states of its six neighbors (2<sup>(1+6)</sup> = 128 possibilities).
      * The output of each rule is a single bit, determining the center cell's state in the next generation.
      * Rulesets are represented and can be manipulated as a 32-character hexadecimal string (128 bits).

## Architecture Overview

HexLife Explorer utilizes a modern web architecture for responsiveness and performance:

  * **Multi-Worker Simulation:** Each of the 9 simulation "worlds" runs its core logic in a dedicated Web Worker (`WorldWorker.js`). This allows for parallel computation, preventing the UI from freezing during intensive simulation steps.
  * **Main Thread Control:**
      * `main.js`: Initializes the application, WebGL renderer, UI, and the `WorldManager`. It handles user input on the canvas (clicks, mouse drawing, hover, wheel for brush size) and manages the main render loop. It also handles the initial canvas loader animation.
      * `WorldManager.js`: Orchestrates the simulation. It manages multiple `WorldProxy` instances, global settings (speed, pause, brush size, entropy sampling), and facilitates communication between the UI and workers via an `EventBus`. It also handles loading/saving of world states and ruleset manipulation logic.
      * `WorldProxy.js`: Acts as a main-thread interface for each `WorldWorker`, handling message passing for commands (like start/stop, set speed, set ruleset, reset, brush application, hover state, load state, entropy sampling parameters) and state updates (cell states, rule indices, hover states, statistics).
  * **Rendering Engine (WebGL2):**
      * `renderer.js` and `webglUtils.js` manage all WebGL2 operations.
      * **Render-to-Texture:** Each world is first rendered to an offscreen Framebuffer Object (FBO). These textures are then composited onto the main canvas.
      * **Instanced Rendering:** Hexagons are drawn using instanced rendering for high efficiency.
      * **GLSL Shaders:** Custom vertex and fragment shaders (`vertex.glsl`, `fragment.glsl`, `quad_vertex.glsl`, `quad_fragment.glsl`) handle hexagon positioning, scaling, dynamic cell coloring, and texture rendering for the main scene display. Disabled worlds show a "DISABLED" text texture.
  * **Modular UI:**
      * `ui.js` initializes and manages all user interface elements, their interactions, and popout panels.
      * Components (`RulesetEditor.js`, `SetupPanel.js`, `AnalysisPanel.js`, `PopoutPanel.js`, `SliderComponent.js`) provide distinct UI functionalities in draggable panels or popouts.
  * **Services:**
      * `EventBus.js`: A publish/subscribe system for decoupled communication between application modules.
      * `PersistenceService.js`: Manages saving and loading of user settings (rulesets, world configurations, UI states including panel positions and UI control states) to `localStorage`.
  * **Core Logic:**
      * `Symmetry.js`: Provides utilities for ruleset analysis and generation based on rotational symmetries.
      * `config.js`: Centralized configuration for grid parameters (rows, columns, number of cells, hex size), world layout, default settings (densities, enabled states, speed, brush size), history sizes, rendering parameters, and colors.
      * `utils.js`: Contains utility functions for coordinate conversion, hex geometry, file downloads, canvas resizing, and hex code formatting.
  * **Canvas Loader:**
      * `canvasLoader.js`: Manages an initial loading animation displayed on the canvas while the application initializes, particularly while Web Workers are starting up.

## Key Features

### 1\. Multi-World Simulation & Per-World Rulesets

  * **Concurrent Worlds:** Runs 9 instances of the HexLife simulation simultaneously, arranged in a 3x3 grid. Each world's simulation logic executes in its own Web Worker (`WorldWorker.js`).
  * **Per-World Rulesets:** Each world can operate with its own distinct 128-bit ruleset. This allows for direct comparison of different rule evolutions under identical or varied initial conditions. Rulesets are stored and managed per world.
  * **Initial Densities & Enabling:** Each world can be initialized with a different density of active cells and can be individually enabled or disabled via the **World Setup Panel**.
  * **Visual Layout:**
      * A main, larger view displays the currently selected world.
      * A mini-map area shows all 9 worlds, allowing for quick selection and overview. The selected world in the mini-map is highlighted.
      * The layout adapts for landscape and portrait orientations.

### 2\. Dynamic Cell Coloring

  * **Rule-Based Hue:** Cells are colored based on the specific rule index (0-127) that *caused* their current state in the most recent simulation step. This information (rule index per cell) is passed from the workers to the renderer.
  * **Hue Spectrum:** The hue is derived from this rule index, with the spectrum shifted so that rule 0 starts at yellow.
  * **State & Hover Differentiation (Shader-based):**
      * **Active Cells (1):** Displayed with 100% saturation and 100% brightness in their rule-determined hue.
      * **Inactive Cells (0):** Displayed with 50% saturation and 15% brightness (updated from 20%) in their rule-determined hue.
      * **Hover Effect:** Cells under the mouse cursor (within the brush radius on the selected world) are highlighted: active cells are darkened (by `u_hoverFilledDarkenFactor`), and inactive cells are brightened (by `u_hoverInactiveLightenFactor`).

### 3\. Interactive Controls & UI Elements

  * **Vertical Toolbar:** Provides access to main functions and panels via buttons.
  * **Playback:**
      * **Play/Pause ([P]):** Globally start or pause the simulation for all enabled worlds.
      * **Speed Control (SPD Popout):** Adjust the global simulation speed (target ticks per second) using a slider.
  * **Brush Interaction (BRS Popout):**
      * **Brush Size:** Adjust the size of the interaction brush using a slider or mouse wheel.
      * **Drawing/Erasing:** Click on the selected world's canvas to toggle the state of cells within the brush radius. Continuous drawing is supported by holding the mouse button and dragging. The simulation temporarily pauses during a mouse drawing stroke if it was running.
  * **Ruleset Management:**
      * **Display (Top Bar):** The 32-character hexadecimal ruleset of the *currently selected world* is displayed.
      * **New Rules Popout (NEW):**
          * Generate new rulesets with options for **Random**, **N-Count** (based on active neighbor count), or **R-Sym** (based on rotational symmetry groups) modes.
          * **Custom Bias:** Optionally use a slider to bias random generation towards active or inactive rule outputs.
          * **Apply To:** Generate rules for the 'Selected' world or 'All' worlds.
          * **Auto-Reset:** Option to automatically reset the affected world(s) to initial densities.
      * **Set/Copy Ruleset Hex Popout (HEX):**
          * **Set:** Input a 32-character hex string to apply a custom ruleset. Scope (Selected/All from New Rules popout) and Auto-Reset options are considered.
          * **Copy Current:** Copy the selected world's ruleset hex code to the clipboard.
  * **State Management:**
      * **Save State (SAV):** Save the current grid configuration (cell states), the active ruleset, and current tick of the *selected world* to a JSON file.
      * **Load State (LOD):** Load a previously saved world state (grid, ruleset, and tick) from a JSON file into the *currently selected world*. The system checks for dimension compatibility and applies the loaded ruleset and state to that world.
  * **Reset/Clear Worlds Popout (R/C):**
      * **Reset Selected/All:** Resets world(s) to their configured initial random densities, using their current rulesets.
      * **Clear Selected/All:** Toggles all cells in the world(s) to inactive (0) or active (1) if already all inactive.
  * **Popout Panel System:** Many controls are housed in popout panels that appear next to their trigger buttons, managed by `PopoutPanel.js`. Popouts generally close when clicking outside or opening another popout.

### 4\. Draggable Panels

  * **Ruleset Editor Panel ([E]DT):**
      * An intuitive interface to view and modify the ruleset of the world(s).
      * **Apply Changes To:** Choose to apply edits to the 'Selected World' or 'All Worlds'.
      * **Auto-Reset:** Option to automatically reset affected world(s) upon change.
      * **Editor Modes:**
          * **Detailed (128 rules):** View and toggle all 128 individual rule outputs. Visualizations show rule index-based coloring for the output.
          * **Neighbor Count (14 groups):** Define rules based on center cell state and the *number* of active neighbors (0-6). Updates all corresponding detailed rules.
          * **Rotational Symmetry (28 groups):** Define rules based on canonical rotational symmetry groups. Updates all corresponding detailed rules.
          * Visualizations show current state, neighbor configuration, and resulting output state. Clicking toggles the output.
      * **Direct Hex Input:** Edit the ruleset hex code directly.
      * **Clear/Fill Rules:** Set all rule outputs to inactive (0) or active (1 if all are already inactive).
  * **World Setup Panel ([S]ET):**
      * Configure individual settings for each of the 9 worlds:
          * **Initial Density:** Set the random density of active cells at reset using a slider.
          * **Enable/Disable:** Toggle whether a world participates in the simulation.
          * **Ruleset Display:** Shows a shortened version of each world's current ruleset hex (full hex on hover).
          * **Use Main Ruleset:** Button per world to copy the selected (main view) world's ruleset to that specific world and reset it.
      * **Apply & Reset All Enabled Worlds:** Button to re-initialize all enabled worlds with their current settings.
  * **Analysis Panel ([A]NL):**
      * A panel housing various analysis plugins, managed by `AnalysisPanel.js`.
      * **Plugin System:**
          * **Ratio History Plot:** Visualizes the history of active cell ratio for the selected world.
          * **Entropy Plot Plugin:**
              * Visualizes the history of sampled entropy for the selected world.
              * Allows selection between **Binary Entropy** (calculated from overall activity ratio) and **Block Entropy** (calculated from 7-cell hexagonal block patterns) for display on the plot.
              * Controls to enable/disable entropy sampling and adjust the sampling rate (how many ticks per entropy calculation).
              * Displays current values for Binary Entropy, Block Entropy, Activity Ratio, and the percentage difference between Binary and Block Entropy.

### 5\. Information Displays & Performance

  * **Statistics (Top Bar - for Selected World):**
      * **Tick:** Current simulation step of the selected world.
      * **Ratio:** Percentage of active cells in the selected world.
      * **Brush:** Current brush size.
      * **TPS (Ticks Per Second):** Actual simulation steps being processed per second for the selected world, reported by its worker.
  * **Performance Indicators (Top Bar):**
      * **FPS (Frames Per Second):** Real-time rendering performance of the main canvas.

### 6\. User Interface & Experience

  * **Responsive Design:** Main canvas layout adjusts based on viewport orientation (landscape/portrait) and size. Toolbar adjusts for smaller screens.
  * **Keyboard Shortcuts:**
      * `P`: Play/Pause simulation.
      * `N`: Toggle New Rules popout.
      * `E`: Toggle Ruleset Editor panel.
      * `S`: Toggle World Setup panel.
      * `A`: Toggle Analysis panel.
      * `R`: Reset All Worlds.
      * `Shift+R`: Reset Selected World.
      * `C`: Clear All Worlds (toggle between all 0s and all 1s).
      * `Shift+C`: Clear Selected World (toggle).
      * `G`: Generate new ruleset using current popout settings.
      * `Numpad 1-9` / `Digit 1-9`: Select World (1-9, mapping to top-left to bottom-right).
      * `Shift + Numpad 1-9` / `Shift + Digit 1-9`: Toggle Enable/Disable for World (1-9).
      * `Escape`: Close active popout or draggable panel. If an input within a panel/popout is focused, it blurs the input first.
  * **File Input:** A hidden file input (`<input type="file">`) is used for loading world states from JSON files.
  * **Persistence:** UI settings like panel states, slider values, and selected modes are persisted in `localStorage`.

## Technical Overview (Summary)

  * **Simulation Core:** JavaScript, with each world's logic in a separate Web Worker (`WorldWorker.js`). Workers handle simulation ticks, ruleset application, state updates, brush interactions, and entropy calculations (including binary and block entropy).
  * **Rendering:** WebGL2 with instanced rendering for hexagons and FBOs for multi-world display. Disabled worlds are rendered with an overlay and "DISABLED" text.
  * **Shaders (GLSL):** Vertex shaders for positioning, fragment shaders for dynamic cell coloring based on state, rule index, and hover status.
  * **State Management:** Simulation state (cell data, rulesets) managed within workers and proxied to the main thread by `WorldManager.js` via `WorldProxy.js` instances. UI state, global settings (speed, brush size), and panel positions persisted via `localStorage` (`PersistenceService.js`).
  * **Communication:** `EventBus.js` for decoupled messaging between components. `postMessage` / `onmessage` for main thread-worker communication.
  * **Modularity:** Code is organized into core logic (`core`), rendering (`rendering`), UI (`ui` with sub-components for panels, popouts, sliders, and analysis plugins), services (`services`), and utilities (`utils`). Shader files are located in a `shaders` directory.