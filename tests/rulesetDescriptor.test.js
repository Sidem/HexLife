import { describe, it, expect } from 'vitest';
import {
    describeRuleset,
    classifyRulesetConstraint,
    CONSTRAINT_CLASSES,
    CONSTRAINT_CLASS_META,
    ORBIT_LABELS,
} from '../src/core/rulesetDescriptor.js';
import { rulesetToHex, hexToRuleset } from '../src/core/rulesetHex.js';
import { countSetBits, getCanonicalRepresentative, precomputeSymmetryGroups } from '../src/core/Symmetry.js';
import { RulesetService } from '../src/core/RulesetService.js';

/** Build a ruleset hex from a per-rule predicate. */
function hexFrom(fn) {
    const rules = new Uint8Array(128);
    for (let cs = 0; cs < 2; cs++) {
        for (let mask = 0; mask < 64; mask++) {
            rules[(cs << 6) | mask] = fn(cs, mask) ? 1 : 0;
        }
    }
    return rulesetToHex(rules);
}

describe('ORBIT_LABELS', () => {
    it('covers the canonical representative of every 6-bit mask', () => {
        for (let mask = 0; mask < 64; mask++) {
            expect(ORBIT_LABELS.has(getCanonicalRepresentative(mask))).toBe(true);
        }
        expect(ORBIT_LABELS.size).toBe(14);
    });
});

describe('describeRuleset', () => {
    it('rejects non-hex input', () => {
        expect(describeRuleset(null)).toBeNull();
        expect(describeRuleset('')).toBeNull();
        expect(describeRuleset('HXW1.notahex')).toBeNull();
        expect(describeRuleset('D5F5EBB9CD2C79E4B3F1F0E6ED1D67A')).toBeNull(); // 31 chars
    });

    it('classifies a neighbor-count rule as B/S digits', () => {
        const hex = hexFrom((cs, mask) => {
            const n = countSetBits(mask);
            return cs === 0 ? n === 2 : n === 3 || n === 5;
        });
        // Pinned literal: the devvit server tests reuse this exact hex as their B2/S35 fixture.
        expect(hex).toBe('16686880688080000116166916696996');
        const d = describeRuleset(hex);
        expect(d.type).toBe('n-count');
        expect(d.notation).toBe('B2/S35');
        expect(d.birth).toEqual(['2']);
        expect(d.survival).toEqual(['3', '5']);
        expect(d.reflectionSymmetric).toBe(true);
        expect(d.summary).toContain('born with 2');
        expect(d.summary).toContain('3 or 5');
    });

    it('classifies the all-dead rule as an empty B/S', () => {
        const d = describeRuleset('0'.repeat(32));
        expect(d.type).toBe('n-count');
        expect(d.notation).toBe('B/S');
        expect(d.birth).toEqual([]);
        expect(d.survival).toEqual([]);
        expect(d.aliveOutputs).toBe(0);
    });

    it('classifies an orbit-uniform rule as r-sym with arrangement suffixes', () => {
        // Birth only on the adjacent pair (2o); survival on any 3 neighbors.
        const hex = hexFrom((cs, mask) =>
            cs === 0
                ? getCanonicalRepresentative(mask) === 0b000011
                : countSetBits(mask) === 3,
        );
        const d = describeRuleset(hex);
        expect(d.type).toBe('r-sym');
        expect(d.notation).toBe('B2o/S3');
        expect(d.birth).toEqual(['2o']);
        expect(d.survival).toEqual(['3']);
        expect(d.reflectionSymmetric).toBe(true);
    });

    it('collapses a fully-active count to its bare digit inside an r-sym rule', () => {
        // Birth on every 2-arrangement plus only the 3o orbit → "B23o".
        const hex = hexFrom((cs, mask) => {
            if (cs !== 0) return false;
            const rep = getCanonicalRepresentative(mask);
            return countSetBits(mask) === 2 || rep === 0b000111;
        });
        const d = describeRuleset(hex);
        expect(d.type).toBe('r-sym');
        expect(d.notation).toBe('B23o/S');
    });

    it("distinguishes the chiral 3m/3m' pair and drops the reflection flag", () => {
        const hex = hexFrom((cs, mask) =>
            cs === 0 && getCanonicalRepresentative(mask) === 0b001011,
        );
        const d = describeRuleset(hex);
        expect(d.type).toBe('r-sym');
        expect(d.notation).toBe('B3m/S');
        expect(d.reflectionSymmetric).toBe(false);
        expect(d.summary).toContain('mirror');
    });

    it('classifies an orbit-mixed rule as raw with no notation', () => {
        // Alive for exactly one member of the 2o orbit — its rotation is dead.
        const hex = hexFrom((cs, mask) => cs === 0 && mask === 0b000011);
        const d = describeRuleset(hex);
        expect(d.type).toBe('raw');
        expect(d.notation).toBeNull();
        expect(d.birth).toEqual([]);
        expect(d.aliveOutputs).toBe(1);
        expect(d.summary).toContain('1/128');
    });

    it('uppercases and echoes the input hex', () => {
        const d = describeRuleset('d5f5ebb9cd2c79e4b3f1f0e6ed1d67a6');
        expect(d).not.toBeNull();
        expect(d.hex).toBe('D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6');
    });
});

// --- #38: constraint classification (totalistic ⊂ n_count ⊂ r_sym ⊂ free) --------------------

/** Strictness rank: 0 = totalistic (strictest) … 3 = free. Lower means more constrained. */
const rank = (cls) => CONSTRAINT_CLASSES.indexOf(cls);

/** A deterministic RNG so "random" rulesets are the same rulesets on every run. */
function seededRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

describe('classifyRulesetConstraint', () => {
    it('rejects input that is not a 32-char hex or a 128-entry table', () => {
        expect(classifyRulesetConstraint(null)).toBeNull();
        expect(classifyRulesetConstraint('')).toBeNull();
        expect(classifyRulesetConstraint('D5F5EBB9CD2C79E4B3F1F0E6ED1D67A')).toBeNull(); // 31 chars
        expect(classifyRulesetConstraint('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBeNull();
        expect(classifyRulesetConstraint(new Uint8Array(64))).toBeNull();
    });

    it('accepts a rule table directly, agreeing with the hex form', () => {
        const hex = hexFrom((cs, mask) => (cs + countSetBits(mask)) % 2 === 0);
        expect(classifyRulesetConstraint(hexToRuleset(hex))).toBe(classifyRulesetConstraint(hex));
    });

    it('names each class from a hand-built rule table', () => {
        // Depends only on the total live count (centre + neighbours).
        expect(classifyRulesetConstraint(hexFrom((cs, mask) => cs + countSetBits(mask) === 3))).toBe('totalistic');
        // Depends on the count, but a live and a dead cell with the same TOTAL disagree
        // (born at 3 neighbours, survives with 3 — sum 3 vs sum 4), so it is only outer-totalistic.
        expect(classifyRulesetConstraint(hexFrom((cs, mask) => countSetBits(mask) === 3))).toBe('n_count');
        // Depends on the neighbour ARRANGEMENT (adjacent pair vs opposite pair are both count 2),
        // but every rotation of an arrangement agrees.
        expect(classifyRulesetConstraint(hexFrom((_cs, mask) => getCanonicalRepresentative(mask) === 0b000011))).toBe('r_sym');
        // A single mask fires — its own rotations do not, so not even rotationally symmetric.
        expect(classifyRulesetConstraint(hexFrom((cs, mask) => cs === 0 && mask === 0b000011))).toBe('free');
    });

    it('classifies the degenerate all-dead / all-alive tables as totalistic', () => {
        // Constant outputs satisfy every constraint, so the strictest one wins.
        expect(classifyRulesetConstraint('0'.repeat(32))).toBe('totalistic');
        expect(classifyRulesetConstraint('F'.repeat(32))).toBe('totalistic');
    });

    it('never reports a class looser than the mode a ruleset was generated in', () => {
        // The generators guarantee subspace membership; a draw may land in a STRICTER class by
        // chance (e.g. every orbit of a count agreeing), so "no looser" is the honest invariant.
        const service = new RulesetService(precomputeSymmetryGroups());
        const modes = [
            ['totalistic', 'totalistic'],
            ['n_count', 'n_count'],
            ['r_sym', 'r_sym'],
            ['single', 'free'],
        ];
        for (const [mode, expectedClass] of modes) {
            for (let i = 0; i < 40; i++) {
                const hex = service.generateRandomRulesetHex(0.5, mode, seededRng(1000 + i));
                const cls = classifyRulesetConstraint(hex);
                expect(rank(cls), `${mode} draw #${i} (${hex}) classified ${cls}`)
                    .toBeLessThanOrEqual(rank(expectedClass));
            }
        }
    });

    it('reports each mode exactly for a typical (non-degenerate) draw', () => {
        // The complement of the property above: the classifier must not collapse everything to
        // "totalistic". One representative draw per mode, pinned by seed.
        const service = new RulesetService(precomputeSymmetryGroups());
        expect(classifyRulesetConstraint(service.generateRandomRulesetHex(0.5, 'totalistic', seededRng(7)))).toBe('totalistic');
        expect(classifyRulesetConstraint(service.generateRandomRulesetHex(0.5, 'n_count', seededRng(7)))).toBe('n_count');
        expect(classifyRulesetConstraint(service.generateRandomRulesetHex(0.5, 'r_sym', seededRng(7)))).toBe('r_sym');
        expect(classifyRulesetConstraint(service.generateRandomRulesetHex(0.5, 'single', seededRng(7)))).toBe('free');
    });

    it('hierarchy: projecting onto a stricter mode never loosens the class', () => {
        const service = new RulesetService(precomputeSymmetryGroups());
        const rng = seededRng(99);
        for (let i = 0; i < 20; i++) {
            const free = service.generateRandomRulesetHex(0.5, 'single', rng);
            const rsym = service.projectToMode(free, 'r_sym');
            const ncount = service.projectToMode(rsym, 'n_count');
            const tot = service.projectToMode(ncount, 'totalistic');
            const ranks = [free, rsym, ncount, tot].map((h) => rank(classifyRulesetConstraint(h)));
            for (let k = 1; k < ranks.length; k++) {
                expect(ranks[k]).toBeLessThanOrEqual(ranks[k - 1]);
            }
            expect(rank(classifyRulesetConstraint(tot))).toBe(rank('totalistic'));
        }
    });

    it('a ruleset already inside a mode is returned — and classified — unchanged', () => {
        const service = new RulesetService(precomputeSymmetryGroups());
        const hex = service.generateRandomRulesetHex(0.5, 'n_count', seededRng(3));
        expect(service.projectToMode(hex, 'n_count')).toBe(hex);
        expect(classifyRulesetConstraint(hex)).toBe('n_count');
    });

    it('every class has badge metadata', () => {
        for (const cls of CONSTRAINT_CLASSES) {
            expect(CONSTRAINT_CLASS_META[cls].label).toBeTruthy();
            expect(CONSTRAINT_CLASS_META[cls].description.length).toBeGreaterThan(20);
        }
        expect(CONSTRAINT_CLASSES).toEqual(['totalistic', 'n_count', 'r_sym', 'free']);
    });
});

describe('describeRuleset — constraintClass field', () => {
    it('agrees with the standalone classifier', () => {
        const service = new RulesetService(precomputeSymmetryGroups());
        const rng = seededRng(11);
        for (const mode of ['totalistic', 'n_count', 'r_sym', 'single']) {
            for (let i = 0; i < 10; i++) {
                const hex = service.generateRandomRulesetHex(0.5, mode, rng);
                expect(describeRuleset(hex).constraintClass).toBe(classifyRulesetConstraint(hex));
            }
        }
    });

    it('refines the notation `type`: raw ⇒ free, n-count ⇒ n_count or the stricter totalistic', () => {
        const raw = describeRuleset(hexFrom((cs, mask) => cs === 0 && mask === 0b000011));
        expect(raw.type).toBe('raw');
        expect(raw.constraintClass).toBe('free');

        const rsym = describeRuleset(hexFrom((_cs, mask) => getCanonicalRepresentative(mask) === 0b000011));
        expect(rsym.type).toBe('r-sym');
        expect(rsym.constraintClass).toBe('r_sym');

        const nCount = describeRuleset(hexFrom((cs, mask) => countSetBits(mask) === 3));
        expect(nCount.type).toBe('n-count');
        expect(nCount.constraintClass).toBe('n_count');

        const totalistic = describeRuleset(hexFrom((cs, mask) => cs + countSetBits(mask) === 3));
        expect(totalistic.type).toBe('n-count'); // same notation tier…
        expect(totalistic.constraintClass).toBe('totalistic'); // …but a stricter class
    });
});
