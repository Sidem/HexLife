import { describe, it, expect } from 'vitest';
import { scoreSingleIC, applyConfirmation } from '../src/core/analysis/InterestingnessScore.js';
import { describeRuleset } from '../src/core/rulesetDescriptor.js';
import benchmark from './fixtures/interestingnessBenchmark.json';

/**
 * #37 Stage 0 — the human-alignment benchmark (the instrument, not a fix).
 *
 * Two fixture rulesets can tell us gliders out-rank churn; they cannot tell us whether the objective
 * agrees with a human *in general*. This file measures that on a labeled panel: 16 human-picked
 * "interesting" rulesets (the curated library is human-picked by definition) vs 7 hand-verified
 * "boring" ones (the v2 churn reference plus high-scoring auto-explore finds that are visually
 * uniform static — the exact failure the owner reports).
 *
 * The two headline numbers:
 *   pairwiseAccuracy — fraction of (interesting, boring) cross-pairs the scorer orders correctly.
 *   marginMean       — mean(interesting score) − mean(boring score).
 *
 * Both are pinned at **whatever the scorer measured when the panel was captured** (2026-07-22).
 * Stage 0 deliberately does NOT improve the score — it pins the starting point so Stages 2/5 have a
 * needle to move. The baseline is mediocre by design: pairwiseAccuracy 0.509 is a coin flip.
 *
 * Scores are read at CONFIRM length (600 ticks) through `applyConfirmation`, i.e. exactly what
 * auto-explore banks: hard kills → 0, long cycles → penalized+tagged. `SCREEN_*` constants record
 * the same measurement on the cheap 160-tick screen for reference (it is *worse* than chance).
 *
 * Panel provenance + regeneration: tests/fixtures/README.md. Never hand-edit the JSON.
 */

// --- Constraint class (roadmap #38's classifier, inlined until it lands) ---------------------
// Strictest structural constraint the rule satisfies. The panel is stratified by it because
// symmetric rulesets have much better odds of being interesting: an unstratified panel would let a
// scorer (or Stage 4's reward model) score well by learning "symmetric = good" instead of reading
// the dynamics. Hence r_sym-class NEGATIVES exist in the panel and within-class accuracy is
// reported alongside the overall number.
/**
 * @param {string} hex 32-char ruleset hex.
 * @returns {'totalistic'|'n_count'|'r_sym'|'free'|'invalid'}
 */
function constraintClass(hex) {
    const d = describeRuleset(hex);
    if (!d) return 'invalid';
    if (d.type === 'raw') return 'free';
    if (d.type === 'r-sym') return 'r_sym';
    // n-count: fully totalistic iff the output depends only on (centre + neighbour count), i.e. the
    // birth entry for count k must agree with the survival entry for count k−1 (same cell sum).
    const birth = new Set(d.birth.map(Number));
    const survival = new Set(d.survival.map(Number));
    for (let k = 1; k <= 6; k++) {
        if (birth.has(k) !== survival.has(k - 1)) return 'n_count';
    }
    return 'totalistic';
}

// --- Scoring the panel -----------------------------------------------------------------------

/**
 * The score auto-explore would bank for a panel entry: screen on the 160-tick burst, then reconcile
 * against the 600-tick confirmation burst (kills reject → 0, long cycles are penalized + tagged).
 * @param {any} entry
 */
function scoreEntry(entry) {
    const screen = scoreSingleIC(entry.metrics);
    const confirmIC = scoreSingleIC(entry.confirmMetrics);
    const confirmed = applyConfirmation(screen.score, confirmIC, entry.confirmMetrics);
    return {
        id: entry.id,
        label: entry.label,
        cls: entry.constraintClass,
        screen: screen.score,
        score: confirmed.rejected ? 0 : confirmed.finalScore,
        killReason: confirmIC.killReason,
        cyclic: confirmed.cyclic,
    };
}

const rows = benchmark.entries.map(scoreEntry);
const positives = rows.filter((r) => r.label === 'interesting');
const negatives = rows.filter((r) => r.label === 'boring');

/**
 * Fraction of (interesting × boring) cross-pairs the scorer orders correctly (ties count as losses).
 * @param {typeof rows} pos
 * @param {typeof rows} neg
 * @param {'score'|'screen'} [key]
 */
function pairwiseAccuracy(pos, neg, key = 'score') {
    let wins = 0;
    let pairs = 0;
    for (const p of pos) {
        for (const n of neg) {
            pairs++;
            if (p[key] > n[key]) wins++;
        }
    }
    return pairs > 0 ? wins / pairs : NaN;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const marginMean = (pos, neg) => mean(pos.map((r) => r.score)) - mean(neg.map((r) => r.score));

// --- Recorded baselines (measured 2026-07-22, score v3.1) ------------------------------------
// Exact measurements, kept as the raw win/pair fractions so a re-derivation is legible:
//   overall  57/112 = 0.508928…   margin −0.00098   (mean pos 0.50876, mean neg 0.50974)
//   free     14/24  = 0.583333…
//   r_sym     7/18  = 0.388888…   ← symmetric churn out-ranks symmetric structure more often than not
//   screen   39/112 = 0.348214…   (the cheap screen is *worse* than chance)
// The constants sit a hair below the measurements so a last-bit float drift can't fail the build;
// a real regression moves these by whole pairs (1 pair ≈ 0.009).
const BASELINE_PAIRWISE_ACCURACY = 0.5089;
const BASELINE_MARGIN = -0.0010;
const BASELINE_FREE_ACCURACY = 0.5833;
const BASELINE_RSYM_ACCURACY = 0.3888;
const BASELINE_SCREEN_ACCURACY = 0.3482;

// Per-entry table at capture time (confirm-length banked score, best first). Stages 2/5 must show
// which rows flip; regenerate with `BENCH_TABLE=1 npx vitest run tests/interestingnessBenchmark.test.js`.
//
//   0.759  interesting  r_sym       lib27_stable_exchange
//   0.748  interesting  free        lib23_dancer_1
//   0.702  interesting  free        lib34_lazers
//   0.700  interesting  n_count     lib19_mandala_1_with_hidden_stability
//   0.693  interesting  r_sym       lib29_mutated_oscillators
//   0.693  BORING       r_sym       neg_rsym_static_a
//   0.691  interesting  totalistic  lib20_exothermic_reaction_requiring_activation
//   0.623  BORING       free        neg_free_static_c
//   0.609  interesting  free        lib02_moving_cracks
//   0.587  BORING       free        neg_free_static_b
//   0.554  BORING       r_sym       neg_rsym_static_b
//   0.535  interesting  r_sym       lib09_spontaneous_gliders
//   0.534  BORING       r_sym       neg_rsym_static_c
//   0.516  BORING       free        neg_free_static_a
//   0.480  interesting  free        lib15_chains
//   0.472  interesting  r_sym       lib14_organic_crystals
//   0.429  interesting  free        lib03_lichtenberg_figures
//   0.406  interesting  r_sym       lib10_amoeba_1
//   0.399  interesting  free        lib25_spears_in_rain
//   0.177  interesting  n_count     lib13_game_of_life_like_3   (cycle 12 → ×0.25)
//   0.173  interesting  r_sym       lib08_oscillators_2_spinners (cycle 42 → ×0.25)
//   0.167  interesting  n_count     lib11_game_of_life_like_1   (cycle 12 → ×0.25)
//   0.063  BORING       free        neg_churn_sparse            (cycle 84 → ×0.25)
//
// Reading it: five of the seven boring entries land in the interesting entries' score band, and the
// only negative the objective decisively rejects (neg_churn_sparse) is rejected by the *cycle*
// penalty rather than by any structure term. Meanwhile three genuine positives are demoted by that
// same cycle penalty — human-interesting rules are often long cyclers.

function formatTable() {
    return rows
        .slice()
        .sort((a, b) => b.score - a.score)
        .map((r) => {
            const tag = r.cyclic ? ` (cycle ${r.cyclic} → penalized)` : r.killReason ? ` (${r.killReason})` : '';
            return `  ${r.score.toFixed(3)}  ${(r.label === 'boring' ? 'BORING' : 'interesting').padEnd(12)}${r.cls.padEnd(12)}${r.id}${tag}`;
        })
        .join('\n');
}

if (process.env.BENCH_TABLE) {
    console.log(`\nInterestingness benchmark — banked (confirm-length) scores:\n${formatTable()}\n`);
}

// --- Tests -----------------------------------------------------------------------------------

describe('interestingness benchmark — panel integrity', () => {
    it('is a two-class panel of 16–24 entries with at least 6 negatives', () => {
        expect(rows.length).toBeGreaterThanOrEqual(16);
        expect(rows.length).toBeLessThanOrEqual(24);
        expect(negatives.length).toBeGreaterThanOrEqual(6);
        expect(positives.length).toBeGreaterThanOrEqual(6);
        expect(positives.length + negatives.length).toBe(rows.length);
    });

    it('every entry carries a reproducible recipe and both burst lengths', () => {
        for (const e of benchmark.entries) {
            expect(e.hex).toMatch(/^[0-9A-F]{32}$/);
            expect(Number.isFinite(e.seed)).toBe(true);
            expect(e.initialState.mode).toMatch(/^(density|clusters)$/);
            expect(e.metrics.ticksRun).toBe(benchmark._meta.capture.screenTicks);
            expect(e.confirmMetrics.ticksRun).toBeLessThanOrEqual(benchmark._meta.capture.confirmTicks);
            expect(e.metrics.ruleUsageDelta).toHaveLength(128);
        }
    });

    it('the recorded constraint class matches the class derived from the hex (hand-edit guard)', () => {
        for (const e of benchmark.entries) {
            expect(`${e.id}:${e.constraintClass}`).toBe(`${e.id}:${constraintClass(e.hex)}`);
        }
    });

    it('is stratified: both classes that carry negatives also carry positives', () => {
        // Without r_sym negatives the benchmark would reward "symmetric = good" instead of dynamics.
        for (const cls of ['free', 'r_sym']) {
            expect(positives.filter((r) => r.cls === cls).length).toBeGreaterThan(0);
            expect(negatives.filter((r) => r.cls === cls).length).toBeGreaterThan(0);
        }
    });
});

describe('interestingness benchmark — human alignment baseline (#37 Stage 0)', () => {
    it(`ranks interesting above boring on ≥${BASELINE_PAIRWISE_ACCURACY} of cross-pairs`, () => {
        const acc = pairwiseAccuracy(positives, negatives);
        expect(acc, `pairwiseAccuracy regressed below the pinned baseline.\n${formatTable()}`)
            .toBeGreaterThanOrEqual(BASELINE_PAIRWISE_ACCURACY);
    });

    it(`separates the class means by ≥${BASELINE_MARGIN}`, () => {
        expect(marginMean(positives, negatives), `marginMean regressed.\n${formatTable()}`)
            .toBeGreaterThanOrEqual(BASELINE_MARGIN);
    });

    it('the cheap screening burst is no better than the confirmed ranking', () => {
        // Recorded so a later stage that improves screening can see it move; screening at 0.348 is
        // worse than a coin flip, which is why finds are confirmed before banking.
        expect(pairwiseAccuracy(positives, negatives, 'screen')).toBeGreaterThanOrEqual(BASELINE_SCREEN_ACCURACY);
    });

    it('records the starting point honestly: the baseline is near chance, not good', () => {
        // Guards against the benchmark silently becoming trivial (e.g. someone swapping the panel for
        // easy entries). If a stage genuinely pushes accuracy past 0.8, raise this bound deliberately.
        expect(pairwiseAccuracy(positives, negatives)).toBeLessThan(0.8);
    });
});

describe('interestingness benchmark — within-class alignment', () => {
    it(`holds the free-class baseline (${BASELINE_FREE_ACCURACY})`, () => {
        const pos = positives.filter((r) => r.cls === 'free');
        const neg = negatives.filter((r) => r.cls === 'free');
        expect(pairwiseAccuracy(pos, neg)).toBeGreaterThanOrEqual(BASELINE_FREE_ACCURACY);
    });

    it(`holds the r_sym-class baseline (${BASELINE_RSYM_ACCURACY}) — the weakest class`, () => {
        const pos = positives.filter((r) => r.cls === 'r_sym');
        const neg = negatives.filter((r) => r.cls === 'r_sym');
        expect(pairwiseAccuracy(pos, neg)).toBeGreaterThanOrEqual(BASELINE_RSYM_ACCURACY);
    });

    it('n_count / totalistic entries are positives only (no within-class pair to report yet)', () => {
        // Documented gap: the curated library has no boring n-count rules to draw on. If Stage 2+
        // needs them, capture n_count-mode explore churn and extend the panel (README procedure).
        expect(negatives.filter((r) => r.cls === 'n_count' || r.cls === 'totalistic')).toHaveLength(0);
    });
});
