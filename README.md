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
    * `main.js`: Initializes the application, WebGL renderer, UI, and the `WorldManager`. It handles user input on the canvas and manages the main render loop.
    * `WorldManager.js`: Orchestrates the simulation. It manages multiple `WorldProxy` instances, global settings (speed, pause), and facilitates communication between the UI and workers via an `EventBus`.
    * `WorldProxy.js`: Acts as a main-thread interface for each `WorldWorker`, handling message passing for commands and state updates.
* **Rendering Engine (WebGL2):**
    * `renderer.js` and `webglUtils.js` manage all WebGL2 operations.
    * **Render-to-Texture:** Each world is first rendered to an offscreen Framebuffer Object (FBO). These textures are then composited onto the main canvas.
    * **Instanced Rendering:** Hexagons are drawn using instanced rendering for high efficiency.
    * **GLSL Shaders:** Custom vertex and fragment shaders handle hexagon positioning, scaling, and dynamic cell coloring.
* **Modular UI:**
    * `ui.js` initializes and manages all user interface elements and their interactions.
    * Components (`RulesetEditor.js`, `SetupPanel.js`, `AnalysisPanel.js`, `PopoutPanel.js`, etc.) provide distinct UI functionalities in draggable panels or popouts.
* **Services:**
    * `EventBus.js`: A publish/subscribe system for decoupled communication between application modules.
    * `PersistenceService.js`: Manages saving and loading of user settings (rulesets, world configurations, UI states) to `localStorage`.
* **Core Logic:**
    * `Symmetry.js`: Provides utilities for ruleset analysis and generation based on rotational symmetries.
    * `config.js`: Centralized configuration for grid parameters, default settings, and styling.

## Key Features

### 1. Multi-World Simulation & Per-World Rulesets
* **Concurrent Worlds:** Runs 9 instances of the HexLife simulation simultaneously, arranged in a 3x3 grid. Each world's simulation logic executes in its own Web Worker.
* **Per-World Rulesets:** Each world can operate with its own distinct 128-bit ruleset. This allows for direct comparison of different rule evolutions under identical or varied initial conditions.
* **Initial Densities & Enabling:** Each world can be initialized with a different density of active cells and can be individually enabled or disabled via the **World Setup Panel**.
* **Visual Layout:**
    * A main, larger view displays the currently selected world.
    * A mini-map area shows all worlds, allowing for quick selection and overview.
    * The layout adapts for landscape and portrait orientations.

### 2. Dynamic Cell Coloring
* **Rule-Based Hue:** Cells are colored based on the specific rule index (0-127) that *caused* their current state in the most recent simulation step. This information is passed from the workers to the renderer.
* **Hue Spectrum:** The hue is derived from this rule index, with the spectrum shifted so that rule 0 starts at yellow.
* **State & Hover Differentiation (Shader-based):**
    * **Active Cells (1):** Displayed with 100% saturation and 100% brightness in their rule-determined hue.
    * **Inactive Cells (0):** Displayed with 50% saturation and 20% brightness in their rule-determined hue.
    * **Hover Effect:** Cells under the mouse cursor (within the brush radius on the selected world) are highlighted: active cells are slightly darkened, and inactive cells are brightened.

### 3. Interactive Controls & UI Elements

* **Vertical Toolbar:** Provides access to main functions and panels.
* **Playback:**
    * **Play/Pause ([P]):** Globally start or pause the simulation for all enabled worlds.
    * **Speed Control (SPD Popout):** Adjust the global simulation speed (target ticks per second) using a slider.
* **Brush Interaction (BRS Popout):**
    * **Brush Size:** Adjust the size of the interaction brush using a slider or mouse wheel.
    * **Drawing/Erasing:** Click on the selected world's canvas to toggle the state of cells within the brush radius.
* **Ruleset Management:**
    * **Display (Top Bar):** The 32-character hexadecimal ruleset of the *currently selected world* is displayed.
    * **New Rules Popout (NEW):**
        * Generate new rulesets with options for **Random**, **N-Count** (based on active neighbor count), or **R-Sym** (based on rotational symmetry groups) modes.
        * **Custom Bias:** Optionally use a slider to bias random generation towards active or inactive rule outputs.
        * **Apply To:** Generate rules for the 'Selected' world or 'All' worlds.
        * **Auto-Reset:** Option to automatically reset the affected world(s) to initial densities.
    * **Set/Copy Ruleset Hex Popout (HEX):**
        * **Set:** Input a 32-character hex string to apply a custom ruleset. Scope (Selected/All) and Auto-Reset options from the New Rules popout are considered.
        * **Copy Current:** Copy the selected world's ruleset hex code to the clipboard.
* **State Management:**
    * **Save State (SAV):** Save the current grid configuration (cell states) and the active ruleset of the *selected world* to a JSON file.
    * **Load State (LOD):** Load a previously saved world state (grid and ruleset) from a JSON file into the *currently selected world*. The system checks for dimension compatibility and applies the loaded ruleset to that world.
* **Reset/Clear Worlds Popout (R/C):**
    * **Reset Selected/All:** Resets world(s) to their configured initial random densities, using their current rulesets.
    * **Clear Selected/All:** Toggles all cells in the world(s) to inactive (0) or active (1) if already all inactive.

### 4. Draggable Panels

* **Ruleset Editor Panel ([E]DT):**
    * An intuitive interface to view and modify the ruleset of the world(s).
    * **Apply Changes To:** Choose to apply edits to the 'Selected World' or 'All Worlds'.
    * **Auto-Reset:** Option to automatically reset affected world(s) upon change.
    * **Editor Modes:**
        * **Detailed (128 rules):** View and toggle all 128 individual rule outputs.
        * **Neighbor Count (14 groups):** Define rules based on center cell state and the *number* of active neighbors (0-6). Updates all corresponding detailed rules.
        * **Rotational Symmetry (28 groups):** Define rules based on canonical rotational symmetry groups. Updates all corresponding detailed rules.
        * Visualizations show current state, neighbor configuration, and resulting output state. Clicking toggles the output.
    * **Direct Hex Input:** Edit the ruleset hex code directly.
    * **Clear/Fill Rules:** Set all rule outputs to inactive (0) or active (1).
* **World Setup Panel ([S]ET):**
    * Configure individual settings for each of the 9 worlds:
        * **Initial Density:** Set the random density of active cells at reset.
        * **Enable/Disable:** Toggle whether a world participates in the simulation.
        * **Ruleset Display:** Shows a shortened version of each world's current ruleset hex (full hex on hover).
        * **Use Main Ruleset:** Button per world to copy the selected (main view) world's ruleset to that specific world and reset it.
    * **Apply & Reset All Enabled Worlds:** Button to re-initialize all enabled worlds with their current settings.
* **Analysis Panel ([A]NL):**
    * **Entropy Sampling:**
        * Enable/disable Shannon entropy calculation for the selected world.
        * Adjust the sampling rate (how many ticks per entropy calculation).
        * Displays the most recent sampled entropy value for the selected world.
    * **Plugin System:**
        * **Ratio History Plot:** Visualizes the history of active cell ratio for the selected world.
        * **Entropy Plot:** Visualizes the history of sampled entropy for the selected world.

### 5. Information Displays & Performance
* **Statistics (Top Bar - for Selected World):**
    * **Tick:** Current simulation step of the selected world.
    * **Ratio:** Percentage of active cells in the selected world.
    * **TPS (Ticks Per Second):** Actual simulation steps being processed per second for the selected world, reported by its worker.
* **Performance Indicators (Top Bar):**
    * **FPS (Frames Per Second):** Real-time rendering performance of the main canvas.

### 6. User Interface & Experience
* **Responsive Design:** Main canvas layout adjusts based on viewport orientation.
* **Keyboard Shortcuts:**
    * `P`: Play/Pause simulation.
    * `N`: Toggle New Rules popout.
    * `E`: Toggle Ruleset Editor panel.
    * `S`: Toggle World Setup panel.
    * `A`: Toggle Analysis panel.
    * `Escape`: Close active popout or draggable panel.
* **File Input:** file input used for loading states.

## Technical Overview (Summary)

* **Simulation Core:** JavaScript, with each world's logic in a separate Web Worker (`WorldWorker.js`).
* **Rendering:** WebGL2 with instanced rendering for hexagons and FBOs for multi-world display.
* **Shaders (GLSL):** Vertex shaders for positioning, fragment shaders for dynamic cell coloring based on state, rule index, and hover status.
* **State Management:** Simulation state (cell data, rulesets) managed within workers and proxied to the main thread by `WorldManager.js`. UI state and global settings persisted via `localStorage`.
* **Communication:** `EventBus.js` for decoupled messaging between components. `postMessage` / `onmessage` for main thread-worker communication.
* **Modularity:** Code is organized into core logic (`core`), rendering (`rendering`), UI (`ui` with sub-components), services (`services`), and utilities (`utils`).