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
 * @property {number} variance Variance of the block-entropy samples.
 * @property {number} [samples] Optional raw sample count / array (unused by the score).
 */

/**
 * Subset of an EVALUATION_RESULT that the score consumes. Extra fields are ignored.
 * @typedef {object} EvalMetrics
 * @property {number} [finalRatio]       Final active-cell ratio in [0,1].
 * @property {number} [finalActiveCount] Final active-cell count.
 * @property {number} [numCells]         Total cells (optional; derived from ratio if absent).
 * @property {ChangedStats} [changed]
 * @property {BlockEntropyStats} [blockEntropy]
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
 * @property {boolean} criticalityUsed Whether σ was present and the criticality term counted.
 */

/**
 * @typedef {object} ICScore
 * @property {number} score                Interestingness of this single IC ([0,1]).
 * @property {ComponentBreakdown} components
 * @property {boolean} killed              True if a hard kill signal fired (score forced to 0).
 * @property {string|null} killReason      'extinct' | 'saturated' | 'frozen' | 'short-cycle' | null.
 * @property {string|null} icLabel
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

    // --- Component weights (relative; renormalized internally, criticality dropped if σ absent) ---
    weights: {
        criticality: 0.35,
        entropyBand: 0.25,
        fluctuation: 0.20,
        ruleDiversity: 0.20,
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
                criticalityUsed: false,
            },
            killed: true,
            killReason,
            icLabel,
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

    // Weighted combine; drop the criticality weight (and renormalize) when σ is unavailable
    // so a no-probe burst is judged on the remaining terms rather than penalized.
    const w = cfg.weights;
    let num = entropyBand * w.entropyBand + fluctuation * w.fluctuation + ruleDiversity * w.ruleDiversity;
    let den = w.entropyBand + w.fluctuation + w.ruleDiversity;
    if (criticalityUsed) {
        num += criticality * w.criticality;
        den += w.criticality;
    }
    const score = den > 0 ? num / den : 0;

    return {
        score,
        components: { criticality, entropyBand, fluctuation, ruleDiversity, criticalityUsed },
        killed: false,
        killReason: null,
        icLabel,
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
                criticality: 0, entropyBand: 0, fluctuation: 0, ruleDiversity: 0, criticalityUsed: false,
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
