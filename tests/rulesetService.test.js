import { describe, it, expect, beforeAll } from 'vitest';
import { RulesetService } from '../src/core/RulesetService.js';
import * as Symmetry from '../src/core/Symmetry.js';
import { hexToRuleset, rulesetToHex } from '../src/utils/utils.js';
import { countSetBits } from '../src/core/Symmetry.js';

const ALL_ZERO = '0'.repeat(32);
const ALL_ONE = 'F'.repeat(32);

// A deterministic RNG that yields a fixed sequence (cycling). Lets us drive the
// probabilistic branches without Math.random.
function seq(values) {
    let i = 0;
    return () => values[i++ % values.length];
}

// True iff every rule entry with the same totalistic sum (centerState + neighbor count) agrees.
function isTotalistic(rules) {
    for (let sum = 0; sum <= 7; sum++) {
        let first = -1;
        for (let cs = 0; cs <= 1; cs++) {
            for (let mask = 0; mask < 64; mask++) {
                if (cs + countSetBits(mask) !== sum) continue;
                const out = rules[(cs << 6) | mask];
                if (first === -1) first = out;
                else if (first !== out) return false;
            }
        }
    }
    return true;
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

describe('RulesetService.getEffectiveRuleForTotalisticSum', () => {
    it('returns 2 (mixed) for a null ruleset', () => {
        expect(RulesetService.getEffectiveRuleForTotalisticSum(null, 3)).toBe(2);
    });

    it('returns the uniform output of a totalistic-sum bucket', () => {
        const zeros = hexToRuleset(ALL_ZERO);
        for (let sum = 0; sum <= 7; sum++) {
            expect(RulesetService.getEffectiveRuleForTotalisticSum(zeros, sum)).toBe(0);
        }
        const ones = hexToRuleset(ALL_ONE);
        for (let sum = 0; sum <= 7; sum++) {
            expect(RulesetService.getEffectiveRuleForTotalisticSum(ones, sum)).toBe(1);
        }
    });

    it('returns 2 when a totalistic-sum bucket is mixed', () => {
        const rules = hexToRuleset(ALL_ZERO);
        // sum=3 is reachable by (cs=0, 3 neighbors) and (cs=1, 2 neighbors); make them disagree.
        // Flip a single (cs=0, 3-neighbor) entry so the bucket is no longer uniform.
        for (let mask = 0; mask < 64; mask++) {
            if (countSetBits(mask) === 3) { rules[(0 << 6) | mask] = 1; break; }
        }
        expect(RulesetService.getEffectiveRuleForTotalisticSum(rules, 3)).toBe(2);
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

describe('RulesetService.generateMutatedHex (totalistic)', () => {
    it('keeps every totalistic-sum bucket uniform and flips all buckets at rate 1', () => {
        // Source is totalistic (ALL_ZERO); reference is itself; rng always passes => every bucket flips.
        const out = service.generateMutatedHex(ALL_ZERO, 1, 'totalistic', hexToRuleset(ALL_ZERO), () => 0);
        const rules = hexToRuleset(out);
        expect(isTotalistic(rules)).toBe(true);
        // Every bucket was uniformly 0 and flips to 1 => all ones.
        expect(out).toBe(ALL_ONE);
    });

    it('flips nothing when rng never passes — equals source', () => {
        const out = service.generateMutatedHex(ALL_ZERO, 0.5, 'totalistic', hexToRuleset(ALL_ZERO), () => 0.999);
        expect(out).toBe(ALL_ZERO);
    });

    it('consumes an extra Math.round(rng()) draw when the reference bucket is mixed', () => {
        // Build a reference whose sum=0 bucket is uniform (0) but sum=1 bucket is mixed.
        const ref = hexToRuleset(ALL_ZERO);
        // sum=1 reachable by (cs=0, 1 neighbor) and (cs=1, 0 neighbors); disagree them.
        ref[(1 << 6) | 0] = 1; // (cs=1, 0 neighbors) => 1, while (cs=0, 1 neighbor) stays 0 => mixed
        // Exact draw stream (8 sum-gates ascending + 1 extra for the mixed sum=1 bucket):
        //   sum=0: gate 0 (pass), uniform ref (0) => newOutput 1, NO extra draw.
        //   sum=1: gate 0 (pass), mixed ref => extra draw 0.9 => Math.round(0.9)=1.
        //   sum=2..7: gate 0.999 (no pass).
        const rng = seq([0, 0, 0.9, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999]);
        const out = service.generateMutatedHex(ALL_ZERO, 0.5, 'totalistic', ref, rng);
        const rules = hexToRuleset(out);
        expect(isTotalistic(rules)).toBe(true);
        // sum=0 bucket (only (cs=0,0 neighbors)) set to 1; sum=1 bucket set to 1.
        expect(rules[(0 << 6) | 0]).toBe(1);
        for (let mask = 0; mask < 64; mask++) {
            if (countSetBits(mask) === 1) expect(rules[(0 << 6) | mask]).toBe(1);
        }
        expect(rules[(1 << 6) | 0]).toBe(1);
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

    it('totalistic output keeps sum-buckets uniform (8 ascending draws)', () => {
        // seq([0, 0.9]) => sums 0,2,4,6 draw 0 (=> output 1); sums 1,3,5,7 draw 0.9 (=> output 0).
        const out = service.generateRandomRulesetHex(0.5, 'totalistic', seq([0, 0.9]));
        const rules = hexToRuleset(out);
        expect(isTotalistic(rules)).toBe(true);
        // Pin the 8-draw ascending contract: bucket output = (sum even ? 1 : 0).
        for (let sum = 0; sum <= 7; sum++) {
            expect(RulesetService.getEffectiveRuleForTotalisticSum(rules, sum)).toBe(sum % 2 === 0 ? 1 : 0);
        }
    });

    it('totalistic output is nested inside n_count (buckets uniform, cs=1/n == cs=0/n+1)', () => {
        const out = service.generateRandomRulesetHex(0.5, 'totalistic', seq([0, 0.9]));
        const rules = hexToRuleset(out);
        // Every neighbor-count bucket is uniform (never mixed) ...
        for (const cs of [0, 1]) {
            for (let nan = 0; nan <= 6; nan++) {
                expect(RulesetService.getEffectiveRuleForNeighborCount(rules, cs, nan)).not.toBe(2);
            }
        }
        // ... and the diagonal identity that distinguishes totalistic from n_count holds.
        for (let n = 0; n <= 6; n++) {
            const lo = RulesetService.getEffectiveRuleForNeighborCount(rules, 0, n);      // sum = n
            const hi = RulesetService.getEffectiveRuleForNeighborCount(rules, 1, n);      // sum = n+1
            const loNext = RulesetService.getEffectiveRuleForNeighborCount(rules, 0, n + 1); // sum = n+1
            if (n < 6) expect(hi).toBe(loNext);
            expect(lo).toBe(RulesetService.getEffectiveRuleForTotalisticSum(rules, n));
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

    it('n_count: each neighbor-count bucket is taken wholesale from a single parent', () => {
        const out = service.crossoverHexes(hexA, hexB, 'n_count', seq([0, 0.9]));
        const a = hexToRuleset(hexA), b = hexToRuleset(hexB), child = hexToRuleset(out);
        for (let cs = 0; cs <= 1; cs++) {
            for (let nan = 0; nan <= 6; nan++) {
                // Find the parent this bucket took (from its first mask), then assert the rest match it.
                let fromA = null;
                for (let mask = 0; mask < 64; mask++) {
                    if (countSetBits(mask) !== nan) continue;
                    const idx = (cs << 6) | mask;
                    if (fromA === null) fromA = child[idx] === a[idx];
                    expect(child[idx]).toBe(fromA ? a[idx] : b[idx]);
                }
            }
        }
    });

    it('totalistic: each totalistic-sum bucket is taken wholesale from a single parent', () => {
        const out = service.crossoverHexes(hexA, hexB, 'totalistic', seq([0, 0.9]));
        // Parents need not be totalistic; only that each sum-bucket is inherited wholesale.
        const a = hexToRuleset(hexA), b = hexToRuleset(hexB), child = hexToRuleset(out);
        for (let sum = 0; sum <= 7; sum++) {
            // Collect the bucket's indices, find the parent it took from its first entry, assert the rest.
            const idxs = [];
            for (let cs = 0; cs <= 1; cs++) {
                for (let mask = 0; mask < 64; mask++) {
                    if (cs + countSetBits(mask) === sum) idxs.push((cs << 6) | mask);
                }
            }
            const fromA = child[idxs[0]] === a[idxs[0]];
            for (const idx of idxs) expect(child[idx]).toBe(fromA ? a[idx] : b[idx]);
        }
    });

    it('totalistic: two totalistic parents breed a totalistic child', () => {
        const tA = service.generateRandomRulesetHex(0.5, 'totalistic', seq([0, 0.9]));
        const tB = service.generateRandomRulesetHex(0.5, 'totalistic', seq([0.9, 0]));
        const out = service.crossoverHexes(tA, tB, 'totalistic', seq([0, 0.9]));
        expect(isTotalistic(hexToRuleset(out))).toBe(true);
    });

    it('breeding identical parents is the identity (no post-mutation)', () => {
        expect(service.crossoverHexes(hexA, hexA, 'uniform', seq([0, 0.9]))).toBe(hexA);
        expect(service.crossoverHexes(hexA, hexA, 'r_sym', seq([0, 0.9]))).toBe(hexA);
        expect(service.crossoverHexes(hexA, hexA, 'n_count', seq([0, 0.9]))).toBe(hexA);
        expect(service.crossoverHexes(hexA, hexA, 'totalistic', seq([0, 0.9]))).toBe(hexA);
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

    it('r_sym post-crossover mutation flips whole orbit groups (rate 1, identical symmetric parents => invert)', () => {
        const sym = service.generateRandomRulesetHex(0.5, 'r_sym', seq([0, 0.9]));
        // Identical parents => child = sym; rate-1 r_sym post-mutation flips every group => invert.
        const out = service.crossoverHexes(sym, sym, 'r_sym', () => 0, 1);
        expect(out).toBe(RulesetService.invertHex(sym));
    });

    it('r_sym breeding + post-mutation keeps the child orbit-uniform (mode subspace is closed)', () => {
        const symA = service.generateRandomRulesetHex(0.5, 'r_sym', seq([0, 0.9]));
        const symB = service.generateRandomRulesetHex(0.5, 'r_sym', seq([0.9, 0, 0]));
        const out = service.crossoverHexes(symA, symB, 'r_sym', seq([0.1, 0.6, 0.4, 0.8]), 0.5);
        const child = hexToRuleset(out);
        for (const group of symmetryData.canonicalRepresentatives) {
            for (const cs of [0, 1]) {
                const ref = child[(cs << 6) | group.members[0]];
                for (const m of group.members) {
                    expect(child[(cs << 6) | m]).toBe(ref);
                }
            }
        }
    });

    it('totalistic breeding + post-mutation keeps the child totalistic', () => {
        const tA = service.generateRandomRulesetHex(0.5, 'totalistic', seq([0, 0.9]));
        const tB = service.generateRandomRulesetHex(0.5, 'totalistic', seq([0.9, 0]));
        const out = service.crossoverHexes(tA, tB, 'totalistic', seq([0.1, 0.6, 0.4, 0.8]), 0.5);
        expect(isTotalistic(hexToRuleset(out))).toBe(true);
    });

    it('n_count breeding + post-mutation keeps every neighbor-count bucket uniform', () => {
        const nA = service.generateRandomRulesetHex(0.5, 'n_count', seq([0, 0.9]));
        const nB = service.generateRandomRulesetHex(0.5, 'n_count', seq([0.9, 0]));
        const out = service.crossoverHexes(nA, nB, 'n_count', seq([0.1, 0.6, 0.4, 0.8]), 0.5);
        const child = hexToRuleset(out);
        for (const cs of [0, 1]) {
            for (let nan = 0; nan <= 6; nan++) {
                expect(RulesetService.getEffectiveRuleForNeighborCount(child, cs, nan)).not.toBe(2);
            }
        }
    });

    it('r_sym falls back to uniform when symmetryData is missing', () => {
        const bare = new RulesetService(null);
        const out = bare.crossoverHexes(hexA, hexB, 'r_sym', () => 0);
        expect(out).toBe(hexA); // uniform with rng always < 0.5 => parent A
    });
});

describe('RulesetService.crossoverPoolHexes (genepool)', () => {
    const hexA = '12482080480080006880800180010117';
    const hexB = RulesetService.invertHex(hexA);
    const hexC = '0FF00FF00FF00FF00FF00FF00FF00FF0';

    it('two-parent pool is byte-identical to crossoverHexes (same rng sequence)', () => {
        for (const mode of ['uniform', 'r_sym', 'n_count', 'totalistic']) {
            const draws = [0.1, 0.8, 0.3, 0.9, 0.2, 0.6, 0.05, 0.95, 0.4, 0.55, 0.7, 0.15, 0.85, 0.25];
            const pool = service.crossoverPoolHexes([hexA, hexB], mode, seq(draws), 0);
            const bin = service.crossoverHexes(hexA, hexB, mode, seq(draws), 0);
            expect(pool).toBe(bin);
        }
    });

    it('single-parent pool + post-mutation == clone-and-mutate (identity then flips)', () => {
        // No mutation: pure clone of the only parent, regardless of mode.
        expect(service.crossoverPoolHexes([hexA], 'r_sym', () => 0.4, 0)).toBe(hexA);
        expect(service.crossoverPoolHexes([hexA], 'n_count', () => 0.4, 0)).toBe(hexA);
        expect(service.crossoverPoolHexes([hexA], 'totalistic', () => 0.4, 0)).toBe(hexA);
        // Full mutation flips every bit (clone then invert).
        expect(service.crossoverPoolHexes([hexA], 'uniform', () => 0, 1)).toBe(RulesetService.invertHex(hexA));
    });

    it('every child bit comes from some parent in the pool (uniform, 3 parents)', () => {
        const out = service.crossoverPoolHexes([hexA, hexB, hexC], 'uniform', seq([0.1, 0.5, 0.9]), 0);
        const a = hexToRuleset(hexA), b = hexToRuleset(hexB), c = hexToRuleset(hexC), child = hexToRuleset(out);
        for (let i = 0; i < 128; i++) {
            expect(child[i] === a[i] || child[i] === b[i] || child[i] === c[i]).toBe(true);
        }
    });

    it('n_count, 3 parents: each bucket is taken wholesale from one pool member', () => {
        const out = service.crossoverPoolHexes([hexA, hexB, hexC], 'n_count', seq([0, 0.4, 0.9]), 0);
        const pool = [hexToRuleset(hexA), hexToRuleset(hexB), hexToRuleset(hexC)];
        const child = hexToRuleset(out);
        for (let cs = 0; cs <= 1; cs++) {
            for (let nan = 0; nan <= 6; nan++) {
                const masks = [];
                for (let mask = 0; mask < 64; mask++) if (countSetBits(mask) === nan) masks.push((cs << 6) | mask);
                // Some single pool member must match the child across the whole bucket.
                const ok = pool.some(p => masks.every(idx => child[idx] === p[idx]));
                expect(ok).toBe(true);
            }
        }
    });

    it('empty pool yields a zeroed ruleset', () => {
        expect(service.crossoverPoolHexes([], 'uniform', () => 0)).toBe('0'.repeat(32));
    });
});

describe('RulesetService.projectToMode', () => {
    const hexA = '12482080480080006880800180010117';

    it('single (and unknown) modes return the hex unchanged', () => {
        expect(service.projectToMode(hexA, 'single')).toBe(hexA);
        expect(service.projectToMode(hexA, 'bogus')).toBe(hexA);
    });

    it('r_sym returns an already-symmetric ruleset bit-identical', () => {
        const sym = service.generateRandomRulesetHex(0.5, 'r_sym', seq([0, 0.9]));
        expect(service.projectToMode(sym, 'r_sym')).toBe(sym);
    });

    it('r_sym projection makes every canonical orbit uniform', () => {
        const out = service.projectToMode(hexA, 'r_sym');
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

    it('r_sym projection takes the majority output of each orbit', () => {
        const group3 = symmetryData.canonicalRepresentatives.find(g => g.members.length === 3);
        const rules = hexToRuleset(ALL_ZERO);
        // Two of three members ON => majority 1.
        rules[(0 << 6) | group3.members[0]] = 1;
        rules[(0 << 6) | group3.members[1]] = 1;
        const out = hexToRuleset(service.projectToMode(rulesetToHex(rules), 'r_sym'));
        for (const m of group3.members) expect(out[(0 << 6) | m]).toBe(1);
    });

    it('r_sym projection breaks ties with the first (lowest-index) orbit member', () => {
        const group2 = symmetryData.canonicalRepresentatives.find(g => g.members.length === 2);
        const rules = hexToRuleset(ALL_ZERO);
        // 1-1 split: first member 0, second member 1 => tie resolves to the first member's 0.
        rules[(0 << 6) | group2.members[1]] = 1;
        const out = hexToRuleset(service.projectToMode(rulesetToHex(rules), 'r_sym'));
        for (const m of group2.members) expect(out[(0 << 6) | m]).toBe(0);
    });

    it('n_count projection makes every neighbor-count bucket uniform', () => {
        const out = hexToRuleset(service.projectToMode(hexA, 'n_count'));
        for (const cs of [0, 1]) {
            for (let nan = 0; nan <= 6; nan++) {
                expect(RulesetService.getEffectiveRuleForNeighborCount(out, cs, nan)).not.toBe(2);
            }
        }
    });

    it('totalistic projection yields a totalistic ruleset', () => {
        expect(isTotalistic(hexToRuleset(service.projectToMode(hexA, 'totalistic')))).toBe(true);
    });

    it('r_sym without symmetryData returns the hex unchanged', () => {
        const bare = new RulesetService(null);
        expect(bare.projectToMode(hexA, 'r_sym')).toBe(hexA);
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
