// @ts-check

/**
 * Phase 3 of the auto-explore roadmap: turn the raw per-burst metrics produced by
 * `RUN_EVALUATION` (see WorldWorker.finishEvaluation / EVALUATION_RESULT) into a single
 * "interestingness" score in [0, 1].
 *
 * This module is PURE: no worlds, proxies, EventBus, persistence, or globals. Every
 * weight/target lives in the exported {@link SCORE_CONFIG} so tuning is config churn,
 * not code churn. The score follows the "interesting ≈ near-critical" heuristic from the
 * roadmap design notes — a composite of cheap proxies (σ≈1 damage spreading, mid-band
 * block entropy, large activity fluctuations, rule-usage diversity) with hard kill signals
 * (extinct / saturated / frozen / short-cycle) collapsing the score to 0.
 *
 * We deliberately do NOT attempt to *prove* criticality (no power-law fitting); the goal is
 * a robust ranking that puts near-critical candidates above every degenerate regime. Tests
 * assert that ordering, not absolute values.
 */

/**
 * @typedef {object} ChangedStats
 * @property {number} mean     Mean changed-cell count per tick over the burst.
 * @property {number} variance Variance of the changed-cell count.
 * @property {number} fano     variance / mean (susceptibility proxy).
 * @property {number} cv       std / mean (coefficient of variation).
 */

/**
 * @typedef {object} BlockEntropyStats
 * @property {number} mean     Mean normalized hex block entropy ([0,1]) over the burst.
 * @property {number} variance Variance of the block-entropy samples (temporal).
 * @property {number} [spatialVariance] Mean over samples of the across-block surprisal variance
 *   (v2.1 spatial heterogeneity; absent on v1 metrics / old persisted entries).
 * @property {number} [samples] Optional raw sample count / array (unused by the score).
 */

/**
 * @typedef {object} SpatialOrderStats
 * @property {number} mean  Mean join-count spatial-order statistic over the burst (v2.1).
 *   ~0 = random mixing; deviation in either direction = spatial structure.
 * @property {number} last  Last sampled spatial-order value.
 */

/**
 * @typedef {object} TransportStats
 * @property {number} meanSpeed  Mean per-tick active-cell centroid drift speed (cells/tick) over the
 *   burst (v2.9 transport/mobility term). Coherent translation (gliders/spaceships) → high; a dense
 *   churn whose centroid stays pinned → ~0. Absent on v1/legacy metrics.
 */

/**
 * @typedef {object} EmbeddingStats
 * @property {number} openEndedness  Raw trajectory novelty (mean consecutive cosine distance) of a
 *   find's frame embeddings in a foundation-model (CLIP) space (v3.0 ASAL perceptual term). Present
 *   ONLY when the optional, default-off embedding objective is enabled AND a model produced ≥2 usable
 *   frame embeddings; absent otherwise (statistical objective ⇒ term dropped + renormalized, so the
 *   score is unchanged from the embedding-off pipeline).
 */

/**
 * Subset of an EVALUATION_RESULT that the score consumes. Extra fields are ignored.
 * @typedef {object} EvalMetrics
 * @property {number} [finalRatio]       Final active-cell ratio in [0,1].
 * @property {number} [finalActiveCount] Final active-cell count.
 * @property {number} [numCells]         Total cells (optional; derived from ratio if absent).
 * @property {ChangedStats} [changed]
 * @property {BlockEntropyStats} [blockEntropy]
 * @property {SpatialOrderStats} [spatialOrder] v2.1 spatial-order stats (absent on v1 metrics).
 * @property {TransportStats} [transport] v2.9 centroid-drift transport stats (absent on v1 metrics).
 * @property {EmbeddingStats} [embedding] v3.0 foundation-model perceptual stats (absent unless the
 *   optional embedding objective is enabled and a model produced a usable frame trajectory).
 * @property {number|null} [sigma]       Damage-spreading σ (1≈critical; null if no probe).
 * @property {Uint32Array|number[]} [ruleUsageDelta] 128-entry rule-usage delta over the burst.
 * @property {boolean} [extinct]
 * @property {boolean} [saturated]
 * @property {{detected: boolean, period: number}} [cycle]
 * @property {string} [icLabel]          Optional label of the initial condition that produced this.
 */

/**
 * @typedef {object} ComponentBreakdown
 * @property {number} criticality   σ-peaked term ([0,1]) — null σ marks it unused.
 * @property {number} entropyBand   Mid-band block-entropy term ([0,1]).
 * @property {number} fluctuation   Activity-fluctuation (CV) term ([0,1]).
 * @property {number} ruleDiversity Shannon diversity of rule usage ([0,1]).
 * @property {number} spatialStructure     Spatial-order deviation term ([0,1]) — 0 if unused (v2).
 * @property {number} spatialHeterogeneity Across-block surprisal-variance term ([0,1]) — 0 if unused (v2).
 * @property {number} temporalEntropyVariance Temporal block-entropy-variance term ([0,1]) — 0 if unused (v2.8).
 * @property {number} transport     Centroid-drift transport/mobility term ([0,1]) — 0 if unused (v2.9).
 * @property {number} openEndedness Foundation-model trajectory-novelty term ([0,1]) — 0 if unused (v3.0).
 * @property {boolean} criticalityUsed Whether σ was present and the criticality term counted.
 * @property {boolean} spatialUsed     Whether spatial metrics were present and counted (v2; UI shows n/a otherwise).
 * @property {boolean} temporalVarUsed Whether blockEntropy.variance was present and the temporal term counted (v2.8).
 * @property {boolean} transportUsed   Whether transport.meanSpeed was present and the transport term counted (v2.9).
 * @property {boolean} openEndednessUsed Whether an embedding trajectory was present and the perceptual term counted (v3.0).
 * @property {number} uniformFactor  Multiplicative uniform-chaos factor applied to the combined score
 *   (v3.1): 1 = no penalty, lower = high-coverage structureless churn. Not a weighted term.
 * @property {boolean} uniformUsed   Whether the uniform-chaos penalty could be evaluated (needs
 *   finalRatio + the v2.1 spatialOrder metric; false on legacy metrics ⇒ factor forced to 1).
 */

/**
 * Raw metric inputs behind each graded term, for UI explainers that plot the term's shape function
 * with a marker at the measured value (v3.1). Fields are null when the metric is absent.
 * @typedef {object} RawTermInputs
 * @property {number|null} sigma             Damage-spreading σ (criticality input).
 * @property {number|null} blockEntropyMean  Mean block entropy (entropyBand input).
 * @property {number|null} cv                Changed-count CV (fluctuation input).
 * @property {number|null} ruleDiversityNorm Normalized rule-usage Shannon entropy (ruleDiversity input).
 * @property {number|null} spatialOrderMean  Mean spatial-order statistic (spatialStructure input).
 * @property {number|null} spatialVariance   Across-block surprisal variance (spatialHeterogeneity input).
 * @property {number|null} temporalVariance  Temporal block-entropy variance (temporalEntropyVariance input).
 * @property {number|null} transportSpeed    Mean centroid drift speed (transport input).
 * @property {number|null} openEndedness     Raw trajectory novelty (openEndedness input).
 * @property {number|null} finalRatio        Final active-cell ratio (uniform-chaos penalty input).
 */

/**
 * @typedef {object} ICScore
 * @property {number} score                Interestingness of this single IC ([0,1]).
 * @property {ComponentBreakdown} components
 * @property {boolean} killed              True if a hard kill signal fired (score forced to 0).
 * @property {string|null} killReason      'extinct' | 'saturated' | 'frozen' | 'short-cycle' | null.
 * @property {string|null} icLabel
 * @property {RawTermInputs|null} raw      Raw metric inputs per term (v3.1; null on the kill path).
 */

/**
 * @typedef {object} CandidateScore
 * @property {number} score                Aggregated interestingness across the IC suite ([0,1]).
 * @property {ICScore[]} perIC             Per-IC breakdowns (input order preserved).
 * @property {ComponentBreakdown} perComponent Component breakdown of the winning IC (explains the score).
 * @property {number} winningIC            Index into perIC of the best-scoring IC.
 */

/**
 * All tunable weights and targets. Nothing else in this module hard-codes a magic number.
 */
export const SCORE_CONFIG = {
    // --- Hard kill signals (force the IC score to 0) ---
    /** cycle.period at or below this is degenerate terminal repetition (blinkers, fixed points). */
    shortCycleMaxPeriod: 4,
    /** Mean changed-cell count at or below this is a frozen / fixed-point state. */
    frozenChangedMean: 0.5,
    /** finalRatio at or above this is a saturated state (double-guards the worker's own flag). */
    saturatedRatio: 0.99,

    // --- Component weights (relative; renormalized internally — criticality dropped if σ absent,
    // the two spatial terms dropped if the v2.1 spatial metrics are absent, temporalEntropyVariance
    // dropped if blockEntropy.variance is absent) ---
    //
    // v2 rebalance (F1/F2/F4): the σ≈1 / mid-band-entropy / high-CV proxies CANNOT tell
    // homogeneous "churn" from a structured glider soup — both saturate those terms (measured in
    // tests/fixtures/exploreEvalFixtures.json: churn-sparse and gliders-chaos tie on criticality,
    // and churn actually *wins* entropyBand, fluctuation and ruleDiversity). The ONLY metric that
    // separates them is the spatial-order term, so it carries the most weight; fluctuation drops
    // (CV rewards a cycle's oscillation amplitude — F2). These weights are tuned so the gliders-chaos
    // fixture out-ranks the churn-sparse fixture by ≥0.10 (the central v2 regression).
    //
    // v2.8 (Wuensche discriminator): added `temporalEntropyVariance` — the variance of block entropy
    // OVER TIME. Wuensche (1999, "Classifying Cellular Automata Automatically") shows this is the
    // single strongest signal separating complex/glider rules from ordered and chaotic ones: ordered
    // rules settle to a low stable entropy, chaotic rules sit at a high stable entropy, and only
    // *complex* rules show large entropy *swings*. On the fixtures gliders-chaos has ~12× the temporal
    // variance of churn-sparse, so it reinforces spatialStructure (the v2 separator) rather than
    // fighting it. All weights were re-tuned together to make room; spatialStructure REMAINS the
    // dominant term (the v2 finding). NB: temporal-variance terms were historically down-weighted
    // because long cyclers inflate them (the `fluctuation` weight = 0.05 rationale, F2). This term is
    // only safe because the v2.4 confirmation burst hard-penalizes cyclers DOWNSTREAM
    // (confirmCycleMaxPeriod). Keep that ordering — never reintroduce temporal variance upstream of the
    // confirmation filter.
    //
    // v2.9 (direct transport): added `transport` — the mean per-tick active-cell centroid drift speed
    // (Kumar/ASAL-style mobility signal). Gliders/spaceships are the archetypal "interesting"
    // structures and were previously detected only indirectly (via spatialStructure); a translating
    // structure drifts the centroid steadily while a dense churn keeps it pinned, so this is a DIRECT
    // motion signal that reinforces spatialStructure rather than fighting it. The other seven weights
    // were scaled down proportionally to make room (spatialStructure stays dominant; their relative
    // proportions — and therefore the gliders-vs-churn fixture gap — are preserved). Like the spatial
    // and temporal terms it is dropped-and-renormalized for v1/legacy entries that predate it.
    //
    // v3.0 (perceptual interestingness, ASAL): added `openEndedness` — the temporal novelty of a
    // find's frames in a foundation-model (CLIP) embedding space (Kumar et al. 2024). It is an
    // OPTIONAL, default-off term: present only when the embedding objective is enabled AND a model
    // produced a usable frame trajectory, dropped-and-renormalized otherwise. CRITICALLY, its weight
    // is ADDED WITHOUT changing the other eight values, so when embeddings are off the term is absent
    // and the renormalized score is byte-identical to the statistical pipeline (the eight terms keep
    // their exact relative proportions — fixtures lacking it still rank gliders > churn unchanged).
    // It complements the statistical terms with a human-perception-aligned signal rather than
    // replacing them; it sits downstream of the v2.4 confirmation filter like every other graded term.
    weights: {
        criticality: 0.16,
        entropyBand: 0.07,
        fluctuation: 0.04,
        ruleDiversity: 0.07,
        spatialStructure: 0.31,
        spatialHeterogeneity: 0.11,
        temporalEntropyVariance: 0.13,
        transport: 0.11,
        openEndedness: 0.12,
    },

    // --- Criticality term: gaussian in ln(σ), peaked at σ=1 → exp(-(ln σ)² / 2τ²) ---
    criticalityTau: 0.6,

    // --- Entropy-band term: gaussian peaked at a mid-range target (maximal ≈ noise, not interesting) ---
    entropyTarget: 0.4,
    entropyTau: 0.18,

    // --- Fluctuation term: half-saturation reward on the changed-count CV (susceptibility proxy) ---
    /** CV value at which the fluctuation term reaches 0.5; higher CV asymptotes to 1. */
    fluctuationHalfSat: 0.3,

    // --- Rule-diversity term: Shannon entropy of the 128-bin usage delta, normalized to [0,1] ---
    /** Exponent applied to the normalized diversity (gamma); 1 = linear. */
    ruleDiversityGamma: 1,

    // --- Spatial terms (v2.1 metrics; half-saturation rewards in [0,1]) ---
    /** |spatialOrder.mean| at which the structure term reaches 0.5. Deviation in EITHER direction
     *  from random mixing (≈0) counts as structure. Tuned from the fixtures (gliders ≈0.23 vs churn ≈0.02). */
    spatialOrderHalfSat: 0.12,
    /** blockEntropy.spatialVariance at which the heterogeneity term reaches 0.5 (the [0,1]-entropy
     *  variance scale is small). */
    spatialVarHalfSat: 0.02,

    // --- Temporal entropy-variance term (v2.8 Wuensche discriminator; half-saturation reward) ---
    /** blockEntropy.variance (temporal — variance of the per-sample block entropy OVER the burst) at
     *  which the term reaches 0.5. The temporal-variance scale is an order of magnitude below the
     *  spatial one (a complex rule swings entropy by ~0.007 across samples vs ~0.16 across blocks). */
    temporalVarHalfSat: 0.005,

    // --- Transport / mobility term (v2.9 centroid drift; half-saturation reward) ---
    /** transport.meanSpeed (mean per-tick active-cell centroid drift, in cells/tick) at which the
     *  term reaches 0.5. A glider/spaceship soup drifts the centroid on the order of tenths of a cell
     *  per tick; a dense churn keeps it near zero, so a low half-sat keeps the term discriminating. */
    transportHalfSat: 0.1,

    // --- Open-endedness term (v3.0 ASAL perceptual novelty; half-saturation reward) ---
    /** embedding.openEndedness (mean consecutive cosine distance of a find's frame embeddings, in
     *  [0,2]) at which the term reaches 0.5. A still/settled pattern barely moves in CLIP space
     *  (≈0); an evolving/travelling one steps into visually-new territory each frame. A low half-sat
     *  keeps the term discriminating, since consecutive frames of even an active CA stay fairly
     *  similar in a vision-model embedding. */
    openEndednessHalfSat: 0.08,

    // --- Uniform-chaos penalty (v3.1): a MULTIPLICATIVE factor on the combined score, not a tenth
    // weighted term. Rationale (measured on tests/fixtures/exploreEvalFixtures.json): homogeneous
    // full-coverage churn maxes five of the nine graded terms (criticality≈1, entropyBand≈1,
    // fluctuation≈0.81, heterogeneity≈0.84), so churn_sparse_160 lands at ≈0.49 — ABOVE the 0.45
    // findThreshold — and floods the gallery whenever confirmation misses its cycle. A weighted
    // coverage term cannot fix this: drop-and-renormalize dilutes it (weight 0.12→0.20 only moves
    // churn to 0.448→0.425, within noise of the threshold). The multiplicative factor
    //   1 − strength · covFrac · (1 − spatialStructure),
    //   covFrac = clamp01((finalRatio − uniformCoverageMin) / (uniformCoverageMax − uniformCoverageMin))
    // is decisive instead: churn (coverage 0.917, structure 0.13) → ×0.566 → 0.28, while
    // gliders_chaos (coverage < 0.5) is untouched (factor 1) — the gliders−churn gap widens from
    // 0.20 to 0.41. Structure rescues legitimately dense rules by design (coverage 0.85 at
    // structure 0.6 → only ×0.8). Mirrors the confirmCyclePenalty pattern: an honest, surfaced,
    // user-tunable multiplier rather than silent rejection. Skipped (factor 1) when finalRatio or
    // the v2.1 spatialOrder metric is absent (legacy metrics).
    /** Penalty strength in [0,1]: 0 disables; 1 can zero a fully uniform blanket of chaos. */
    uniformPenaltyStrength: 0.5,
    /** finalRatio where the coverage ramp starts (below this the penalty is always 0). */
    uniformCoverageMin: 0.5,
    /** finalRatio where coverage counts as fully "blanketed" (covFrac saturates at 1). */
    uniformCoverageMax: 0.8,

    // --- Confirmation pass (v2.4 two-stage eval; consumed by applyConfirmation). The operational
    // copies live in AutoExploreService.EXPLORE_CONFIG and are passed through; these are the defaults
    // that keep the pure helper self-contained and unit-testable. ---
    /** A cycle of period ≤ this at confirmation is a (legitimate but degenerate) cycler → penalize+tag. */
    confirmCycleMaxPeriod: 120,
    /** Score multiplier applied to a confirmed cycler (honest labeling, not silent rejection). */
    confirmCyclePenalty: 0.25,

    // --- IC-suite aggregation: soft-max over per-IC scores (mostly best) + small mean (robustness) ---
    /** Soft-max temperature; lower → closer to the single best IC. */
    softmaxTemp: 0.15,
    /** Weight of the plain mean term (robustness bonus); the rest is the soft-max combine. */
    meanWeight: 0.2,
};

const LOG2_128 = Math.log2(128); // 7 — max Shannon entropy of a 128-bin distribution.

/**
 * Gaussian bump: exp(-(x - center)² / (2 τ²)), clamped to [0,1] (it already is).
 * @param {number} x
 * @param {number} center
 * @param {number} tau
 * @returns {number}
 */
function gaussian(x, center, tau) {
    if (tau <= 0) return x === center ? 1 : 0;
    const d = x - center;
    return Math.exp(-(d * d) / (2 * tau * tau));
}

/**
 * Shannon entropy of the rule-usage delta, normalized to [0,1] by log2(128).
 * An all-in-one-rule burst → 0; perfectly uniform over all 128 rules → 1.
 * @param {Uint32Array|number[]|undefined} delta
 * @returns {number}
 */
export function ruleUsageDiversity(delta) {
    if (!delta || delta.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < delta.length; i++) total += delta[i];
    if (total <= 0) return 0;
    let entropy = 0;
    for (let i = 0; i < delta.length; i++) {
        const p = delta[i] / total;
        if (p > 0) entropy -= p * Math.log2(p);
    }
    return Math.min(1, entropy / LOG2_128);
}

/**
 * Identify a hard kill signal, if any. Order matters only for the reported reason.
 * @param {EvalMetrics} m
 * @param {typeof SCORE_CONFIG} cfg
 * @returns {string|null}
 */
function detectKill(m, cfg) {
    if (m.extinct || m.finalActiveCount === 0) return 'extinct';
    if (m.saturated || (m.finalRatio ?? 0) >= cfg.saturatedRatio) return 'saturated';
    if (m.cycle && m.cycle.detected && m.cycle.period <= cfg.shortCycleMaxPeriod) return 'short-cycle';
    const changedMean = m.changed ? m.changed.mean : 0;
    if (changedMean <= cfg.frozenChangedMean) return 'frozen';
    return null;
}

/**
 * Score a single (ruleset × initial condition) burst.
 * @param {EvalMetrics} metrics
 * @param {typeof SCORE_CONFIG} [config]
 * @returns {ICScore}
 */
export function scoreSingleIC(metrics, config = SCORE_CONFIG) {
    const cfg = config;
    const icLabel = metrics.icLabel ?? null;

    const killReason = detectKill(metrics, cfg);
    if (killReason) {
        return {
            score: 0,
            components: {
                criticality: 0,
                entropyBand: 0,
                fluctuation: 0,
                ruleDiversity: 0,
                spatialStructure: 0,
                spatialHeterogeneity: 0,
                temporalEntropyVariance: 0,
                transport: 0,
                openEndedness: 0,
                criticalityUsed: false,
                spatialUsed: false,
                temporalVarUsed: false,
                transportUsed: false,
                openEndednessUsed: false,
                uniformFactor: 1,
                uniformUsed: false,
            },
            killed: true,
            killReason,
            icLabel,
            raw: null,
        };
    }

    // --- Criticality (σ peaked at 1, gaussian in ln σ). Absent/0/∞ σ → 0; null → unused. ---
    const sigma = metrics.sigma;
    const criticalityUsed = sigma != null && Number.isFinite(sigma) && sigma > 0;
    const criticality = criticalityUsed
        ? gaussian(Math.log(/** @type {number} */(sigma)), 0, cfg.criticalityTau)
        : 0;

    // --- Entropy band (mid-range block entropy). ---
    const be = metrics.blockEntropy ? metrics.blockEntropy.mean : 0;
    const entropyBand = gaussian(be, cfg.entropyTarget, cfg.entropyTau);

    // --- Fluctuation (changed-count CV → half-saturation reward). ---
    const cv = metrics.changed ? metrics.changed.cv : 0;
    const fluctuation = cv > 0 ? cv / (cv + cfg.fluctuationHalfSat) : 0;

    // --- Rule diversity (Shannon entropy of the usage delta). ---
    const ruleDiversity = Math.pow(ruleUsageDiversity(metrics.ruleUsageDelta), cfg.ruleDiversityGamma);

    // --- Spatial structure (join-count deviation from random mixing, EITHER direction). v2.1. ---
    const soMean = metrics.spatialOrder != null ? metrics.spatialOrder.mean : undefined;
    const hasSpatialOrder = soMean != null && Number.isFinite(soMean);
    const soMag = hasSpatialOrder ? Math.abs(soMean) : 0;
    const spatialStructure = hasSpatialOrder ? soMag / (soMag + cfg.spatialOrderHalfSat) : 0;

    // --- Spatial heterogeneity (across-block surprisal variance). v2.1. ---
    const sv = metrics.blockEntropy ? metrics.blockEntropy.spatialVariance : undefined;
    const hasSpatialVar = sv != null && Number.isFinite(sv);
    const spatialHeterogeneity = hasSpatialVar ? sv / (sv + cfg.spatialVarHalfSat) : 0;
    const spatialUsed = hasSpatialOrder || hasSpatialVar;

    // --- Temporal entropy variance (Wuensche complex-rule discriminator). v2.8. ---
    // The variance of block entropy OVER TIME across the burst's samples — large for complex rules
    // that swing between order and disorder, small for both ordered (low stable) and chaotic (high
    // stable) rules. Safe ONLY because the v2.4 confirmation burst hard-penalizes cyclers downstream
    // (cyclers also inflate this); never move it upstream of that filter. Absent on v1/legacy metrics.
    const tv = metrics.blockEntropy ? metrics.blockEntropy.variance : undefined;
    const hasTemporalVar = tv != null && Number.isFinite(tv);
    const temporalEntropyVariance = hasTemporalVar ? tv / (tv + cfg.temporalVarHalfSat) : 0;

    // --- Transport / mobility (active-cell centroid drift speed). v2.9. ---
    // The mean per-tick drift of the active-cell centroid: a DIRECT signal for coherently translating
    // structures (gliders/spaceships), which a dense homogeneous churn — whose centroid stays pinned —
    // lacks. Half-saturation reward. Absent on v1/legacy metrics → dropped + renormalized below.
    const tp = metrics.transport ? metrics.transport.meanSpeed : undefined;
    const hasTransport = tp != null && Number.isFinite(tp);
    const transport = hasTransport ? tp / (tp + cfg.transportHalfSat) : 0;

    // --- Open-endedness / perceptual novelty (foundation-model trajectory novelty). v3.0 (ASAL). ---
    // The mean cosine distance between consecutive frame embeddings in a CLIP-style space: a DIRECT,
    // human-perception-aligned signal for "the look keeps evolving". Present only when the optional
    // embedding objective is enabled and a model produced a usable trajectory; absent otherwise →
    // dropped + renormalized below, so the embedding-off score is unchanged. Half-saturation reward.
    const oe = metrics.embedding ? metrics.embedding.openEndedness : undefined;
    const hasOpenEndedness = oe != null && Number.isFinite(oe);
    const openEndedness = hasOpenEndedness ? oe / (oe + cfg.openEndednessHalfSat) : 0;

    // Weighted combine; drop a weight (and renormalize) when its input is unavailable so a burst is
    // judged on the terms it has rather than penalized: criticality when σ is null, the two spatial
    // terms when the v2.1 metrics are absent, the temporal-variance term when blockEntropy.variance
    // is absent, and the transport term when transport.meanSpeed is absent (v1 metrics / old entries).
    const w = cfg.weights;
    let num = entropyBand * w.entropyBand + fluctuation * w.fluctuation + ruleDiversity * w.ruleDiversity;
    let den = w.entropyBand + w.fluctuation + w.ruleDiversity;
    if (criticalityUsed) {
        num += criticality * w.criticality;
        den += w.criticality;
    }
    if (hasSpatialOrder) {
        num += spatialStructure * w.spatialStructure;
        den += w.spatialStructure;
    }
    if (hasSpatialVar) {
        num += spatialHeterogeneity * w.spatialHeterogeneity;
        den += w.spatialHeterogeneity;
    }
    if (hasTemporalVar) {
        num += temporalEntropyVariance * w.temporalEntropyVariance;
        den += w.temporalEntropyVariance;
    }
    if (hasTransport) {
        num += transport * w.transport;
        den += w.transport;
    }
    if (hasOpenEndedness) {
        num += openEndedness * w.openEndedness;
        den += w.openEndedness;
    }
    // --- Uniform-chaos penalty (v3.1): multiplicative suppression of high-coverage structureless
    // churn — see the SCORE_CONFIG rationale. Needs finalRatio AND the v2.1 spatialOrder metric
    // (the structure term is what rescues dense-but-structured rules); factor 1 otherwise.
    const uniformUsed = hasSpatialOrder && Number.isFinite(metrics.finalRatio);
    let uniformFactor = 1;
    if (uniformUsed && cfg.uniformPenaltyStrength > 0) {
        const covSpan = cfg.uniformCoverageMax - cfg.uniformCoverageMin;
        const covFrac = covSpan > 0
            ? Math.min(1, Math.max(0, (/** @type {number} */(metrics.finalRatio) - cfg.uniformCoverageMin) / covSpan))
            : (/** @type {number} */(metrics.finalRatio) >= cfg.uniformCoverageMax ? 1 : 0);
        uniformFactor = 1 - cfg.uniformPenaltyStrength * covFrac * (1 - spatialStructure);
    }

    const score = den > 0 ? (num / den) * uniformFactor : 0;

    return {
        score,
        components: {
            criticality, entropyBand, fluctuation, ruleDiversity,
            spatialStructure, spatialHeterogeneity, temporalEntropyVariance, transport, openEndedness,
            criticalityUsed, spatialUsed, temporalVarUsed: hasTemporalVar, transportUsed: hasTransport,
            openEndednessUsed: hasOpenEndedness,
            uniformFactor, uniformUsed,
        },
        killed: false,
        killReason: null,
        icLabel,
        raw: {
            sigma: criticalityUsed ? /** @type {number} */(sigma) : null,
            blockEntropyMean: metrics.blockEntropy ? be : null,
            cv: metrics.changed ? cv : null,
            ruleDiversityNorm: metrics.ruleUsageDelta ? ruleUsageDiversity(metrics.ruleUsageDelta) : null,
            spatialOrderMean: hasSpatialOrder ? /** @type {number} */(soMean) : null,
            spatialVariance: hasSpatialVar ? /** @type {number} */(sv) : null,
            temporalVariance: hasTemporalVar ? /** @type {number} */(tv) : null,
            transportSpeed: hasTransport ? /** @type {number} */(tp) : null,
            openEndedness: hasOpenEndedness ? /** @type {number} */(oe) : null,
            finalRatio: Number.isFinite(metrics.finalRatio) ? /** @type {number} */(metrics.finalRatio) : null,
        },
    };
}

/**
 * Aggregate a candidate's per-IC scores into one headline score.
 *
 * Combine is "mostly the best IC, small robustness bonus": a soft-max over the per-IC scores
 * (temperature {@link SCORE_CONFIG.softmaxTemp}) blended with the plain mean
 * ({@link SCORE_CONFIG.meanWeight}). A gallery find should reproduce the *best* IC, so the
 * returned `winningIC`/`perComponent` always describe the single highest-scoring IC.
 *
 * @param {EvalMetrics[]} metricsPerIC Per-IC eval metrics (the IC suite). Order is preserved.
 * @param {typeof SCORE_CONFIG} [config]
 * @returns {CandidateScore}
 */
export function scoreCandidate(metricsPerIC, config = SCORE_CONFIG) {
    const cfg = config;
    const perIC = (metricsPerIC || []).map((m) => scoreSingleIC(m, cfg));

    if (perIC.length === 0) {
        return {
            score: 0,
            perIC: [],
            perComponent: {
                criticality: 0, entropyBand: 0, fluctuation: 0, ruleDiversity: 0,
                spatialStructure: 0, spatialHeterogeneity: 0, temporalEntropyVariance: 0, transport: 0,
                openEndedness: 0,
                criticalityUsed: false, spatialUsed: false, temporalVarUsed: false, transportUsed: false,
                openEndednessUsed: false,
                uniformFactor: 1, uniformUsed: false,
            },
            winningIC: -1,
        };
    }

    // Winning IC = highest single-IC score (ties → first).
    let winningIC = 0;
    for (let i = 1; i < perIC.length; i++) {
        if (perIC[i].score > perIC[winningIC].score) winningIC = i;
    }

    const scores = perIC.map((r) => r.score);
    const n = scores.length;
    const mean = scores.reduce((a, b) => a + b, 0) / n;

    // Soft-max-weighted combine of the per-IC scores (shifted by max for numerical stability).
    const maxScore = Math.max(...scores);
    const t = cfg.softmaxTemp > 0 ? cfg.softmaxTemp : 1e-9;
    let wSum = 0;
    let weighted = 0;
    for (const s of scores) {
        const wgt = Math.exp((s - maxScore) / t);
        wSum += wgt;
        weighted += wgt * s;
    }
    const softmaxCombine = wSum > 0 ? weighted / wSum : maxScore;

    const score = (1 - cfg.meanWeight) * softmaxCombine + cfg.meanWeight * mean;

    return {
        score,
        perIC,
        perComponent: perIC[winningIC].components,
        winningIC,
    };
}

/**
 * @typedef {object} ConfirmationResult
 * @property {number} finalScore  The score to bank for this find (confirmation-based).
 * @property {number|null} cyclic  Detected cycle period if the find is a (penalized) cycler, else null.
 * @property {boolean} rejected   True if the confirmation burst killed the find (don't bank it).
 */

/**
 * Phase v2.4: reconcile a cheap *screening* score with an expensive *confirmation* burst on the same
 * world / IC / seed. The confirmation burst runs far longer (EXPLORE_CONFIG.confirmTicks) so it can
 * see long-horizon outcomes the 160-tick screen can't (F2): a find that quietly dies, saturates,
 * freezes, or settles into a long cycle by tick ~600.
 *
 * Honest labeling over silent rejection (design principle 3): a hard kill at confirmation rejects the
 * find outright, but a *long* cycle (period in (shortCycleMaxPeriod, confirmCycleMaxPeriod]) is a
 * legitimate category — it is tagged `cyclic` and its score is multiplied by `confirmCyclePenalty`
 * rather than discarded.
 *
 * Pure and side-effect-free (unit-testable without workers).
 *
 * @param {number} screenScore               The cheap screening score (kept for context/telemetry).
 * @param {ICScore} confirmICScore           scoreSingleIC() applied to the confirmation metrics.
 * @param {EvalMetrics} confirmMetrics        The raw confirmation-burst metrics (for the cycle period).
 * @param {typeof SCORE_CONFIG} [config]
 * @returns {ConfirmationResult}
 */
export function applyConfirmation(screenScore, confirmICScore, confirmMetrics, config = SCORE_CONFIG) {
    const cfg = config;
    // A hard kill at confirmation (extinct / saturated / frozen / short-cycle) ⇒ the find did not
    // survive a long burst; reject it (never banked).
    if (!confirmICScore || confirmICScore.killed) {
        return { finalScore: 0, cyclic: null, rejected: true };
    }

    const cycle = confirmMetrics ? confirmMetrics.cycle : null;
    if (cycle && cycle.detected && cycle.period <= cfg.confirmCycleMaxPeriod) {
        // A real, longer cycle (the short ones are already hard-killed above): legitimate but degenerate.
        return {
            finalScore: confirmICScore.score * cfg.confirmCyclePenalty,
            cyclic: cycle.period,
            rejected: false,
        };
    }

    return { finalScore: confirmICScore.score, cyclic: null, rejected: false };
}
