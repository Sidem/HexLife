import {describe, expect, it} from 'vitest';
import {hexToRuleset, isVacuumStable, rulesetToHex, VACUUM_RULE_INDEX} from '../src/core/rulesetHex.js';

/**
 * The engine's rule index for a dead centre cell with `liveNeighbours` live neighbours, derived the
 * same way `World::run_tick` does: `(centerState << 6) | neighbourMask`. Written out independently
 * of `VACUUM_RULE_INDEX` on purpose — a test that reuses the constant it is checking proves nothing.
 */
function deadCentreRuleIndex(neighbourMask) {
    return (0 << 6) | neighbourMask;
}

describe('vacuum stability', () => {
    it('pins the empty neighbourhood to the most significant bit of the first hex character', () => {
        expect(VACUUM_RULE_INDEX).toBe(deadCentreRuleIndex(0));

        // One bit set, in the position the predicate reads: the MSB of hex character 0.
        const onlyVacuumLive = new Uint8Array(128);
        onlyVacuumLive[deadCentreRuleIndex(0)] = 1;
        expect(rulesetToHex(onlyVacuumLive)).toBe('80000000000000000000000000000000');

        // …and every other rule live, with that one dead, is its exact complement.
        const everythingButVacuum = new Uint8Array(128).fill(1);
        everythingButVacuum[deadCentreRuleIndex(0)] = 0;
        expect(rulesetToHex(everythingButVacuum)).toBe('7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
    });

    it('agrees with a brute-force rule-table evaluation across a large random sample', () => {
        // Deterministic sample: a fixed LCG, so a failure is reproducible rather than a flake.
        let state = 0x9e3779b9;
        const nextHexChar = () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return (state >>> 28).toString(16).toUpperCase();
        };

        for (let trial = 0; trial < 4096; trial++) {
            const hex = Array.from({length: 32}, nextHexChar).join('');
            const table = hexToRuleset(hex);
            // The brute-force truth: evaluate the parsed table at the configuration a dead cell in
            // empty space actually reaches. No shortcut, no reference to the first hex character.
            const bruteForce = table[deadCentreRuleIndex(0)] === 0;

            expect(isVacuumStable(hex)).toBe(bruteForce);
            expect(isVacuumStable(table)).toBe(bruteForce);
            expect(isVacuumStable(hex.toLowerCase())).toBe(bruteForce);
            // The claim the shortcut rests on, restated as data rather than as arithmetic.
            expect(bruteForce).toBe('01234567'.includes(hex[0]));
        }
    });

    it('classifies the two rulesets HexWorlds pins as vectors', () => {
        // Genesis is vacuum-stable and may host a sparse world; the determinism vector is not, and
        // must stay a dense-mode fixture. Keeping both classes is what proves sparse evaluation did
        // not quietly change dense semantics.
        expect(isVacuumStable('124925874933957F121D13F6475EBE68')).toBe(true);
        expect(isVacuumStable('D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6')).toBe(false);
    });

    it('refuses anything that is not a well-formed ruleset', () => {
        expect(isVacuumStable('')).toBe(false);
        expect(isVacuumStable('0')).toBe(false);
        expect(isVacuumStable('0000000000000000000000000000000')).toBe(false); // 31 characters
        expect(isVacuumStable('000000000000000000000000000000000')).toBe(false); // 33 characters
        expect(isVacuumStable('0000000000000000000000000000000G')).toBe(false);
        expect(isVacuumStable(' 00000000000000000000000000000000')).toBe(false);
        expect(isVacuumStable('T21')).toBe(false); // short codes are not identities
        expect(isVacuumStable(new Uint8Array(127))).toBe(false);
        expect(isVacuumStable(/** @type {never} */ (null))).toBe(false);
        expect(isVacuumStable(/** @type {never} */ (undefined))).toBe(false);
        expect(isVacuumStable(/** @type {never} */ (new Array(128).fill(0)))).toBe(false);
    });
});
