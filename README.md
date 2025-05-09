try live: https://sidem.github.io/HexLife/

# HexLife Explorer

HexLife Explorer is an interactive web-based cellular automaton simulator that operates on a hexagonal grid. It allows users to explore complex emergent behaviors by defining and manipulating rulesets that govern the life and death of cells. The simulation is rendered using WebGL2 for high performance, enabling multiple "worlds" to run simultaneously with distinct initial conditions.

## Core Concepts

* **Hexagonal Grid:** The simulation takes place on a "flat-top, odd-r" hexagonal grid. Each cell has six direct neighbors. The grid wraps toroidally, meaning edges connect to the opposite side.
* **Cellular Automata:** Each cell can be in one of two states: active (alive) or inactive (dead). The state of a cell in the next generation (tick) is determined by its current state and the states of its six neighbors, according to a defined ruleset.
* **Rulesets:**
    * The behavior of the automaton is defined by a ruleset consisting of 128 individual rules.
    * Each rule corresponds to a unique configuration: 1 bit for the center cell's current state and 6 bits for the states of its six neighbors (2<sup>(1+6)</sup> = 128 possibilities).
    * The output of each rule is a single bit, determining the center cell's state in the next generation.
    * Rulesets are represented and can be manipulated as a 32-character hexadecimal string (128 bits).

## Key Features

### 1. Multi-World Simulation
* **Concurrent Worlds:** Runs multiple instances (typically 9, arranged in a 3x3 grid) of the HexLife simulation simultaneously.
* **Initial Densities:** Each world can be initialized with a different density of active cells, allowing for diverse starting conditions.
* **Visual Layout:**
    * A main, larger view displays the currently selected world.
    * A mini-map area shows all worlds, allowing for quick selection and overview.
    * The layout adapts for landscape and portrait orientations.

### 2. Dynamic Cell Coloring
* **Rule-Based Hue:** Cells are colored based on the specific rule index (0-127) that *caused* their current state in the most recent simulation step.
* **Hue Spectrum:** The hue is derived from this rule index, with the spectrum shifted so that rule 0 starts at yellow.
* **State Differentiation:**
    * **Active Cells (1):** Displayed with 100% saturation and 100% brightness in their rule-determined hue.
    * **Inactive Cells (0):** Displayed with 50% saturation and 20% brightness in their rule-determined hue, allowing them to still carry color information.

### 3. Interactive Controls
* **Playback:**
    * **Play/Pause ([P]):** Start or pause the simulation for all worlds.
    * **Speed Control:** Adjust the simulation speed (ticks per second) using a slider.
* **Brush Interaction:**
    * **Brush Size:** Adjust the size of the interaction brush (number of affected hexagonal cells) using a slider or mouse wheel.
    * **Drawing/Erasing:** Click on the selected world's canvas to toggle the state of cells within the brush radius.

### 4. Ruleset Management
* **Display:** The current 32-character hexadecimal ruleset code is prominently displayed.
* **Copy ([Ctrl+C] equivalent):** Button to copy the current ruleset hex code to the clipboard.
* **Set Custom Rule:** Input a 32-character hex string to apply a custom ruleset.
* **Generate New Rules ([N]):**
    * **Random Generation:** Create a new random ruleset.
    * **Custom Bias:** Optionally use a slider to set a bias for the random generation (probability of a rule outputting 'active').
    * **Symmetrical Generation:** A checkbox allows generating rules symmetrically, meaning rules are defined based on the *count* of active neighbors rather than their specific positions.
* **Reset on New Rule:** Option to automatically reset all world states to their initial densities when a new ruleset is generated.

### 5. Visual Ruleset Editor ([E])
A draggable panel provides an intuitive way to view and modify the current ruleset.
* **Editor Modes:**
    * **Detailed Mode (128 rules):**
        * Displays all 128 individual rules.
        * Each rule visualization shows the center cell's current state, the configuration of its six neighbors, and a smaller inner hexagon representing the center cell's output state for the next generation.
        * Clicking the inner hexagon of a rule toggles its output state (0 or 1).
    * **Neighbor Count Mode (14 rules):**
        * Simplifies rule definition by focusing on the center cell's current state and the *number* of active neighbors (0 to 6). This results in 14 fundamental conditions (2 center states \* 7 neighbor counts).
        * Each visualization shows the center cell state, the count of active neighbors, and the resulting output state.
        * Clicking a rule in this mode updates all corresponding detailed rules in the underlying 128-bit ruleset.
        * If the underlying detailed rules for a neighbor-count condition are inconsistent (some output 0, some 1), the editor will display a "mixed" state for that condition. Clicking it will typically resolve it to a consistent state (e.g., 0), and subsequent clicks will toggle it.
* **Direct Hex Input:** Edit the ruleset hex code directly within the editor panel. Changes are applied on 'Enter' or when the input field loses focus.
* **Clear Rules:** A button to set all 128 rule outputs to inactive (0). If all are already inactive, it sets them all to active (1).

### 6. State Management
* **Save State:** Save the current grid configuration (cell states) and the active ruleset of the *selected world* to a JSON file.
* **Load State:** Load a previously saved world state (grid and ruleset) from a JSON file into the currently selected world. The system checks for dimension compatibility.
* **Reset All Worlds ([R]):** Resets all worlds to their configured initial random densities.

### 7. Information Displays
* **Statistics (Selected World):**
    * **Ratio:** Percentage of active cells in the selected world.
    * **Average Ratio:** Moving average of the active cell ratio over a history period.
* **Performance Indicators:**
    * **FPS (Frames Per Second):** Real-time rendering performance.
    * **TPS (Ticks Per Second):** Actual simulation steps being processed per second.

### 8. User Interface & Experience
* **Responsive Design:** The main canvas layout (selected world vs. mini-maps) adjusts based on viewport orientation (landscape/portrait).
* **Keyboard Shortcuts:**
    * `P`: Play/Pause
    * `N`: New Rules
    * `R`: Reset All Worlds
    * `E`: Toggle Ruleset Editor Panel
* **Hover Effects:** Cells under the mouse cursor (within the brush radius) are highlighted in the selected world.
* **File Input:** Hidden file input used for loading states.

## Technical Overview

* **Rendering Engine:** WebGL2 is used for efficient rendering of the hexagonal grid and cells.
* **Render-to-Texture:** Each of the non-selected "mini-map" worlds is first rendered to an offscreen Framebuffer Object (FBO / texture), which is then drawn onto the main canvas.
* **Instanced Rendering:** Hexagons are drawn using instanced rendering, allowing many cells to be drawn with a single draw call, significantly improving performance.
* **Shaders (GLSL):**
    * Vertex shaders handle the positioning and scaling of hexagon instances.
    * Fragment shaders determine the color of each cell based on its state and the rule index that led to that state, implementing the dynamic hue-shifting logic.
* **Modular JavaScript:** The application is structured into modules for simulation logic (`core`), rendering (`rendering`), UI management (`ui`), and utilities (`utils`).

