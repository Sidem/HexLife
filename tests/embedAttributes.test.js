import { describe, it, expect } from 'vitest';
import { clampInt, clampFloat, readSeed, readGradient } from '../src/embed/attrs.js';

/**
 * Attribute coercion for `<hexlife-world>` (#25 Phase 2).
 *
 * These four helpers are the entire trust boundary between a stranger's HTML and the sim. The rule
 * they encode: **an embed never throws into the host page** — every unparseable value falls back to
 * a sane default, and every out-of-range value clamps. A test here failing means some third party's
 * blog post gets a red console error instead of a hexagon grid.
 *
 * (The element itself isn't exercised here — it needs a DOM + WebGL2 + wasm, so it's verified in the
 * browser against `embed-demo.html`. These are the parts that are pure and cheap to pin.)
 */

describe('clampInt', () => {
    it('parses and clamps into range', () => {
        expect(clampInt('64', 16, 512, 64)).toBe(64);
        expect(clampInt('8', 16, 512, 64)).toBe(16);      // below min
        expect(clampInt('9999', 16, 512, 64)).toBe(512);  // above max
    });

    it('falls back when the value is not a number at all', () => {
        expect(clampInt(null, 16, 512, 64)).toBe(64);
        expect(clampInt('', 16, 512, 64)).toBe(64);
        expect(clampInt('banana', 16, 512, 64)).toBe(64);
    });

    it('truncates rather than rejecting a float (parseInt semantics)', () => {
        expect(clampInt('64.9', 16, 512, 64)).toBe(64);
    });
});

describe('clampFloat', () => {
    it('parses and clamps into range', () => {
        expect(clampFloat('0.35', 0, 1, 0.5)).toBe(0.35);
        expect(clampFloat('-2', 0, 1, 0.5)).toBe(0);
        expect(clampFloat('4', 0, 1, 0.5)).toBe(1);
    });

    it('falls back on garbage, but keeps a legitimate 0', () => {
        expect(clampFloat('nope', 0, 1, 0.5)).toBe(0.5);
        expect(clampFloat(null, 0, 1, 0.5)).toBe(0.5);
        // density="0" is meaningful (the app's single-center-cell special case), not "unset".
        expect(clampFloat('0', 0, 1, 0.5)).toBe(0);
    });
});

describe('readSeed', () => {
    it('returns a uint32 for a valid seed', () => {
        expect(readSeed('12345')).toBe(12345);
        expect(readSeed('1720968400000')).toBe(1720968400000 >>> 0);   // wraps, as mulberry32 expects
        expect(readSeed('42.9')).toBe(42);                             // floored
    });

    it('returns null (⇒ nondeterministic run) for absent or unusable values', () => {
        expect(readSeed(null)).toBeNull();
        expect(readSeed('')).toBeNull();
        expect(readSeed('   ')).toBeNull();
        expect(readSeed('abc')).toBeNull();
        expect(readSeed('-5')).toBeNull();
    });

    it('treats seed="0" as no seed', () => {
        // Not pedantry: EmbedSim and WorldWorker both branch on a *falsy* seed to Math.random, so
        // accepting 0 as a seed would silently promise determinism the engine does not deliver.
        expect(readSeed('0')).toBeNull();
    });
});

describe('readGradient', () => {
    it('is null unless palette-on is present (so `palette` stays in charge)', () => {
        expect(readGradient(null, null)).toBeNull();
        expect(readGradient('', '#000')).toBeNull();
        expect(readGradient('  ,  ', null)).toBeNull();   // separators only, no colors
    });

    it('splits, trims and drops empties', () => {
        expect(readGradient('#00ffa3, #f5ff00 ,', '#04241a,#2b2c05')).toEqual({
            on: ['#00ffa3', '#f5ff00'],
            off: ['#04241a', '#2b2c05'],
        });
    });

    it('defaults the off-gradient so a one-sided override still looks deliberate', () => {
        expect(readGradient('#fff', null)).toEqual({ on: ['#fff'], off: ['#111111'] });
    });
});
