// @ts-check

/**
 * Named initial-condition presets and per-mode defaults for the generative initial-state modes.
 *
 * Extracted from `InitialStateConfigModal` so non-UI callers (the Corpus Lab collector, tests) can
 * build a valid `initialState` without importing the dialog. **The param bundles are byte-frozen:**
 * they identify initial conditions in Corpus v1 headers via `initialConditionId`, and the modal's
 * preset-chip highlighting compares them by exact value. Adding a preset is safe; editing an
 * existing one silently re-points every clip already collected under that identity.
 *
 * Unrelated to `Config.DEFAULT_INITIAL_DENSITIES`, which is frozen for a different reason (share
 * links omit it when it matches).
 */

/**
 * @typedef {object} InitialStatePreset
 * @property {'density'|'clusters'} mode
 * @property {string} name
 * @property {Record<string, any>} params
 */

/**
 * Cluster-mode presets. Each is a full param bundle; picking one fills every slider.
 *
 * Every preset carries its own `mode` so that any single preset object is self-describing —
 * {@link initialStateFromPreset} needs the mode to pick the right defaults, and an untagged bundle
 * would be silently merged as a density state instead. The modal reads only `name` and `params`.
 *
 * @type {InitialStatePreset[]}
 */
export const CLUSTER_PRESETS = [
    { mode: 'clusters', name: 'Scattered', params: { count: 35, density: 0.6, densityVariation: 0.2, diameter: 6, diameterVariation: 3, eccentricity: 0.2, orientation: 0, orientationVariation: 1.0, gaussianStdDev: 2.5 } },
    { mode: 'clusters', name: 'Islands', params: { count: 12, density: 0.75, densityVariation: 0.15, diameter: 18, diameterVariation: 6, eccentricity: 0.3, orientation: 0, orientationVariation: 1.0, gaussianStdDev: 2.0 } },
    { mode: 'clusters', name: 'Big blobs', params: { count: 5, density: 0.8, densityVariation: 0.1, diameter: 42, diameterVariation: 10, eccentricity: 0.2, orientation: 0, orientationVariation: 1.0, gaussianStdDev: 1.6 } },
    { mode: 'clusters', name: 'Streaks', params: { count: 14, density: 0.7, densityVariation: 0.2, diameter: 24, diameterVariation: 8, eccentricity: 0.82, orientation: 30, orientationVariation: 0.6, gaussianStdDev: 2.6 } },
];

/**
 * Density-mode presets. `Single seed` (density 1) is the documented degenerate case: it places one
 * opposite seed cell in the center, so it reliably produces extinction/saturation runs.
 *
 * @type {InitialStatePreset[]}
 */
export const DENSITY_PRESETS = [
    { mode: 'density', name: 'Sparse', params: { density: 0.15 } },
    { mode: 'density', name: 'Balanced', params: { density: 0.5 } },
    { mode: 'density', name: 'Dense', params: { density: 0.85 } },
    { mode: 'density', name: 'Single seed', params: { density: 1 } },
];

/**
 * Per-mode default params. A preset bundle is merged *over* these, which is how cluster presets
 * acquire `distribution: 'gaussian'` — they deliberately omit it. Saved starts carry a captured
 * payload rather than defaults, so an empty selection means nothing is chosen yet.
 */
export const DEFAULT_PARAMS = {
    density: { density: 0.5 },
    clusters: { count: 25, density: 0.7, densityVariation: 0.2, diameter: 10, diameterVariation: 5, eccentricity: 0.33, orientation: 0, orientationVariation: 1.0, distribution: 'gaussian', gaussianStdDev: 2.0 },
    saved: {},
};

/**
 * Every generative preset as one flat draw pool for automated collection.
 * @type {InitialStatePreset[]}
 */
export const GENERATIVE_PRESETS = [...DENSITY_PRESETS, ...CLUSTER_PRESETS];

/**
 * Build the `initialState` a world setting expects from a named preset, applying the same
 * defaults-then-preset merge the modal performs — which is how a cluster bundle acquires
 * `distribution: 'gaussian'`.
 *
 * Throws on an unrecognized mode rather than defaulting: a cluster bundle silently merged against
 * the density defaults yields a `density`-mode state carrying cluster params, which the worker would
 * accept and quietly render as the wrong initial condition.
 *
 * @param {Partial<InitialStatePreset>|null} preset
 * @returns {{mode: 'density'|'clusters', params: Record<string, any>}}
 */
export function initialStateFromPreset(preset) {
    const mode = preset?.mode;
    if (mode !== 'density' && mode !== 'clusters') {
        throw new Error(`initialStateFromPreset: preset "${preset?.name ?? '?'}" has no generative mode.`);
    }
    return { mode, params: { ...DEFAULT_PARAMS[mode], ...(preset?.params || {}) } };
}
