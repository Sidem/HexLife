// @ts-check

import {
    ACCEPTANCE_SCENARIOS,
    CORPUS_COVERAGE,
    CORPUS_GRID_PRESETS,
    CORPUS_LABELS,
    CORPUS_MINIMUM_FAMILIES,
    CORPUS_SYMMETRY_CLASSES,
} from './corpusProtocol.js';
import { buildLineage, buildRevisitLineage, pickInitialCondition, pickSeed } from './CorpusLineage.js';

/**
 * Coverage-driven round scheduling for Corpus v1 collection (#37 Stage 4B.2, step 5).
 *
 * The first build of Corpus Lab drew a fresh lineage every round and aimed random rounds at the
 * thinnest symmetry class. That fills two of the audit's strata and structurally cannot fill the rest:
 *
 * - `minimumSeedsPerRuleset` / `minimumInitialConditionsPerRuleset` apply to **every** ruleset in the
 *   corpus, not to a quota of rulesets. A ruleset judged once holds one seed and one initial condition
 *   forever, so each new lineage added nine permanent audit failures and nothing ever paid them off.
 * - `requireBothLabelsPerSymmetryClass` is checked per `(class, label)` **cell**. A class with 200
 *   boring clips and no interesting one fails while looking well covered in a per-class tally.
 * - `requireEveryScenario` iterates the protocol's ten scenarios, `other` included.
 * - Grid presets each need 32 clips, and the app can only change grid size through a page reload — so
 *   a preset is a *block* the session moves between, never a per-card choice.
 *
 * This module is the fix, kept pure so it can be tested without workers or a DOM: it reads a coverage
 * snapshot, states the exact distance to a passing `hexlife-corpus-audit --strict`, and returns the
 * round that shrinks it most. The overlay executes plans; it does not decide them.
 *
 * The scheduling policy is deliberately **debt-first**: while any collected ruleset is short of its
 * seed or initial-condition minimum, the next round replays those rulesets instead of drawing new
 * ones. A new lineage is only started when the corpus owes nothing, which drives each family to
 * completion (9 rulesets × 3 visits) before the next begins and keeps the deficit list from growing
 * faster than the owner can pay it down.
 */

/** Total families the proposed split cycle needs to satisfy 6 train / 2 validation / 2 test. */
const FAMILY_TARGET = Object.values(CORPUS_MINIMUM_FAMILIES).reduce((sum, n) => sum + n, 0);

/**
 * Initial-condition presets biased toward a missing scenario. Scenario is *observed* by the
 * classifier, never commanded, so these only load the dice — `Single seed` is the documented
 * extinction/saturation generator, and a sparse start is what usually settles into a still life or a
 * short oscillator.
 *
 * @type {Record<string, string[]>}
 */
const SCENARIO_PRESET_BIAS = {
    extinction: ['Single seed'],
    saturation: ['Single seed'],
    still_life: ['Sparse'],
    oscillator: ['Sparse'],
    slow_boiling: ['Sparse', 'Balanced'],
    distributed_churn: ['Balanced', 'Dense'],
    structured_growth: ['Sparse', 'Scattered'],
    glider: ['Scattered', 'Sparse'],
    localized_change: ['Scattered', 'Islands'],
};

/**
 * @typedef {object} AuditStatus
 * @property {boolean} passing            True when no coverage deficit remains.
 * @property {string[]} deficits          Deficit lines phrased as `hexlife-corpus-audit` prints them.
 * @property {number} clipsNeeded
 * @property {number} familiesNeeded
 * @property {Array<{split: string, have: number, need: number}>} familyGaps
 * @property {string[]} scenarioGaps
 * @property {Array<{symmetryClass: string, label: string}>} symmetryGaps
 * @property {Array<{preset: string, have: number, need: number}>} gridGaps
 * @property {import('./CorpusCollectionBuffer.js').RulesetCoverage[]} rulesetGaps
 */

/**
 * Distance to a passing strict audit, mirroring the auditor's own checks and wording.
 *
 * Deliberately a mirror rather than an approximation: the owner reads this to decide when to stop
 * collecting, and a readout that is merely *near* the auditor's rules costs a whole collection session
 * when the two disagree. The one check not reproducible here is the hard-pair owner votes, which live
 * in `comparisons.jsonl` rather than the clip buffer (step 6).
 *
 * @param {ReturnType<import('./CorpusCollectionBuffer.js').CorpusCollectionBuffer['coverage']>} coverage
 * @param {Array<{id: string, split: string}>} [familyRegistry]
 * @returns {AuditStatus}
 */
export function auditStatus(coverage, familyRegistry = []) {
    /** @type {string[]} */
    const deficits = [];

    const labeled = CORPUS_LABELS.reduce((sum, label) => sum + (coverage.labels?.[label] || 0), 0);
    const clipsNeeded = Math.max(0, CORPUS_COVERAGE.minimumLabeledClips - labeled);
    if (clipsNeeded) {
        deficits.push(`labeled clips ${labeled} < ${CORPUS_COVERAGE.minimumLabeledClips}`);
    }

    /** @type {Array<{split: string, have: number, need: number}>} */
    const familyGaps = [];
    for (const [split, need] of Object.entries(CORPUS_MINIMUM_FAMILIES)) {
        const have = familyRegistry.filter((entry) => entry.split === split).length;
        if (have < need) {
            familyGaps.push({ split, have, need });
            deficits.push(`${split} families ${have} < ${need}`);
        }
    }
    // The proposed split cycle is positional and its first ten entries are exactly 6/2/2, so the
    // shortfall in families is the shortfall against that total — no per-split arithmetic needed.
    const familiesNeeded = Math.max(0, FAMILY_TARGET - familyRegistry.length);

    const rulesetGaps = (coverage.rulesets || []).filter((entry) => (
        entry.seeds < CORPUS_COVERAGE.minimumSeedsPerRuleset
        || entry.initialConditions < CORPUS_COVERAGE.minimumInitialConditionsPerRuleset
    ));
    for (const entry of rulesetGaps) {
        if (entry.seeds < CORPUS_COVERAGE.minimumSeedsPerRuleset) {
            deficits.push(`ruleset ${entry.ruleset}: seeds ${entry.seeds} < ${CORPUS_COVERAGE.minimumSeedsPerRuleset}`);
        }
        if (entry.initialConditions < CORPUS_COVERAGE.minimumInitialConditionsPerRuleset) {
            deficits.push(`ruleset ${entry.ruleset}: initial conditions ${entry.initialConditions}`
                + ` < ${CORPUS_COVERAGE.minimumInitialConditionsPerRuleset}`);
        }
    }

    /** @type {Array<{preset: string, have: number, need: number}>} */
    const gridGaps = [];
    for (const preset of CORPUS_GRID_PRESETS) {
        const have = coverage.gridPresets?.[preset] || 0;
        if (have < CORPUS_COVERAGE.minimumClipsPerGridPreset) {
            gridGaps.push({ preset, have, need: CORPUS_COVERAGE.minimumClipsPerGridPreset });
            deficits.push(`grid ${preset}: clips ${have} < ${CORPUS_COVERAGE.minimumClipsPerGridPreset}`);
        }
    }

    /** @type {string[]} */
    const scenarioGaps = [];
    if (CORPUS_COVERAGE.requireEveryScenario) {
        for (const scenario of ACCEPTANCE_SCENARIOS) {
            if (!(coverage.scenarios?.[scenario] > 0)) {
                scenarioGaps.push(scenario);
                deficits.push(`scenario ${scenario}: no clips`);
            }
        }
    }

    /** @type {Array<{symmetryClass: string, label: string}>} */
    const symmetryGaps = [];
    if (CORPUS_COVERAGE.requireBothLabelsPerSymmetryClass) {
        for (const symmetryClass of CORPUS_SYMMETRY_CLASSES) {
            for (const label of CORPUS_LABELS) {
                if (!(coverage.symmetryLabelCells?.[symmetryClass]?.[label] > 0)) {
                    symmetryGaps.push({ symmetryClass, label });
                    deficits.push(`symmetry ${symmetryClass}: no ${label} clips`);
                }
            }
        }
    }

    return {
        passing: deficits.length === 0,
        deficits,
        clipsNeeded,
        familiesNeeded,
        familyGaps,
        scenarioGaps,
        symmetryGaps,
        gridGaps,
        rulesetGaps,
    };
}

/**
 * The grid-preset block to move to next, or null to stay put.
 *
 * A switch costs a partial ZIP download plus a full page reload (the only way the app can resize the
 * torus), so it is proposed only when the active block has met its 32-clip minimum and another block
 * has not. That keeps blocks short and dedicated, as the plan requires, without ever interrupting one
 * midway.
 *
 * @param {AuditStatus} status
 * @param {string|null|undefined} activePreset
 * @returns {{preset: string, have: number, need: number}|null}
 */
export function suggestGridSwitch(status, activePreset) {
    const activeStillNeeded = status.gridGaps.some((gap) => gap.preset === activePreset);
    if (activeStillNeeded) return null;
    // Thinnest first: `huge` clips cost ~35× a `small` one, so finishing the cheap blocks first keeps
    // the buffer small for longer.
    const [thinnest] = [...status.gridGaps].sort((a, b) => a.have - b.have);
    return thinnest || null;
}

/**
 * @typedef {object} RoundSlot
 * @property {number} worldIndex
 * @property {string} rulesetHex
 * @property {{familyId: string, anchorRuleset: string, relationship: string}} family
 * @property {import('./CorpusLineage.js').LineageMember} member
 * @property {'library'|'random'} origin
 * @property {string|null} libraryName
 * @property {boolean} revisit
 * @property {{presetName: string, initialState: object, source: string, id: string}} ic
 * @property {number} seed
 */

/**
 * @typedef {object} RoundPlan
 * @property {'revisit'|'new-lineage'} kind
 * @property {string} reason              One line explaining the choice, shown to the owner.
 * @property {RoundSlot[]} slots
 * @property {AuditStatus} status
 * @property {{preset: string, have: number, need: number}|null} gridSwitch
 */

/**
 * Choose and materialize the next collection round.
 *
 * @param {object} state
 * @param {ReturnType<import('./CorpusCollectionBuffer.js').CorpusCollectionBuffer['coverage']>} state.coverage
 * @param {Array<{id: string, split: string, anchorRuleset: string, relationship: string}>} state.familyRegistry
 * @param {number} state.worldCount        Worlds available to fill (the grid is 9).
 * @param {string|null} [state.activeGridPreset]
 * @param {object} deps
 * @param {import('../RulesetService.js').RulesetService} deps.rulesetService
 * @param {() => number} [deps.rng]
 * @param {(anchorHex: string) => object|null} [deps.libraryInitialStateFor] Curated initial condition
 *        for a library anchor, when one exists.
 * @returns {RoundPlan}
 */
export function planRound(state, deps) {
    const rng = deps?.rng || Math.random;
    const worldCount = Math.max(1, Math.min(9, Math.trunc(Number(state?.worldCount) || 9)));
    const coverage = state.coverage;
    const familyRegistry = state.familyRegistry || [];
    const status = auditStatus(coverage, familyRegistry);
    const gridSwitch = suggestGridSwitch(status, state.activeGridPreset);
    const preferPresetNames = scenarioPresetBias(status.scenarioGaps);

    const debt = orderDebtByFamily(status.rulesetGaps, familyRegistry);
    if (debt.length) {
        return {
            kind: 'revisit',
            reason: revisitReason(debt, status),
            slots: revisitSlots(debt.slice(0, worldCount), {
                coverage, familyRegistry, rng, preferPresetNames, libraryInitialStateFor: deps.libraryInitialStateFor,
            }),
            status,
            gridSwitch,
        };
    }

    return {
        kind: 'new-lineage',
        ...newLineageRound({ status, coverage, familyRegistry, worldCount, rng, preferPresetNames }, deps),
        status,
        gridSwitch,
    };
}

/** @param {string[]} scenarioGaps @returns {string[]} */
function scenarioPresetBias(scenarioGaps) {
    const names = new Set();
    for (const scenario of scenarioGaps) {
        for (const name of SCENARIO_PRESET_BIAS[scenario] || []) names.add(name);
    }
    return [...names];
}

/**
 * Order the rulesets that owe seeds or initial conditions, oldest family first.
 *
 * Oldest-first is what makes the debt-first policy converge: it drives one family to completion rather
 * than spreading a visit across every family and leaving all of them one short.
 *
 * @param {import('./CorpusCollectionBuffer.js').RulesetCoverage[]} gaps
 * @param {Array<{id: string}>} familyRegistry
 */
function orderDebtByFamily(gaps, familyRegistry) {
    const order = new Map(familyRegistry.map((entry, index) => [entry.id, index]));
    return [...gaps].sort((a, b) => {
        const rank = (order.get(a.family) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.family) ?? Number.MAX_SAFE_INTEGER);
        return rank || a.ruleset.localeCompare(b.ruleset);
    });
}

/**
 * @param {import('./CorpusCollectionBuffer.js').RulesetCoverage[]} debt
 * @param {AuditStatus} status
 */
function revisitReason(debt, status) {
    const families = new Set(debt.map((entry) => entry.family)).size;
    const seeds = debt.filter((entry) => entry.seeds < CORPUS_COVERAGE.minimumSeedsPerRuleset).length;
    const ics = debt.filter((entry) => entry.initialConditions < CORPUS_COVERAGE.minimumInitialConditionsPerRuleset).length;
    const scenarios = status.scenarioGaps.length ? `, biased at ${status.scenarioGaps.length} missing scenario(s)` : '';
    return `revisit — ${debt.length} ruleset(s) across ${families} family/families owe `
        + `${seeds} seed(s) and ${ics} initial condition(s)${scenarios}`;
}

/**
 * Replay already-collected rulesets under a seed and initial condition they have not seen.
 *
 * @param {import('./CorpusCollectionBuffer.js').RulesetCoverage[]} debt
 * @param {{
 *   coverage: any,
 *   familyRegistry: Array<{id: string, anchorRuleset: string, relationship: string}>,
 *   rng: () => number,
 *   preferPresetNames: string[],
 *   libraryInitialStateFor?: (anchorHex: string) => object|null,
 * }} context
 * @returns {RoundSlot[]}
 */
function revisitSlots(debt, context) {
    const byId = new Map(context.familyRegistry.map((entry) => [entry.id, entry]));

    /** @type {Map<string, import('./CorpusCollectionBuffer.js').RulesetCoverage[]>} */
    const byFamily = new Map();
    for (const entry of debt) {
        const siblings = byFamily.get(entry.family) || [];
        siblings.push(entry);
        byFamily.set(entry.family, siblings);
    }

    /** @type {RoundSlot[]} */
    const slots = [];
    for (const [familyId, entries] of byFamily) {
        const registryEntry = byId.get(familyId);
        const lineage = buildRevisitLineage({
            familyId,
            // A family missing from the registry cannot happen through the buffer (it registers every
            // family on the first `add`), but treating the ruleset as its own anchor keeps a
            // hand-assembled coverage snapshot from throwing here.
            anchorRuleset: registryEntry?.anchorRuleset || entries[0].ruleset,
            relationship: registryEntry?.relationship || 'exact-ruleset',
            memberHexes: entries.map((entry) => entry.ruleset),
        });
        const ownInitialState = lineage.origin === 'library' && context.libraryInitialStateFor
            ? context.libraryInitialStateFor(lineage.anchorRuleset)
            : null;
        const family = {
            familyId: lineage.familyId,
            anchorRuleset: lineage.anchorRuleset,
            relationship: lineage.relationship,
        };

        entries.forEach((entry, index) => {
            // Only exclude used initial conditions while this ruleset still owes one: once it has two,
            // a repeat is harmless and forcing novelty would drift the corpus toward exotic presets.
            const needsIc = entry.initialConditions < CORPUS_COVERAGE.minimumInitialConditionsPerRuleset;
            slots.push({
                worldIndex: slots.length,
                rulesetHex: entry.ruleset,
                family,
                member: lineage.members[index],
                origin: lineage.origin,
                libraryName: null,
                revisit: true,
                ic: pickInitialCondition(context.rng, {
                    ownInitialState,
                    excludeIds: needsIc ? entry.initialConditionIds : null,
                    preferPresetNames: context.preferPresetNames,
                }),
                seed: pickSeed(context.rng, { excludeIds: entry.seedIds }),
            });
        });
    }
    return slots;
}

/**
 * Start a fresh family, aimed at whichever stratum a new lineage can actually influence.
 *
 * Origin alternates by family count. Library turns supply curated rules that are genuinely
 * interesting — without them the corpus skews boring and `requireBothLabelsPerSymmetryClass` never
 * closes on the interesting side. Random turns carry the symmetry targeting, because `d_sym`,
 * `n_count` and `totalistic` anchors are only reachable by generating in that mode; the library's
 * table is whatever it is.
 *
 * @param {{
 *   status: AuditStatus,
 *   coverage: any,
 *   familyRegistry: Array<{id: string, anchorRuleset: string}>,
 *   worldCount: number,
 *   rng: () => number,
 *   preferPresetNames: string[],
 * }} context
 * @param {{rulesetService: any, libraryInitialStateFor?: (anchorHex: string) => object|null}} deps
 * @returns {{reason: string, slots: RoundSlot[]}}
 */
function newLineageRound(context, deps) {
    const { status, familyRegistry, worldCount, rng } = context;
    const wantLibrary = familyRegistry.length % 2 === 0;
    const targetClass = wantLibrary
        ? undefined
        : thinnestGapClass(status, context.coverage?.symmetryClasses || {});

    const lineage = buildLineage({
        origin: wantLibrary ? 'library' : 'random',
        symmetryClass: targetClass,
        memberCount: worldCount,
        excludeAnchorHexes: familyRegistry.map((entry) => entry.anchorRuleset).filter(Boolean),
    }, { rulesetService: deps.rulesetService, rng });

    const ownInitialState = lineage.origin === 'library' && deps.libraryInitialStateFor
        ? deps.libraryInitialStateFor(lineage.anchorRuleset)
        : null;

    const family = {
        familyId: lineage.familyId,
        anchorRuleset: lineage.anchorRuleset,
        relationship: lineage.relationship,
    };
    const slots = lineage.members.map((member, worldIndex) => ({
        worldIndex,
        rulesetHex: member.rulesetHex,
        family,
        member,
        origin: lineage.origin,
        libraryName: lineage.libraryName,
        revisit: false,
        ic: pickInitialCondition(rng, {
            ownInitialState,
            preferPresetNames: context.preferPresetNames,
        }),
        seed: pickSeed(rng),
    }));

    const aim = targetClass ? ` aimed at ${targetClass}` : '';
    const need = status.familiesNeeded ? `, ${status.familiesNeeded} more family/families needed` : '';
    return {
        reason: `new ${lineage.origin} lineage${aim} — corpus owes no seeds or initial conditions${need}`,
        slots,
    };
}

/**
 * The symmetry class most worth aiming a random lineage at.
 *
 * Candidates are the classes with an empty `(class, label)` cell, ranked by how few clips they hold
 * overall — not by protocol order. A class can have hundreds of boring clips and still show a gap
 * because its interesting cell is empty, and no amount of extra generation in that class fixes that;
 * only the owner's judgment does. Ranking by thinness sends generation where clips are genuinely
 * missing and lets the session rotate instead of re-rolling one class forever.
 *
 * @param {AuditStatus} status
 * @param {Record<string, number>} classTotals
 */
function thinnestGapClass(status, classTotals) {
    if (!status.symmetryGaps.length) return undefined;
    const gapClasses = [...new Set(status.symmetryGaps.map((gap) => gap.symmetryClass))];
    return gapClasses.sort((a, b) => (
        (classTotals[a] || 0) - (classTotals[b] || 0)
        || CORPUS_SYMMETRY_CLASSES.indexOf(a) - CORPUS_SYMMETRY_CLASSES.indexOf(b)
    ))[0];
}
