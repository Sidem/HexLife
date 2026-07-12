import { describe, it, expect, vi, beforeEach } from 'vitest';

// PersistenceService touches localStorage (absent in node). Stub every entry point start()/the
// constructor reach so the search runs in pure node (mirrors autoExploreDeterminism.test.js).
vi.mock('../src/services/PersistenceService.js', () => ({
    saveUISetting: vi.fn(),
    loadUISetting: vi.fn((_k, d) => d),
    loadExploreGallery: vi.fn(() => []),
    saveExploreGallery: vi.fn(),
    loadEmbeddingGallery: vi.fn(() => []),
    saveEmbeddingGallery: vi.fn(),
}));

import { AutoExploreService } from '../src/core/AutoExploreService.js';
import { RulesetService } from '../src/core/RulesetService.js';
import * as Symmetry from '../src/core/Symmetry.js';
import { EventBus, EVENTS } from '../src/services/EventBus.js';

const SEED_HEX = '0123456789ABCDEF0123456789ABCDEF';

/** Non-killing synthetic metrics: positive activity, mid coverage, no cycle ⇒ every candidate survives
 *  screening AND confirmation, so target mode confirms + embeds all 9 (the model drives selection). */
function liveMetrics() {
    return {
        finalRatio: 0.4,
        finalActiveCount: 400,
        numCells: 1000,
        changed: { mean: 30, variance: 1, fano: 0.5, cv: 0.3 },
        blockEntropy: { mean: 0.4, variance: 0.005, spatialVariance: 0.02 },
        spatialOrder: { mean: 0.2, last: 0 },
        transport: { meanSpeed: 0.1 },
        sigma: 1.0,
        ruleUsageDelta: Array.from({ length: 8 }, (_, i) => i + 1),
        extinct: false,
        saturated: false,
        cycle: { detected: false, period: 0 },
    };
}

class FakeProxy {
    constructor(index) { this.index = index; }
    resetWorld() {}
    async runEvaluation() { return liveMetrics(); }
}

function makeFakeWM() {
    const rulesetService = new RulesetService(Symmetry.precomputeSymmetryGroups());
    const wm = {
        rulesetService,
        selectedWorldIndex: 4,
        getCurrentRulesetHex: () => SEED_HEX,
        _applyExploreRuleset() {},
        _captureAutoExploreSnapshot: () => ({}),
        _restoreAutoExploreSnapshot: () => {},
        _setAllWorldsEnabledForExplore: () => {},
    };
    wm.worlds = Array.from({ length: 9 }, (_, i) => new FakeProxy(i));
    return wm;
}

/** A four-dim CLIP-like space. The prompt vector is the x-axis; frames on world 0 point exactly along
 *  it (cosine 1), every other world points ~orthogonally (cosine ≈ 0.1). So candidate 0 is the match. */
const TARGET_VEC = new Float32Array([1, 0, 0, 0]);
function vecForWorld(w) {
    return w === 0 ? new Float32Array([1, 0, 0, 0]) : new Float32Array([0.1, 1, 0, 0]);
}

/**
 * Build an embedding provider fake. `embedText` returns the fixed target (or a caller-supplied override,
 * e.g. null to exercise the degradation path). `embed` maps a frame's world tag to its world's vector.
 */
function makeEmbeddingProvider({ textResult = TARGET_VEC } = {}) {
    return {
        isEnabled: () => true,
        ensureReady: async () => true,
        getStatus: () => 'ready',
        getModelId: () => 'test-model',
        embed: async (frame) => (frame ? vecForWorld(frame.world) : null),
        embedText: vi.fn(async () => textResult),
    };
}

/** Run a target-mode search; capture populations, per-generation progress, toasts, and the gallery. */
async function runTargetSearch(startOptions, providerOpts = {}) {
    const wm = makeFakeWM();
    const embeddingProvider = makeEmbeddingProvider(providerOpts);
    const service = new AutoExploreService(wm, {
        embeddingProvider,
        frameProvider: (worldIndex) => ({ world: worldIndex }),
    });

    const populations = [];
    const origBuild = service._buildPopulation.bind(service);
    service._buildPopulation = (...args) => {
        const pop = origBuild(...args);
        populations.push([...pop]);
        return pop;
    };

    const generations = [];
    const toasts = [];
    const unsubToast = EventBus.subscribe(EVENTS.COMMAND_SHOW_TOAST, (t) => toasts.push(t));
    const stopped = new Promise((resolve) => {
        const unsub = EventBus.subscribe(EVENTS.EXPLORE_PROGRESS, (p) => {
            if (!p) return;
            if (p.phase === 'generation') generations.push(p);
            if (p.phase === 'stopped') { unsub(); unsubToast(); resolve(); }
        });
    });

    service.start(startOptions);
    await stopped;
    return { service, wm, populations, generations, toasts, embeddingProvider };
}

describe('AutoExploreService — supervised target search (v3.2)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('embeds the prompt once and selects the champion by target cosine, not the statistical score', async () => {
        const r = await runTargetSearch({
            baseSeed: 2024, maxGenerations: 1, mutationMode: 'r_sym', populationSize: 9,
            targetPrompt: 'spirals', targetBankThreshold: 0.5,
        });

        // The prompt was embedded (once — cached thereafter is the service's job, not tested here).
        expect(r.embeddingProvider.embedText).toHaveBeenCalledWith('spirals');

        // Candidate 0 runs on world 0 (cosine 1 with the prompt); it must become champion.
        const gen0 = r.generations[0];
        expect(gen0.targetMode).toBe(true);
        expect(gen0.bestHex).toBe(r.populations[0][0]);
        // bestScore in target mode is the match cosine — candidate 0's is ~1.0, far above any other.
        expect(gen0.bestScore).toBeGreaterThan(0.99);
    });

    it('banks only finds whose target match clears targetBankThreshold', async () => {
        const r = await runTargetSearch({
            baseSeed: 7, maxGenerations: 1, mutationMode: 'r_sym', populationSize: 9,
            targetPrompt: 'spirals', targetBankThreshold: 0.5,
        });
        const entries = r.service.getGalleryEntries();
        // Only the cosine-1 match (world 0) clears 0.5; the ~0.1 candidates are confirmed but not banked.
        expect(entries.length).toBe(1);
        const best = entries[0];
        expect(best.targetSimilarity).toBeGreaterThan(0.99);
        expect(best.descriptorKind).toBe('embedding'); // banked under a perceptual SimHash cell
        expect(typeof best.cellKey).toBe('string');
        expect(best.cellKey.startsWith('e:')).toBe(true);
    });

    it('degrades to the statistical objective (and toasts) when the prompt cannot be embedded', async () => {
        const r = await runTargetSearch(
            { baseSeed: 11, maxGenerations: 1, mutationMode: 'r_sym', targetPrompt: 'spirals' },
            { textResult: null },
        );
        // The run still completes and produces a champion (statistical fallback), and warns once.
        expect(r.generations.length).toBe(1);
        expect(r.generations[0].bestHex).toBeTruthy();
        expect(r.toasts.some((t) => /statistical objective/i.test(t.message || ''))).toBe(true);
    });
});
