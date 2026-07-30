import { describe, it, expect, beforeAll } from 'vitest';
import { RulesetService } from '../src/core/RulesetService.js';
import * as Symmetry from '../src/core/Symmetry.js';
import { auditStatus, planRound, suggestGridSwitch } from '../src/core/analysis/CorpusScheduler.js';
import { CorpusCollectionBuffer } from '../src/core/analysis/CorpusCollectionBuffer.js';
import {
    ACCEPTANCE_SCENARIOS,
    CORPUS_COVERAGE,
    CORPUS_GRID_PRESETS,
    CORPUS_SYMMETRY_CLASSES,
    initialConditionId,
} from '../src/core/analysis/corpusProtocol.js';

let rulesetService;

beforeAll(() => {
    rulesetService = new RulesetService(Symmetry.precomputeSymmetryGroups());
});

/** Deterministic rng so a planned round is reproducible. */
function seededRng(seed = 987654) {
    let state = seed >>> 0;
    return () => {
        state ^= state << 13; state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5; state >>>= 0;
        return state / 0x100000000;
    };
}

/** A coverage snapshot with every gate already satisfied, to be spoiled one field at a time. */
function passingCoverage(overrides = {}) {
    /** @type {Record<string, number>} */
    const scenarios = {};
    for (const scenario of ACCEPTANCE_SCENARIOS) scenarios[scenario] = 5;
    /** @type {Record<string, Record<string, number>>} */
    const symmetryLabelCells = {};
    for (const cls of CORPUS_SYMMETRY_CLASSES) symmetryLabelCells[cls] = { interesting: 4, boring: 4 };
    /** @type {Record<string, number>} */
    const gridPresets = {};
    for (const preset of CORPUS_GRID_PRESETS) gridPresets[preset] = CORPUS_COVERAGE.minimumClipsPerGridPreset;

    return {
        clips: 500,
        families: 10,
        labels: { interesting: 250, boring: 250 },
        scenarios,
        symmetryClasses: Object.fromEntries(CORPUS_SYMMETRY_CLASSES.map((c) => [c, 8])),
        gridPresets,
        symmetryLabelCells,
        coverageEligibleClips: 500,
        rulesets: [],
        familyRulesets: {},
        distinctRulesets: 0,
        rulesetsWithThreeSeeds: 0,
        rulesetsWithTwoInitialConditions: 0,
        ...overrides,
    };
}

/** Ten registered families, which is exactly the protocol's 6 train / 2 validation / 2 test. */
function passingRegistry() {
    const splits = ['train', 'train', 'train', 'train', 'train', 'train', 'validation', 'validation', 'test', 'test'];
    return splits.map((split, index) => ({
        id: `rand-free-${String(index).repeat(12).slice(0, 12)}`,
        split,
        anchorRuleset: String(index).repeat(32).slice(0, 32),
        relationship: 'mutation-lineage',
    }));
}

/** @param {Partial<any>} overrides */
function rulesetRow(overrides = {}) {
    return {
        ruleset: 'A'.repeat(32),
        family: 'rand-free-aaaaaaaaaaaa',
        clips: 4,
        seeds: 3,
        initialConditions: 2,
        seedIds: ['seed-1', 'seed-2', 'seed-3'],
        initialConditionIds: ['ic-1', 'ic-2'],
        ...overrides,
    };
}

describe('auditStatus — mirrors the strict auditor', () => {
    it('passes when every gate is met', () => {
        const status = auditStatus(passingCoverage(), passingRegistry());
        expect(status.deficits).toEqual([]);
        expect(status.passing).toBe(true);
    });

    it('counts only acceptance labels toward the clip minimum', () => {
        // The auditor sums counts for `interesting` and `boring` only; a stray label contributes zero.
        const status = auditStatus(
            passingCoverage({ labels: { interesting: 100, boring: 100, unlabeled: 900 } }),
            passingRegistry(),
        );
        expect(status.clipsNeeded).toBe(CORPUS_COVERAGE.minimumLabeledClips - 200);
        expect(status.deficits).toContain(`labeled clips 200 < ${CORPUS_COVERAGE.minimumLabeledClips}`);
    });

    it('reports a symmetry class with clips but only one label', () => {
        const coverage = passingCoverage();
        coverage.symmetryLabelCells.totalistic = { boring: 40 };
        const status = auditStatus(coverage, passingRegistry());
        expect(status.symmetryGaps).toEqual([{ symmetryClass: 'totalistic', label: 'interesting' }]);
        expect(status.deficits).toContain('symmetry totalistic: no interesting clips');
        // The per-class total looks healthy — which is exactly why the readout uses cells.
        expect(coverage.symmetryClasses.totalistic).toBeGreaterThan(0);
    });

    it('requires a clip of `other`, which the audit treats like any other scenario', () => {
        const coverage = passingCoverage();
        delete coverage.scenarios.other;
        const status = auditStatus(coverage, passingRegistry());
        expect(status.scenarioGaps).toEqual(['other']);
        expect(status.deficits).toContain('scenario other: no clips');
    });

    it('flags every ruleset short of the per-ruleset minimums, not a quota of them', () => {
        const coverage = passingCoverage({
            rulesets: [
                rulesetRow({ ruleset: 'A'.repeat(32), seeds: 1, initialConditions: 1 }),
                rulesetRow({ ruleset: 'B'.repeat(32), seeds: 3, initialConditions: 1 }),
                rulesetRow({ ruleset: 'C'.repeat(32) }),
            ],
        });
        const status = auditStatus(coverage, passingRegistry());
        expect(status.rulesetGaps.map((r) => r.ruleset)).toEqual(['A'.repeat(32), 'B'.repeat(32)]);
        expect(status.deficits).toContain(`ruleset ${'A'.repeat(32)}: seeds 1 < 3`);
        expect(status.deficits).toContain(`ruleset ${'B'.repeat(32)}: initial conditions 1 < 2`);
        expect(status.passing).toBe(false);
    });

    it('reports per-split family shortfalls and the families still to create', () => {
        const status = auditStatus(passingCoverage(), passingRegistry().slice(0, 7));
        expect(status.familiesNeeded).toBe(3);
        expect(status.deficits).toContain('validation families 1 < 2');
        expect(status.deficits).toContain('test families 0 < 2');
    });

    it('reports each under-filled grid preset', () => {
        const coverage = passingCoverage();
        coverage.gridPresets.huge = 4;
        const status = auditStatus(coverage, passingRegistry());
        expect(status.gridGaps).toEqual([{ preset: 'huge', have: 4, need: CORPUS_COVERAGE.minimumClipsPerGridPreset }]);
        expect(status.deficits).toContain(`grid huge: clips 4 < ${CORPUS_COVERAGE.minimumClipsPerGridPreset}`);
    });
});

describe('suggestGridSwitch', () => {
    it('never interrupts a block that has not met its minimum', () => {
        const coverage = passingCoverage();
        coverage.gridPresets.medium = 4;
        coverage.gridPresets.huge = 0;
        const status = auditStatus(coverage, passingRegistry());
        expect(suggestGridSwitch(status, 'medium')).toBeNull();
    });

    it('moves to the thinnest under-filled block once the active one is done', () => {
        const coverage = passingCoverage();
        coverage.gridPresets.large = 10;
        coverage.gridPresets.huge = 0;
        const status = auditStatus(coverage, passingRegistry());
        expect(suggestGridSwitch(status, 'medium')?.preset).toBe('huge');
    });

    it('stays put when every block is full', () => {
        const status = auditStatus(passingCoverage(), passingRegistry());
        expect(suggestGridSwitch(status, 'medium')).toBeNull();
    });
});

describe('planRound', () => {
    const deps = () => ({ rulesetService, rng: seededRng() });

    it('starts a new lineage when nothing is owed', () => {
        const plan = planRound({
            coverage: passingCoverage(),
            familyRegistry: [],
            worldCount: 9,
            activeGridPreset: 'medium',
        }, deps());
        expect(plan.kind).toBe('new-lineage');
        expect(plan.slots).toHaveLength(9);
        // One family per round: the whole grid is one lineage, which is what makes family-held-out
        // evaluation meaningful.
        expect(new Set(plan.slots.map((s) => s.family.familyId)).size).toBe(1);
        expect(plan.slots.every((s) => s.revisit === false)).toBe(true);
    });

    it('pays off seed debt before drawing anything new', () => {
        const rulesets = ['A', 'B', 'C'].map((letter) => rulesetRow({
            ruleset: letter.repeat(32),
            seeds: 1,
            initialConditions: 1,
            seedIds: ['seed-7'],
            initialConditionIds: ['ic-7'],
        }));
        const plan = planRound({
            coverage: passingCoverage({ rulesets }),
            familyRegistry: passingRegistry(),
            worldCount: 9,
            activeGridPreset: 'medium',
        }, deps());
        expect(plan.kind).toBe('revisit');
        expect(plan.slots.map((s) => s.rulesetHex)).toEqual(rulesets.map((r) => r.ruleset));
        expect(plan.slots.every((s) => s.revisit)).toBe(true);
    });

    it('replays the exact deficient hexes rather than re-deriving mutants from the anchor', () => {
        // Re-deriving would produce nine *new* rulesets, each owing three seeds — the debt would grow.
        const ruleset = 'D'.repeat(32);
        const plan = planRound({
            coverage: passingCoverage({ rulesets: [rulesetRow({ ruleset, seeds: 2 })] }),
            familyRegistry: [{
                id: 'rand-free-aaaaaaaaaaaa',
                split: 'train',
                anchorRuleset: 'E'.repeat(32),
                relationship: 'mutation-lineage',
            }],
            worldCount: 9,
            activeGridPreset: 'medium',
        }, deps());
        expect(plan.slots).toHaveLength(1);
        expect(plan.slots[0].rulesetHex).toBe(ruleset);
        expect(plan.slots[0].family.anchorRuleset).toBe('E'.repeat(32));
    });

    it('draws a seed the ruleset has not been run with', () => {
        // A repeated seed writes the same seedId and credits nothing toward the 3-seed minimum.
        const plan = planRound({
            coverage: passingCoverage({
                rulesets: [rulesetRow({ seeds: 1, seedIds: ['seed-1'], initialConditions: 2 })],
            }),
            familyRegistry: passingRegistry(),
            worldCount: 9,
            activeGridPreset: 'medium',
        }, deps());
        expect(plan.slots[0].seed).toBeGreaterThan(0);
        expect(`seed-${plan.slots[0].seed >>> 0}`).not.toBe('seed-1');
    });

    it('draws an unused initial condition while the ruleset still owes one', () => {
        const used = initialConditionId({ mode: 'density', params: { density: 0.5 } });
        const plan = planRound({
            coverage: passingCoverage({
                rulesets: [rulesetRow({ seeds: 3, initialConditions: 1, initialConditionIds: [used] })],
            }),
            familyRegistry: passingRegistry(),
            worldCount: 9,
            activeGridPreset: 'medium',
        }, deps());
        expect(plan.slots[0].ic.id).not.toBe(used);
        expect(initialConditionId(plan.slots[0].ic.initialState)).toBe(plan.slots[0].ic.id);
    });

    it('caps a revisit round at the number of available worlds', () => {
        const rulesets = Array.from({ length: 14 }, (_, index) => rulesetRow({
            ruleset: index.toString(16).repeat(32).slice(0, 32),
            seeds: 1,
            seedIds: ['seed-3'],
        }));
        const plan = planRound({
            coverage: passingCoverage({ rulesets }),
            familyRegistry: passingRegistry(),
            worldCount: 9,
            activeGridPreset: 'medium',
        }, deps());
        expect(plan.slots).toHaveLength(9);
    });

    it('drives the oldest family to completion first', () => {
        const registry = passingRegistry();
        const older = registry[0].id;
        const newer = registry[5].id;
        const plan = planRound({
            coverage: passingCoverage({
                rulesets: [
                    rulesetRow({ ruleset: 'F'.repeat(32), family: newer, seeds: 1 }),
                    rulesetRow({ ruleset: '9'.repeat(32), family: older, seeds: 1 }),
                ],
            }),
            familyRegistry: registry,
            worldCount: 9,
            activeGridPreset: 'medium',
        }, deps());
        expect(plan.slots[0].family.familyId).toBe(older);
    });

    it('aims a random lineage at the thinnest symmetry class with a missing label', () => {
        const coverage = passingCoverage({ symmetryClasses: { free: 400, totalistic: 2 } });
        coverage.symmetryLabelCells.free = { boring: 400 };
        coverage.symmetryLabelCells.totalistic = { boring: 2 };
        // An odd family count makes this a random turn, which is the turn that carries the targeting:
        // `totalistic` anchors are unreachable from the library table.
        const plan = planRound({
            coverage,
            familyRegistry: passingRegistry().slice(0, 1),
            worldCount: 9,
            activeGridPreset: 'medium',
        }, deps());
        expect(plan.kind).toBe('new-lineage');
        expect(plan.reason).toContain('totalistic');
        expect(plan.slots[0].origin).toBe('random');
    });

    it('never re-draws a library anchor already registered as a family', () => {
        // Re-drawing would graft nine new rulesets onto a family already being paid off.
        const registry = [];
        for (let round = 0; round < 6; round++) {
            const plan = planRound({
                coverage: passingCoverage(),
                familyRegistry: registry,
                worldCount: 9,
                activeGridPreset: 'medium',
            }, { rulesetService, rng: seededRng(1000 + round) });
            registry.push({
                id: plan.slots[0].family.familyId,
                split: 'train',
                anchorRuleset: plan.slots[0].family.anchorRuleset,
                relationship: plan.slots[0].family.relationship,
            });
        }
        expect(new Set(registry.map((r) => r.anchorRuleset)).size).toBe(registry.length);
    });

    it('carries the audit status and any grid suggestion on the plan', () => {
        const coverage = passingCoverage();
        coverage.gridPresets.huge = 1;
        const plan = planRound({
            coverage,
            familyRegistry: passingRegistry(),
            worldCount: 9,
            activeGridPreset: 'medium',
        }, deps());
        expect(plan.status.passing).toBe(false);
        expect(plan.gridSwitch?.preset).toBe('huge');
    });
});

describe('scheduler + buffer — the per-ruleset minimums actually close', () => {
    const bytesPerClip = 512;

    /** One judgment's worth of clips for a planned slot. */
    function clipsFor(slot, label, scenario) {
        return [{
            filename: `${slot.rulesetHex}.hxlt`,
            bytes: new Uint8Array(bytesPerClip),
            header: {
                id: `${slot.rulesetHex}-${slot.seed}`,
                family: slot.family.familyId,
                ruleset: slot.rulesetHex,
                label,
                scenario,
                symmetryClass: slot.member.symmetryClass || 'free',
                gridPreset: 'medium',
                seed: slot.seed,
                seedId: `seed-${slot.seed >>> 0}`,
                initialConditionId: slot.ic.id,
            },
        }];
    }

    it('reaches zero seed/initial-condition debt for a family in three visits', () => {
        const buffer = new CorpusCollectionBuffer({
            sessionId: 'session-convergence',
            createdAt: '2026-07-30T00:00:00.000Z',
        });
        const rng = seededRng(4242);

        for (let round = 0; round < 3; round++) {
            const plan = planRound({
                coverage: buffer.coverage(),
                familyRegistry: buffer.familyRegistry(),
                worldCount: 9,
                activeGridPreset: 'medium',
            }, { rulesetService, rng });
            // Round 1 creates the family; rounds 2 and 3 must be revisits of it, or the debt never clears.
            expect(plan.kind).toBe(round === 0 ? 'new-lineage' : 'revisit');
            for (const slot of plan.slots) {
                buffer.add(clipsFor(slot, round % 2 ? 'boring' : 'interesting', 'glider'), {
                    familyId: slot.family.familyId,
                    anchorRuleset: slot.family.anchorRuleset,
                    relationship: slot.family.relationship,
                });
            }
        }

        const coverage = buffer.coverage();
        expect(coverage.families).toBe(1);
        // A low mutation rate can flip nothing, so `buildLineage` may hand back fewer than nine
        // distinct hexes across nine worlds (it retries, then accepts rather than looping forever).
        expect(coverage.distinctRulesets).toBeGreaterThan(1);
        expect(coverage.distinctRulesets).toBeLessThanOrEqual(9);
        const status = auditStatus(coverage, buffer.familyRegistry());
        expect(status.rulesetGaps).toEqual([]);
        // With debt cleared, the next round is free to start the second family.
        const next = planRound({
            coverage,
            familyRegistry: buffer.familyRegistry(),
            worldCount: 9,
            activeGridPreset: 'medium',
        }, { rulesetService, rng });
        expect(next.kind).toBe('new-lineage');
    });
});
