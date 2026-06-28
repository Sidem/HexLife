import { describe, it, expect } from 'vitest';
import { computeWorldStatus, computeStatusWord } from '../src/ui/worldStatus.js';

describe('computeWorldStatus', () => {
    it('returns null for missing stats', () => {
        expect(computeWorldStatus(null)).toBeNull();
        expect(computeWorldStatus(undefined)).toBeNull();
    });

    it('classifies extinct (ratio 0)', () => {
        expect(computeWorldStatus({ ratio: 0 })).toMatchObject({ type: 'extinct', label: '✕' });
    });

    it('classifies saturated (ratio 1)', () => {
        expect(computeWorldStatus({ ratio: 1 })).toMatchObject({ type: 'saturated', label: '■' });
    });

    it('classifies cycling with its period', () => {
        expect(computeWorldStatus({ ratio: 0.5, isInCycle: true, cycleLength: 7 }))
            .toMatchObject({ type: 'cycling', label: '↻7' });
    });

    it('extinct/saturated take precedence over a degenerate cycle flag', () => {
        expect(computeWorldStatus({ ratio: 0, isInCycle: true, cycleLength: 1 }).type).toBe('extinct');
        expect(computeWorldStatus({ ratio: 1, isInCycle: true, cycleLength: 1 }).type).toBe('saturated');
    });

    it('returns null for an actively-evolving world', () => {
        expect(computeWorldStatus({ ratio: 0.5, isInCycle: false })).toBeNull();
    });
});

describe('computeStatusWord', () => {
    it('reports unknown when no ratio is present', () => {
        expect(computeStatusWord(null)).toMatchObject({ type: 'unknown', word: '—' });
        expect(computeStatusWord({}).type).toBe('unknown');
    });

    it('names every terminal state in plain language', () => {
        expect(computeStatusWord({ ratio: 0 })).toMatchObject({ type: 'extinct', word: 'Died out' });
        expect(computeStatusWord({ ratio: 1 })).toMatchObject({ type: 'saturated', word: 'Full' });
        expect(computeStatusWord({ ratio: 0.5, isInCycle: true, cycleLength: 12 }))
            .toMatchObject({ type: 'cycling', word: 'Cycling ↻12' });
    });

    it('names the active case (unlike the minimap classifier)', () => {
        expect(computeStatusWord({ ratio: 0.5, isInCycle: false }))
            .toMatchObject({ type: 'active', word: 'Active' });
    });
});
