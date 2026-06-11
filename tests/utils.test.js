import { describe, it, expect } from 'vitest';
import * as Config from '../src/core/config.js';
import {
    rulesetToHex,
    hexToRuleset,
    mutateRandomBitsInHex,
    indexToCoords,
    coordsToIndex,
    getHexLine,
    cellsToBase64,
    base64ToCells,
    rulesetName,
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

describe('cellsToBase64 <-> base64ToCells (world-state save format)', () => {
    it('round-trips a typical 0/1 cell array when the count is supplied', () => {
        const cells = new Uint8Array([0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0]);
        const b64 = cellsToBase64(cells);
        expect(typeof b64).toBe('string');
        const back = base64ToCells(b64, cells.length);
        expect(back).toBeInstanceOf(Uint8Array);
        expect(Array.from(back)).toEqual(Array.from(cells));
    });

    it('normalizes any truthy input to 1 and accepts a plain number array', () => {
        const back = base64ToCells(cellsToBase64([1, 0, 1, 1]), 4);
        expect(Array.from(back)).toEqual([1, 0, 1, 1]);
    });

    it('drops trailing pad bits using the supplied count, but exposes them without it', () => {
        // 11 cells -> 2 packed bytes -> up to 16 bits; the 5 pad bits are zero.
        const cells = new Uint8Array([1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1]);
        const b64 = cellsToBase64(cells);
        expect(base64ToCells(b64).length).toBe(16);          // rounded up to a byte boundary
        expect(Array.from(base64ToCells(b64, 11))).toEqual(Array.from(cells));
    });

    it('handles the empty array', () => {
        expect(cellsToBase64(new Uint8Array(0))).toBe('');
        expect(base64ToCells('')).toEqual(new Uint8Array(0));
        expect(base64ToCells(undefined)).toEqual(new Uint8Array(0));
    });

    it('round-trips a large grid without overflowing the call stack', () => {
        const n = 90000; // larger than 8 * 0x8000 packed bytes; ~huge-preset scale
        const cells = new Uint8Array(n);
        for (let i = 0; i < n; i++) cells[i] = (i * 7 + 3) % 5 === 0 ? 1 : 0;
        const back = base64ToCells(cellsToBase64(cells), n);
        expect(back.length).toBe(n);
        for (let i = 0; i < n; i++) expect(back[i]).toBe(cells[i]);
    });

    it('is several times smaller than a JSON number array', () => {
        const cells = new Uint8Array(42624); // a real grid size (222 x 192)
        for (let i = 0; i < cells.length; i++) cells[i] = i % 2;
        const b64Len = cellsToBase64(cells).length;
        const jsonLen = JSON.stringify(Array.from(cells)).length;
        // Bit-packing -> ~0.167 base64 chars/cell vs ~2 chars/cell for "0,"/"1,".
        expect(b64Len).toBeLessThan(jsonLen / 4);
    });
});

describe('rulesetName (human-friendly ruleset identity)', () => {
    const VALID = Config.INITIAL_RULESET_CODE;

    it('produces a stable two-word name for a valid hex', () => {
        const name = rulesetName(VALID);
        expect(typeof name).toBe('string');
        const words = name.split(' ');
        expect(words.length).toBe(2);
        expect(words[0].length).toBeGreaterThan(0);
        expect(words[1].length).toBeGreaterThan(0);
    });

    it('is deterministic — same hex always yields the same name', () => {
        expect(rulesetName(VALID)).toBe(rulesetName(VALID));
        expect(rulesetName('0'.repeat(32))).toBe(rulesetName('0'.repeat(32)));
    });

    it('is case-insensitive (canonical identity ignores hex casing)', () => {
        expect(rulesetName(VALID.toLowerCase())).toBe(rulesetName(VALID.toUpperCase()));
    });

    it('gives different rulesets different names (no trivial collapse)', () => {
        const names = new Set([
            rulesetName('0'.repeat(32)),
            rulesetName('F'.repeat(32)),
            rulesetName(VALID),
            rulesetName('12482080480080006880800180010117'),
            rulesetName('EDB7DF7FB7FF7FF97F7FFE7FEFFEEEE8'),
        ]);
        // At least 4 of the 5 distinct hexes map to distinct names.
        expect(names.size).toBeGreaterThanOrEqual(4);
    });

    it('returns the input unchanged for invalid hex', () => {
        expect(rulesetName('not-a-hex')).toBe('not-a-hex');
        expect(rulesetName('ABC')).toBe('ABC');
        expect(rulesetName('')).toBe('');
        expect(rulesetName(null)).toBe(null);
        expect(rulesetName(undefined)).toBe(undefined);
    });

    it('distributes reasonably across many random rulesets', () => {
        // Sanity check that the hash spreads names out rather than clustering.
        const seen = new Set();
        for (let i = 0; i < 200; i++) {
            // deterministic pseudo-hex from i (no Math.random in tests)
            const hex = (BigInt(i) * 0x9e3779b97f4a7c15n & ((1n << 128n) - 1n))
                .toString(16).toUpperCase().padStart(32, '0');
            seen.add(rulesetName(hex));
        }
        // Expect a healthy spread of distinct names from 200 inputs.
        expect(seen.size).toBeGreaterThan(100);
    });
});
