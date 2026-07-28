import { describe, expect, it } from 'vitest';
import { rulesetToHex } from '../src/core/rulesetHex.js';
import { getAllRotations, countSetBits } from '../src/core/Symmetry.js';
import {
    findRulesetRelatives,
    rulesetRelatedness,
    suggestRulesetFamilyName,
} from '../src/core/rulesetRelatedness.js';

function hexFrom(predicate) {
    const rules = new Uint8Array(128);
    for (let cs = 0; cs <= 1; cs++) {
        for (let mask = 0; mask < 64; mask++) {
            rules[(cs << 6) | mask] = predicate(cs, mask) ? 1 : 0;
        }
    }
    return rulesetToHex(rules);
}

const DEAD = '0'.repeat(32);

describe('rulesetRelatedness', () => {
    it('counts a multi-entry rotational orbit flip as one degree', () => {
        const orbit = new Set(getAllRotations(0b000011));
        const child = hexFrom((cs, mask) => cs === 0 && orbit.has(mask));
        const relation = rulesetRelatedness(DEAD, child);

        expect(orbit.size).toBe(6);
        expect(relation).toMatchObject({
            degrees: 1,
            totalUnits: 28,
            space: 'r_sym',
            isClose: true,
        });
    });

    it('counts a whole neighbor-count bucket as one degree', () => {
        const child = hexFrom((cs, mask) => cs === 0 && countSetBits(mask) === 3);
        expect(rulesetRelatedness(DEAD, child)).toMatchObject({
            degrees: 1,
            totalUnits: 14,
            space: 'n_count',
        });
    });

    it('counts a whole totalistic sum as one degree', () => {
        const a = hexFrom((cs, mask) => cs + countSetBits(mask) === 2);
        const b = hexFrom((cs, mask) => {
            const sum = cs + countSetBits(mask);
            return sum === 2 || sum === 5;
        });
        expect(rulesetRelatedness(a, b)).toMatchObject({
            degrees: 1,
            totalUnits: 8,
            space: 'totalistic',
        });
    });

    it('falls back to free-bit distance when one ruleset breaks rotational symmetry', () => {
        const child = hexFrom((cs, mask) => cs === 0 && mask === 0b000011);
        expect(rulesetRelatedness(DEAD, child)).toMatchObject({
            degrees: 1,
            totalUnits: 128,
            space: 'free',
        });
    });

    it('rejects invalid hex and reports exact identity as zero degrees', () => {
        expect(rulesetRelatedness('bad', DEAD)).toBeNull();
        expect(rulesetRelatedness(DEAD, DEAD)).toMatchObject({
            degrees: 0,
            isIdentical: true,
            isClose: false,
        });
    });
});

describe('rule-family naming', () => {
    const orbit = new Set(getAllRotations(0b000011));
    const child = hexFrom((cs, mask) => cs === 0 && orbit.has(mask));

    it('ranks relatives and suggests II after an unnumbered base', () => {
        const entries = [{ id: 'a', name: 'Crystal Tide', hex: DEAD }];
        const relatives = findRulesetRelatives(child, entries);
        expect(relatives[0].relatedness.degrees).toBe(1);
        expect(suggestRulesetFamilyName(relatives, entries)).toEqual({
            name: 'Crystal Tide II',
            basedOn: 'Crystal Tide',
        });
    });

    it('counts up across existing Roman-numeral family members', () => {
        const entries = [
            { name: 'Crystal Tide', hex: DEAD },
            { name: 'Crystal Tide II', hex: DEAD },
            { name: 'Crystal Tide IV', hex: DEAD },
        ];
        const relatives = findRulesetRelatives(child, entries);
        expect(suggestRulesetFamilyName(relatives, entries).name).toBe('Crystal Tide V');
    });

    it('does not suggest a new variant name for an exact duplicate', () => {
        const entries = [{ name: 'Already Here', hex: child }];
        const relatives = findRulesetRelatives(child, entries);
        expect(suggestRulesetFamilyName(relatives, entries)).toBeNull();
    });

    it('can exclude the entry being edited', () => {
        const entries = [
            { id: 'self', name: 'Self', hex: child },
            { id: 'parent', name: 'Parent', hex: DEAD },
        ];
        const relatives = findRulesetRelatives(child, entries, { excludeId: 'self' });
        expect(relatives[0].entry.id).toBe('parent');
    });
});
