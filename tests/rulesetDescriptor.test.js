import { describe, it, expect } from 'vitest';
import { describeRuleset, ORBIT_LABELS } from '../src/core/rulesetDescriptor.js';
import { rulesetToHex } from '../src/core/rulesetHex.js';
import { countSetBits, getCanonicalRepresentative } from '../src/core/Symmetry.js';

/** Build a ruleset hex from a per-rule predicate. */
function hexFrom(fn) {
    const rules = new Uint8Array(128);
    for (let cs = 0; cs < 2; cs++) {
        for (let mask = 0; mask < 64; mask++) {
            rules[(cs << 6) | mask] = fn(cs, mask) ? 1 : 0;
        }
    }
    return rulesetToHex(rules);
}

describe('ORBIT_LABELS', () => {
    it('covers the canonical representative of every 6-bit mask', () => {
        for (let mask = 0; mask < 64; mask++) {
            expect(ORBIT_LABELS.has(getCanonicalRepresentative(mask))).toBe(true);
        }
        expect(ORBIT_LABELS.size).toBe(14);
    });
});

describe('describeRuleset', () => {
    it('rejects non-hex input', () => {
        expect(describeRuleset(null)).toBeNull();
        expect(describeRuleset('')).toBeNull();
        expect(describeRuleset('HXW1.notahex')).toBeNull();
        expect(describeRuleset('D5F5EBB9CD2C79E4B3F1F0E6ED1D67A')).toBeNull(); // 31 chars
    });

    it('classifies a neighbor-count rule as B/S digits', () => {
        const hex = hexFrom((cs, mask) => {
            const n = countSetBits(mask);
            return cs === 0 ? n === 2 : n === 3 || n === 5;
        });
        // Pinned literal: the devvit server tests reuse this exact hex as their B2/S35 fixture.
        expect(hex).toBe('16686880688080000116166916696996');
        const d = describeRuleset(hex);
        expect(d.type).toBe('n-count');
        expect(d.notation).toBe('B2/S35');
        expect(d.birth).toEqual(['2']);
        expect(d.survival).toEqual(['3', '5']);
        expect(d.reflectionSymmetric).toBe(true);
        expect(d.summary).toContain('born with 2');
        expect(d.summary).toContain('3 or 5');
    });

    it('classifies the all-dead rule as an empty B/S', () => {
        const d = describeRuleset('0'.repeat(32));
        expect(d.type).toBe('n-count');
        expect(d.notation).toBe('B/S');
        expect(d.birth).toEqual([]);
        expect(d.survival).toEqual([]);
        expect(d.aliveOutputs).toBe(0);
    });

    it('classifies an orbit-uniform rule as r-sym with arrangement suffixes', () => {
        // Birth only on the adjacent pair (2o); survival on any 3 neighbors.
        const hex = hexFrom((cs, mask) =>
            cs === 0
                ? getCanonicalRepresentative(mask) === 0b000011
                : countSetBits(mask) === 3,
        );
        const d = describeRuleset(hex);
        expect(d.type).toBe('r-sym');
        expect(d.notation).toBe('B2o/S3');
        expect(d.birth).toEqual(['2o']);
        expect(d.survival).toEqual(['3']);
        expect(d.reflectionSymmetric).toBe(true);
    });

    it('collapses a fully-active count to its bare digit inside an r-sym rule', () => {
        // Birth on every 2-arrangement plus only the 3o orbit → "B23o".
        const hex = hexFrom((cs, mask) => {
            if (cs !== 0) return false;
            const rep = getCanonicalRepresentative(mask);
            return countSetBits(mask) === 2 || rep === 0b000111;
        });
        const d = describeRuleset(hex);
        expect(d.type).toBe('r-sym');
        expect(d.notation).toBe('B23o/S');
    });

    it("distinguishes the chiral 3m/3m' pair and drops the reflection flag", () => {
        const hex = hexFrom((cs, mask) =>
            cs === 0 && getCanonicalRepresentative(mask) === 0b001011,
        );
        const d = describeRuleset(hex);
        expect(d.type).toBe('r-sym');
        expect(d.notation).toBe('B3m/S');
        expect(d.reflectionSymmetric).toBe(false);
        expect(d.summary).toContain('mirror');
    });

    it('classifies an orbit-mixed rule as raw with no notation', () => {
        // Alive for exactly one member of the 2o orbit — its rotation is dead.
        const hex = hexFrom((cs, mask) => cs === 0 && mask === 0b000011);
        const d = describeRuleset(hex);
        expect(d.type).toBe('raw');
        expect(d.notation).toBeNull();
        expect(d.birth).toEqual([]);
        expect(d.aliveOutputs).toBe(1);
        expect(d.summary).toContain('1/128');
    });

    it('uppercases and echoes the input hex', () => {
        const d = describeRuleset('d5f5ebb9cd2c79e4b3f1f0e6ed1d67a6');
        expect(d).not.toBeNull();
        expect(d.hex).toBe('D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6');
    });
});
