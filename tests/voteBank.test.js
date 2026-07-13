import { describe, it, expect } from 'vitest';
import { VoteBank, pairKey, extractFeatures, nextPair, MAX_VOTES } from '../src/core/analysis/VoteBank.js';
import { WEIGHT_KEYS } from '../src/core/analysis/ScoringPresets.js';

/** In-memory backing store so the bank needs no localStorage (tests run in node). */
function makeBank(opts = {}) {
    let store = opts.initial || [];
    const bank = new VoteBank({
        load: () => store,
        save: (v) => { store = v.slice(); },
        max: opts.max,
    });
    return { bank, peek: () => store };
}

const HEX_A = '11111111111111111111111111111111';
const HEX_B = '22222222222222222222222222222222';
const HEX_C = '33333333333333333333333333333333';

function fullComponent(fill = 0.5) {
    return Object.fromEntries(WEIGHT_KEYS.map((k) => [k, fill]));
}

describe('VoteBank pure helpers', () => {
    it('pairKey is order-independent and stable', () => {
        expect(pairKey(HEX_A, HEX_B)).toBe(pairKey(HEX_B, HEX_A));
        expect(pairKey(HEX_A, HEX_B)).not.toBe(pairKey(HEX_A, HEX_C));
    });

    it('extractFeatures snapshots every weight key, clamped to [0,1]', () => {
        const feats = extractFeatures({ ...fullComponent(0.3), criticality: 1.7, entropyBand: -2, extra: 9 });
        expect(Object.keys(feats).sort()).toEqual([...WEIGHT_KEYS].sort());
        expect(feats.criticality).toBe(1);
        expect(feats.entropyBand).toBe(0);
        expect(feats).not.toHaveProperty('extra');
    });

    it('extractFeatures returns null with no breakdown', () => {
        expect(extractFeatures(null)).toBeNull();
        expect(extractFeatures(undefined)).toBeNull();
    });
});

describe('nextPair selection', () => {
    it('returns null with fewer than two candidates', () => {
        expect(nextPair([], new Set())).toBeNull();
        expect(nextPair([{ hex: HEX_A }], new Set())).toBeNull();
    });

    it('never returns an already-voted pair', () => {
        const candidates = [{ hex: HEX_A, score: 0.5 }, { hex: HEX_B, score: 0.5 }];
        const voted = new Set([pairKey(HEX_A, HEX_B)]);
        expect(nextPair(candidates, voted)).toBeNull();
    });

    it('prefers similar scores and different cells (maximum information)', () => {
        // A↔B: close scores, same cell. A↔C: close scores, different cell (should win the cross-cell bonus).
        // B↔C: far scores. Deterministic rng picks the top-ranked pair.
        const candidates = [
            { hex: HEX_A, score: 0.80, cellKey: '1|1|c' },
            { hex: HEX_B, score: 0.79, cellKey: '1|1|c' },
            { hex: HEX_C, score: 0.80, cellKey: '2|2|c' },
        ];
        const pick = nextPair(candidates, new Set(), () => 0);
        const key = pairKey(pick.a.hex, pick.b.hex);
        expect(key).toBe(pairKey(HEX_A, HEX_C));
    });
});

describe('VoteBank persistence', () => {
    it('records a vote with the full record shape and persists it', () => {
        const { bank, peek } = makeBank();
        const rec = bank.record({
            aHex: HEX_A, bHex: HEX_B, winner: 'a',
            aMetrics: fullComponent(0.6), bMetrics: fullComponent(0.4),
            aScore: 0.6, bScore: 0.4, source: 'desktop',
        }, 12345);
        expect(rec).toMatchObject({ ts: 12345, aHex: HEX_A, bHex: HEX_B, winner: 'a', source: 'desktop' });
        expect(bank.getCount()).toBe(1);
        expect(peek()).toHaveLength(1);
        // Round-trips through a fresh bank reading the same store.
        const reopened = new VoteBank({ load: () => peek(), save: () => {} });
        expect(reopened.getCount()).toBe(1);
    });

    it('counts decisive votes (non-skip with features on both sides)', () => {
        const { bank } = makeBank();
        bank.record({ aHex: HEX_A, bHex: HEX_B, winner: 'a', aMetrics: fullComponent(), bMetrics: fullComponent() });
        bank.record({ aHex: HEX_A, bHex: HEX_C, winner: 'skip', aMetrics: fullComponent(), bMetrics: fullComponent() });
        bank.record({ aHex: HEX_B, bHex: HEX_C, winner: 'b', aMetrics: null, bMetrics: fullComponent() });
        expect(bank.getCount()).toBe(3);
        expect(bank.getDecisiveCount()).toBe(1);
    });

    it('enforces the FIFO cap, dropping oldest first', () => {
        const { bank } = makeBank({ max: 3 });
        for (let i = 0; i < 5; i++) {
            bank.record({ aHex: HEX_A, bHex: HEX_B, winner: 'a' }, i);
        }
        const votes = bank.getVotes();
        expect(votes).toHaveLength(3);
        expect(votes.map((v) => v.ts)).toEqual([2, 3, 4]);
    });

    it('votedPairKeys reflects every banked pairing', () => {
        const { bank } = makeBank();
        bank.record({ aHex: HEX_A, bHex: HEX_B, winner: 'a' });
        const keys = bank.votedPairKeys();
        expect(keys.has(pairKey(HEX_A, HEX_B))).toBe(true);
        expect(keys.has(pairKey(HEX_A, HEX_C))).toBe(false);
    });

    it('ignores malformed persisted entries on load', () => {
        const { bank } = makeBank({ initial: [null, { aHex: 1 }, { aHex: HEX_A, bHex: HEX_B, winner: 'x' }, { aHex: HEX_A, bHex: HEX_B, winner: 'a' }] });
        expect(bank.getCount()).toBe(1);
    });

    it('MAX_VOTES default is bounded', () => {
        expect(MAX_VOTES).toBe(2000);
    });
});
