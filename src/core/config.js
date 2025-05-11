// src/core/config.js

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

// Initial Densities and Enabled States for Worlds
// These are defaults if nothing is found in localStorage
export const DEFAULT_INITIAL_DENSITIES = [
    0.0, 0.001, 0.01,
    0.1, 0.5,   0.9,
    0.99, 0.999, 1.0
];
export const DEFAULT_WORLD_ENABLED_STATES = [
    true, true, true,
    true, true, true,
    true, true, true
]; // All worlds enabled by default

// Simulation Defaults
export const DEFAULT_SPEED = 20; // ticks per second
export const MAX_SIM_SPEED = 120;
export const DEFAULT_NEIGHBORHOOD_SIZE = 0;
export const MAX_NEIGHBORHOOD_SIZE = 40;
export const STATS_HISTORY_SIZE = 100; // For moving average ratio

// Rendering Defaults
export const RENDER_TEXTURE_SIZE = 1024; // Increased from 512

// Colors (Normalized RGBA 0-1)
export const FILL_COLOR = [1.0, 1.0, 0.0, 1.0];    // Yellow (No longer primary way cells are colored)
export const HOVER_BORDER_COLOR = [0.6, 0.6, 0.6, 1.0];    // Lighter Grey (Potentially for a different hover effect)

export const HOVER_FILLED_DARKEN_FACTOR = 0.66;
export const HOVER_INACTIVE_LIGHTEN_FACTOR = 1.5;

export const BACKGROUND_COLOR = [0.15, 0.15, 0.15, 1.0]; // Dark Grey bg
export const SELECTION_OUTLINE_COLOR = [1.0, 1.0, 0.0, 0.9]; // Yellow outline
export const DISABLED_WORLD_OVERLAY_COLOR = [0.1, 0.1, 0.1, 0.7]; // For rendering disabled worlds

// localStorage Keys
export const LS_KEY_PREFIX = 'hexLifeExplorer_';
export const LS_KEY_RULESET = `${LS_KEY_PREFIX}ruleset`;
export const LS_KEY_WORLD_SETTINGS = `${LS_KEY_PREFIX}worldSettings`; // For { initialDensity, enabled } array
export const LS_KEY_SIM_SPEED = `${LS_KEY_PREFIX}simSpeed`;
export const LS_KEY_BRUSH_SIZE = `${LS_KEY_PREFIX}brushSize`;
export const LS_KEY_RULESET_PANEL_STATE = `${LS_KEY_PREFIX}rulesetPanelState`; // { isOpen, x, y }
export const LS_KEY_SETUP_PANEL_STATE = `${LS_KEY_PREFIX}setupPanelState`;   // { isOpen, x, y }
export const LS_KEY_UI_SETTINGS = `${LS_KEY_PREFIX}uiSettings`; // For other UI toggles like symmetrical generation, bias etc.