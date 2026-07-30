import { describe, expect, it } from 'vitest';
import { CorpusVoteBank, candidatePairKey } from '../src/core/analysis/CorpusVoteBank.js';
import { CORPUS_HARD_PAIRS, hardPairsForScenarios } from '../src/core/analysis/corpusProtocol.js';

/** @param {Partial<import('../src/core/analysis/CorpusVoteBank.js').VoteCandidate>} overrides */
function candidate(id, scenario, initialDensity, overrides = {}) {
    return {
        id,
        scenario,
        initialDensity,
        ruleset: '0'.repeat(32),
        family: 'family-a',
        label: 'interesting',
        gridPreset: 'medium',
        initialConditionId: `ic-${id}`,
        seed: 1,
        clipIds: [`${id}-clip`],
        ...overrides,
    };
}

function bank() {
    return new CorpusVoteBank({ sessionId: 'session-1' });
}

describe('corpus hard-pair protocol', () => {
    it('mirrors the four frozen strata with 12 owner votes each', () => {
        expect(CORPUS_HARD_PAIRS).toHaveLength(4);
        expect(CORPUS_HARD_PAIRS.every((pair) => pair.minimumOwnerVotes === 12)).toBe(true);
        expect(CORPUS_HARD_PAIRS.every((pair) => pair.maximumInitialDensityDelta === 0.05)).toBe(true);
        expect(CORPUS_HARD_PAIRS.filter((pair) => pair.strictRegression).map((pair) => pair.id))
            .toEqual(['glider-vs-distributed-churn']);
    });

    it('credits a glider-vs-churn comparison to both strata that admit it', () => {
        expect(hardPairsForScenarios('glider', 'distributed_churn').map((pair) => pair.id))
            .toEqual(['glider-vs-distributed-churn', 'localized-vs-distributed-change']);
        // Order-independent: the owner may see either world on either side.
        expect(hardPairsForScenarios('distributed_churn', 'glider').map((pair) => pair.id))
            .toEqual(['glider-vs-distributed-churn', 'localized-vs-distributed-change']);
        expect(hardPairsForScenarios('glider', 'saturation')).toEqual([]);
    });
});

describe('CorpusVoteBank', () => {
    it('keeps only candidates some stratum can actually pair', () => {
        const votes = bank();
        expect(votes.addCandidate(candidate('a', 'glider', 0.2))).toBe(true);
        expect(votes.addCandidate(candidate('b', 'saturation', 0.2))).toBe(false);
        expect(votes.addCandidate(candidate('a', 'glider', 0.2))).toBe(false);
        expect(votes.candidates).toHaveLength(1);
    });

    it('refuses to offer a pairing outside the density tolerance', () => {
        const votes = bank();
        votes.addCandidate(candidate('a', 'glider', 0.20));
        votes.addCandidate(candidate('b', 'distributed_churn', 0.30));
        expect(votes.nextPair()).toBeNull();

        votes.addCandidate(candidate('c', 'distributed_churn', 0.24));
        const pair = votes.nextPair();
        expect(pair?.b.id).toBe('c');
        expect(pair?.delta).toBeCloseTo(0.04, 10);
    });

    it('never offers a candidate whose starting density is unknown', () => {
        const votes = bank();
        votes.addCandidate(candidate('a', 'glider', null));
        votes.addCandidate(candidate('b', 'distributed_churn', 0.2));
        expect(votes.nextPair()).toBeNull();
    });

    it('prefers the tightest density match available', () => {
        const votes = bank();
        votes.addCandidate(candidate('a', 'glider', 0.20));
        votes.addCandidate(candidate('loose', 'distributed_churn', 0.24));
        votes.addCandidate(candidate('tight', 'distributed_churn', 0.205));
        expect(votes.nextPair()?.b.id).toBe('tight');
    });

    it('credits one vote to every stratum it satisfies and banks a jsonl row', () => {
        const votes = bank();
        votes.addCandidate(candidate('a', 'glider', 0.2));
        votes.addCandidate(candidate('b', 'distributed_churn', 0.2));
        const pair = votes.nextPair();

        expect(votes.record({ ...pair, winner: 'a' }))
            .toEqual(['glider-vs-distributed-churn', 'localized-vs-distributed-change']);
        expect(votes.tallies['glider-vs-distributed-churn']).toBe(1);
        expect(votes.tallies['localized-vs-distributed-change']).toBe(1);
        expect(votes.tallies['still-life-vs-oscillator']).toBe(0);

        const rows = votes.comparisonsJsonl().trim().split('\n').map((line) => JSON.parse(line));
        expect(rows).toHaveLength(1);
        expect(rows[0].source).toBe('owner-vote');
        expect(rows[0].hardPair).toBe('glider-vs-distributed-churn');
        expect(rows[0].hardPairs).toEqual(['glider-vs-distributed-churn', 'localized-vs-distributed-change']);
        expect(rows[0].winner).toBe('a');
        expect(rows[0].a.id).toBe('a');
        expect(rows[0].b.clipIds).toEqual(['b-clip']);
    });

    it('never offers the same unordered pairing twice, including after a skip', () => {
        const votes = bank();
        votes.addCandidate(candidate('a', 'glider', 0.2));
        votes.addCandidate(candidate('b', 'distributed_churn', 0.2));

        const first = votes.nextPair();
        expect(first).not.toBeNull();
        expect(votes.record({ ...first, winner: 'skip' })).toEqual([]);
        expect(votes.voteCount).toBe(0);
        expect(votes.nextPair()).toBeNull();
    });

    it('serves the stratum furthest from its quota first', () => {
        const votes = bank();
        // Both strata servable; still-life/oscillator is untouched, so it should win over a
        // glider stratum that already has votes banked.
        votes.addCandidate(candidate('g1', 'glider', 0.2));
        votes.addCandidate(candidate('c1', 'distributed_churn', 0.2));
        votes.addCandidate(candidate('s1', 'still_life', 0.2));
        votes.addCandidate(candidate('o1', 'oscillator', 0.2));

        votes.tallies['glider-vs-distributed-churn'] = 11;
        votes.tallies['localized-vs-distributed-change'] = 11;
        expect(votes.nextPair()?.hardPair.id).toBe('still-life-vs-oscillator');
    });

    it('reports which scenarios block an unservable stratum', () => {
        const votes = bank();
        votes.addCandidate(candidate('g1', 'glider', 0.2));
        const status = votes.voteStatus();

        expect(status.passing).toBe(false);
        expect(status.totalNeeded).toBe(48);
        const stillLife = status.strata.find((s) => s.id === 'still-life-vs-oscillator');
        expect(stillLife.blockedBy).toEqual(['still_life', 'oscillator']);
        const gliderChurn = status.strata.find((s) => s.id === 'glider-vs-distributed-churn');
        expect(gliderChurn.blockedBy).toEqual(['distributed_churn']);
        expect(status.deficits.some((line) => line.includes('no clips yet for still_life, oscillator'))).toBe(true);
    });

    it('flags a stratum that has clips on both sides but no unoffered matched pairing', () => {
        const votes = bank();
        votes.addCandidate(candidate('a', 'glider', 0.2));
        votes.addCandidate(candidate('b', 'distributed_churn', 0.2));
        votes.record({ ...votes.nextPair(), winner: 'a' });

        const stratum = votes.voteStatus().strata.find((s) => s.id === 'glider-vs-distributed-churn');
        expect(stratum.blockedBy).toEqual([]);
        expect(stratum.exhausted).toBe(true);
    });

    it('withdraws votes that depended on an undone judgment', () => {
        const votes = bank();
        votes.addCandidate(candidate('a', 'glider', 0.2));
        votes.addCandidate(candidate('b', 'distributed_churn', 0.2));
        votes.record({ ...votes.nextPair(), winner: 'a' });
        expect(votes.voteCount).toBe(1);

        expect(votes.removeCandidate('b')).toBe(true);
        expect(votes.voteCount).toBe(0);
        expect(votes.tallies['glider-vs-distributed-churn']).toBe(0);
        expect(votes.tallies['localized-vs-distributed-change']).toBe(0);
        expect(votes.comparisonsJsonl()).toBe('');
        expect(votes.removeCandidate('nope')).toBe(false);
    });

    it('round-trips through the grid-switch snapshot without re-serving offered pairs', () => {
        const votes = bank();
        votes.addCandidate(candidate('a', 'glider', 0.2));
        votes.addCandidate(candidate('b', 'distributed_churn', 0.2));
        votes.record({ ...votes.nextPair(), winner: 'b' });

        const restored = bank();
        restored.restore(votes.snapshot());

        expect(restored.voteCount).toBe(1);
        expect(restored.tallies['glider-vs-distributed-churn']).toBe(1);
        expect(restored.candidates.map((c) => c.id).sort()).toEqual(['a', 'b']);
        expect(restored.nextPair()).toBeNull();
        expect(restored.comparisonsJsonl()).toBe(votes.comparisonsJsonl());
    });

    it('keys pairings order-independently', () => {
        expect(candidatePairKey('a', 'b')).toBe(candidatePairKey('b', 'a'));
        expect(candidatePairKey('a', 'b')).not.toBe(candidatePairKey('a', 'c'));
    });

    it('emits newline-delimited json with no trailing blank line', () => {
        const votes = bank();
        expect(votes.comparisonsJsonl()).toBe('');
        votes.addCandidate(candidate('a', 'glider', 0.2));
        votes.addCandidate(candidate('b', 'distributed_churn', 0.2));
        votes.record({ ...votes.nextPair(), winner: 'a' });

        const text = votes.comparisonsJsonl();
        expect(text.endsWith('\n')).toBe(true);
        expect(text.split('\n').filter(Boolean)).toHaveLength(1);
    });
});
