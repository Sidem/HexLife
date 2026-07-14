// Shared, dependency-free helper that renders a small "what the initial state looks like" preview
// for a given initial-state config (density / clusters). It reuses the real generation strategies so
// the preview is faithful, but runs them on a down-scaled grid for speed: the grid dimensions are
// capped to `maxDim` (preserving the live grid's aspect ratio) and the cluster size params are scaled
// by the same factor so clumps keep their relative proportions.
//
// The result is drawn into a <canvas> at the down-scaled resolution; callers give the canvas a fixed
// CSS size with `image-rendering: pixelated` so it scales up crisply.
import { DensityStrategy } from '../../core/initialStateStrategies/DensityStrategy.js';
import { ClusterStrategy } from '../../core/initialStateStrategies/ClusterStrategy.js';
import { SavedStrategy } from '../../core/initialStateStrategies/SavedStrategy.js';
import * as Config from '../../core/config.js';

const strategies = {
    density: new DensityStrategy(),
    clusters: new ClusterStrategy(),
    // Saved starts resample from their captured dims to whatever grid they're drawn on, so the
    // down-scaled preview grid below is just another resample target — no special preview path.
    saved: new SavedStrategy(),
};

// Same PRNG the worker uses, so a given (config, seed) previews like a real reset would look.
function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/** Down-scaled preview dimensions that preserve the live grid's aspect ratio. */
export function getPreviewDims(maxDim) {
    const realCols = Config.GRID_COLS || 2;
    const realRows = Config.GRID_ROWS || 2;
    const scale = Math.min(1, maxDim / Math.max(realCols, realRows));
    return {
        cols: Math.max(2, Math.round(realCols * scale)),
        rows: Math.max(2, Math.round(realRows * scale)),
        scale,
    };
}

/**
 * Generate a preview cell buffer for an initial-state config.
 * @returns {{state: Uint8Array, cols: number, rows: number}}
 */
export function generatePreviewState(initialState, maxDim = 160, seed = 1) {
    const { cols, rows, scale } = getPreviewDims(maxDim);
    const state = new Uint8Array(cols * rows);
    const mode = initialState?.mode || 'density';
    const strategy = strategies[mode] || strategies.density;

    const params = { ...(initialState?.params || {}) };
    // Cluster sizes are absolute (in cells), so scale them with the preview grid to stay faithful.
    if (mode === 'clusters' && scale < 1) {
        if (typeof params.diameter === 'number') params.diameter = Math.max(1, params.diameter * scale);
        if (typeof params.diameterVariation === 'number') params.diameterVariation *= scale;
    }

    const rng = mulberry32((seed >>> 0) || 1);
    strategy.generate(state, params, rng, { GRID_COLS: cols, GRID_ROWS: rows });
    return { state, cols, rows };
}

function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const v = h.length === 3
        ? h.split('').map(c => c + c).join('')
        : h;
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

/**
 * Render a preview of `initialState` into `canvas`. The canvas's intrinsic resolution is set to the
 * down-scaled grid; give it a display size via CSS (with `image-rendering: pixelated`).
 * @param {HTMLCanvasElement} canvas
 */
export function renderInitialStatePreview(canvas, initialState, {
    maxDim = 160,
    seed = 1,
    onColor = '#f0c674',
    offColor = '#16181d',
} = {}) {
    const { state, cols, rows } = generatePreviewState(initialState, maxDim, seed);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = cols;
    canvas.height = rows;

    const [orr, org, orb] = hexToRgb(onColor);
    const [ofr, ofg, ofb] = hexToRgb(offColor);
    const img = ctx.createImageData(cols, rows);
    const data = img.data;
    for (let i = 0; i < state.length; i++) {
        const on = state[i] === 1;
        const o = i * 4;
        data[o] = on ? orr : ofr;
        data[o + 1] = on ? org : ofg;
        data[o + 2] = on ? orb : ofb;
        data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
}
