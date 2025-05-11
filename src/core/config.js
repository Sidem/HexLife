// config.js

// Grid Dimensions (per world)
export const GRID_ROWS = 96; // Logical rows
export const GRID_COLS = 108; // Logical columns
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
export const DEFAULT_SPEED = 20; // ticks per second
export const MAX_SIM_SPEED = 120;
export const DEFAULT_NEIGHBORHOOD_SIZE = 0;
export const MAX_NEIGHBORHOOD_SIZE = 40;
export const STATS_HISTORY_SIZE = 100; // For moving average ratio

// Rendering Defaults
// *** INCREASE TEXTURE SIZE for sharper rendering ***
export const RENDER_TEXTURE_SIZE = 1024; // Increased from 512

// Colors (Normalized RGBA 0-1) - ensure these match shader uniform expectations
export const FILL_COLOR = [1.0, 1.0, 0.0, 1.0];    // Yellow
export const HOVER_BORDER_COLOR = [0.6, 0.6, 0.6, 1.0];    // Lighter Grey

// --- ADJUSTED HOVER CONFIG ---
// export const HOVER_EMPTY_FILL_COLOR = [0.3, 0.3, 0.3, 0.8]; // No longer needed if we lighten original color
export const HOVER_FILLED_DARKEN_FACTOR = 0.66; // Adjusted for "slight" darkening (e.g., 0.8 to 0.9)
export const HOVER_INACTIVE_LIGHTEN_FACTOR = 1.5; // NEW: Factor to lighten inactive cells on hover (e.g., 1.1 to 1.4)
// --- END ADJUSTED HOVER CONFIG ---

export const BACKGROUND_COLOR = [0.15, 0.15, 0.15, 1.0]; // Dark Grey bg
export const SELECTION_OUTLINE_COLOR = [1.0, 1.0, 0.0, 0.9]; // Yellow outline