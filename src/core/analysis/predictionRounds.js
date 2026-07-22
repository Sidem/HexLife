// @ts-check

import { mulberry32 } from '../rng.js';
import { IC_SUITE } from '../AutoExploreService.js';

/**
 * Round recipes for Prediction mode (PLAY-LAYER-PLAN §P1, roadmap #19).
 *
 * A round is a `(ruleset × initial condition × seed)` triple — the app's unit of behaviour — and this
 * module is the part that decides *which* triple the player is shown. It is PURE and seeded: one
 * integer reproduces a round exactly, which is what lets a round be replayed, reported in a bug, or
 * later minted into a challenge link (#20) without storing a thumbnail.
 *
 * **Why the recipe is not just "a random ruleset".** With all 128 bits flipped independently and a
 * half-full grid, almost everything is chaotic soup: the honest answer would be "Runs wild" nearly
 * every time and the game would be a single button. A four-way question needs a spread of four
 * answers, so a round samples over the axes that actually move the outcome:
 *
 *   - **Generation mode.** Constrained rule families (#38's `r_sym`, `n_count`, `totalistic`) produce
 *     structure — still lifes and oscillators — far more often than free 128-bit noise. The rotation
 *     below is weighted toward them, which both spreads the answers and matches the finding that
 *     symmetric rulesets have much better odds of being interesting.
 *   - **Bias.** The probability a rule outputs "alive". Low bias starves a world (→ dies out), high
 *     bias floods it. The sampled band straddles the transition.
 *   - **Initial condition.** Drawn from the same {@link IC_SUITE} auto-explore screens over, so a
 *     round is a behaviour the rest of the app would also have looked at — dense chaos, a sparse
 *     dusting, a single seed cluster.
 *
 * None of this is a promise about the answer: the recipe biases the *distribution* of outcomes and
 * the world is still simulated for real. {@link module:core/analysis/outcomeClass} grades it.
 */

/**
 * Generation modes a round may draw from, listed with the multiplicity that gives them their weight.
 * Constrained families dominate deliberately (see the module note): free 128-bit noise is one entry
 * in six because it is the mode whose outcome is most often the same one.
 * @type {ReadonlyArray<string>}
 */
export const ROUND_MODE_POOL = Object.freeze([
    'r_sym', 'r_sym', 'n_count', 'n_count', 'totalistic', 'free',
]);

/** Bias band a round samples from — below it worlds starve, above it they flood. */
export const ROUND_BIAS_MIN = 0.28;
export const ROUND_BIAS_MAX = 0.62;

/**
 * ICs a round may open on, by {@link IC_SUITE} label. `inverted` (a saturated grid) is excluded: its
 * first frame is a solid block of colour, which is not a picture anyone can predict from.
 * @type {ReadonlyArray<string>}
 */
export const ROUND_IC_LABELS = Object.freeze(['chaos', 'sparse', 'seed', 'clusters', 'scatter']);

/** The IC-suite entries {@link ROUND_IC_LABELS} names, resolved once. */
const ROUND_ICS = IC_SUITE.filter((ic) => ROUND_IC_LABELS.includes(ic.label));

/**
 * A prediction round: everything needed to reproduce the world, plus what to tell the player about it
 * afterwards.
 * @typedef {object} PredictionRound
 * @property {number} roundSeed  The integer this whole recipe was derived from.
 * @property {string} hex        32-char ruleset hex.
 * @property {string} mode       Generation mode the ruleset was drawn under.
 * @property {number} bias       Sampled "alive" bias.
 * @property {number} seed       Initial-condition seed handed to the world reset.
 * @property {string} icLabel    IC-suite label ('chaos', 'seed', …).
 * @property {object} initialState IC descriptor for `WorldProxy.resetWorld`.
 */

/**
 * Build one reproducible round from a single integer.
 *
 * @param {number} roundSeed Any integer; the same value always yields the same round.
 * @param {{generateRandomRulesetHex: (bias: number, mode: string, rng: () => number) => string}} rulesetService
 * @returns {PredictionRound}
 */
export function makePredictionRound(roundSeed, rulesetService) {
    // One stream for the whole recipe, drawn in a fixed order — adding a draw anywhere but the end
    // would re-point every existing seed at a different round.
    const rng = mulberry32(roundSeed >>> 0);
    const mode = ROUND_MODE_POOL[Math.floor(rng() * ROUND_MODE_POOL.length) % ROUND_MODE_POOL.length];
    const bias = ROUND_BIAS_MIN + rng() * (ROUND_BIAS_MAX - ROUND_BIAS_MIN);
    const ic = ROUND_ICS[Math.floor(rng() * ROUND_ICS.length) % ROUND_ICS.length];
    // The world seed must be a positive int32 — the worker treats a falsy seed as "pick your own",
    // which would make the round unreproducible (see the deterministic-reset contract in AGENTS.md).
    const seed = (Math.floor(rng() * 0x7ffffffe) + 1) >>> 0;
    const hex = rulesetService.generateRandomRulesetHex(bias, mode === 'free' ? 'random' : mode, rng);
    return { roundSeed, hex, mode, bias, seed, icLabel: ic.label, initialState: ic.initialState };
}

/**
 * Draw a fresh round seed. Separated from {@link makePredictionRound} so every caller that wants a
 * *reproducible* round can supply its own integer (a daily date-hash, a challenge link, a test).
 * @param {() => number} [rng]
 * @returns {number}
 */
export function randomRoundSeed(rng = Math.random) {
    return (Math.floor(rng() * 0xfffffffe) + 1) >>> 0;
}
