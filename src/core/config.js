// --- Grid dimensions ---------------------------------------------------------
// The grid size is configurable at startup (persisted setting / share-URL `g` param). Dimensions
// are derived from a single row count so the rendered grid keeps a roughly square aspect ratio,
// and the column count is forced even so the flat-top odd-r hex layout wraps seamlessly on the
// torus (an odd column count leaves a half-row jog at the wrap seam).
//
// These are intentionally mutable (`let`) and read live via the `Config.*` namespace everywhere.
// Call setGridDimensions() once, before WorldManager / the renderer are constructed.
const SQRT3_OVER_2 = Math.sqrt(3) / 2;

/** Named row-count presets. Cols are derived (see deriveGridDimensions). 'medium' is the legacy size. */
export const GRID_SIZE_PRESETS = {
    small: 96,
    medium: 192,
    large: 384,
    huge: 576,
};
export const DEFAULT_GRID_SIZE_KEY = 'medium';

/**
 * Derives a seamless, ratio-preserving grid from a desired row count.
 * @param {number} rows Desired number of rows.
 * @returns {{rows: number, cols: number}} Sanitized rows and an even column count (cols ≈ rows·2/√3).
 */
export function deriveGridDimensions(rows) {
    const safeRows = Math.max(2, Math.round(rows) || GRID_SIZE_PRESETS[DEFAULT_GRID_SIZE_KEY]);
    let cols = Math.round(safeRows / SQRT3_OVER_2); // rows * (1/(sqrt(3)/2)) == rows * 2/sqrt(3)
    if (cols % 2 !== 0) cols += 1; // even columns => seamless toroidal wrap
    return { rows: safeRows, cols };
}

export let GRID_ROWS = 0;
export let GRID_COLS = 0;
export let NUM_CELLS = 0;

/**
 * Sets the live grid dimensions from a row count, keeping the aspect ratio and an even column count.
 * @param {number} rows Desired number of rows.
 * @returns {{rows: number, cols: number, numCells: number}}
 */
export function setGridDimensions(rows) {
    const { rows: r, cols: c } = deriveGridDimensions(rows);
    GRID_ROWS = r;
    GRID_COLS = c;
    NUM_CELLS = r * c;
    return { rows: r, cols: c, numCells: NUM_CELLS };
}

// Initialize to the default so any module consuming these before startup config runs sees valid,
// legacy-compatible values (192 x 222 = 42624 cells).
setGridDimensions(GRID_SIZE_PRESETS[DEFAULT_GRID_SIZE_KEY]);

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
// Sliding window of recent state checksums kept per world. Cycle detection can only *trigger* when a
// state's checksum still matches one in this window, so this is the effective ceiling on detectable
// cycle period: a cycle of period P is only caught if P <= CYCLE_DETECTION_HISTORY_SIZE. The window
// stores plain 32-bit checksums (not states), so its cost is tiny and independent of grid size.
export const CYCLE_DETECTION_HISTORY_SIZE = 400;
// Hard cap on how many frames a candidate cycle may accumulate before detection is aborted. Kept
// equal to CYCLE_DETECTION_HISTORY_SIZE: a genuine cycle closes within HISTORY_SIZE frames, so any
// candidate that grows past this is necessarily a spurious 32-bit checksum collision (which would
// otherwise grow `detectedCycle` unbounded — one full state copy per tick — until it happens to
// recur). NB: unlike the history window, this buffer holds full state+rules copies, so its worst-case
// memory scales with NUM_CELLS (~2*NUM_CELLS bytes/frame, only while a long cycle is actually being
// collected/played back). Raise both together to detect longer cycles.
export const CYCLE_DETECTION_MAX_PERIOD = 400;
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
// Cap per-tick grid snapshots to ~display rate. At high TPS the worker would otherwise post a full
// copied state+rule buffer every changed tick (≈290 MB/s at 250 TPS × 9 worlds) while the display
// only consumes 60 fps. Forced syncs (brush/reset/pause/enable) bypass this and send immediately.
export const GRID_UPDATE_INTERVAL_MS = 1000 / 60;

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

// ── Hex neighbor offsets ──────────────────────────────────────────────────────
// CANONICAL SOURCE shared with the Wasm engine. These two tables are duplicated
// verbatim as `NEIGHBOR_DIRS_ODD_R` / `NEIGHBOR_DIRS_EVEN_R` in
// `hexlife-wasm/src/lib.rs` (where `compute_neighbor_indices` flattens them into the
// per-cell neighbor table). They MUST stay byte-for-byte identical on both sides —
// a mismatch silently changes the simulation. Drift is guarded on each side:
//   • JS:   tests/neighborDirs.test.js pins these arrays to the canonical values.
//   • Rust: `neighbor_dirs_match_canonical` in lib.rs pins the Rust copies.
// If you edit one table, edit the other and update both pinned tests.
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
    // Gated on the dev build so production never ships event-bus console logging. Set to true
    // manually while debugging; import.meta.env.DEV is false in `vite build`.
    enabled: import.meta.env.DEV, // Set to true to enable console logging of events
    
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
        "0-0": { "on": "#000000", "off": "#2A0000" },
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
        "1-6": { "on": "#FF007F", "off": "#000000" }
    },
    customSymmetryColors: {
        "0-0": { "on": "#000000", "off": "#2A0000" },
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
        "1-63": { "on": "#FF007F", "off": "#000000" }
    }
};