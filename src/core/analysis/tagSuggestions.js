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
 * Named thresholds for {@link suggestScenarioFromStats}. Separate from {@link STATS_THRESHOLDS}
 * because the two vocabularies answer different questions: canonical tags are user-facing and may
 * overlap, corpus scenarios are a mutually exclusive protocol partition used for audit coverage.
 */
export const SCENARIO_THRESHOLDS = {
    /** `finalRatio` at/above this is a degenerate blanket ⇒ `saturation`. */
    saturatedRatio: 0.99,
    /** Change-per-tick fraction at/below this reads as nothing moving ⇒ `still_life`/`oscillator`. */
    frozenChangeFraction: 0.0002,
    /** Change-per-tick fraction at/below this is a slow simmer rather than churn ⇒ `slow_boiling`. */
    slowChangeFraction: 0.01,
    /** `blockEntropy.mean` at/above this reads as a disordered field ⇒ `distributed_churn`. */
    churnEntropy: 0.30,
    /** `transport.meanSpeed` at/above this is coherent translation ⇒ `glider`. */
    gliderTransport: 0.08,
    /** `changeOrder.mean` at/above this means change is clustered into fronts ⇒ `localized_change`. */
    localizedChangeOrder: 0.25,
    /** Coverage below which mobile structures are actually visible against the field. */
    sparseRatio: 0.60,
    /** `finalRatio − initialRatio` at/above this is real coverage growth ⇒ `structured_growth`. */
    growthDelta: 0.25,
    /** `spatialOrder.mean` at/above this makes that growth structured rather than noise. */
    growthSpatialOrder: 0.10,
};

/**
 * Classify already-computed behaviour metrics into one Corpus v1 scenario (#37 Stage 4B.2).
 *
 * Pure, model-free, and deliberately a single mutually exclusive answer: the protocol treats
 * scenarios as a partition (coverage counts per scenario, hard pairs are defined by scenario), so
 * unlike {@link suggestTagsFromStats} this never returns a list. The collection UI renders the
 * result as a *pre-selected* chip the owner accepts with one key or overrides with another — the
 * guess is never applied silently, and `confidence: 'low'` is the signal to make the owner look.
 *
 * Decision order runs most-decisive first, because several signals co-occur: a glider also shows a
 * high `changeOrder`, and structured growth also shows clustered change fronts. Each earlier branch
 * is the more specific claim.
 *
 * `changed.mean` is cells-changed-per-tick, so it needs a cell count to become a comparable
 * fraction. Pass `cellCount` explicitly, or let it be derived from `finalActiveCount / finalRatio`.
 * Without either, the activity-magnitude branches are skipped and the classifier leans on cycle,
 * transport, and entropy alone.
 *
 * @param {StatsMetrics & {
 *   changed?: {mean?: number},
 *   changeOrder?: {mean?: number},
 *   finalActiveCount?: number,
 *   cellCount?: number,
 *   initialRatio?: number,
 * }} metrics
 * @param {typeof SCENARIO_THRESHOLDS} [thresholds]
 * @returns {{scenario: string, confidence: 'high'|'low'}} A {@link module:core/analysis/corpusProtocol.CORPUS_SCENARIOS} id.
 */
export function suggestScenarioFromStats(metrics, thresholds = SCENARIO_THRESHOLDS) {
    if (!metrics || typeof metrics !== 'object') return { scenario: 'unknown', confidence: 'low' };
    const t = thresholds;

    const finalRatio = num(metrics.finalRatio);
    const entropy = num(metrics.blockEntropy?.mean);
    const transport = num(metrics.transport?.meanSpeed);
    const spatial = num(metrics.spatialOrder?.mean);
    const changeOrder = num(metrics.changeOrder?.mean);
    const changedMean = num(metrics.changed?.mean);

    // Terminal regimes first: both are protocol scenarios in their own right, and neither leaves
    // meaningful behaviour to classify underneath.
    if (metrics.extinct === true || finalRatio === 0) return { scenario: 'extinction', confidence: 'high' };
    if (metrics.saturated === true || (finalRatio != null && finalRatio >= t.saturatedRatio)) {
        return { scenario: 'saturation', confidence: 'high' };
    }

    // Cell count → change fraction. `finalActiveCount / finalRatio` recovers it exactly for any
    // non-degenerate run; the degenerate ones already returned above.
    const explicitCells = num(metrics.cellCount);
    const activeCount = num(metrics.finalActiveCount);
    const cellCount = explicitCells
        ?? (activeCount != null && finalRatio != null && finalRatio > 0 ? activeCount / finalRatio : null);
    const changeFraction = changedMean != null && cellCount != null && cellCount > 0
        ? changedMean / cellCount
        : null;

    const cyclePeriod = num(metrics.cyclic) ?? (metrics.cycle?.detected ? num(metrics.cycle?.period) : null);
    const inCycle = metrics.isInCycle === true || metrics.cycle?.detected === true || (cyclePeriod != null && cyclePeriod > 0);
    const periodicMotion = inCycle && (cyclePeriod == null || cyclePeriod > 1);

    // Frozen field: a still life, unless a >1 period says the few changing cells are an oscillator.
    // The threshold is loose enough that a lone blinker on a static field lands here, which is why
    // the cycle check has to run inside this branch rather than after it.
    if (changeFraction != null && changeFraction <= t.frozenChangeFraction) {
        return periodicMotion
            ? { scenario: 'oscillator', confidence: 'high' }
            : { scenario: 'still_life', confidence: 'high' };
    }
    if (periodicMotion) return { scenario: 'oscillator', confidence: 'high' };

    // Coherent translation on a field sparse enough to see it against.
    const sparseEnough = finalRatio == null || finalRatio < t.sparseRatio;
    if (transport != null && transport >= t.gliderTransport && sparseEnough) {
        return { scenario: 'glider', confidence: 'high' };
    }

    // Growth needs the starting coverage, which only the caller knows (the initial-state density it
    // seeded the world with). Requiring structure as well as delta keeps a noise blanket out.
    const initialRatio = num(metrics.initialRatio);
    if (initialRatio != null && finalRatio != null
        && finalRatio - initialRatio >= t.growthDelta
        && (spatial == null || spatial >= t.growthSpatialOrder)) {
        return { scenario: 'structured_growth', confidence: 'high' };
    }

    // Clustered change fronts. More specific than the activity-magnitude branches below, so it wins
    // over `slow_boiling` for a slow-but-localized front.
    if (changeOrder != null && changeOrder >= t.localizedChangeOrder) {
        return { scenario: 'localized_change', confidence: 'high' };
    }

    // Activity magnitude, now that shape-based reads are exhausted.
    if (changeFraction != null && changeFraction <= t.slowChangeFraction) {
        return { scenario: 'slow_boiling', confidence: 'high' };
    }
    if (entropy != null && entropy >= t.churnEntropy) {
        // Confident only when change really is spread out; otherwise churn is the best guess left.
        return { scenario: 'distributed_churn', confidence: changeFraction != null ? 'high' : 'low' };
    }

    return { scenario: 'other', confidence: 'low' };
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
