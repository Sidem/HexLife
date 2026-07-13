// @ts-check

/**
 * Opt-in interestingness weight refit (PLAY-LAYER-PLAN §S3).
 *
 * Fits a Bradley–Terry / logistic model over the pairwise votes banked by the swipe-to-judge deck
 * ({@link module:core/analysis/VoteBank}), using each side's per-component score breakdown as the
 * features. The model is
 *     P(a beats b) = σ( Σ_k w_k · (f_a,k − f_b,k) )
 * with no intercept (the comparison is antisymmetric, so a side bias would be spurious) and a small
 * L2 penalty for stability. The fitted coefficients are turned into a non-negative, relative
 * 0–100 weight vector — the same shape as a scoring preset — so the user can apply them as a
 * "Personal" objective (an explicit action; stock presets are never touched silently, §S3 / roadmap #7).
 *
 * PURE: no DOM / EventBus / persistence / globals. The refit is deterministic given its inputs, so it
 * is unit-tested by planting known weights, generating Bradley–Terry votes, and recovering them.
 */

import { WEIGHT_KEYS } from './ScoringPresets.js';

/** §S3 guardrail: refuse a refit below this many decisive (non-skip, both-featured) votes. */
export const MIN_VOTES_FOR_REFIT = 50;

/** Fit hyperparameters. Exposed for tests; the defaults converge on realistic vote counts. */
export const REFIT_CONFIG = {
    iterations: 1200,
    learningRate: 0.5,
    l2: 1e-3,
};

/**
 * @typedef {object} RefitResult
 * @property {boolean} ok               True when a usable fit was produced.
 * @property {string|null} reason       Why the refit was refused ('not-enough-votes' | 'no-signal'), else null.
 * @property {number} nUsed             Decisive votes actually fed to the fit.
 * @property {Record<string, number>} weightsPct Non-negative relative weights (0–100; dominant term = 100).
 * @property {Record<string, number>} rawCoef    Fitted logistic coefficients (may be negative).
 * @property {number} accuracy          Fraction of training pairs the fit predicts correctly ([0,1]).
 * @property {number} logLoss           Mean binary log loss over the training pairs (lower = better).
 */

/**
 * Numerically-stable logistic sigmoid.
 * @param {number} z
 * @returns {number}
 */
function sigmoid(z) {
    if (z >= 0) {
        const e = Math.exp(-z);
        return 1 / (1 + e);
    }
    const e = Math.exp(z);
    return e / (1 + e);
}

/**
 * Fit interestingness weights from banked votes.
 * @param {import('./VoteBank.js').VoteRecord[]} votes
 * @param {{keys?: readonly string[], config?: typeof REFIT_CONFIG, minVotes?: number}} [opts]
 * @returns {RefitResult}
 */
export function refitWeights(votes, opts = {}) {
    const keys = opts.keys || WEIGHT_KEYS;
    const cfg = opts.config || REFIT_CONFIG;
    const minVotes = Number.isFinite(opts.minVotes) ? /** @type {number} */ (opts.minVotes) : MIN_VOTES_FOR_REFIT;

    // Build antisymmetric training rows from decisive votes (skips + featureless votes excluded).
    /** @type {Array<{x: number[], y: number}>} */
    const rows = [];
    for (const v of (Array.isArray(votes) ? votes : [])) {
        if (!v || (v.winner !== 'a' && v.winner !== 'b')) continue;
        const am = v.aMetrics;
        const bm = v.bMetrics;
        if (!am || !bm) continue;
        const x = keys.map((k) => {
            const a = Number(am[k]);
            const b = Number(bm[k]);
            return (Number.isFinite(a) ? a : 0) - (Number.isFinite(b) ? b : 0);
        });
        rows.push({ x, y: v.winner === 'a' ? 1 : 0 });
    }

    const zeroPct = Object.fromEntries(keys.map((k) => [k, 0]));
    const zeroCoef = Object.fromEntries(keys.map((k) => [k, 0]));
    if (rows.length < minVotes) {
        return { ok: false, reason: 'not-enough-votes', nUsed: rows.length, weightsPct: zeroPct, rawCoef: zeroCoef, accuracy: 0, logLoss: 0 };
    }

    // --- Batch gradient descent on the logistic loss (+ L2), no intercept. ---
    const d = keys.length;
    const w = new Array(d).fill(0);
    const N = rows.length;
    for (let iter = 0; iter < cfg.iterations; iter++) {
        const grad = new Array(d).fill(0);
        for (const row of rows) {
            let z = 0;
            for (let k = 0; k < d; k++) z += w[k] * row.x[k];
            const err = sigmoid(z) - row.y;
            for (let k = 0; k < d; k++) grad[k] += err * row.x[k];
        }
        for (let k = 0; k < d; k++) {
            w[k] -= cfg.learningRate * (grad[k] / N + cfg.l2 * w[k]);
        }
    }

    // --- Goodness summary over the training pairs. ---
    let correct = 0;
    let loss = 0;
    for (const row of rows) {
        let z = 0;
        for (let k = 0; k < d; k++) z += w[k] * row.x[k];
        const p = sigmoid(z);
        const pred = z > 0 ? 1 : 0;
        if (pred === row.y) correct++;
        const pc = Math.min(1 - 1e-9, Math.max(1e-9, p));
        loss += -(row.y * Math.log(pc) + (1 - row.y) * Math.log(1 - pc));
    }
    const accuracy = correct / N;
    const logLoss = loss / N;

    /** @type {Record<string, number>} */
    const rawCoef = {};
    keys.forEach((k, i) => { rawCoef[k] = w[i]; });

    // --- Map coefficients to a non-negative, relative 0–100 weight vector. A term that anti-correlates
    // with "interesting" drops to 0; the strongest positive term anchors the scale at 100 (weights are
    // relative in the scorer, so only ratios matter). ---
    const maxPos = Math.max(0, ...w);
    if (maxPos <= 1e-9) {
        return { ok: false, reason: 'no-signal', nUsed: N, weightsPct: zeroPct, rawCoef, accuracy, logLoss };
    }
    /** @type {Record<string, number>} */
    const weightsPct = {};
    keys.forEach((k, i) => { weightsPct[k] = Math.round(100 * Math.max(0, w[i]) / maxPos); });

    return { ok: true, reason: null, nUsed: N, weightsPct, rawCoef, accuracy, logLoss };
}
