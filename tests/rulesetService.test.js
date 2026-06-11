import { describe, it, expect, beforeAll } from 'vitest';
import { RulesetService } from '../src/core/RulesetService.js';
import * as Symmetry from '../src/core/Symmetry.js';
import { hexToRuleset } from '../src/utils/utils.js';
import { countSetBits } from '../src/core/Symmetry.js';

const ALL_ZERO = '0'.repeat(32);
const ALL_ONE = 'F'.repeat(32);

// A deterministic RNG that yields a fixed sequence (cycling). Lets us drive the
// probabilistic branches without Math.random.
function seq(values) {
    let i = 0;
    return () => values[i++ % values.length];
}

let service;
let symmetryData;
beforeAll(() => {
    symmetryData = Symmetry.precomputeSymmetryGroups();
    service = new RulesetService(symmetryData);
});

describe('RulesetService.invertHex', () => {
    it('flips all bits (all-zero <-> all-one)', () => {
        expect(RulesetService.invertHex(ALL_ZERO)).toBe(ALL_ONE);
        expect(RulesetService.invertHex(ALL_ONE)).toBe(ALL_ZERO);
    });

    it('is an involution (invert twice == identity)', () => {
        const hex = '12482080480080006880800180010117';
        expect(RulesetService.invertHex(RulesetService.invertHex(hex))).toBe(hex);
    });
});

describe('RulesetService.getEffectiveRuleForNeighborCount', () => {
    it('returns 2 (mixed) for a null ruleset', () => {
        expect(RulesetService.getEffectiveRuleForNeighborCount(null, 0, 3)).toBe(2);
    });

    it('returns the uniform output of a neighbor-count bucket', () => {
        // All-zero ruleset: every bucket is uniformly 0.
        const zeros = hexToRuleset(ALL_ZERO);
        for (let nan = 0; nan <= 6; nan++) {
            expect(RulesetService.getEffectiveRuleForNeighborCount(zeros, 0, nan)).toBe(0);
            expect(RulesetService.getEffectiveRuleForNeighborCount(zeros, 1, nan)).toBe(1 * 0); // still 0
        }
        const ones = hexToRuleset(ALL_ONE);
        expect(RulesetService.getEffectiveRuleForNeighborCount(ones, 0, 2)).toBe(1);
    });

    it('returns 2 when a bucket is mixed', () => {
        const rules = hexToRuleset(ALL_ZERO);
        // Force the neighbor-count==2 bucket (centerState 0) to disagree internally.
        let first = -1;
        for (let mask = 0; mask < 64; mask++) {
            if (countSetBits(mask) === 2) {
                rules[mask] = first === -1 ? 1 : 0; // first member 1, rest 0
                if (first === -1) first = mask;
            }
        }
        expect(RulesetService.getEffectiveRuleForNeighborCount(rules, 0, 2)).toBe(2);
    });
});

describe('RulesetService.generateMutatedHex (single)', () => {
    const source = '12482080480080006880800180010117';

    it('flips every bit when rate=1 and rng always passes — equals invert', () => {
        const out = service.generateMutatedHex(source, 1, 'single', null, () => 0);
        expect(out).toBe(RulesetService.invertHex(source));
    });

    it('flips nothing when rng never passes — equals source', () => {
        const out = service.generateMutatedHex(source, 0.5, 'single', null, () => 0.999);
        expect(out).toBe(source);
    });

    it('flips exactly the entries where rng < rate', () => {
        // rng yields 0 for even indices (flip), 0.9 for odd (no flip), rate 0.5.
        const rng = (() => { let i = 0; return () => (i++ % 2 === 0 ? 0 : 0.9); })();
        const out = service.generateMutatedHex(source, 0.5, 'single', null, rng);
        const before = hexToRuleset(source);
        const after = hexToRuleset(out);
        for (let i = 0; i < 128; i++) {
            if (i % 2 === 0) expect(after[i]).toBe(1 - before[i]);
            else expect(after[i]).toBe(before[i]);
        }
    });
});

describe('RulesetService.generateMutatedHex (r_sym)', () => {
    it('keeps every canonical-orbit member in agreement', () => {
        const source = ALL_ZERO;
        // Always pass so every group flips; output must remain orbit-uniform.
        const out = service.generateMutatedHex(source, 1, 'r_sym', null, () => 0);
        const rules = hexToRuleset(out);
        for (const group of symmetryData.canonicalRepresentatives) {
            for (const cs of [0, 1]) {
                const ref = rules[(cs << 6) | group.members[0]];
                for (const m of group.members) {
                    expect(rules[(cs << 6) | m]).toBe(ref);
                }
            }
        }
        // With an all-zero source, flipping every group yields all ones.
        expect(out).toBe(ALL_ONE);
    });
});

describe('RulesetService.generateMutatedHex (n_count)', () => {
    it('keeps every neighbor-count bucket uniform', () => {
        const out = service.generateMutatedHex(ALL_ZERO, 1, 'n_count', hexToRuleset(ALL_ZERO), () => 0);
        const rules = hexToRuleset(out);
        for (const cs of [0, 1]) {
            for (let nan = 0; nan <= 6; nan++) {
                let ref = -1;
                for (let mask = 0; mask < 64; mask++) {
                    if (countSetBits(mask) === nan) {
                        if (ref === -1) ref = rules[(cs << 6) | mask];
                        else expect(rules[(cs << 6) | mask]).toBe(ref);
                    }
                }
            }
        }
    });
});

describe('RulesetService.generateRandomRulesetHex', () => {
    it('all-ones when rng always below bias', () => {
        expect(service.generateRandomRulesetHex(0.5, 'single', () => 0)).toBe(ALL_ONE);
    });

    it('all-zeros when rng always at/above bias', () => {
        expect(service.generateRandomRulesetHex(0.5, 'single', () => 0.5)).toBe(ALL_ZERO);
    });

    it('r_sym output is orbit-uniform', () => {
        const out = service.generateRandomRulesetHex(0.5, 'r_sym', seq([0, 0.9]));
        const rules = hexToRuleset(out);
        for (const group of symmetryData.canonicalRepresentatives) {
            for (const cs of [0, 1]) {
                const ref = rules[(cs << 6) | group.members[0]];
                for (const m of group.members) {
                    expect(rules[(cs << 6) | m]).toBe(ref);
                }
            }
        }
    });

    it('n_count output keeps buckets uniform', () => {
        const out = service.generateRandomRulesetHex(0.5, 'n_count', seq([0, 0.9]));
        const rules = hexToRuleset(out);
        for (const cs of [0, 1]) {
            for (let nan = 0; nan <= 6; nan++) {
                let ref = -1;
                for (let mask = 0; mask < 64; mask++) {
                    if (countSetBits(mask) === nan) {
                        if (ref === -1) ref = rules[(cs << 6) | mask];
                        else expect(rules[(cs << 6) | mask]).toBe(ref);
                    }
                }
            }
        }
    });
});

describe('RulesetService.crossoverHexes', () => {
    const hexA = '12482080480080006880800180010117';
    const hexB = RulesetService.invertHex(hexA);

    it('uniform: every child bit comes from A or B', () => {
        // Mixed rng so some bits pick A (rng<0.5) and some pick B.
        const out = service.crossoverHexes(hexA, hexB, 'uniform', seq([0, 0.9]));
        const a = hexToRuleset(hexA), b = hexToRuleset(hexB), child = hexToRuleset(out);
        for (let i = 0; i < 128; i++) {
            expect(child[i] === a[i] || child[i] === b[i]).toBe(true);
        }
    });

    it('uniform: rng always < 0.5 yields parent A exactly', () => {
        expect(service.crossoverHexes(hexA, hexB, 'uniform', () => 0)).toBe(hexA);
    });

    it('uniform: rng always >= 0.5 yields parent B exactly', () => {
        expect(service.crossoverHexes(hexA, hexB, 'uniform', () => 0.9)).toBe(hexB);
    });

    it('r_sym: every child bit comes from A or B, per orbit member', () => {
        const out = service.crossoverHexes(hexA, hexB, 'r_sym', seq([0, 0.9]));
        const a = hexToRuleset(hexA), b = hexToRuleset(hexB), child = hexToRuleset(out);
        for (let i = 0; i < 128; i++) {
            expect(child[i] === a[i] || child[i] === b[i]).toBe(true);
        }
    });

    it('r_sym: each canonical-orbit group is taken wholesale from a single parent', () => {
        const out = service.crossoverHexes(hexA, hexB, 'r_sym', seq([0, 0.9]));
        const a = hexToRuleset(hexA), b = hexToRuleset(hexB), child = hexToRuleset(out);
        for (const group of symmetryData.canonicalRepresentatives) {
            for (const cs of [0, 1]) {
                // Whatever parent this group took, every member must match THAT parent.
                const idx0 = (cs << 6) | group.members[0];
                const fromA = child[idx0] === a[idx0];
                for (const m of group.members) {
                    const idx = (cs << 6) | m;
                    expect(child[idx]).toBe(fromA ? a[idx] : b[idx]);
                }
            }
        }
    });

    it('breeding identical parents is the identity (no post-mutation)', () => {
        expect(service.crossoverHexes(hexA, hexA, 'uniform', seq([0, 0.9]))).toBe(hexA);
        expect(service.crossoverHexes(hexA, hexA, 'r_sym', seq([0, 0.9]))).toBe(hexA);
    });

    it('is deterministic under an injected rng', () => {
        const a = service.crossoverHexes(hexA, hexB, 'r_sym', seq([0.1, 0.8, 0.3]));
        const b = service.crossoverHexes(hexA, hexB, 'r_sym', seq([0.1, 0.8, 0.3]));
        expect(a).toBe(b);
    });

    it('post-crossover mutation flips child bits (rate 1, identical parents => invert)', () => {
        // Crossover of A with A is A; a post-mutation rate of 1 (rng always passes) inverts every bit.
        // seq must satisfy crossover picks first, then 128 mutation draws — all < 1 to flip.
        const out = service.crossoverHexes(hexA, hexA, 'uniform', () => 0, 1);
        expect(out).toBe(RulesetService.invertHex(hexA));
    });

    it('r_sym falls back to uniform when symmetryData is missing', () => {
        const bare = new RulesetService(null);
        const out = bare.crossoverHexes(hexA, hexB, 'r_sym', () => 0);
        expect(out).toBe(hexA); // uniform with rng always < 0.5 => parent A
    });
});

describe('RulesetService.getCanonicalRuleDetails', () => {
    it('returns [] for a null ruleset', () => {
        expect(service.getCanonicalRuleDetails(null)).toEqual([]);
    });

    it('returns two rows (centerState 0 and 1) per canonical group with correct effective output', () => {
        const details = service.getCanonicalRuleDetails(hexToRuleset(ALL_ZERO));
        expect(details).toHaveLength(symmetryData.canonicalRepresentatives.length * 2);
        for (const row of details) {
            expect(row.effectiveOutput).toBe(0); // all-zero ruleset
            expect([0, 1]).toContain(row.centerState);
        }
    });

    it('flags mixed orbits as effectiveOutput 2', () => {
        const rules = hexToRuleset(ALL_ZERO);
        // Pick a group with >1 member and make its members disagree for centerState 0.
        const group = symmetryData.canonicalRepresentatives.find(g => g.members.length > 1);
        rules[(0 << 6) | group.members[0]] = 1; // others stay 0
        const details = service.getCanonicalRuleDetails(rules);
        const row = details.find(r => r.canonicalBitmask === group.representative && r.centerState === 0);
        expect(row.effectiveOutput).toBe(2);
    });
});
