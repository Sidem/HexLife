import { describe, it, expect } from 'vitest';
import {
    caColumnsForRows,
    defaultStatePalette,
    parseHexColor,
    readCaBackend,
    readCaMaxDpr,
    readCaPalette,
    readCaRows,
    readCaSpeed,
    readCaStates,
    BLOCK_ROW_MULTIPLE,
    CA_DEFAULTS,
    MAX_BLOCK_STATES,
    MAX_NEIGHBORHOOD_STATES,
} from '../src/embed/caAttrs.js';

/**
 * Attribute coercion for `<hexlife-ca>`.
 *
 * Same trust boundary `attrs.js` guards for `<hexlife-world>`, same first law: **an embed never
 * throws into the host page**, so a typo produces a boring world rather than a red console error.
 *
 * (The element itself isn't exercised here — it needs a DOM + WebGL2 + wasm, so it is verified in
 * the browser against `coffee-percolation.html`, exactly as `<hexlife-world>` is against
 * `embed-demo.html`. These are the parts that are pure and cheap to pin.)
 */

describe('readCaBackend', () => {
    it('recognizes the two backends and nothing else', () => {
        expect(readCaBackend('block')).toBe('block');
        expect(readCaBackend('  BLOCK  ')).toBe('block');
        expect(readCaBackend('neighborhood')).toBe('neighborhood');
    });

    it('falls back rather than switching engines on a typo', () => {
        // Silently running someone's model on the other backend's semantics would be far worse than
        // ignoring them: `blok` must not become `block`.
        expect(readCaBackend('blok')).toBe('neighborhood');
        expect(readCaBackend(null)).toBe('neighborhood');
        expect(readCaBackend('')).toBe('neighborhood');
    });
});

describe('readCaStates', () => {
    it('clamps into the backend cap, which differs between them', () => {
        expect(readCaStates('4', 'neighborhood')).toBe(MAX_NEIGHBORHOOD_STATES);
        // k^7 is 78 KB at k=5 and 268 MB at k=16, so the neighborhood cap is the table, not taste.
        expect(readCaStates('8', 'neighborhood')).toBe(MAX_NEIGHBORHOOD_STATES);
        expect(readCaStates('8', 'block')).toBe(8);
        expect(readCaStates('99', 'block')).toBe(MAX_BLOCK_STATES);
        expect(readCaStates('1', 'block')).toBe(2);
    });

    it('falls back to the default when the value is not a number', () => {
        expect(readCaStates(null, 'block')).toBe(CA_DEFAULTS.states);
        expect(readCaStates('banana', 'neighborhood')).toBe(CA_DEFAULTS.states);
    });
});

describe('readCaRows', () => {
    it('clamps like every other numeric attribute', () => {
        expect(readCaRows('66', 'neighborhood')).toEqual({ rows: 66, problem: null });
        expect(readCaRows('9999', 'neighborhood').rows).toBe(512);
        expect(readCaRows('banana', 'neighborhood')).toEqual({ rows: CA_DEFAULTS.rows, problem: null });
    });

    it('reports rather than rounds a block row count that is not a multiple of 3', () => {
        // THE sharp edge of block mode. The 3-phase triangular partition is seamless only if the
        // sublattice residue survives the row wrap. Rounding would mean the grid you asked for is
        // not the grid you got, so the engine throws and this reports — which is what lets the
        // element show readable text instead of leaking an exception into the host page.
        const parsed = readCaRows('64', 'block');
        expect(parsed.rows).toBe(64);
        expect(parsed.problem).not.toBeNull();
        // The two nearest legal counts are the whole of what an author needs to know.
        expect(parsed.problem.detail).toContain('63');
        expect(parsed.problem.detail).toContain('66');
    });

    it('has no such constraint on the neighborhood backend', () => {
        expect(readCaRows('64', 'neighborhood').problem).toBeNull();
    });

    it('defaults to a row count that is legal in BOTH backends', () => {
        // A default that is fine in one backend and fatal in the other is a trap, which is exactly
        // why this is 66 and not `<hexlife-world>`'s 64.
        expect(CA_DEFAULTS.rows % BLOCK_ROW_MULTIPLE).toBe(0);
        expect(readCaRows(null, 'block').problem).toBeNull();
    });
});

describe('caColumnsForRows', () => {
    it('is always even, so the column wrap preserves hex parity', () => {
        for (const rows of [6, 33, 63, 64, 66, 128, 511, 512]) {
            expect(caColumnsForRows(rows) % 2).toBe(0);
        }
    });

    it('makes the grid roughly square on screen rather than in cell counts', () => {
        // Hex cells are wider than they are tall in spacing terms, so more rows than columns would
        // give a portrait grid inside a square element.
        expect(caColumnsForRows(66)).toBe(76);
    });
});

describe('readCaSpeed / readCaMaxDpr', () => {
    it('clamps and falls back', () => {
        expect(readCaSpeed('20')).toBe(20);
        expect(readCaSpeed('-5')).toBe(0);        // a legitimate "stopped", not a fallback
        expect(readCaSpeed('99999')).toBe(1000);
        expect(readCaSpeed('banana')).toBe(CA_DEFAULTS.speed);
        expect(readCaMaxDpr('3')).toBe(3);
        expect(readCaMaxDpr('9')).toBe(4);
        expect(readCaMaxDpr(null)).toBe(CA_DEFAULTS.maxDpr);
    });
});

describe('parseHexColor', () => {
    it('accepts both hex forms, with or without the hash', () => {
        expect(parseHexColor('#3aa0ff')).toEqual([0x3a, 0xa0, 0xff]);
        expect(parseHexColor('3aa0ff')).toEqual([0x3a, 0xa0, 0xff]);
        expect(parseHexColor('#f0a')).toEqual([0xff, 0x00, 0xaa]);
        expect(parseHexColor('  #FFF  ')).toEqual([255, 255, 255]);
    });

    it('returns null for anything else', () => {
        for (const bad of ['', '#gg0000', 'red', '#12345', null, undefined]) {
            expect(parseHexColor(bad)).toBeNull();
        }
    });
});

describe('defaultStatePalette', () => {
    it('gives exactly k entries, with state 0 as the app background', () => {
        for (const k of [2, 4, 8, MAX_BLOCK_STATES]) {
            const palette = defaultStatePalette(k);
            expect(palette).toHaveLength(k);
            // State 0 reads as empty space, so a mostly-vacuum physical model looks like one.
            expect(palette[0]).toEqual([26, 26, 26]);
            for (const entry of palette) {
                expect(entry).toHaveLength(3);
                for (const channel of entry) {
                    expect(Number.isInteger(channel)).toBe(true);
                    expect(channel).toBeGreaterThanOrEqual(0);
                    expect(channel).toBeLessThanOrEqual(255);
                }
            }
        }
    });
});

describe('readCaPalette', () => {
    it('parses one colour per state', () => {
        expect(readCaPalette('#12161a,#3aa0ff,#6b5344,#2f2318', 4)).toEqual([
            [0x12, 0x16, 0x1a], [0x3a, 0xa0, 0xff], [0x6b, 0x53, 0x44], [0x2f, 0x23, 0x18],
        ]);
    });

    it('always returns exactly `states` entries', () => {
        // Short lists pad and long ones truncate rather than being rejected: tweaking two of four
        // colours should not mean restating the other two, and a stale colour left over from a
        // `states` change should not blank the world.
        expect(readCaPalette('#ff0000', 4)).toHaveLength(4);
        expect(readCaPalette('#ff0000,#00ff00,#0000ff,#ffffff,#000000', 3)).toHaveLength(3);
        expect(readCaPalette(null, 4)).toEqual(defaultStatePalette(4));
        expect(readCaPalette('', 4)).toEqual(defaultStatePalette(4));
    });

    it('substitutes the built-in colour for an entry it cannot parse', () => {
        const fallback = defaultStatePalette(3);
        const parsed = readCaPalette('#ff0000,notacolor,#0000ff', 3);
        expect(parsed[0]).toEqual([255, 0, 0]);
        expect(parsed[1]).toEqual(fallback[1]);
        expect(parsed[2]).toEqual([0, 0, 255]);
    });
});
