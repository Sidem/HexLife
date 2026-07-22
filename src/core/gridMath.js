/**
 * Pure grid-dimension math, split out of `config.js`.
 *
 * `config.js` holds mutable live globals (`GRID_ROWS`/`GRID_COLS`/`NUM_CELLS`) and runs
 * `setGridDimensions()` as an **import-time side effect**. Consumers that need only the *math* —
 * notably the embeddable widget (`src/embed/`), which must not pull the app's config graph into its
 * bundle — import this module instead. `config.js` re-exports everything here, so app call sites are
 * unaffected.
 *
 * **Determinism-critical:** the embed and the app must derive the *same* `cols` from the same `rows`,
 * or a shared seed fills a differently-shaped grid and the tick sequences diverge.
 */

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
 * Smallest on-screen hex pitch (in render-texture pixels) at which a grid reads as *cells* rather
 * than as monochrome static. Below roughly this, a half-filled world is texture, not structure —
 * the "first legibility" defect the UX audit recorded (roadmap #34, audit fix 7).
 */
export const LEGIBLE_HEX_PITCH_PX = 14;

/** Never open a first-time visitor deeper than this, however small the render texture is. */
export const MAX_FIRST_RUN_ZOOM = 4;

/**
 * Camera zoom a *first-time* visitor should open at, so the opening frame shows structure.
 *
 * At zoom 1 the whole grid fills the render texture, so one row of hexes is `textureSize / rows`
 * pixels tall — about 6.7px on the default 192-row grid, which is below the size at which a human
 * can see individual cells interact. Scaling that pitch up to {@link LEGIBLE_HEX_PITCH_PX} is what
 * turns the cold-start frame from static into gliders. Derived from the grid rather than hardcoded
 * so every grid-size preset opens at a comparable apparent cell size.
 *
 * Never below 1 (zoom-out past the grid is meaningless) and never above
 * {@link MAX_FIRST_RUN_ZOOM} (a deep opening zoom hides the world instead of explaining it).
 *
 * @param {number} rows Grid rows.
 * @param {number} textureSize Render-texture size in px (`Config.RENDER_TEXTURE_SIZE`).
 * @param {number} [minHexPitchPx] Target pitch; defaults to {@link LEGIBLE_HEX_PITCH_PX}.
 * @returns {number} A camera zoom factor in [1, MAX_FIRST_RUN_ZOOM].
 */
export function legibleFirstRunZoom(rows, textureSize, minHexPitchPx = LEGIBLE_HEX_PITCH_PX) {
    if (!(rows > 0) || !(textureSize > 0)) return 1;
    const pitchAtZoom1 = textureSize / rows;
    const zoom = minHexPitchPx / pitchAtZoom1;
    if (!Number.isFinite(zoom)) return 1;
    return Math.max(1, Math.min(MAX_FIRST_RUN_ZOOM, zoom));
}

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
