import neighborDirs from './neighbor-dirs.json';
import { GRID_SIZE_PRESETS, DEFAULT_GRID_SIZE_KEY, deriveGridDimensions, legibleFirstRunZoom } from './gridMath.js';

// --- Grid dimensions ---------------------------------------------------------
// The grid size is configurable at startup (persisted setting / share-URL `g` param). Dimensions
// are derived from a single row count so the rendered grid keeps a roughly square aspect ratio,
// and the column count is forced even so the flat-top odd-r hex layout wraps seamlessly on the
// torus (an odd column count leaves a half-row jog at the wrap seam).
//
// The derivation math + presets live in `gridMath.js` (pure, side-effect free) so the embeddable
// widget can share them without importing this module's live globals and import-time side effect.
// Re-exported here so `Config.*` call sites are unchanged.
export { GRID_SIZE_PRESETS, DEFAULT_GRID_SIZE_KEY, deriveGridDimensions, legibleFirstRunZoom };

// These are intentionally mutable (`let`) and read live via the `Config.*` namespace everywhere.
// Call setGridDimensions() once, before WorldManager / the renderer are constructed.
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
// State-history scrub-back ring: how many recent state frames the SELECTED world's worker retains so
// the user can pause and step backward ("what just happened?"). Only the selected world captures (the
// main thread toggles capture on selection change), so memory is one world's ring: each frame holds a
// bit-packed binary state (NUM_CELLS/8 bytes) plus a rule-index byte array (NUM_CELLS bytes), the same
// frame shape the cycle-detection buffer uses. ~240 ticks of scrub-back covers the "few hundred ticks"
// the feature targets while keeping the worst-case (huge grid) ring well under the cycle buffer's cap.
export const STATE_HISTORY_RING_SIZE = 240;
export const RENDER_TEXTURE_SIZE = 1280;
// --- Selected-view / minimap layout regimes (renderer._calculateAndCacheLayout) ---
// aspectRatio = canvasWidth / canvasHeight. Wide windows get a side-by-side split (minimap
// column on the right); tall, narrow windows get a stacked split (minimap strip across the
// bottom). In the near-square band between these two thresholds, a full-width/height strip
// would leave the square 3x3 grid floating in a large empty band, so the selected view instead
// fills the whole canvas and the minimap is docked as a corner overlay.
export const LAYOUT_LANDSCAPE_MIN_ASPECT = 1.25; // >= this -> side-by-side columns
export const LAYOUT_PORTRAIT_MAX_ASPECT = 0.8;   // <= this -> stacked rows (tall, narrow band)
// Minimap overlay square side as a fraction of the smaller canvas dimension (near-square only).
export const MINIMAP_OVERLAY_SIZE_FACTOR = 0.32;
export const FILL_COLOR = [1.0, 1.0, 0.0, 1.0]; 
export const HOVER_BORDER_COLOR = [0.6, 0.6, 0.6, 1.0]; 
export const HOVER_FILLED_DARKEN_FACTOR = 0.66; 
export const HOVER_INACTIVE_LIGHTEN_FACTOR = 1.5; 
export const BACKGROUND_COLOR = [0.10, 0.10, 0.10, 1.0];
// The UI's golden accent (--accent, #f0c674), so the selection outline matches the app chrome.
export const SELECTION_OUTLINE_COLOR = [0.941, 0.776, 0.455, 0.9];
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
// SINGLE-SOURCED from `src/core/neighbor-dirs.json`, the one canonical copy shared with the Wasm
// engine: `hexlife-wasm/build.rs` reads the same JSON and generates the Rust `NEIGHBOR_DIRS_ODD_R`
// / `NEIGHBOR_DIRS_EVEN_R` consts (`compute_neighbor_indices` flattens them into the per-cell
// neighbor table). A mismatch would silently change the simulation, so drift guards remain on each
// side as backstops that the single source resolved to the canonical values:
//   • JS:   tests/neighborDirs.test.js pins these arrays.
//   • Rust: `neighbor_dirs_match_canonical` in lib.rs pins the generated consts.
// Each of the 6 offsets is [dCol, dRow], ordered by visual slot: 0 SW (bottom-left), 1 NW
// (top-left), 2 N (top center), 3 NE (top-right), 4 SE (bottom-right), 5 S (bottom center).
export const NEIGHBOR_DIRS_ODD_R = neighborDirs.odd_r;
export const NEIGHBOR_DIRS_EVEN_R = neighborDirs.even_r;

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