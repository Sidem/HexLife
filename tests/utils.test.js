import { describe, it, expect } from 'vitest';
import * as Config from '../src/core/config.js';
import {
    rulesetToHex,
    hexToRuleset,
    mutateRandomBitsInHex,
    indexToCoords,
    coordsToIndex,
    getHexLine,
} from '../src/utils/utils.js';

describe('ruleset hex <-> array round-trip', () => {
    it('round-trips the default ruleset through array and back', () => {
        const hex = Config.INITIAL_RULESET_CODE;
        const arr = hexToRuleset(hex);
        expect(arr).toBeInstanceOf(Uint8Array);
        expect(arr.length).toBe(128);
        expect(rulesetToHex(arr)).toBe(hex);
    });

    it('round-trips all-zero and all-one rulesets', () => {
        const zeros = new Uint8Array(128).fill(0);
        const ones = new Uint8Array(128).fill(1);
        expect(rulesetToHex(zeros)).toBe('0'.repeat(32));
        expect(rulesetToHex(ones)).toBe('F'.repeat(32));
        expect(Array.from(hexToRuleset(rulesetToHex(zeros)))).toEqual(Array.from(zeros));
        expect(Array.from(hexToRuleset(rulesetToHex(ones)))).toEqual(Array.from(ones));
    });

    it('preserves bit positions (MSB-first) across the round-trip', () => {
        const arr = new Uint8Array(128).fill(0);
        arr[0] = 1; // most-significant bit
        arr[127] = 1; // least-significant bit
        const hex = rulesetToHex(arr);
        // bit 0 set -> top nibble has 0x8; bit 127 set -> bottom nibble has 0x1.
        expect(hex.startsWith('8')).toBe(true);
        expect(hex.endsWith('1')).toBe(true);
        expect(Array.from(hexToRuleset(hex))).toEqual(Array.from(arr));
    });

    it('rulesetToHex rejects wrong-length input', () => {
        expect(rulesetToHex(new Uint8Array(127))).toBe('Error');
        expect(rulesetToHex(null)).toBe('Error');
    });

    it('hexToRuleset returns a zeroed array for malformed hex', () => {
        expect(Array.from(hexToRuleset('not-hex'))).toEqual(Array.from(new Uint8Array(128)));
        expect(Array.from(hexToRuleset(''))).toEqual(Array.from(new Uint8Array(128)));
        expect(Array.from(hexToRuleset('ABC'))).toEqual(Array.from(new Uint8Array(128)));
    });

    it('is case-insensitive on input and produces uppercase output', () => {
        const lower = Config.INITIAL_RULESET_CODE.toLowerCase();
        const fromLower = rulesetToHex(hexToRuleset(lower));
        expect(fromLower).toBe(Config.INITIAL_RULESET_CODE.toUpperCase());
    });
});

describe('mutateRandomBitsInHex', () => {
    it('flips exactly `rate` rule bits', () => {
        const src = Config.INITIAL_RULESET_CODE;
        const srcArr = hexToRuleset(src);
        for (const rate of [1, 3, 7, 20]) {
            const out = mutateRandomBitsInHex(src, rate);
            expect(out).toMatch(/^[0-9A-F]{32}$/);
            const outArr = hexToRuleset(out);
            let diff = 0;
            for (let i = 0; i < 128; i++) if (outArr[i] !== srcArr[i]) diff++;
            expect(diff).toBe(rate);
        }
    });

    it('caps the flip count at 128 rules', () => {
        const src = '0'.repeat(32);
        const out = mutateRandomBitsInHex(src, 1000);
        // Flipping every bit of all-zero yields all-one.
        expect(out).toBe('F'.repeat(32));
    });

    it('returns the input unchanged for invalid hex', () => {
        expect(mutateRandomBitsInHex('bogus', 1)).toBe('bogus');
    });
});

describe('index <-> coords round-trip', () => {
    it('round-trips a sample of valid indices', () => {
        const samples = [0, 1, Config.GRID_COLS, Config.GRID_COLS + 1, Config.NUM_CELLS - 1];
        for (const idx of samples) {
            const { col, row } = indexToCoords(idx);
            expect(coordsToIndex(col, row)).toBe(idx);
        }
    });

    it('returns null/undefined for out-of-range values', () => {
        expect(indexToCoords(-1)).toBeNull();
        expect(indexToCoords(Config.NUM_CELLS)).toBeNull();
        expect(coordsToIndex(-1, 0)).toBeUndefined();
        expect(coordsToIndex(0, Config.GRID_ROWS)).toBeUndefined();
        expect(coordsToIndex(NaN, 0)).toBeUndefined();
    });
});

describe('getHexLine', () => {
    it('returns a single hex when start equals end', () => {
        expect(getHexLine(5, 5, 5, 5)).toEqual([{ col: 5, row: 5 }]);
    });

    it('includes both endpoints and is contiguous in length', () => {
        const line = getHexLine(2, 2, 6, 4);
        expect(line[0]).toEqual({ col: 2, row: 2 });
        expect(line[line.length - 1]).toEqual({ col: 6, row: 4 });
        // The number of hexes equals the hex distance + 1; never empty.
        expect(line.length).toBeGreaterThanOrEqual(2);
    });

    it('produces integer coordinates only', () => {
        const line = getHexLine(0, 0, 10, 7);
        for (const { col, row } of line) {
            expect(Number.isInteger(col)).toBe(true);
            expect(Number.isInteger(row)).toBe(true);
        }
    });
});
