import { describe, it, expect } from 'vitest';
import {
    countSetBits,
    rotateBitmaskClockwise,
    getAllRotations,
    getCanonicalRepresentative,
    getOrbitSize,
    precomputeSymmetryGroups,
} from '../src/core/Symmetry.js';

describe('countSetBits', () => {
    it('counts bits for known values', () => {
        expect(countSetBits(0)).toBe(0);
        expect(countSetBits(0b101010)).toBe(3);
        expect(countSetBits(0b111111)).toBe(6);
    });
});

describe('rotateBitmaskClockwise', () => {
    it('returns to the original after 6 rotations', () => {
        for (let mask = 0; mask < 64; mask++) {
            let m = mask;
            for (let i = 0; i < 6; i++) m = rotateBitmaskClockwise(m);
            expect(m).toBe(mask);
        }
    });

    it('keeps all-zero and all-one masks invariant', () => {
        expect(rotateBitmaskClockwise(0)).toBe(0);
        expect(rotateBitmaskClockwise(0b111111)).toBe(0b111111);
    });

    it('rotates a single bit into the documented neighbour slot', () => {
        // Bit 0 (SW) rotates to bit 1 (NW) under one clockwise step.
        expect(rotateBitmaskClockwise(0b000001)).toBe(0b000010);
    });
});

describe('getAllRotations / getOrbitSize', () => {
    it('always yields 6 entries (with repeats for symmetric masks)', () => {
        for (let mask = 0; mask < 64; mask++) {
            expect(getAllRotations(mask).length).toBe(6);
        }
    });

    it('orbit size divides 6 and matches unique-rotation count', () => {
        for (let mask = 0; mask < 64; mask++) {
            const size = getOrbitSize(mask);
            expect([1, 2, 3, 6]).toContain(size);
            const unique = new Set(getAllRotations(mask));
            expect(unique.size).toBe(size);
        }
    });

    it('fully-symmetric masks have orbit size 1', () => {
        expect(getOrbitSize(0)).toBe(1);
        expect(getOrbitSize(0b111111)).toBe(1);
    });

    it('alternating mask has orbit size 2', () => {
        expect(getOrbitSize(0b010101)).toBe(2);
    });
});

describe('getCanonicalRepresentative', () => {
    it('is the smallest value in the rotation orbit', () => {
        for (let mask = 0; mask < 64; mask++) {
            const rep = getCanonicalRepresentative(mask);
            const rotations = getAllRotations(mask);
            expect(rep).toBe(Math.min(...rotations));
            // All members of the orbit share the same representative.
            for (const r of rotations) {
                expect(getCanonicalRepresentative(r)).toBe(rep);
            }
        }
    });
});

describe('precomputeSymmetryGroups', () => {
    const groups = precomputeSymmetryGroups();

    it('partitions all 64 masks into disjoint groups exactly once', () => {
        const seen = new Set();
        let total = 0;
        for (const g of groups.canonicalRepresentatives) {
            for (const m of g.members) {
                expect(seen.has(m)).toBe(false);
                seen.add(m);
                total++;
            }
        }
        expect(total).toBe(64);
        expect(seen.size).toBe(64);
    });

    it('exposes consistent lookup maps for every mask', () => {
        for (let mask = 0; mask < 64; mask++) {
            expect(groups.bitmaskToCanonical.get(mask)).toBe(getCanonicalRepresentative(mask));
            expect(groups.bitmaskToOrbitSize.get(mask)).toBe(getOrbitSize(mask));
        }
    });

    it('each group representative is the canonical of its members', () => {
        for (const g of groups.canonicalRepresentatives) {
            expect(g.members).toContain(g.representative);
            for (const m of g.members) {
                expect(getCanonicalRepresentative(m)).toBe(g.representative);
            }
            expect(g.orbitSize).toBe(getOrbitSize(g.representative));
        }
    });

    it('has the known hexagonal symmetry-group count (14)', () => {
        // The number of distinct rotation orbits of a 6-bit cyclic mask is 14 (necklace count C(6)).
        expect(groups.canonicalRepresentatives.length).toBe(14);
    });
});
