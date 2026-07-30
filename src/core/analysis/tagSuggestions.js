// @ts-check

/**
 * Tag suggestion engine (roadmap #13, PLAY-LAYER-PLAN §T3/§T4).
 *
 * The pure statistical source maps already-computed behavior metrics to canonical tags via named
 * thresholds. {@link mergeSuggestions} combines caller-provided suggestion lists without coupling
 * this module to a model.
 *
 * Every canonical id these emit exists in {@link module:core/tags.CANONICAL_TAGS}. Suggestions are
 * one-tap accept, never auto-applied (§T4 merge rule) — the caller renders them as a "Suggested" row.
 *
 * No DOM / EventBus / persistence / globals here, so the rules are fixture-testable.
 */

/** Maximum suggestions surfaced at once (§T2/§T3: "top 3–4"). */
export const MAX_SUGGESTIONS = 4;

/**
 * Named thresholds for the stats heuristic. Tuned against tests/fixtures/exploreEvalFixtures.json
 * (the same reference finds the interestingness score is calibrated on) — see tagSuggestions.test.js.
 */
export const STATS_THRESHOLDS = {
    /** blockEntropy.mean at/above this reads as high-entropy churn ⇒ `chaos`. */
    chaosEntropy: 0.35,
    /** blockEntropy.mean at/below this reads as near-frozen order ⇒ `still-life`/`mosaic`. */
    orderEntropy: 0.12,
    /** finalRatio at/above this reads as coverage having grown to blanket the grid ⇒ `growth`. */
    growthRatio: 0.6,
    /** finalRatio at/below this reads as a sparse field (mobile structures show against it). */
    sparseRatio: 0.2,
    /** finalRatio at/above this is a degenerate saturated blanket — suppress behaviour tags. */
    saturatedRatio: 0.99,
    /** transport.meanSpeed at/above this is coherent translation ⇒ `gliders`/`ships`. */
    mobilityTransport: 0.08,
    /** |spatialOrder.mean| at/above this is structured (non-random) layout ⇒ mobile structures. */
    mobilitySpatial: 0.12,
};

/**
 * Flexible metrics shape accepted by {@link suggestTagsFromStats}. Every field is optional so both the
 * gallery entry's persisted `metrics` (finalRatio / blockEntropy / transport / sigma + a `cyclic`
 * period) AND a raw EVALUATION_RESULT (adds `spatialOrder`, `cycle`, `extinct`) work unchanged.
 * @typedef {object} StatsMetrics
 * @property {number} [finalRatio]
 * @property {{mean?: number, variance?: number}} [blockEntropy]
 * @property {{meanSpeed?: number}} [transport]
 * @property {{mean?: number}} [spatialOrder]
 * @property {number|null} [sigma]
 * @property {number|null} [cyclic]        Detected cycle period (gallery-entry shape), or null.
 * @property {boolean} [isInCycle]         Explicit cycle flag (alternative to `cyclic`).
 * @property {{detected?: boolean, period?: number}} [cycle] Raw EVALUATION_RESULT cycle shape.
 * @property {boolean} [extinct]
 * @property {boolean} [saturated]
 */

/**
 * Read a number, returning null when absent/non-finite.
 * @param {*} v
 * @returns {number|null}
 */
function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Map already-computed behaviour metrics to canonical tag ids (§T4). Always available (no model).
 * Ordered by confidence: motion/oscillation first, then coverage regime, then texture. Deduped.
 *
 * @param {StatsMetrics} metrics
 * @param {typeof STATS_THRESHOLDS} [thresholds]
 * @returns {string[]} Canonical tag ids (may be empty), most-confident first, capped at {@link MAX_SUGGESTIONS}.
 */
export function suggestTagsFromStats(metrics, thresholds = STATS_THRESHOLDS) {
    if (!metrics || typeof metrics !== 'object') return [];
    const t = thresholds;
    /** @type {string[]} */
    const out = [];
    /** @param {string} id */
    const add = (id) => { if (!out.includes(id)) out.push(id); };

    const finalRatio = num(metrics.finalRatio);
    const entropy = num(metrics.blockEntropy?.mean);
    const transport = num(metrics.transport?.meanSpeed);
    const spatial = num(metrics.spatialOrder?.mean);
    const extinct = metrics.extinct === true || metrics.finalRatio === 0;
    const saturated = metrics.saturated === true || (finalRatio != null && finalRatio >= t.saturatedRatio);

    // Extinction / saturation are terminal regimes: one honest tag, no behaviour noise on top.
    if (extinct) return ['decay'];
    if (saturated) return [];

    // Cycle detected (long or short) ⇒ oscillators. Accept any of the three metric shapes.
    const cyclePeriod = num(metrics.cyclic) ?? (metrics.cycle?.detected ? num(metrics.cycle?.period) : null);
    const isInCycle = metrics.isInCycle === true || (cyclePeriod != null && cyclePeriod > 0);
    if (isInCycle) add('oscillators');

    // Mobility: a translating structure drifts the centroid (transport) and/or sits in a structured,
    // non-random layout (spatialOrder magnitude) on an un-blanketed field ⇒ gliders/ships.
    const hasMobility =
        (transport != null && transport >= t.mobilityTransport) ||
        (spatial != null && Math.abs(spatial) >= t.mobilitySpatial);
    const sparseEnough = finalRatio == null || finalRatio < t.growthRatio;
    if (hasMobility && sparseEnough) {
        add('gliders');
        add('ships');
    }

    // Coverage regime.
    if (finalRatio != null && finalRatio >= t.growthRatio) add('growth');

    // Texture from entropy — only when NOT already explained by mobile structure (a glider soup can
    // read low-entropy without being a still life).
    if (entropy != null) {
        if (entropy >= t.chaosEntropy) add('chaos');
        else if (entropy <= t.orderEntropy && !hasMobility) {
            add('still-life');
            add('mosaic');
        }
    }

    return out.slice(0, MAX_SUGGESTIONS);
}

/**
 * Merge two suggestion sources, deduped, order-preserving, and capped.
 * @param {string[]} primarySuggestions
 * @param {string[]} fallbackSuggestions
 * @param {number} [max]
 * @returns {string[]}
 */
export function mergeSuggestions(primarySuggestions, fallbackSuggestions, max = MAX_SUGGESTIONS) {
    /** @type {string[]} */
    const out = [];
    for (const id of [...(primarySuggestions || []), ...(fallbackSuggestions || [])]) {
        if (id && !out.includes(id)) out.push(id);
        if (out.length >= max) break;
    }
    return out;
}
