import { describe, it, expect } from 'vitest';
import { StateHistoryRing } from '../src/core/StateHistoryRing.js';

describe('StateHistoryRing', () => {
    it('reports length and grows as frames are pushed', () => {
        const ring = new StateHistoryRing(10);
        expect(ring.length).toBe(0);
        ring.push('a');
        ring.push('b');
        expect(ring.length).toBe(2);
    });

    it('evicts the oldest frame once over capacity (newest retained)', () => {
        const ring = new StateHistoryRing(3);
        ring.push('a');
        ring.push('b');
        ring.push('c');
        ring.push('d'); // evicts 'a'
        expect(ring.length).toBe(3);
        expect(ring.at(0)).toBe('d'); // tip
        expect(ring.at(2)).toBe('b'); // oldest retained
        expect(ring.at(3)).toBeNull(); // 'a' is gone
    });

    it('at(offset) indexes back from the tip (0 = newest)', () => {
        const ring = new StateHistoryRing(10);
        ['a', 'b', 'c'].forEach(f => ring.push(f));
        expect(ring.at(0)).toBe('c');
        expect(ring.at(1)).toBe('b');
        expect(ring.at(2)).toBe('a');
        expect(ring.at(-1)).toBeNull();
        expect(ring.at(99)).toBeNull();
    });

    it('clampOffset bounds to [0, length-1] and rounds', () => {
        const ring = new StateHistoryRing(10);
        ['a', 'b', 'c', 'd'].forEach(f => ring.push(f));
        expect(ring.clampOffset(-5)).toBe(0);
        expect(ring.clampOffset(100)).toBe(3);
        expect(ring.clampOffset(1.4)).toBe(1);
        expect(ring.clampOffset(1.6)).toBe(2);
    });

    it('clampOffset on an empty ring returns 0', () => {
        const ring = new StateHistoryRing(10);
        expect(ring.clampOffset(5)).toBe(0);
    });

    it('truncateToOffset drops frames newer than the scrub point', () => {
        const ring = new StateHistoryRing(10);
        ['a', 'b', 'c', 'd', 'e'].forEach(f => ring.push(f));
        ring.truncateToOffset(2); // keep through 'c' (2 back from tip), drop 'd','e'
        expect(ring.length).toBe(3);
        expect(ring.at(0)).toBe('c');
    });

    it('truncateToOffset(0) is a no-op', () => {
        const ring = new StateHistoryRing(10);
        ['a', 'b', 'c'].forEach(f => ring.push(f));
        ring.truncateToOffset(0);
        expect(ring.length).toBe(3);
        expect(ring.at(0)).toBe('c');
    });

    it('truncateToOffset clamps an out-of-range offset', () => {
        const ring = new StateHistoryRing(10);
        ['a', 'b', 'c'].forEach(f => ring.push(f));
        ring.truncateToOffset(99); // clamps to oldest, keeps just 'a'
        expect(ring.length).toBe(1);
        expect(ring.at(0)).toBe('a');
    });

    it('clear empties the ring', () => {
        const ring = new StateHistoryRing(10);
        ['a', 'b'].forEach(f => ring.push(f));
        ring.clear();
        expect(ring.length).toBe(0);
        expect(ring.at(0)).toBeNull();
    });

    it('treats a non-positive capacity as at least 1', () => {
        const ring = new StateHistoryRing(0);
        expect(ring.capacity).toBe(1);
        ring.push('a');
        ring.push('b');
        expect(ring.length).toBe(1);
        expect(ring.at(0)).toBe('b');
    });
});
