import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/PersistenceService.js', () => ({
    saveUISetting: vi.fn(),
    loadUISetting: vi.fn((_key, fallback) => fallback),
    loadExploreGallery: vi.fn(() => []),
    saveExploreGallery: vi.fn(),
    loadNativeDescriptorGallery: vi.fn(() => []),
    saveNativeDescriptorGallery: vi.fn(),
}));

import { AutoExploreService } from '../src/core/AutoExploreService.js';
import { RulesetService } from '../src/core/RulesetService.js';
import * as Symmetry from '../src/core/Symmetry.js';
import * as PersistenceService from '../src/services/PersistenceService.js';
import { EventBus, EVENTS } from '../src/services/EventBus.js';

const SEED_HEX = '0123456789ABCDEF0123456789ABCDEF';

function liveMetrics() {
    return {
        finalRatio: 0.35,
        finalActiveCount: 350,
        numCells: 1000,
        changed: { mean: 25, variance: 9, fano: 0.36, cv: 0.4 },
        blockEntropy: { mean: 0.4, variance: 0.006, spatialVariance: 0.025 },
        spatialOrder: { mean: 0.25, last: 0.25 },
        changeOrder: { mean: 0.4, last: 0.4 },
        transport: { meanSpeed: 0.15 },
        sigma: 1,
        ruleUsageDelta: [1, 2, 3, 4, 5, 6, 7, 8],
        extinct: false,
        saturated: false,
        cycle: { detected: false, period: 0 },
    };
}

class FakeProxy {
    constructor(index) {
        this.index = index;
    }
    resetWorld() {}
    async runEvaluation() {
        return liveMetrics();
    }
    async captureTrajectory({ frameCount }) {
        return {
            frames: Array.from({ length: frameCount }, () => new Uint8Array([this.index])),
        };
    }
}

function makeWorldManager() {
    const wm = {
        rulesetService: new RulesetService(Symmetry.precomputeSymmetryGroups()),
        selectedWorldIndex: 4,
        getCurrentRulesetHex: () => SEED_HEX,
        _applyExploreRuleset() {},
        _captureAutoExploreSnapshot: () => ({}),
        _restoreAutoExploreSnapshot() {},
        _setAllWorldsEnabledForExplore() {},
    };
    wm.worlds = Array.from({ length: 9 }, (_, index) => new FakeProxy(index));
    return wm;
}

async function run(options, nativeModelProvider = null) {
    const service = new AutoExploreService(makeWorldManager(), { nativeModelProvider });
    const generations = [];
    await new Promise((resolve) => {
        const unsubscribe = EventBus.subscribe(EVENTS.EXPLORE_PROGRESS, (progress) => {
            if (progress?.phase === 'generation') generations.push(progress);
            if (progress?.phase === 'stopped') {
                unsubscribe();
                resolve();
            }
        });
        service.start({
            baseSeed: 12345,
            maxGenerations: 1,
            icLabels: ['chaos'],
            findThreshold: 0,
            objective: nativeModelProvider ? 'native-beta' : 'statistical',
            ...options,
        });
    });
    return { service, generations };
}

describe('AutoExplore native ranking', () => {
    beforeEach(() => vi.clearAllMocks());

    it('uses calibrated native reward for ranking and native descriptors for cells', async () => {
        const provider = {
            setEnabled: vi.fn(),
            ensureReady: vi.fn(async () => true),
            getStatus: () => ({ modelId: 'native-test' }),
            evaluate: vi.fn(async ({ frames }) => {
                const world = frames[0][0];
                const descriptor = new Float32Array(32);
                descriptor[world % 32] = 1;
                return {
                    reward: world === 0 ? 0.99 : 0.1,
                    rawReward: world === 0 ? 4 : -2,
                    descriptor,
                    modelId: 'native-test',
                };
            }),
        };
        const { service, generations } = await run({}, provider);
        expect(provider.evaluate).toHaveBeenCalledTimes(9);
        expect(generations[0].bestScore).toBe(0.99);
        expect(service.getGalleryEntries().some((entry) =>
            entry.score === 0.99
            && entry.statisticalScore !== entry.score
            && entry.descriptorKind === 'native'
            && entry.cellKey.startsWith('n:')
        )).toBe(true);
    });

    it('falls back to the byte-identical statistical result when every inference fails', async () => {
        const baseline = await run({});
        const provider = {
            setEnabled: vi.fn(),
            ensureReady: vi.fn(async () => false),
            getStatus: () => ({ modelId: 'broken' }),
            evaluate: vi.fn(async () => { throw new Error('forced failure'); }),
        };
        const fallback = await run({}, provider);
        expect(fallback.generations[0].bestHex).toBe(baseline.generations[0].bestHex);
        expect(fallback.generations[0].bestScore).toBe(baseline.generations[0].bestScore);
        expect(fallback.service.getGalleryEntries().every((entry) =>
            entry.descriptorKind === 'stats' && entry.nativeModelId == null
        )).toBe(true);
    });

    it('re-keys the descriptor archive once the real model id is known', () => {
        // The service is constructed long before the manifest arrives, so the first load runs under
        // a null model id and cannot self-invalidate. WorldManager calls onNativeModelChanged() when
        // NATIVE_MODEL_STATUS_CHANGED first carries an id; this must re-read and re-persist under it.
        const status = { modelId: null };
        const provider = { getStatus: () => status };
        const service = new AutoExploreService(makeWorldManager(), { nativeModelProvider: provider });
        expect(PersistenceService.loadNativeDescriptorGallery).toHaveBeenLastCalledWith(null);

        status.modelId = 'native-real';
        const stale = service.descriptorArchive;
        service.onNativeModelChanged();
        expect(service.descriptorArchive).not.toBe(stale);
        expect(PersistenceService.loadNativeDescriptorGallery).toHaveBeenLastCalledWith('native-real');
        expect(PersistenceService.saveNativeDescriptorGallery).toHaveBeenLastCalledWith([], 'native-real');
    });
});
