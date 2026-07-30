import { describe, expect, it, vi } from 'vitest';

/**
 * The Corpus Lab ZIP is assembled in the capture service but its contents are what the sibling
 * auditor consumes, so the entry list is worth pinning independently of the download plumbing.
 * `createStoredZip` and `downloadFile` are stubbed to capture the entries rather than to produce a
 * real archive — ZIP framing itself is covered by `zipStore.test.js`.
 */
const zipCalls = [];
const downloads = [];

vi.mock('../src/utils/ZipStore.js', () => ({
    createStoredZip: (entries) => {
        zipCalls.push(entries);
        return new Uint8Array([0x50, 0x4b, 0x05, 0x06]);
    },
}));

vi.mock('../src/utils/utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    downloadFile: (filename) => downloads.push(filename),
}));

const { TrajectoryCaptureService } = await import('../src/services/TrajectoryCaptureService.js');
const { CorpusCollectionBuffer } = await import('../src/core/analysis/CorpusCollectionBuffer.js');
const { CorpusVoteBank } = await import('../src/core/analysis/CorpusVoteBank.js');

function buffer() {
    const b = new CorpusCollectionBuffer({
        sessionId: 'session-abcdef12',
        createdAt: '2026-07-30T00:00:00.000Z',
        appVersion: '1.2.0',
    });
    b.add([{
        filename: 'family-a-rule-t0-clip1.hxlt',
        bytes: new Uint8Array([1, 2, 3]),
        header: {
            id: 'clip1',
            ruleset: '0'.repeat(32),
            family: 'family-a',
            label: 'interesting',
            scenario: 'glider',
            symmetryClass: 'free',
            gridPreset: 'medium',
            initialConditionId: 'ic-1',
            seedId: 'seed-1',
        },
    }], { familyId: 'family-a', anchorRuleset: '0'.repeat(32), relationship: 'mutation-lineage' });
    return b;
}

function candidate(id, scenario) {
    return {
        id,
        scenario,
        initialDensity: 0.2,
        ruleset: '0'.repeat(32),
        family: 'family-a',
        label: 'interesting',
        gridPreset: 'medium',
        initialConditionId: `ic-${id}`,
        seed: 1,
        clipIds: [`${id}-clip`],
    };
}

function names() {
    return zipCalls.at(-1).map((entry) => entry.name);
}

describe('Corpus Lab ZIP contents', () => {
    it('omits comparisons.jsonl entirely when no hard-pair votes were cast', () => {
        const service = new TrajectoryCaptureService({});
        service.downloadCorpusBuffer(buffer(), { voteBank: new CorpusVoteBank({ sessionId: 's' }) });
        expect(names()).toEqual([
            'family-a-rule-t0-clip1.hxlt',
            '_hexlife-corpus-session-session-abcdef12.json',
            '_families-v1-proposed-session-abcdef12.json',
        ]);
    });

    it('writes owner votes as comparisons.jsonl alongside the clips', () => {
        const votes = new CorpusVoteBank({ sessionId: 'session-abcdef12' });
        votes.addCandidate(candidate('a', 'glider'));
        votes.addCandidate(candidate('b', 'distributed_churn'));
        votes.record({ ...votes.nextPair(), winner: 'a' });

        const service = new TrajectoryCaptureService({});
        service.downloadCorpusBuffer(buffer(), { voteBank: votes });

        expect(names()).toContain('comparisons.jsonl');
        const entry = zipCalls.at(-1).find((row) => row.name === 'comparisons.jsonl');
        const rows = new TextDecoder().decode(entry.bytes).trim().split('\n').map((line) => JSON.parse(line));
        expect(rows).toHaveLength(1);
        expect(rows[0].source).toBe('owner-vote');
        expect(rows[0].hardPair).toBe('glider-vs-distributed-churn');
    });

    it('repeats the full vote set in every part, so no part has dangling clip references', () => {
        const votes = new CorpusVoteBank({ sessionId: 'session-abcdef12' });
        votes.addCandidate(candidate('a', 'glider'));
        votes.addCandidate(candidate('b', 'distributed_churn'));
        votes.record({ ...votes.nextPair(), winner: 'b' });

        const service = new TrajectoryCaptureService({});
        const b = buffer();
        service.downloadCorpusBuffer(b, { partIndex: 1, final: false, voteBank: votes });

        // The part suffix applies to the session/family files, never to the cumulative comparisons.
        expect(names()).toContain('_hexlife-corpus-session-session-abcdef12-part2.json');
        expect(names()).toContain('comparisons.jsonl');
        expect(downloads.at(-1)).toMatch(/-part2-/);
    });

    it('still refuses to write anything when no clips are buffered', () => {
        const service = new TrajectoryCaptureService({});
        const empty = new CorpusCollectionBuffer({ sessionId: 's', createdAt: '' });
        expect(() => service.downloadCorpusBuffer(empty)).toThrow('Nothing collected yet.');
    });
});
