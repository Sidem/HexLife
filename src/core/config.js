export const GRID_ROWS = 32*6;
export const GRID_COLS = 37*6; // GRID_ROWS * (1/(sqrt(3)/2))
export const NUM_CELLS = GRID_ROWS * GRID_COLS;
export const HEX_SIZE = 50; 
export const HEX_WIDTH = 2 * HEX_SIZE;
export const HEX_HEIGHT = Math.sqrt(3) * HEX_SIZE;
export const WORLD_LAYOUT_ROWS = 3;
export const WORLD_LAYOUT_COLS = 3;
export const NUM_WORLDS = WORLD_LAYOUT_ROWS * WORLD_LAYOUT_COLS;
export const DEFAULT_SELECTED_WORLD_INDEX = Math.floor(NUM_WORLDS / 2);
export const INITIAL_RULESET_CODE = "12482080480080006880800180010117";
export const DEFAULT_SPEED = 40; 
export const MAX_SIM_SPEED = 250;
export const DEFAULT_NEIGHBORHOOD_SIZE = 2; 
export const MAX_NEIGHBORHOOD_SIZE = 40;
export const STATS_HISTORY_SIZE = 1000;
export const CYCLE_DETECTION_HISTORY_SIZE = 40;
export const RULESET_HISTORY_SIZE = 30;
export const RENDER_TEXTURE_SIZE = 1280; 
export const FILL_COLOR = [1.0, 1.0, 0.0, 1.0]; 
export const HOVER_BORDER_COLOR = [0.6, 0.6, 0.6, 1.0]; 
export const HOVER_FILLED_DARKEN_FACTOR = 0.66; 
export const HOVER_INACTIVE_LIGHTEN_FACTOR = 1.5; 
export const BACKGROUND_COLOR = [0.10, 0.10, 0.10, 1.0];
export const SELECTION_OUTLINE_COLOR = [1.0, 1.0, 0.0, 0.9];
export const DISABLED_WORLD_OVERLAY_COLOR = [0.25, 0.25, 0.25, 1.0];
export const UI_UPDATE_THROTTLE_MS = 400;
export const SIM_HOVER_THROTTLE_MS = 20;
export const STATS_UPDATE_INTERVAL_MS = 100;

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

export const NEIGHBOR_DIRS_ODD_R = [ 
    [-1, +1],  // SW (Visual slot 0 - Bottom-left for odd cells)
    [-1, 0],   // NW (Visual slot 1 - Top-left for odd cells)
    [0, -1],   // N  (Visual slot 2 - Top center for odd cells)
    [+1, 0],   // NE (Visual slot 3 - Top-right for odd cells)
    [+1, +1],  // SE (Visual slot 4 - Bottom-right for odd cells)
    [0, +1]    // S  (Visual slot 5 - Bottom center for odd cells)
];

export const NEIGHBOR_DIRS_EVEN_R = [ 
    [-1, 0],   // SW (Visual slot 0 - Bottom-left)
    [-1, -1],  // NW (Visual slot 1 - Top-left)
    [0, -1],   // N  (Visual slot 2 - Top center)
    [+1, -1],  // NE (Visual slot 3 - Top-right)
    [+1, 0],   // SE (Visual slot 4 - Bottom-right, using E as closest)
    [0, +1]    // S  (Visual slot 5 - Bottom center)
];

/**
 * Configuration for logging EventBus events to the console.
 * Useful for debugging the flow of information in the application.
 */
export const EVENT_BUS_LOGGING = {
    enabled: true, // Set to true to enable console logging of events
    
    /**
     * An array of event prefixes to log. If empty, all events are logged (if enabled).
     * This allows for granular debugging without console spam.
     * Examples:
     * filter: ['command:'] // Only log commands
     * filter: ['simulation:worldStatsUpdated', 'ui:'] // Log specific simulation events and all UI events
     * filter: [] // Log all events
     */
    filter: ['ui:'] 
};

/**
 * Default color schemes for neighbor count and symmetry group modes.
 * These provide a rich, visually distinct palette for different rule configurations.
 */
export const DEFAULT_COLOR_SCHEMES = {
    customNeighborColors: {
        "0-0": { "on": "#FF0000", "off": "#2A0000" },
        "0-1": { "on": "#FED400", "off": "#2A2300" },
        "0-2": { "on": "#2AFF2A", "off": "#072A07" },
        "0-3": { "on": "#00FEFF", "off": "#002A2A" },
        "0-4": { "on": "#002AFF", "off": "#00072A" },
        "0-5": { "on": "#AA00FF", "off": "#1C002A" },
        "0-6": { "on": "#FF007F", "off": "#2A0015" },
        "1-0": { "on": "#FF0000", "off": "#2A0000" },
        "1-1": { "on": "#FED400", "off": "#2A2300" },
        "1-2": { "on": "#2AFF2A", "off": "#072A07" },
        "1-3": { "on": "#00FEFF", "off": "#002A2A" },
        "1-4": { "on": "#002AFF", "off": "#00072A" },
        "1-5": { "on": "#AA00FF", "off": "#1C002A" },
        "1-6": { "on": "#FF007F", "off": "#2A0015" }
    },
    customSymmetryColors: {
        "0-0": { "on": "#FF0000", "off": "#2A0000" },
        "0-1": { "on": "#FF6200", "off": "#2A1000" },
        "0-3": { "on": "#FEC400", "off": "#2A2000" },
        "0-5": { "on": "#C3FF00", "off": "#202A00" },
        "0-7": { "on": "#3AFF0A", "off": "#092A02" },
        "0-9": { "on": "#0AFF6B", "off": "#022A12" },
        "0-11": { "on": "#00FECE", "off": "#002A22" },
        "0-13": { "on": "#00CDFF", "off": "#00222A" },
        "0-15": { "on": "#006BFF", "off": "#00122A" },
        "0-21": { "on": "#000AFF", "off": "#00022A" },
        "0-23": { "on": "#5800FF", "off": "#0F002A" },
        "0-27": { "on": "#BA00FF", "off": "#1F002A" },
        "0-31": { "on": "#FF00E1", "off": "#2A0025" },
        "0-63": { "on": "#FF007F", "off": "#2A0015" },
        "1-0": { "on": "#FF0000", "off": "#2A0000" },
        "1-1": { "on": "#FF6200", "off": "#2A1000" },
        "1-3": { "on": "#FEC400", "off": "#2A2000" },
        "1-5": { "on": "#C3FF00", "off": "#202A00" },
        "1-7": { "on": "#3AFF0A", "off": "#092A02" },
        "1-9": { "on": "#0AFF6B", "off": "#022A12" },
        "1-11": { "on": "#00FECE", "off": "#002A22" },
        "1-13": { "on": "#00CDFF", "off": "#00222A" },
        "1-15": { "on": "#006BFF", "off": "#00122A" },
        "1-21": { "on": "#000AFF", "off": "#00022A" },
        "1-23": { "on": "#5800FF", "off": "#0F002A" },
        "1-27": { "on": "#BA00FF", "off": "#1F002A" },
        "1-31": { "on": "#FF00E1", "off": "#2A0025" },
        "1-63": { "on": "#FF007F", "off": "#2A0015" }
    }
};