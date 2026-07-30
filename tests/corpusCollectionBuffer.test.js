import { describe, expect, it, vi } from 'vitest';
import * as Config from '../src/core/config.js';
import { TrajectoryCaptureService } from '../src/services/TrajectoryCaptureService.js';
import {
    CorpusCollectionBuffer,
    DEFAULT_FLUSH_BYTES,
} from '../src/core/analysis/CorpusCollectionBuffer.js';

const LINEAGE = {
    familyId: 'lib-rain-freezing-200110000006',
    anchorRuleset: '200110000006000C8903020805009804',
    relationship: 'mutation-lineage',
};

/** @param {Partial<Record<string, any>>} header */
function clip(header = {}, byteLength = 1024) {
    return {
        filename: `${header.id || 'clip'}.hxlt`,
        bytes: new Uint8Array(byteLength),
        header: {
            id: 'clip-1',
            family: LINEAGE.familyId,
            label: 'interesting',
            scenario: 'glider',
            symmetryClass: 'r_sym',
            gridPreset: 'medium',
            initialConditionId: 'ic-aaaa',
            seedId: 'seed-1',
            seed: 1,
            ruleset: '0'.repeat(32),
            sourceTick: 10,
            payloadCrc32: 'deadbeef',
            ...header,
        },
    };
}

function buffer() {
    return new CorpusCollectionBuffer({
        sessionId: 'session-abcdef12',
        createdAt: '2026-07-30T00:00:00.000Z',
        appVersion: '1.1.0',
    });
}

describe('CorpusCollectionBuffer — accumulation', () => {
    it('requires a session id', () => {
        expect(() => new CorpusCollectionBuffer({})).toThrow(/sessionId/);
    });

    it('accumulates clips and payload bytes', () => {
        const b = buffer();
        b.add([clip({ id: 'a' }, 500), clip({ id: 'b' }, 700)], LINEAGE);
        expect(b.clipCount).toBe(2);
        expect(b.totalBytes).toBe(1200);
    });

    it('registers each family once, in first-seen order', () => {
        const b = buffer();
        b.add([clip({ id: 'a' })], LINEAGE);
        b.add([clip({ id: 'b' })], LINEAGE);
        b.add([clip({ id: 'c' })], { ...LINEAGE, familyId: 'rand-free-aabbccddeeff' });
        expect(b.familyRegistry().map((f) => f.id)).toEqual([
            LINEAGE.familyId,
            'rand-free-aabbccddeeff',
        ]);
    });

    it('rejects clips with no family', () => {
        expect(() => buffer().add([clip()], {})).toThrow(/familyId/);
    });

    it('skips empty payloads rather than recording phantom clips', () => {
        const b = buffer();
        b.add([{ filename: 'x.hxlt', bytes: new Uint8Array(0), header: {} }], LINEAGE);
        expect(b.clipCount).toBe(0);
    });
});

describe('CorpusCollectionBuffer — flush accounting', () => {
    it('signals a flush once the byte threshold is crossed', () => {
        const b = buffer();
        expect(b.shouldFlush(1000)).toBe(false);
        b.add([clip({ id: 'a' }, 1000)], LINEAGE);
        expect(b.shouldFlush(1000)).toBe(true);
        expect(b.shouldFlush(DEFAULT_FLUSH_BYTES)).toBe(false);
    });

    it('markFlushed clears payloads but preserves families and lifetime counts', () => {
        const b = buffer();
        b.add([clip({ id: 'a' }, 500), clip({ id: 'b' }, 500)], LINEAGE);
        b.markFlushed();
        expect(b.clipCount).toBe(0);
        expect(b.totalBytes).toBe(0);
        expect(b.lifetimeClipCount).toBe(2);
        // The registry must survive so part 2's proposed splits agree with part 1's.
        expect(b.familyRegistry()).toHaveLength(1);
    });

    it('a later part reports the running session total, not just its own clips', () => {
        const b = buffer();
        b.add([clip({ id: 'a' })], LINEAGE);
        b.markFlushed();
        b.add([clip({ id: 'b' })], LINEAGE);
        const index = b.index({ partIndex: 1, final: true });
        expect(index.clipCount).toBe(1);
        expect(index.sessionClipCount).toBe(2);
    });
});

describe('CorpusCollectionBuffer — coverage', () => {
    it('tallies labels, scenarios, symmetry classes, and grid presets', () => {
        const b = buffer();
        b.add([
            clip({ id: 'a', label: 'interesting', scenario: 'glider', symmetryClass: 'r_sym', gridPreset: 'small' }),
            clip({ id: 'b', label: 'boring', scenario: 'extinction', symmetryClass: 'free', gridPreset: 'small' }),
            clip({ id: 'c', label: 'boring', scenario: 'glider', symmetryClass: 'r_sym', gridPreset: 'medium' }),
        ], LINEAGE);
        const c = b.coverage();
        expect(c.labels).toEqual({ interesting: 1, boring: 2 });
        expect(c.scenarios).toEqual({ glider: 2, extinction: 1 });
        expect(c.symmetryClasses).toEqual({ r_sym: 2, free: 1 });
        expect(c.gridPresets).toEqual({ small: 2, medium: 1 });
    });

    it('separates coverage-eligible clips from unknown-scenario ones', () => {
        const b = buffer();
        b.add([
            clip({ id: 'a', scenario: 'glider' }),
            clip({ id: 'b', scenario: 'unknown' }),
        ], LINEAGE);
        const c = b.coverage();
        expect(c.clips).toBe(2);
        expect(c.coverageEligibleClips).toBe(1); // the audit ignores the unknown one
    });

    it('counts per-ruleset seed and initial-condition diversity against the audit minimums', () => {
        const b = buffer();
        const ruleset = 'A'.repeat(32);
        // Three seeds and two initial conditions for one ruleset satisfies both minimums.
        b.add([
            clip({ id: 'a', ruleset, seedId: 'seed-1', initialConditionId: 'ic-1' }),
            clip({ id: 'b', ruleset, seedId: 'seed-2', initialConditionId: 'ic-1' }),
            clip({ id: 'c', ruleset, seedId: 'seed-3', initialConditionId: 'ic-2' }),
        ], LINEAGE);
        const c = b.coverage();
        expect(c.distinctRulesets).toBe(1);
        expect(c.rulesetsWithThreeSeeds).toBe(1);
        expect(c.rulesetsWithTwoInitialConditions).toBe(1);
    });

    it('does not credit repeated slices from one reset as seed diversity', () => {
        const b = buffer();
        const ruleset = 'B'.repeat(32);
        // Consecutive slices share the reset, so they share seedId and initialConditionId.
        b.add([
            clip({ id: 'a', ruleset, seedId: 'seed-9', initialConditionId: 'ic-9' }),
            clip({ id: 'b', ruleset, seedId: 'seed-9', initialConditionId: 'ic-9' }),
            clip({ id: 'c', ruleset, seedId: 'seed-9', initialConditionId: 'ic-9' }),
        ], LINEAGE);
        const c = b.coverage();
        expect(c.rulesetsWithThreeSeeds).toBe(0);
        expect(c.rulesetsWithTwoInitialConditions).toBe(0);
    });
});

describe('CorpusCollectionBuffer — proposed family registry', () => {
    it('meets the protocol 6/2/2 family minimums at ten families', () => {
        const b = buffer();
        for (let index = 0; index < 10; index++) {
            b.add([clip({ id: `c${index}` })], { ...LINEAGE, familyId: `rand-free-${String(index).repeat(12).slice(0, 12)}` });
        }
        const splits = b.familyRegistry().reduce((acc, entry) => {
            acc[entry.split] = (acc[entry.split] || 0) + 1;
            return acc;
        }, {});
        expect(splits.train).toBeGreaterThanOrEqual(6);
        expect(splits.validation).toBeGreaterThanOrEqual(2);
        expect(splits.test).toBeGreaterThanOrEqual(2);
    });

    it('emits exactly the four fields families-v1.json requires', () => {
        const b = buffer();
        b.add([clip()], LINEAGE);
        const [entry] = b.familyRegistry();
        expect(Object.keys(entry).sort()).toEqual(['anchorRuleset', 'id', 'relationship', 'split']);
        expect(entry.anchorRuleset).toBe(LINEAGE.anchorRuleset);
        expect(entry.relationship).toBe('mutation-lineage');
    });

    it('labels the registry as a proposal, since splits are the owner\'s to register', () => {
        const b = buffer();
        b.add([clip()], LINEAGE);
        expect(b.index().proposedFamiliesNote).toMatch(/families-v1\.json/);
        expect(b.index().proposedFamiliesNote).toMatch(/immutable after the first training run/);
    });
});

describe('CorpusCollectionBuffer — index', () => {
    it('carries the protocol id and session identity', () => {
        const b = buffer();
        b.add([clip()], LINEAGE);
        const index = b.index();
        expect(index.schema).toBe('HXLT-CORPUS-SESSION-1');
        expect(index.corpusProtocol).toBe('corpus-v1');
        expect(index.sessionId).toBe('session-abcdef12');
        expect(index.appVersion).toBe('1.1.0');
        expect(index.final).toBe(true);
    });

    it('lists every provenance field the audit reads per clip', () => {
        const b = buffer();
        b.add([clip({ id: 'only' })], LINEAGE);
        const [row] = b.index().clips;
        for (const field of [
            'filename', 'id', 'family', 'label', 'scenario', 'symmetryClass',
            'gridPreset', 'initialConditionId', 'seed', 'ruleset', 'sourceTick', 'payloadCrc32',
        ]) {
            expect(row, field).toHaveProperty(field);
        }
    });
});

describe('captureJudgedWorld', () => {
    const bytesPerFrame = Math.ceil(Config.NUM_CELLS / 8);
    const makeFrames = () => [new Uint8Array(bytesPerFrame), new Uint8Array(bytesPerFrame)];

    function makeService(overrides = {}) {
        const proxy = {
            isInitialized: true,
            lastResetSeed: 4242,
            getLatestStats: () => ({ rulesetHex: '0'.repeat(32) }),
            captureTrajectory: vi.fn(async () => ({ frames: makeFrames(), sourceTick: 5 })),
            captureTrajectorySeries: vi.fn(async () => [
                { frames: makeFrames(), sourceTick: 10 },
                { frames: makeFrames(), sourceTick: 16 },
            ]),
            ...overrides,
        };
        const service = new TrajectoryCaptureService({
            selectedWorldIndex: 0,
            worlds: [proxy],
            worldSettings: [{
                rulesetHex: '0'.repeat(32),
                initialState: { mode: 'density', params: { density: 0.5 } },
            }],
            autoExploreService: { isRunning: () => false },
        });
        return { service, proxy };
    }

    const valid = { label: 'interesting', family: LINEAGE.familyId, scenario: 'glider' };

    it('encodes the derived family and classified scenario into every clip header', async () => {
        const { service } = makeService();
        const { clips } = await service.captureJudgedWorld(0, { ...valid, frameCount: 2, sliceCount: 2 });
        expect(clips).toHaveLength(2);
        for (const c of clips) {
            expect(c.header.family).toBe(LINEAGE.familyId);
            expect(c.header.scenario).toBe('glider');
            expect(c.header.label).toBe('interesting');
            expect(c.header.corpusProtocol).toBe('corpus-v1');
            expect(c.header.seed).toBe(4242);
        }
    });

    it('names files by family so an extracted corpus stays browsable', async () => {
        const { service } = makeService();
        const { clips } = await service.captureJudgedWorld(0, { ...valid, frameCount: 2, sliceCount: 1 });
        expect(clips[0].filename.startsWith('lib-rain-freezing-200110000006-')).toBe(true);
        expect(clips[0].filename.endsWith('.hxlt')).toBe(true);
    });

    it('shares one collectionId across a slice set', async () => {
        const { service } = makeService();
        const { clips } = await service.captureJudgedWorld(0, { ...valid, frameCount: 2, sliceCount: 2 });
        expect(new Set(clips.map((c) => c.header.collectionId)).size).toBe(1);
        expect(clips.map((c) => c.header.collectionIndex)).toEqual([0, 1]);
        expect(clips.map((c) => c.header.sourceTick)).toEqual([10, 16]);
    });

    it('refuses an unlabeled judgment', async () => {
        const { service } = makeService();
        await expect(service.captureJudgedWorld(0, { ...valid, label: 'unlabeled' }))
            .rejects.toThrow(/interesting or boring/);
    });

    it('refuses a family id that is not protocol-valid', async () => {
        const { service } = makeService();
        await expect(service.captureJudgedWorld(0, { ...valid, family: 'Not Valid!' }))
            .rejects.toThrow(/protocol-valid/);
    });

    it('refuses an unknown scenario id', async () => {
        const { service } = makeService();
        await expect(service.captureJudgedWorld(0, { ...valid, scenario: 'gliders' }))
            .rejects.toThrow(/Unknown scenario/);
    });

    it('refuses a world with no known reset seed, which the audit requires', async () => {
        const { service } = makeService({ lastResetSeed: undefined });
        await expect(service.captureJudgedWorld(0, valid)).rejects.toThrow(/reset seed/);
    });

    it('refuses to capture while Auto-Explore is running', async () => {
        const { service } = makeService();
        service.wm.autoExploreService = { isRunning: () => true };
        await expect(service.captureJudgedWorld(0, valid)).rejects.toThrow(/Auto-Explore/);
    });

    it('feeds straight into the buffer', async () => {
        const { service } = makeService();
        const b = buffer();
        const { clips } = await service.captureJudgedWorld(0, { ...valid, frameCount: 2, sliceCount: 2 });
        b.add(clips, LINEAGE);
        expect(b.clipCount).toBe(2);
        expect(b.coverage().scenarios).toEqual({ glider: 2 });
        expect(b.familyRegistry()[0].id).toBe(LINEAGE.familyId);
    });
});
