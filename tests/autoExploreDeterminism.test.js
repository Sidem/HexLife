import { describe, it, expect, vi, beforeEach } from 'vitest';

// PersistenceService touches localStorage (absent in node) and is called from start()/the
// constructor. Stub every entry point the service reaches so the search runs in pure node.
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

/** FNV-1a over a string → uint32. Deterministic synthetic-metric hash. */
function fnv1a(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

/**
 * Deterministic synthetic EVALUATION_RESULT derived from (applied hex, reset seed). No hard-kill
 * signals fire (positive activity, mid-range coverage, no cycle), so every candidate is scorable and
 * champion selection is genuinely exercised. Metric values are spread across [0,1) so scores differ.
 */
function synthMetrics(hex, seed) {
    const h = fnv1a(`${hex}|${seed}`);
    const u = (shift) => ((h >>> shift) & 0xff) / 255; // pseudo-uniform byte → [0,1]
    const finalRatio = 0.2 + u(0) * 0.5;               // 0.2..0.7 — never saturated/extinct
    return {
        finalRatio,
        finalActiveCount: Math.max(1, Math.round(finalRatio * 1000)),
        numCells: 1000,
        changed: { mean: 5 + u(8) * 40, variance: 1, fano: 0.5, cv: 0.1 + u(16) * 0.6 },
        blockEntropy: {
            mean: 0.25 + u(24) * 0.4,
            variance: u(4) * 0.01,
            spatialVariance: u(12) * 0.04,
        },
        spatialOrder: { mean: (u(20) - 0.5) * 0.5, last: 0 },
        transport: { meanSpeed: u(28) * 0.3 },
        sigma: 0.5 + u(2) * 1.0,
        ruleUsageDelta: Array.from({ length: 8 }, (_, i) => ((h >>> i) & 0x7) + 1),
        extinct: false,
        saturated: false,
        cycle: { detected: false, period: 0 },
    };
}

/** A fake world proxy: records reset seeds; resolves synthetic metrics from the currently-applied hex. */
class FakeProxy {
    constructor(index, wm) {
        this.index = index;
        this.wm = wm;
        this.resetSeeds = [];
        this._lastSeed = 0;
    }
    resetWorld(_initialState, seed) {
        this._lastSeed = seed;
        this.resetSeeds.push(seed);
    }
    async runEvaluation(_opts) {
        return synthMetrics(this.wm.appliedHex[this.index], this._lastSeed);
    }
}

/** Minimal WorldManager stand-in: real (pure) RulesetService, 9 fake proxies, no-op explore hooks. */
function makeFakeWM() {
    const rulesetService = new RulesetService(Symmetry.precomputeSymmetryGroups());
    const wm = {
        rulesetService,
        selectedWorldIndex: 4,
        appliedHex: new Array(9).fill(SEED_HEX),
        getCurrentRulesetHex: () => SEED_HEX,
        _applyExploreRuleset(idx, hex) { this.appliedHex[idx] = hex; },
        _captureAutoExploreSnapshot: () => ({}),
        _restoreAutoExploreSnapshot: () => {},
        _setAllWorldsEnabledForExplore: () => {},
    };
    // Nine rendered worlds, always — a larger population time-shares these via per-worker queues.
    wm.worlds = Array.from({ length: 9 }, (_, i) => new FakeProxy(i, wm));
    return wm;
}

/** Run a full search to completion, capturing populations, champions, per-proxy seeds, and badges. */
async function runSearch(startOptions) {
    const wm = makeFakeWM();
    const service = new AutoExploreService(wm);

    const populations = [];
    const origBuild = service._buildPopulation.bind(service);
    service._buildPopulation = (...args) => {
        const pop = origBuild(...args);
        populations.push([...pop]);
        return pop;
    };

    const champions = [];
    const badgeLengths = [];
    const stopped = new Promise((resolve) => {
        const unsub = EventBus.subscribe(EVENTS.EXPLORE_PROGRESS, (p) => {
            if (!p) return;
            if (p.phase === 'generation') {
                champions.push(p.bestHex);
                if (p.perWorldScores) badgeLengths.push(p.perWorldScores.length);
            }
            if (p.phase === 'stopped') { unsub(); resolve(); }
        });
    });

    service.start(startOptions);
    await stopped;

    return {
        service,
        wm,
        populations,
        champions,
        badgeLengths,
        resetSeeds: wm.worlds.map((p) => p.resetSeeds),
    };
}

// --- Golden trajectory pinned from the current code (baseSeed 123456, 3 generations, r_sym). This is
// the byte-identity oracle for Stage 2: the population decoupling must leave populationSize:9 replays
// EXACTLY as they were. Regenerate ONLY if the search algorithm intentionally changes (and then the
// change is, by definition, a breaking change to every shared search link). ---
const GOLDEN_POPULATIONS = [
    [
        '0103050F113355FF0103050F113355FF', '0106152D12734DB70103050F113355FF',
        '0103050F113355FF8103050F113355FF', '0103050F113355FF0103050F113355FF',
        '0103050F113355FF0103050F113355FF', '0103050F113355FF130B058F5133D5FF',
        '0103050F113355FF0112075D143F67B7', '0103050F113355FF130B058F5133D5FF',
        '0103050F113355FF135B27CF5D3BF5FE',
    ],
    [
        '0103050F113355FF130B058F5133D5FF', '0103010F111355FF130B058F5133D5FE',
        '0103040B112151DF7BDBA7CFDD3BF5FF', '0103050F113355FF130B058F5133D5FE',
        '0103050F113355FF130B058F5133D5FF', '0103040B112151DF130B058F5133D5FF',
        '130B058F5133D5FF172B4D8F71B3D5FF', '0103050F113355FF8103050F113355FF',
        '0103050F113355FF130B058F5133D5FF',
    ],
    [
        '130B058F5133D5FF172B4D9E71B6D6E9', '130B058F5133D5FF172B4D8F71B3D5FF',
        '130B058F5133D5FF130B058F5133D5FE', '0103050F113355FF130B058F5133D5FF',
        '0103050F113355FF130B058F5133D5FF', '0103050E113254E9130B018E5112D4E9',
        '0102050D103345B79208058440328421', '0103050F113355FF130B058F5133D5FE',
        '0103050F113355FF130A058D5033C5B7',
    ],
];
const GOLDEN_CHAMPIONS = [
    '0103050F113355FF130B058F5133D5FF',
    '0103050F113355FF130B058F5133D5FF',
    '130B058F5133D5FF172B4D8F71B3D5FF',
];
const GOLDEN_RESETSEEDS = [
    [123456, 123457, 123458, 123459, 123460, 123461, 123462, 123457, 133429, 133430, 133431, 133432, 133433, 133434, 133435, 133434, 143402, 143403, 143404, 143405, 143406, 143407, 143408, 143405],
    [123553, 123554, 123555, 123556, 123557, 123558, 123559, 123558, 133526, 133527, 133528, 133529, 133530, 133531, 133532, 133526, 143499, 143500, 143501, 143502, 143503, 143504, 143505, 143504],
    [123650, 123651, 123652, 123653, 123654, 123655, 123656, 123653, 133623, 133624, 133625, 133626, 133627, 133628, 133629, 133625, 143596, 143597, 143598, 143599, 143600, 143601, 143602, 143597],
    [123747, 123748, 123749, 123750, 123751, 123752, 123753, 123747, 133720, 133721, 133722, 133723, 133724, 133725, 133726, 133722, 143693, 143694, 143695, 143696, 143697, 143698, 143699, 143699],
    [123844, 123845, 123846, 123847, 123848, 123849, 123850, 123850, 133817, 133818, 133819, 133820, 133821, 133822, 133823, 133821, 143790, 143791, 143792, 143793, 143794, 143795, 143796, 143794],
    [123941, 123942, 123943, 123944, 123945, 123946, 123947, 123946, 133914, 133915, 133916, 133917, 133918, 133919, 133920, 133914, 143887, 143888, 143889, 143890, 143891, 143892, 143893, 143887],
    [124038, 124039, 124040, 124041, 124042, 124043, 124044, 124039, 134011, 134012, 134013, 134014, 134015, 134016, 134017, 134016, 143984, 143985, 143986, 143987, 143988, 143989, 143990, 143984],
    [124135, 124136, 124137, 124138, 124139, 124140, 124141, 124136, 134108, 134109, 134110, 134111, 134112, 134113, 134114, 134108, 144081, 144082, 144083, 144084, 144085, 144086, 144087],
    [124232, 124233, 124234, 124235, 124236, 124237, 124238, 124238, 134205, 134206, 134207, 134208, 134209, 134210, 134211, 134208, 144178, 144179, 144180, 144181, 144182, 144183, 144184, 144184],
];

describe('AutoExploreService determinism (golden characterization)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('replays the exact population, champion, and reset-seed trajectory for baseSeed 123456', async () => {
        const r = await runSearch({ baseSeed: 123456, maxGenerations: 3, mutationMode: 'r_sym' });
        expect(r.populations).toEqual(GOLDEN_POPULATIONS);
        expect(r.champions).toEqual(GOLDEN_CHAMPIONS);
        expect(r.resetSeeds).toEqual(GOLDEN_RESETSEEDS);
        // Per-slot badge array is always one entry per rendered world.
        expect(r.badgeLengths).toEqual([9, 9, 9]);
    });

    it('an explicit empty targetPrompt is byte-identical to the statistical pipeline (v3.2)', async () => {
        // Acceptance criterion 1: no prompt ⇒ the entire trajectory is identical to Stage 2. With no
        // embedding provider wired, target mode is inert and targetPrompt:'' must change nothing.
        const r = await runSearch({ baseSeed: 123456, maxGenerations: 3, mutationMode: 'r_sym', targetPrompt: '' });
        expect(r.populations).toEqual(GOLDEN_POPULATIONS);
        expect(r.champions).toEqual(GOLDEN_CHAMPIONS);
        expect(r.resetSeeds).toEqual(GOLDEN_RESETSEEDS);
    });

    it('is stable across repeated runs (no hidden nondeterminism)', async () => {
        const a = await runSearch({ baseSeed: 987654, maxGenerations: 2, mutationMode: 'n_count' });
        const b = await runSearch({ baseSeed: 987654, maxGenerations: 2, mutationMode: 'n_count' });
        expect(b.populations).toEqual(a.populations);
        expect(b.champions).toEqual(a.champions);
        expect(b.resetSeeds).toEqual(a.resetSeeds);
    });
});

describe('AutoExploreService population decoupling (populationSize > 9)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('evaluates 36 candidates/generation on 9 workers, seeds keyed by candidate index, badges stay length 9', async () => {
        const BASE = 555000;
        const r = await runSearch({ baseSeed: BASE, maxGenerations: 2, mutationMode: 'r_sym', populationSize: 36 });

        // 36 candidates built per generation (not 9) …
        expect(r.populations.length).toBe(2);
        for (const pop of r.populations) expect(pop.length).toBe(36);

        // … but only 9 rendered worlds, so the per-slot badge array is still length 9.
        expect(r.badgeLengths).toEqual([9, 9]);

        // Every candidate's IC reset seeds are keyed by CANDIDATE index (base + gen*9973 + c*97 + ic),
        // regardless of which of the 9 workers ran it. All must appear among the observed reset seeds.
        const observed = new Set(r.resetSeeds.flat());
        for (let gen = 0; gen < 2; gen++) {
            for (let c = 0; c < 36; c++) {
                for (let ic = 0; ic < 7; ic++) {
                    expect(observed.has(BASE + gen * 9973 + c * 97 + ic)).toBe(true);
                }
            }
        }

        // The selected world (index 4) still holds the projected champion seed at generation 0, exactly
        // as in the 9-candidate run — the projection is population-size-independent.
        expect(r.populations[0][4]).toBe('0103050F113355FF0103050F113355FF');
    });

    it('is byte-identical across repeated populationSize:36 runs', async () => {
        const a = await runSearch({ baseSeed: 42, maxGenerations: 2, mutationMode: 'r_sym', populationSize: 36 });
        const b = await runSearch({ baseSeed: 42, maxGenerations: 2, mutationMode: 'r_sym', populationSize: 36 });
        expect(b.populations).toEqual(a.populations);
        expect(b.champions).toEqual(a.champions);
        expect(b.resetSeeds).toEqual(a.resetSeeds);
    });
});

describe('AutoExploreService _seedFor uniqueness', () => {
    // Collision analysis (plan Step 1): gen*9973 + candidate*97 + ic collides only for Δcandidate ≈ 2776
    // at Δgen = 27, so any populationSize ≤ 1024 is collision-free. Brute-force the operating envelope.
    it('produces distinct seeds across (gen ≤ 50) × (candidate < 144) × (ic < 7)', () => {
        const wm = makeFakeWM();
        const service = new AutoExploreService(wm);
        service._exploreBaseSeed = 123456;
        const seen = new Set();
        for (let gen = 0; gen <= 50; gen++) {
            service.generation = gen;
            for (let c = 0; c < 144; c++) {
                for (let ic = 0; ic < 7; ic++) {
                    const s = service._seedFor(c, ic);
                    expect(seen.has(s)).toBe(false);
                    seen.add(s);
                }
            }
        }
        expect(seen.size).toBe(51 * 144 * 7);
    });
});
