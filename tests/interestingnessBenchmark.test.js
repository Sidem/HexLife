import { describe, it, expect } from 'vitest';
import { scoreSingleIC, applyConfirmation } from '../src/core/analysis/InterestingnessScore.js';
import { classifyRulesetConstraint } from '../src/core/rulesetDescriptor.js';
import benchmark from './fixtures/interestingnessBenchmark.json';
import library from '../src/core/library/rulesets.json';

/**
 * #37 human-alignment benchmark (the instrument, not a fix).
 *
 * Every curated public-library ruleset is a positive; the seven Stage-0 hand-verified uniform/static
 * controls are negatives. The complete-library view is the current product baseline. Entries from
 * the original 16-positive panel retain `cohort: "stage0"` so the old 0.509 measurement remains
 * available as a longitudinal slice instead of being overwritten by panel growth.
 *
 * The two headline numbers:
 *   pairwiseAccuracy — fraction of (interesting, boring) cross-pairs the scorer orders correctly.
 *   marginMean       — mean(interesting score) − mean(boring score).
 *
 * Baselines are pinned at whatever the scorer measured when the panel was captured. Stage 2 moves
 * the complete-library pairwise accuracy from 0.431 to 0.444 and the preserved slice from 0.509
 * to 0.518 by rewarding localized change.
 *
 * Scores are read at CONFIRM length (600 ticks) through `applyConfirmation`, i.e. exactly what
 * auto-explore banks: hard kills → 0, long cycles → penalized+tagged. `SCREEN_*` constants record
 * the same measurement on the cheap 160-tick screen for reference (it is *worse* than chance).
 *
 * Panel provenance + regeneration: tests/fixtures/README.md. Never hand-edit the JSON.
 */

// The panel is stratified by constraint class (`classifyRulesetConstraint`, roadmap #38) because
// symmetric rulesets have much better odds of being interesting: an unstratified panel would let a
// scorer (or Stage 4's reward model) score well by learning "symmetric = good" instead of reading
// the dynamics. Hence r_sym-class NEGATIVES exist in the panel and within-class accuracy is
// reported alongside the overall number.

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
const stage0Rows = benchmark.entries
    .map((entry, index) => ({ entry, row: rows[index] }))
    .filter(({ entry }) => entry.cohort === 'stage0')
    .map(({ row }) => row);
const stage0Positives = stage0Rows.filter((r) => r.label === 'interesting');
const stage0Negatives = stage0Rows.filter((r) => r.label === 'boring');

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

// --- Recorded baselines (score v3.4, #37 Stage 2) --------------------------------------------
// Complete public library, captured 2026-07-29:
//   overall  227/511 = 0.444227…   margin −0.05584
//   free       34/64 = 0.531250…
//   r_sym     55/150 = 0.366666…   ← the largest and still-weakest library class
//   screen    150/511 = 0.293542…
//
// Preserved Stage-0 slice, captured with the Stage-2 metric:
//   overall   58/112 = 0.517857…   margin +0.01617
//   free       15/24 = 0.625000…
//   r_sym       8/18 = 0.444444…
//   screen     45/112 = 0.401785…
// The constants sit a hair below the measurements so a last-bit float drift can't fail the build;
// a real regression moves these by whole pairs.
const BASELINE_PAIRWISE_ACCURACY = 0.4442;
const BASELINE_MARGIN = -0.0559;
const BASELINE_FREE_ACCURACY = 0.5312;
const BASELINE_RSYM_ACCURACY = 0.3666;
const BASELINE_SCREEN_ACCURACY = 0.2935;

const STAGE0_PAIRWISE_ACCURACY = 0.5178;
const STAGE0_MARGIN = 0.0161;
const STAGE0_FREE_ACCURACY = 0.6249;
const STAGE0_RSYM_ACCURACY = 0.4444;
const STAGE0_SCREEN_ACCURACY = 0.4017;

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
    it('covers every current public-library entry exactly once plus the seven controls', () => {
        expect(positives).toHaveLength(library.length);
        expect(negatives).toHaveLength(7);
        expect(rows).toHaveLength(library.length + negatives.length);
        for (let i = 0; i < library.length; i++) {
            const entry = benchmark.entries[i];
            expect(entry.source).toBe(`library:${i}`);
            expect(entry.hex).toBe(library[i].hex);
            expect(entry.seed).toBe(library[i].seed);
            expect(entry.initialState).toEqual(library[i].initialState);
        }
    });

    it('every entry carries a reproducible recipe and both burst lengths', () => {
        for (const e of benchmark.entries) {
            expect(e.hex).toMatch(/^[0-9A-F]{32}$/);
            expect(Number.isFinite(e.seed)).toBe(true);
            expect(e.initialState.mode).toMatch(/^(density|clusters|saved)$/);
            expect(e.metrics.ticksRun).toBeGreaterThan(0);
            expect(e.metrics.ticksRun).toBeLessThanOrEqual(benchmark._meta.capture.screenTicks);
            expect(e.confirmMetrics.ticksRun).toBeLessThanOrEqual(benchmark._meta.capture.confirmTicks);
            expect(e.metrics.ruleUsageDelta).toHaveLength(128);
        }
    });

    it('preserves the complete original Stage-0 cohort', () => {
        expect(stage0Positives).toHaveLength(16);
        expect(stage0Negatives).toHaveLength(7);
    });

    it('the recorded constraint class matches the class derived from the hex (hand-edit guard)', () => {
        for (const e of benchmark.entries) {
            expect(`${e.id}:${e.constraintClass}`).toBe(`${e.id}:${classifyRulesetConstraint(e.hex)}`);
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

describe('interestingness benchmark — complete-library baseline (#37)', () => {
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
        // Recorded so a later stage that improves screening can see it move.
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

describe('interestingness benchmark — preserved Stage-0 slice', () => {
    it('retains the Stage-2 overall baselines on the longitudinal slice', () => {
        expect(pairwiseAccuracy(stage0Positives, stage0Negatives)).toBeGreaterThanOrEqual(STAGE0_PAIRWISE_ACCURACY);
        expect(marginMean(stage0Positives, stage0Negatives)).toBeGreaterThanOrEqual(STAGE0_MARGIN);
        expect(pairwiseAccuracy(stage0Positives, stage0Negatives, 'screen')).toBeGreaterThanOrEqual(STAGE0_SCREEN_ACCURACY);
    });

    it('retains the Stage-2 within-class baselines on the longitudinal slice', () => {
        const freePos = stage0Positives.filter((r) => r.cls === 'free');
        const freeNeg = stage0Negatives.filter((r) => r.cls === 'free');
        const rSymPos = stage0Positives.filter((r) => r.cls === 'r_sym');
        const rSymNeg = stage0Negatives.filter((r) => r.cls === 'r_sym');
        expect(pairwiseAccuracy(freePos, freeNeg)).toBeGreaterThanOrEqual(STAGE0_FREE_ACCURACY);
        expect(pairwiseAccuracy(rSymPos, rSymNeg)).toBeGreaterThanOrEqual(STAGE0_RSYM_ACCURACY);
    });
});
