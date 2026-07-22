// @ts-check

/**
 * Coarse outcome classes for a single evaluation burst — the answer key for Prediction mode
 * (PLAY-LAYER-PLAN §P1, roadmap #19).
 *
 * Prediction mode shows a player the *static first frame* of a world and asks what happens when it
 * runs. That only works if "what happened" is a small, honest, mutually-exclusive set the player can
 * hold in their head, and if the answer is derived from the same burst metrics the rest of the app
 * already trusts rather than a bespoke second opinion. So this module is PURE — it takes an
 * `EVALUATION_RESULT` summary (see `WorldWorker.finishEvaluation`) and returns one of four keys.
 * No DOM, no worker, no scoring: the interestingness objective is a *ranking* of finds and answers a
 * different question entirely, and deliberately shares nothing with this.
 *
 * The four classes partition every possible burst — order matters, and the order is the order a
 * human reads the world in:
 *
 *   1. `extinct`   nothing is left alive.
 *   2. `stable`    something is left, and it stopped moving (a still life / a fixed point).
 *   3. `cycling`   it repeats — the burst locked into a period ≥ 2.
 *   4. `explosive` none of the above: still churning at the end, no repeat found.
 *
 * `explosive` is the else-branch on purpose. A four-way question whose last option is "it never
 * settled down" is answerable from a still frame; one that also asks the player to distinguish
 * chaotic-but-bounded from genuinely spreading is not (and the burst metrics could not adjudicate it
 * fairly either — the same rule does both depending on density).
 */

/**
 * Fraction of the grid that may still be turning over per tick for the world to count as having
 * *stopped*. Cycle detection catches exact repeats, but a burst can also run out of ticks one step
 * before it would have locked in, and a handful of blinking cells at the rim of a frozen crystal
 * should not read as "cycling" to a player looking at a still picture. 0.0005 ≈ half a cell per
 * thousand — comfortably below any real oscillator's turnover and above pure measurement noise.
 */
export const STABLE_CHANGE_RATIO = 0.0005;

/**
 * The four outcome classes, in the order they are offered to the player. `label` is the button text,
 * `verb` completes "this world …" in the reveal line, and `hint` is the one-line tiebreaker for a
 * player who is unsure which of two classes they mean.
 * @type {ReadonlyArray<{key: string, label: string, verb: string, hint: string}>}
 */
export const PREDICTION_OUTCOMES = Object.freeze([
    Object.freeze({
        key: 'extinct',
        label: 'Dies out',
        verb: 'died out',
        hint: 'Every cell goes dark — an empty grid.',
    }),
    Object.freeze({
        key: 'stable',
        label: 'Freezes',
        verb: 'froze',
        hint: 'Something survives but stops changing — a still pattern.',
    }),
    Object.freeze({
        key: 'cycling',
        label: 'Loops',
        verb: 'fell into a loop',
        hint: 'It repeats itself forever — blinkers, spinners, a breathing pattern.',
    }),
    Object.freeze({
        key: 'explosive',
        label: 'Runs wild',
        verb: 'kept running wild',
        hint: 'Still churning when the clock ran out — no repeat, no rest.',
    }),
]);

/** Lookup by key for the four classes above. */
const OUTCOME_BY_KEY = new Map(PREDICTION_OUTCOMES.map((o) => [o.key, o]));

/**
 * @param {string} key
 * @returns {{key: string, label: string, verb: string, hint: string}|null}
 */
export function outcomeMeta(key) {
    return OUTCOME_BY_KEY.get(key) || null;
}

/**
 * True when `key` names one of the four classes (guards persisted/untrusted round records).
 * @param {string} key
 * @returns {boolean}
 */
export function isOutcomeKey(key) {
    return OUTCOME_BY_KEY.has(key);
}

/**
 * Classify one evaluation burst into a {@link PREDICTION_OUTCOMES} key.
 *
 * Reads only fields every `EVALUATION_RESULT` carries, and treats a missing field as "no evidence"
 * rather than guessing: a burst with no usable evidence at all falls through to `explosive` only if
 * it also reports live cells, so an empty/synthetic object classifies as `extinct` (the honest
 * reading of "zero cells reported alive").
 *
 * @param {{extinct?: boolean, finalActiveCount?: number, finalRatio?: number, numCells?: number,
 *   changed?: {mean?: number}, cycle?: {detected?: boolean, period?: number}}} metrics
 * @returns {string} One of the {@link PREDICTION_OUTCOMES} keys.
 */
export function classifyOutcome(metrics) {
    const m = metrics || {};

    // 1. Extinct — the flag when the worker set it, otherwise the count it was derived from.
    if (m.extinct === true) return 'extinct';
    if (m.extinct !== false && !(Number(m.finalActiveCount) > 0)) return 'extinct';

    const period = Number(m.cycle?.period) || 0;
    const detected = !!m.cycle?.detected;

    // 2. Stable — a period-1 "cycle" IS a still life, so it resolves here and not as a loop. A burst
    //    that ran out of ticks while already frozen never gets a detection, so the turnover rate is
    //    the second route in: `changed.mean` counts cells flipped per measured tick.
    if (detected && period <= 1) return 'stable';
    const numCells = deriveNumCells(m);
    const changedMean = Number(m.changed?.mean);
    if (!detected && numCells > 0 && Number.isFinite(changedMean)
        && changedMean <= STABLE_CHANGE_RATIO * numCells) {
        return 'stable';
    }

    // 3. Cycling — an exact repeat with a real period.
    if (detected && period >= 2) return 'cycling';

    // 4. Everything else is still going.
    return 'explosive';
}

/**
 * Grid size behind a burst, however the caller recorded it: an explicit `numCells`, or back-derived
 * from the active count and its ratio. Returns 0 when neither is available (the caller then skips
 * the turnover test rather than dividing by a guess).
 * @param {{finalActiveCount?: number, finalRatio?: number, numCells?: number}} m
 * @returns {number}
 */
function deriveNumCells(m) {
    if (Number.isFinite(m.numCells) && Number(m.numCells) > 0) return Number(m.numCells);
    const ratio = Number(m.finalRatio);
    const count = Number(m.finalActiveCount);
    if (Number.isFinite(ratio) && ratio > 0 && Number.isFinite(count) && count > 0) {
        return Math.round(count / ratio);
    }
    return 0;
}
