import { describe, it, expect } from 'vitest';
import {
    PREDICTION_OUTCOMES,
    STABLE_CHANGE_RATIO,
    classifyOutcome,
    outcomeMeta,
    isOutcomeKey,
} from '../src/core/analysis/outcomeClass.js';
import {
    ROUND_MODE_POOL,
    ROUND_IC_LABELS,
    ROUND_BIAS_MIN,
    ROUND_BIAS_MAX,
    makePredictionRound,
    randomRoundSeed,
} from '../src/core/analysis/predictionRounds.js';
import { mulberry32 } from '../src/core/rng.js';

/**
 * Prediction mode (#19). The deck itself is DOM + a borrowed world; what is worth pinning is the
 * pair of pure modules underneath it — the answer key (which outcome a burst *was*) and the recipe
 * (which world the player is shown). Both are the kind of thing that fails silently: a classifier
 * that quietly stops returning one of its four classes turns the game into a three-button game, and
 * a recipe that stops being seed-reproducible breaks the labels' link back to their world.
 */

/** A burst summary shaped like `WorldWorker.finishEvaluation`'s reply, with the fields under test. */
function burst({ active = 500, numCells = 10000, changedMean = 50, detected = false, period = 0 } = {}) {
    return {
        ticksRun: 600,
        finalActiveCount: active,
        finalRatio: active / numCells,
        numCells,
        extinct: active === 0,
        saturated: active / numCells >= 0.99,
        changed: { mean: changedMean, variance: 0, fano: 0, cv: 0 },
        cycle: { detected, period },
    };
}

describe('outcome classes', () => {
    it('offers exactly four, each with a key, a label and a reveal verb', () => {
        expect(PREDICTION_OUTCOMES).toHaveLength(4);
        for (const o of PREDICTION_OUTCOMES) {
            expect(o.key).toMatch(/^[a-z]+$/);
            expect(o.label.length).toBeGreaterThan(0);
            expect(o.verb.length).toBeGreaterThan(0);
            expect(o.hint.length).toBeGreaterThan(0);
        }
        expect(new Set(PREDICTION_OUTCOMES.map((o) => o.key)).size).toBe(4);
    });

    it('exposes lookup helpers that reject anything not in the set', () => {
        expect(outcomeMeta('cycling')?.label).toBe('Loops');
        expect(outcomeMeta('nonsense')).toBeNull();
        expect(isOutcomeKey('extinct')).toBe(true);
        expect(isOutcomeKey('chaotic')).toBe(false);
    });
});

describe('classifyOutcome', () => {
    it('reads the extinct flag, and the count it was derived from', () => {
        expect(classifyOutcome(burst({ active: 0 }))).toBe('extinct');
        expect(classifyOutcome({ extinct: true })).toBe('extinct');
        // A synthetic/empty object reports nothing alive, and "nothing alive" is extinct.
        expect(classifyOutcome({})).toBe('extinct');
        expect(classifyOutcome(null)).toBe('extinct');
    });

    it('calls a period-1 cycle a still life, not a loop', () => {
        // THE case the ordering exists for: the worker reports a frozen world as a detected cycle of
        // period 1, and a player looking at a motionless picture would never call that "Loops".
        expect(classifyOutcome(burst({ detected: true, period: 1, changedMean: 0 }))).toBe('stable');
    });

    it('calls a world that stopped turning over stable even without a detection', () => {
        // Ran out of ticks one step before it would have locked in; still visibly frozen.
        const nearlyStill = burst({ numCells: 10000, changedMean: STABLE_CHANGE_RATIO * 10000 });
        expect(classifyOutcome(nearlyStill)).toBe('stable');
        // One notch above the threshold is not frozen.
        const twitching = burst({ numCells: 10000, changedMean: STABLE_CHANGE_RATIO * 10000 + 1 });
        expect(classifyOutcome(twitching)).toBe('explosive');
    });

    it('calls a real repeat a loop', () => {
        expect(classifyOutcome(burst({ detected: true, period: 2, changedMean: 40 }))).toBe('cycling');
        expect(classifyOutcome(burst({ detected: true, period: 84, changedMean: 900 }))).toBe('cycling');
    });

    it('falls through to explosive for anything still going', () => {
        expect(classifyOutcome(burst({ active: 5000, changedMean: 1800 }))).toBe('explosive');
        expect(classifyOutcome(burst({ active: 9950, changedMean: 40 }))).toBe('explosive'); // saturated churn
    });

    it('is total: every burst lands in exactly one of the four classes', () => {
        const cases = [
            burst({ active: 0 }),
            burst({ detected: true, period: 1 }),
            burst({ detected: true, period: 12 }),
            burst({ active: 4000, changedMean: 2000 }),
            burst({ changedMean: 0 }),
            { finalActiveCount: 12 },                      // no changed/cycle evidence at all
            { extinct: false, finalActiveCount: 3, cycle: { detected: true, period: 0 } },
        ];
        for (const c of cases) expect(isOutcomeKey(classifyOutcome(c))).toBe(true);
    });

    it('skips the turnover test rather than guessing when grid size is unknowable', () => {
        // No numCells and no usable ratio: the world is alive and there is no evidence it stopped.
        expect(classifyOutcome({ extinct: false, finalActiveCount: 40, changed: { mean: 0 } })).toBe('explosive');
    });
});

describe('round recipes', () => {
    /** Stand-in for RulesetService: records its inputs and returns a hex derived from the RNG. */
    function fakeRulesetService() {
        const calls = [];
        return {
            calls,
            generateRandomRulesetHex(bias, mode, rng) {
                calls.push({ bias, mode });
                let hex = '';
                for (let i = 0; i < 32; i++) hex += Math.floor(rng() * 16).toString(16).toUpperCase();
                return hex;
            },
        };
    }

    it('is fully reproducible from its integer seed', () => {
        const a = makePredictionRound(12345, fakeRulesetService());
        const b = makePredictionRound(12345, fakeRulesetService());
        expect(b).toEqual(a);
        // A record without a replayable world is not a label — the seed has to round-trip.
        expect(a.roundSeed).toBe(12345);
    });

    it('produces a valid, runnable recipe', () => {
        for (const seed of [1, 7, 99, 4242, 0x7fffffff]) {
            const r = makePredictionRound(seed, fakeRulesetService());
            expect(r.hex).toMatch(/^[0-9A-F]{32}$/);
            expect(ROUND_IC_LABELS).toContain(r.icLabel);
            expect(r.initialState.mode).toMatch(/^(density|clusters)$/);
            expect(r.bias).toBeGreaterThanOrEqual(ROUND_BIAS_MIN);
            expect(r.bias).toBeLessThanOrEqual(ROUND_BIAS_MAX);
            // A falsy seed makes the worker pick its own — which would make the round irreproducible.
            expect(r.seed).toBeGreaterThan(0);
            expect(Number.isInteger(r.seed)).toBe(true);
        }
    });

    it('translates the pool\'s "free" mode into the generator\'s "random"', () => {
        // The pool names the *constraint class* (#38's vocabulary); RulesetService names the
        // generation mode, and its unconstrained mode is the default branch, spelled "random".
        const modes = new Set();
        for (let s = 1; s <= 400; s++) {
            const svc = fakeRulesetService();
            const round = makePredictionRound(s, svc);
            modes.add(svc.calls[0].mode);
            expect(svc.calls[0].mode).not.toBe('free');
            if (round.mode === 'free') expect(svc.calls[0].mode).toBe('random');
        }
        expect(modes).toEqual(new Set(['r_sym', 'n_count', 'totalistic', 'random']));
    });

    it('draws mostly constrained rule families, so the four answers can actually spread', () => {
        // Free 128-bit noise on a half-full grid is chaotic soup nearly every time; if it dominated
        // the pool the honest answer would be "Runs wild" and the game would be one button.
        const free = ROUND_MODE_POOL.filter((m) => m === 'free').length;
        expect(free).toBeGreaterThan(0);            // it must still appear
        expect(free / ROUND_MODE_POOL.length).toBeLessThan(0.25);
    });

    it('never opens on the saturated IC (a solid block is not a picture to predict from)', () => {
        expect(ROUND_IC_LABELS).not.toContain('inverted');
        for (let s = 1; s <= 200; s++) {
            expect(makePredictionRound(s, fakeRulesetService()).icLabel).not.toBe('inverted');
        }
    });

    it('spreads over modes and ICs rather than pinning one', () => {
        const modes = new Set();
        const ics = new Set();
        for (let s = 1; s <= 300; s++) {
            const r = makePredictionRound(s, fakeRulesetService());
            modes.add(r.mode);
            ics.add(r.icLabel);
        }
        expect(modes.size).toBeGreaterThanOrEqual(3);
        expect(ics.size).toBe(ROUND_IC_LABELS.length);
    });

    it('randomRoundSeed yields a positive integer the recipe accepts', () => {
        const rng = mulberry32(7);
        for (let i = 0; i < 50; i++) {
            const seed = randomRoundSeed(rng);
            expect(Number.isInteger(seed)).toBe(true);
            expect(seed).toBeGreaterThan(0);
        }
        expect(randomRoundSeed(() => 0)).toBeGreaterThan(0); // the degenerate draw is still valid
    });
});
