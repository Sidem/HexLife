// src/core/config.js
export const GRID_ROWS = 32*6;//192;
export const GRID_COLS = 37*6;//222; ~ 192*(sqrt(3)/2)
export const NUM_CELLS = GRID_ROWS * GRID_COLS;

export const HEX_SIZE = 50; // Base hex size for calculations if not scaled for texture
export const HEX_WIDTH = 2 * HEX_SIZE;
export const HEX_HEIGHT = Math.sqrt(3) * HEX_SIZE;
// export const HORIZ_SPACING = HEX_WIDTH * 3 / 4; // These are relevant for pixel conversion logic
// export const VERT_SPACING = HEX_HEIGHT;

export const WORLD_LAYOUT_ROWS = 3;
export const WORLD_LAYOUT_COLS = 3;
export const NUM_WORLDS = WORLD_LAYOUT_ROWS * WORLD_LAYOUT_COLS;
export const DEFAULT_SELECTED_WORLD_INDEX = Math.floor(NUM_WORLDS / 2);

export const DEFAULT_INITIAL_DENSITIES = [
    0.0, 0.001, 0.01,
    0.1, 0.5,   0.9,
    0.99, 0.999, 1.0
];
export const DEFAULT_WORLD_ENABLED_STATES = [
    true, true, true,
    true, true, true,
    true, true, true
];

export const DEFAULT_SPEED = 20; // Target TPS
export const MAX_SIM_SPEED = 120;
export const DEFAULT_NEIGHBORHOOD_SIZE = 0; // Brush size
export const MAX_NEIGHBORHOOD_SIZE = 40;
export const STATS_HISTORY_SIZE = 100; // For UI display if maintaining history on main thread

export const RENDER_TEXTURE_SIZE = 1280; // For FBOs

// UI Colors
export const FILL_COLOR = [1.0, 1.0, 0.0, 1.0]; // Not directly used by shader this way anymore
export const HOVER_BORDER_COLOR = [0.6, 0.6, 0.6, 1.0]; // Potentially for UI elements, not shader
export const HOVER_FILLED_DARKEN_FACTOR = 0.66; // Used in fragment shader
export const HOVER_INACTIVE_LIGHTEN_FACTOR = 1.5; // Used in fragment shader
export const BACKGROUND_COLOR = [0.10, 0.10, 0.10, 1.0];
export const SELECTION_OUTLINE_COLOR = [1.0, 1.0, 0.0, 0.9];
export const DISABLED_WORLD_OVERLAY_COLOR = [0.1, 0.1, 0.1, 0.7];

// Hexagon neighbor directions (flat-top, odd-r)
// Relative [col, row] offsets
export const NEIGHBOR_DIRS_ODD_R = [ // For odd columns
    [+1, 0],  // Right
    [+1, +1], // Bottom-right
    [0, +1],  // Bottom-left
    [-1, +1], // Left
    [-1, 0],  // Top-left
    [0, -1]   // Top-right
];
export const NEIGHBOR_DIRS_EVEN_R = [ // For even columns
    [+1, -1], // Right
    [+1, 0],  // Bottom-right
    [0, +1],  // Bottom-left
    [-1, 0],  // Left
    [-1, -1], // Top-left
    [0, -1]   // Top-right
];