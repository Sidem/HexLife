import { describe, it, expect } from 'vitest';
import {
    autoLayout, readLayout, resolveRulesetCode, splitRulesetList,
} from '../src/embed/gridAttrs.js';
import { rulesetToCode } from '../src/core/rulesetCode.js';

/**
 * Attribute coercion for `<hexlife-grid>`.
 *
 * Same trust boundary as `embedAttributes.test.js`, one order of magnitude more exposed: a single
 * bad entry in a 256-item `rulesets` list must cost that one tile, never the page. A failure here
 * means somebody's grid is blank or the wrong shape.
 *
 * (The element itself needs a DOM + WebGL2 + wasm, so it is verified in the browser against
 * `totalistic-256.html`. These are the parts that are pure and cheap to pin.)
 */

describe('splitRulesetList', () => {
    it('splits on commas, semicolons and any whitespace', () => {
        expect(splitRulesetList('T00,T01;T02 T03')).toEqual(['T00', 'T01', 'T02', 'T03']);
    });

    it('survives the formatting a 256-entry list actually gets written in', () => {
        expect(splitRulesetList('\n  T00,\n  T01,\n  T02,\n')).toEqual(['T00', 'T01', 'T02']);
    });

    it('is empty for nothing at all rather than yielding a phantom entry', () => {
        expect(splitRulesetList('')).toEqual([]);
        expect(splitRulesetList(null)).toEqual([]);
        expect(splitRulesetList(undefined)).toEqual([]);
        expect(splitRulesetList('   ,,;  ')).toEqual([]);
    });
});

describe('resolveRulesetCode', () => {
    it('accepts a 32-char hex and canonicalizes its case', () => {
        const hex = '16686880688080006880800080000001';
        expect(resolveRulesetCode(hex)).toBe(hex);
        expect(resolveRulesetCode(hex.toLowerCase())).toBe(hex);
    });

    it('accepts tagged short codes', () => {
        expect(resolveRulesetCode('T21')).toBe('16686880688080006880800080000001');
        expect(resolveRulesetCode(' t21 ')).toBe('16686880688080006880800080000001');
    });

    it('returns null for anything malformed instead of throwing', () => {
        for (const bad of ['', null, undefined, 'nope', 'T2', 'TZZ', 'T210', '0'.repeat(31)]) {
            expect(resolveRulesetCode(/** @type {string} */ (bad))).toBeNull();
        }
    });

    it('round-trips the whole totalistic class — 256 distinct rules, all canonically T-coded', () => {
        const hexes = new Set();
        for (let t = 0; t < 256; t++) {
            const code = `T${t.toString(16).toUpperCase().padStart(2, '0')}`;
            const hex = resolveRulesetCode(code);
            expect(hex).toMatch(/^[0-9A-F]{32}$/);
            // The canonical code for the decoded table must be the code we started from — that is
            // what makes `T00`–`TFF` *the* enumeration of the class rather than one of many.
            expect(rulesetToCode(/** @type {string} */ (hex))).toBe(code);
            hexes.add(hex);
        }
        expect(hexes.size).toBe(256);
    });
});

describe('autoLayout', () => {
    it('gives a perfect square the square', () => {
        expect(autoLayout(256)).toEqual({ cols: 16, rows: 16 });
        expect(autoLayout(9)).toEqual({ cols: 3, rows: 3 });
        expect(autoLayout(1)).toEqual({ cols: 1, rows: 1 });
    });

    it('lands landscape for non-squares', () => {
        expect(autoLayout(12)).toEqual({ cols: 4, rows: 3 });
        expect(autoLayout(6)).toEqual({ cols: 3, rows: 2 });
        expect(autoLayout(8)).toEqual({ cols: 4, rows: 2 });
    });

    it('gives a prime count a single row rather than a ragged grid', () => {
        expect(autoLayout(7)).toEqual({ cols: 7, rows: 1 });
        expect(autoLayout(13)).toEqual({ cols: 13, rows: 1 });
    });

    it('never returns a zero or negative axis, whatever it is handed', () => {
        for (const n of [0, -5, 0.4, NaN]) {
            const { cols, rows } = autoLayout(n);
            expect(cols).toBeGreaterThan(0);
            expect(rows).toBeGreaterThan(0);
        }
    });
});

describe('readLayout', () => {
    it('parses COLSxROWS, with or without spaces and in either multiplication sign', () => {
        expect(readLayout('16x16', 256)).toEqual({ cols: 16, rows: 16 });
        expect(readLayout(' 8 x 4 ', 32)).toEqual({ cols: 8, rows: 4 });
        expect(readLayout('8×4', 32)).toEqual({ cols: 8, rows: 4 });
    });

    it('falls back to the derived layout for anything unparseable', () => {
        expect(readLayout(null, 256)).toEqual({ cols: 16, rows: 16 });
        expect(readLayout('banana', 256)).toEqual({ cols: 16, rows: 16 });
        expect(readLayout('16x', 256)).toEqual({ cols: 16, rows: 16 });
        expect(readLayout('0x16', 256)).toEqual({ cols: 16, rows: 16 });
    });

    it('does not second-guess a layout that disagrees with the world count', () => {
        // More tiles than worlds leaves the tail empty; fewer draws the first cols×rows. Both beat
        // an error, and `drawGrid` iterates the shorter of the two so neither can overrun.
        expect(readLayout('20x20', 256)).toEqual({ cols: 20, rows: 20 });
        expect(readLayout('2x2', 256)).toEqual({ cols: 2, rows: 2 });
    });
});
