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
