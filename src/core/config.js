// config.js

// Grid Dimensions (per world)
export const GRID_ROWS = 57; // Logical rows
export const GRID_COLS = 68; // Logical columns
export const NUM_CELLS = GRID_ROWS * GRID_COLS;

// Hex Geometry
export const HEX_SIZE = 20; // Base radius for rendering calculations if needed outside shader
export const HEX_WIDTH = 2 * HEX_SIZE;
export const HEX_HEIGHT = Math.sqrt(3) * HEX_SIZE;
export const HORIZ_SPACING = HEX_WIDTH * 3 / 4;
export const VERT_SPACING = HEX_HEIGHT;

// World Layout (for mini-maps)
export const WORLD_LAYOUT_ROWS = 3;
export const WORLD_LAYOUT_COLS = 3;
export const NUM_WORLDS = WORLD_LAYOUT_ROWS * WORLD_LAYOUT_COLS;
export const DEFAULT_SELECTED_WORLD_INDEX = Math.floor(NUM_WORLDS / 2); // Center world

export const INITIAL_DENSITIES = [0, 0.001, 0.01, 0.1, 0.5, 0.9, 0.99, 0.999, 1.0];


// Simulation Defaults
export const DEFAULT_SPEED = 10; // ticks per second
export const MAX_SIM_SPEED = 60;
export const DEFAULT_NEIGHBORHOOD_SIZE = 1;
export const MAX_NEIGHBORHOOD_SIZE = 20;
export const STATS_HISTORY_SIZE = 100; // For moving average ratio

// Rendering Defaults
// *** INCREASE TEXTURE SIZE for sharper rendering ***
export const RENDER_TEXTURE_SIZE = 1024; // Increased from 512
// *** RE-ENABLE BORDER slightly ***
export const BORDER_THICKNESS = 0.0; // Set back from 0.0

// Colors (Normalized RGBA 0-1) - ensure these match shader uniform expectations
export const FILL_COLOR = [1.0, 1.0, 0.0, 1.0];    // Yellow
export const BORDER_COLOR = [0.2, 0.2, 0.2, 1.0];    // Dark Grey
export const HOVER_FILL_COLOR = [1.0, 1.0, 0.5, 1.0];    // Light Yellowish (Used for border hover now)
export const HOVER_BORDER_COLOR = [0.6, 0.6, 0.6, 1.0];    // Lighter Grey
// --- NEW HOVER CONFIG ---
export const HOVER_EMPTY_FILL_COLOR = [0.3, 0.3, 0.3, 0.8]; // Slightly lighter than background for empty hover
export const HOVER_FILLED_DARKEN_FACTOR = 0.6; // Multiplier for filled hover (0.0 to 1.0)
// --- END NEW HOVER CONFIG ---
export const BACKGROUND_COLOR = [0.15, 0.15, 0.15, 1.0]; // Dark Grey bg
export const SELECTION_OUTLINE_COLOR = [1.0, 1.0, 0.0, 0.9]; // Yellow outline
