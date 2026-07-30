import { describe, it, expect, beforeAll } from 'vitest';
import { RulesetService } from '../src/core/RulesetService.js';
import * as Symmetry from '../src/core/Symmetry.js';
import { classifyRulesetConstraint, satisfiesRulesetConstraint } from '../src/core/rulesetDescriptor.js';
import {
    buildLineage,
    deriveFamilyId,
    familyRegistryEntry,
    libraryAnchors,
    pickInitialCondition,
    pickSeed,
    MUTATION_LADDER,
} from '../src/core/analysis/CorpusLineage.js';
import { CORPUS_FAMILY_PATTERN, CORPUS_FAMILY_RELATIONSHIPS } from '../src/core/analysis/corpusProtocol.js';
import {
    CLUSTER_PRESETS,
    DENSITY_PRESETS,
    GENERATIVE_PRESETS,
    initialStateFromPreset,
} from '../src/core/initialStatePresets.js';

let rulesetService;

beforeAll(() => {
    rulesetService = new RulesetService(Symmetry.precomputeSymmetryGroups());
});

/** Deterministic rng: a fixed repeating sequence, so lineages are reproducible in tests. */
function seededRng(seed = 12345) {
    let state = seed >>> 0;
    return () => {
        // xorshift32 — same family as the worker's, adequate for test determinism.
        state ^= state << 13; state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5; state >>>= 0;
        return state / 0x100000000;
    };
}

describe('deriveFamilyId', () => {
    it('builds a readable library id from name and anchor hex', () => {
        const id = deriveFamilyId({
            origin: 'library',
            name: 'Rain freezing',
            hex: '200110000006000C8903020805009804',
        });
        expect(id).toBe('lib-rain-freezing-200110000006');
        expect(CORPUS_FAMILY_PATTERN.test(id)).toBe(true);
    });

    it('builds a class-tagged id for random anchors, hyphenating the class', () => {
        const id = deriveFamilyId({
            origin: 'random',
            hex: 'ABCDEF0123456789ABCDEF0123456789',
            symmetryClass: 'r_sym',
        });
        // `r_sym` must become `r-sym`: underscores are illegal in the family id pattern.
        expect(id).toBe('rand-r-sym-abcdef012345');
        expect(CORPUS_FAMILY_PATTERN.test(id)).toBe(true);
    });

    it('is deterministic — the same anchor always re-derives the same id', () => {
        const anchor = { origin: 'library', name: 'Rain freezing', hex: '200110000006000C8903020805009804' };
        expect(deriveFamilyId(anchor)).toBe(deriveFamilyId({ ...anchor }));
    });

    it('never merges two anchors whose names slug identically', () => {
        const a = deriveFamilyId({ origin: 'library', name: 'Rain freezing', hex: 'AAAAAAAAAAAA00000000000000000000' });
        const b = deriveFamilyId({ origin: 'library', name: 'rain-freezing!', hex: 'BBBBBBBBBBBB00000000000000000000' });
        expect(a).not.toBe(b);
    });

    it('stays pattern-valid when the name slugs away entirely', () => {
        const id = deriveFamilyId({ origin: 'library', name: '!!!', hex: '200110000006000C8903020805009804' });
        expect(CORPUS_FAMILY_PATTERN.test(id)).toBe(true);
        expect(id).toBe('lib-200110000006');
    });

    it('falls back to a valid id for an unusable anchor', () => {
        const id = deriveFamilyId({ origin: 'random', hex: '', symmetryClass: null });
        expect(CORPUS_FAMILY_PATTERN.test(id)).toBe(true);
    });

    it('caps a very long library name inside the pattern length limit', () => {
        const id = deriveFamilyId({
            origin: 'library',
            name: 'x'.repeat(300),
            hex: '200110000006000C8903020805009804',
        });
        expect(CORPUS_FAMILY_PATTERN.test(id)).toBe(true);
        expect(id.length).toBeLessThanOrEqual(100);
    });
});

describe('libraryAnchors', () => {
    it('exposes every public-library entry with a derived constraint class', () => {
        const anchors = libraryAnchors();
        expect(anchors.length).toBeGreaterThan(50);
        for (const anchor of anchors) {
            expect(anchor.hex).toMatch(/^[0-9a-fA-F]{32}$/);
            expect(anchor.symmetryClass).toBe(classifyRulesetConstraint(anchor.hex));
        }
    });

    it('every anchor derives a pattern-valid family id', () => {
        for (const anchor of libraryAnchors()) {
            const id = deriveFamilyId({ origin: 'library', name: anchor.name, hex: anchor.hex });
            expect(CORPUS_FAMILY_PATTERN.test(id), `${anchor.name} → ${id}`).toBe(true);
        }
    });

    it('derived family ids are unique across the whole library', () => {
        const ids = libraryAnchors()
            .map((anchor) => deriveFamilyId({ origin: 'library', name: anchor.name, hex: anchor.hex }));
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('buildLineage', () => {
    it('fills nine worlds with one anchor and eight descendants by default', () => {
        const lineage = buildLineage({}, { rulesetService, rng: seededRng() });
        expect(lineage.members).toHaveLength(9);
        expect(lineage.members.filter((m) => m.isAnchor)).toHaveLength(1);
        expect(lineage.members[0].isAnchor).toBe(true);
        expect(lineage.members[0].rulesetHex).toBe(lineage.anchorRuleset);
    });

    it('clamps memberCount to the 1–9 grid', () => {
        expect(buildLineage({ memberCount: 99 }, { rulesetService, rng: seededRng() }).members).toHaveLength(9);
        expect(buildLineage({ memberCount: -3 }, { rulesetService, rng: seededRng() }).members).toHaveLength(1);
    });

    it('a single-member lineage is an exact-ruleset family', () => {
        const lineage = buildLineage({ memberCount: 1 }, { rulesetService, rng: seededRng() });
        expect(lineage.relationship).toBe('exact-ruleset');
        expect(CORPUS_FAMILY_RELATIONSHIPS).toContain(lineage.relationship);
    });

    it('a multi-member lineage is a mutation lineage', () => {
        const lineage = buildLineage({ memberCount: 4 }, { rulesetService, rng: seededRng() });
        expect(lineage.relationship).toBe('mutation-lineage');
    });

    it('walks the mutation ladder so descendants span near and far distance', () => {
        const lineage = buildLineage({ memberCount: 5 }, { rulesetService, rng: seededRng() });
        const rates = lineage.members.slice(1).map((m) => m.mutationRate);
        expect(rates).toEqual(MUTATION_LADDER.slice(0, 4));
    });

    it('produces distinct rulesets across the lineage', () => {
        const lineage = buildLineage({}, { rulesetService, rng: seededRng(999) });
        const hexes = lineage.members.map((m) => m.rulesetHex);
        expect(new Set(hexes).size).toBe(hexes.length);
    });

    it('is deterministic for a given rng seed', () => {
        const a = buildLineage({}, { rulesetService, rng: seededRng(7) });
        const b = buildLineage({}, { rulesetService, rng: seededRng(7) });
        expect(b).toEqual(a);
    });

    it('honours a forced anchor hex', () => {
        const anchorHex = '200110000006000C8903020805009804';
        const lineage = buildLineage({ anchorHex }, { rulesetService, rng: seededRng() });
        expect(lineage.anchorRuleset).toBe(anchorHex.toUpperCase());
    });

    it('throws without a ruleset service rather than silently degrading', () => {
        expect(() => buildLineage({}, {})).toThrow(/rulesetService/);
    });
});

describe('buildLineage — symmetry preservation', () => {
    // The whole point: a lineage seeded to fill a symmetry-class coverage stratum must actually stay
    // in that class. Mutating with `single` mode would drop every descendant to `free`.
    for (const symmetryClass of ['r_sym', 'd_sym', 'n_count', 'totalistic']) {
        it(`keeps every descendant of a ${symmetryClass} anchor within that constraint`, () => {
            const lineage = buildLineage(
                { origin: 'random', symmetryClass },
                { rulesetService, rng: seededRng(4242) },
            );
            expect(lineage.origin).toBe('random');
            expect(lineage.members).toHaveLength(9);
            for (const member of lineage.members) {
                // A mutant may land in a *stricter* nested class, never a looser one.
                expect(
                    satisfiesRulesetConstraint(member.rulesetHex, symmetryClass),
                    `${member.rulesetHex} left ${symmetryClass} (got ${member.symmetryClass})`,
                ).toBe(true);
            }
        });
    }

    it('mutates a free anchor in single-bit mode', () => {
        const lineage = buildLineage(
            { origin: 'random', symmetryClass: 'free' },
            { rulesetService, rng: seededRng(31) },
        );
        expect(lineage.members[1].mutationMode).toBe('single');
    });

    it('records the anchor class and reports each member class independently', () => {
        const lineage = buildLineage({}, { rulesetService, rng: seededRng(88) });
        expect(lineage.anchorSymmetryClass).toBe(classifyRulesetConstraint(lineage.anchorRuleset));
        for (const member of lineage.members) {
            expect(member.symmetryClass).toBe(classifyRulesetConstraint(member.rulesetHex));
        }
    });
});

describe('pickInitialCondition', () => {
    it('draws a named generative preset by default', () => {
        const ic = pickInitialCondition(seededRng());
        expect(ic.source).toBe('preset');
        expect(GENERATIVE_PRESETS.map((p) => p.name)).toContain(ic.presetName);
        expect(['density', 'clusters']).toContain(ic.initialState.mode);
    });

    it('merges mode defaults under the preset params (clusters gain a distribution)', () => {
        // Cluster presets deliberately omit `distribution`; the defaults merge supplies it, exactly
        // as the modal does — a cluster initial state without it would reach the worker malformed.
        const scattered = GENERATIVE_PRESETS.find((p) => p.name === 'Scattered');
        expect(scattered.mode).toBe('clusters');
        expect(scattered.params.distribution).toBeUndefined();

        const built = initialStateFromPreset(scattered);
        expect(built.mode).toBe('clusters');
        expect(built.params.distribution).toBe('gaussian');
        expect(built.params.count).toBe(35);       // preset value wins over the default's 25
        expect(built.params.gaussianStdDev).toBe(2.5);
    });

    it('works on the raw preset arrays, not just the flattened pool', () => {
        // Regression: CLUSTER_PRESETS entries once lacked a `mode`, so building from one silently
        // produced a density-mode state carrying cluster params instead of failing.
        for (const preset of [...CLUSTER_PRESETS, ...DENSITY_PRESETS]) {
            const built = initialStateFromPreset(preset);
            expect(built.mode, preset.name).toBe(preset.mode);
            if (built.mode === 'clusters') expect(built.params.distribution, preset.name).toBe('gaussian');
        }
    });

    it('refuses an untagged bundle instead of guessing a mode', () => {
        expect(() => initialStateFromPreset({ name: 'Homeless', params: { count: 5 } }))
            .toThrow(/generative mode/);
        expect(() => initialStateFromPreset(null)).toThrow(/generative mode/);
    });

    it('every cluster preset drawn through pickInitialCondition carries a distribution', () => {
        for (let index = 0; index < GENERATIVE_PRESETS.length; index++) {
            const ic = pickInitialCondition(() => index / GENERATIVE_PRESETS.length);
            if (ic.initialState.mode === 'clusters') {
                expect(ic.initialState.params.distribution, ic.presetName).toBe('gaussian');
            }
        }
    });

    it('reuses a library entry initial condition when the draw calls for it', () => {
        const own = { mode: 'density', params: { density: 0.05 } };
        const ic = pickInitialCondition(() => 0, { ownInitialState: own });
        expect(ic.source).toBe('library-entry');
        expect(ic.initialState).toEqual(own);
        expect(ic.initialState).not.toBe(own); // cloned, so callers cannot mutate the library
    });

    it('falls back to a preset when the draw misses the library probability', () => {
        const ic = pickInitialCondition(() => 0.99, { ownInitialState: { mode: 'density', params: {} } });
        expect(ic.source).toBe('preset');
    });

    it('every preset in the pool produces a usable initial state', () => {
        for (let index = 0; index < GENERATIVE_PRESETS.length; index++) {
            const rng = () => index / GENERATIVE_PRESETS.length;
            const ic = pickInitialCondition(rng);
            expect(ic.initialState.params).toBeTypeOf('object');
            expect(Object.keys(ic.initialState.params).length).toBeGreaterThan(0);
        }
    });
});

describe('pickSeed', () => {
    it('never returns a falsy seed', () => {
        // A falsy seed makes `_getResetSeed` defer to the worker's Math.random, losing provenance.
        for (const value of [0, 0.5, 0.999999, 1]) {
            expect(pickSeed(() => value)).toBeGreaterThan(0);
        }
    });

    it('stays inside the unsigned 32-bit range', () => {
        const rng = seededRng(5);
        for (let i = 0; i < 200; i++) {
            const seed = pickSeed(rng);
            expect(Number.isInteger(seed)).toBe(true);
            expect(seed).toBeLessThanOrEqual(0xFFFFFFFF);
        }
    });
});

describe('familyRegistryEntry', () => {
    it('emits the four fields families-v1.json requires', () => {
        const lineage = buildLineage({}, { rulesetService, rng: seededRng() });
        const entry = familyRegistryEntry(lineage, 'train');
        expect(Object.keys(entry).sort()).toEqual(['anchorRuleset', 'id', 'relationship', 'split']);
        expect(entry.id).toBe(lineage.familyId);
        expect(entry.anchorRuleset).toBe(lineage.anchorRuleset);
        expect(CORPUS_FAMILY_RELATIONSHIPS).toContain(entry.relationship);
        expect(entry.split).toBe('train');
    });
});
