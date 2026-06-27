import { describe, it, expect } from 'vitest';
import { encode, decode, KNOWN_MODES } from '../src/services/InitialStateCodec.js';

const DENSITY = { mode: 'density', params: { density: 0.42 } };
const CLUSTERS = {
    mode: 'clusters',
    params: { count: 25, density: 0.7, diameter: 10, distribution: 'gaussian', gaussianStdDev: 2.0 },
};

describe('InitialStateCodec', () => {
    it('round-trips a density state with a seed', () => {
        const code = encode(DENSITY, 12345);
        expect(code).toMatch(/^IC1\./);
        const out = decode(code);
        expect(out.initialState).toEqual(DENSITY);
        expect(out.seed).toBe(12345);
        expect(out.unknownMode).toBe(false);
        expect(out.version).toBe(1);
    });

    it('round-trips a clusters state with all params', () => {
        const code = encode(CLUSTERS, 7);
        const out = decode(code);
        expect(out.initialState).toEqual(CLUSTERS);
        expect(out.seed).toBe(7);
        expect(out.unknownMode).toBe(false);
    });

    it('carries the IC1 version tag', () => {
        expect(encode(DENSITY, 1).startsWith('IC1.')).toBe(true);
    });

    it('treats a missing seed as null (replays with fresh randomness)', () => {
        expect(decode(encode(DENSITY)).seed).toBe(null);
        expect(decode(encode(DENSITY, null)).seed).toBe(null);
    });

    it('decodes a future/unknown mode without throwing, flagging it', () => {
        const future = { mode: 'reactionDiffusion', params: { feed: 0.055, kill: 0.062 } };
        const out = decode(encode(future, 9));
        expect(out.initialState).toEqual(future);
        expect(out.unknownMode).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(KNOWN_MODES, 'reactionDiffusion')).toBe(false);
    });

    it('returns null for a malformed or wrong-version code', () => {
        expect(decode('not-a-code')).toBe(null);
        expect(decode('IC1.@@@notbase64@@@')).toBe(null);
        expect(decode('IC2.eyJtIjoiZGVuc2l0eSJ9')).toBe(null);
        expect(decode('')).toBe(null);
        expect(decode(null)).toBe(null);
    });

    it('returns null when encoding a shapeless initial state', () => {
        expect(encode(null)).toBe(null);
        expect(encode(undefined)).toBe(null);
        expect(encode({ params: {} })).toBe(null);
    });
});
