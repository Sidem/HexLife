// @ts-check

/**
 * User-facing scoring configuration for the auto-explore objective (v3.1).
 *
 * PURE module (no UI, EventBus, persistence): the single source of truth for
 *  - the user-tunable subset of {@link SCORE_CONFIG} (the nine term weights, the uniform-chaos
 *    penalty strength, the find threshold), expressed in UI units (integer percent sliders),
 *  - the named presets the Scoring panel offers,
 *  - sanitization of untrusted scoring blobs (persisted settings, share-link `xc` payloads),
 *  - the translation into a real score config consumed by scoreSingleIC/scoreCandidate.
 *
 * Weights are RELATIVE (the combine renormalizes over the present terms), so only their ratios
 * matter — 0–100 integer sliders are exactly as expressive as the fractional SCORE_CONFIG values.
 */

import { SCORE_CONFIG } from './InterestingnessScore.js';

/** The nine graded terms, in canonical display order (matches the UI component bars). */
export const WEIGHT_KEYS = /** @type {const} */ ([
    'criticality',
    'entropyBand',
    'fluctuation',
    'ruleDiversity',
    'spatialStructure',
    'spatialHeterogeneity',
    'temporalEntropyVariance',
    'transport',
    'openEndedness',
]);

/**
 * @typedef {object} ScoringSettings
 * @property {Record<string, number>} weights Integer percent (0–100) per WEIGHT_KEYS entry; relative.
 * @property {number} uniformPenaltyPct Uniform-chaos penalty strength as integer percent (0–100).
 * @property {number} findThreshold Screening score a candidate must reach to be confirmed/banked.
 */

/** Default weights in slider units, derived from SCORE_CONFIG so the two can never drift. */
export const DEFAULT_WEIGHTS_PCT = Object.freeze(Object.fromEntries(
    WEIGHT_KEYS.map((k) => [k, Math.round(SCORE_CONFIG.weights[k] * 100)])
));

export const DEFAULT_UNIFORM_PENALTY_PCT = Math.round(SCORE_CONFIG.uniformPenaltyStrength * 100);

/** Mirrors EXPLORE_CONFIG.findThreshold (drift-guarded in tests/scoringPresets.test.js). */
export const DEFAULT_FIND_THRESHOLD = 0.45;

/** Clamp bounds for the advanced find-threshold slider. */
export const FIND_THRESHOLD_MIN = 0.2;
export const FIND_THRESHOLD_MAX = 0.8;

/**
 * Named scoring presets. `default` must stay byte-equal to the derived defaults (drift-guarded).
 * The others re-balance the same nine weights toward a teaching goal; none of them touches
 * findThreshold (that stays whatever the user set).
 * @type {Record<string, {label: string, description: string, weights: Record<string, number>, uniformPenaltyPct: number}>}
 */
export const SCORING_PRESETS = {
    default: {
        label: 'Default (balanced)',
        description: 'The tuned all-round objective: structure-led, with every signal contributing.',
        weights: { ...DEFAULT_WEIGHTS_PCT },
        uniformPenaltyPct: DEFAULT_UNIFORM_PENALTY_PCT,
    },
    gliders: {
        label: 'Gliders & Ships',
        description: 'Hunts coherently moving structures: spatial order and centroid transport dominate; chaos is penalized hard.',
        weights: {
            criticality: 5, entropyBand: 4, fluctuation: 2, ruleDiversity: 4,
            spatialStructure: 30, spatialHeterogeneity: 5, temporalEntropyVariance: 15,
            transport: 30, openEndedness: 5,
        },
        uniformPenaltyPct: 70,
    },
    edge: {
        label: 'Edge of Chaos',
        description: 'Hunts near-critical dynamics: σ≈1 damage spreading and mid-band entropy lead; denser worlds are tolerated.',
        weights: {
            criticality: 30, entropyBand: 20, fluctuation: 15, ruleDiversity: 10,
            spatialStructure: 10, spatialHeterogeneity: 5, temporalEntropyVariance: 5,
            transport: 2, openEndedness: 3,
        },
        uniformPenaltyPct: 30,
    },
    novelty: {
        label: 'Maximal Novelty',
        description: 'Leans on the perceptual (CLIP) open-endedness signal: worlds whose look keeps evolving. Best with the embedding objective enabled.',
        weights: {
            criticality: 4, entropyBand: 2, fluctuation: 2, ruleDiversity: 2,
            spatialStructure: 15, spatialHeterogeneity: 15, temporalEntropyVariance: 10,
            transport: 10, openEndedness: 40,
        },
        uniformPenaltyPct: 50,
    },
};

/**
 * @param {unknown} v
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(v, min, max, fallback) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

/**
 * Sanitize an untrusted scoring blob (persisted setting, share-link `xc` payload, caller options)
 * into a complete, in-range {@link ScoringSettings}. Unknown fields are dropped, missing/invalid
 * fields fall back to defaults, and an all-zero weight set (which would make every candidate score
 * 0 and bank nothing) falls back to the default weights wholesale.
 * @param {unknown} input
 * @returns {ScoringSettings}
 */
export function sanitizeScoring(input) {
    const obj = (input && typeof input === 'object') ? /** @type {Record<string, any>} */ (input) : {};
    const rawWeights = (obj.weights && typeof obj.weights === 'object') ? obj.weights : {};
    /** @type {Record<string, number>} */
    const weights = {};
    for (const k of WEIGHT_KEYS) {
        weights[k] = clampInt(rawWeights[k], 0, 100, DEFAULT_WEIGHTS_PCT[k]);
    }
    if (WEIGHT_KEYS.every((k) => weights[k] === 0)) {
        Object.assign(weights, DEFAULT_WEIGHTS_PCT);
    }
    const uniformPenaltyPct = clampInt(obj.uniformPenaltyPct, 0, 100, DEFAULT_UNIFORM_PENALTY_PCT);
    let findThreshold = Number(obj.findThreshold);
    if (!Number.isFinite(findThreshold)) findThreshold = DEFAULT_FIND_THRESHOLD;
    findThreshold = Math.min(FIND_THRESHOLD_MAX, Math.max(FIND_THRESHOLD_MIN, findThreshold));
    return { weights, uniformPenaltyPct, findThreshold };
}

/**
 * Translate sanitized scoring settings into a full score config for
 * scoreSingleIC/scoreCandidate/applyConfirmation. Absolute weight scale is irrelevant
 * (the combine renormalizes), so percent units pass straight through ÷100.
 * @param {ScoringSettings} scoring Must already be sanitized.
 * @returns {typeof SCORE_CONFIG}
 */
export function buildScoreConfig(scoring) {
    const weights = /** @type {typeof SCORE_CONFIG.weights} */ (Object.fromEntries(
        WEIGHT_KEYS.map((k) => [k, scoring.weights[k] / 100])
    ));
    return {
        ...SCORE_CONFIG,
        weights,
        uniformPenaltyStrength: scoring.uniformPenaltyPct / 100,
    };
}

/**
 * Match scoring settings against the presets (weights + penalty; findThreshold is not
 * preset-owned). Returns the preset key or 'custom'.
 * @param {ScoringSettings} scoring
 * @returns {string}
 */
export function detectPreset(scoring) {
    for (const [key, preset] of Object.entries(SCORING_PRESETS)) {
        if (preset.uniformPenaltyPct !== scoring.uniformPenaltyPct) continue;
        if (WEIGHT_KEYS.every((k) => preset.weights[k] === scoring.weights[k])) return key;
    }
    return 'custom';
}

/**
 * True when the settings are exactly the defaults (used to keep share links short: the
 * search descriptor omits default scoring).
 * @param {ScoringSettings} scoring
 * @returns {boolean}
 */
export function isDefaultScoring(scoring) {
    return detectPreset(scoring) === 'default' && scoring.findThreshold === DEFAULT_FIND_THRESHOLD;
}
