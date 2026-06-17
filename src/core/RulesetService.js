import { rulesetToHex, hexToRuleset } from '../utils/utils.js';
import * as Symmetry from './Symmetry.js';

/**
 * Pure ruleset algebra extracted from WorldManager: random generation, mutation,
 * canonical-group inspection, neighbor-count effective output, and inversion.
 *
 * Nothing here touches worlds, proxies, persistence, or the EventBus — the only
 * state is the precomputed `symmetryData` (canonical orbit groups) passed in once.
 * The random/mutation helpers accept an injectable `rng` (default `Math.random`)
 * so they stay deterministically testable. WorldManager keeps thin delegators so
 * its public API (and every UI caller) is unchanged.
 */
export class RulesetService {
    /**
     * @param {object} symmetryData - Output of `Symmetry.precomputeSymmetryGroups()`.
     */
    constructor(symmetryData) {
        this.symmetryData = symmetryData;
    }

    /**
     * Generate a fresh ruleset hex.
     * - `n_count`: one random output per (centerState × neighbor-count) bucket.
     * - `r_sym`:   one random output per (centerState × canonical orbit) group.
     * - default:   each of the 128 entries flipped independently.
     * @param {number} bias - Probability of a 1 output.
     * @param {string} generationMode
     * @param {() => number} [rng=Math.random]
     * @returns {string} 32-char hex
     */
    generateRandomRulesetHex(bias, generationMode, rng = Math.random) {
        const tempRuleset = new Uint8Array(128);
        if (generationMode === 'n_count') {
            for (let cs = 0; cs <= 1; cs++) {
                for (let nan = 0; nan <= 6; nan++) {
                    const out = rng() < bias ? 1 : 0;
                    for (let m = 0; m < 64; m++) if (Symmetry.countSetBits(m) === nan) tempRuleset[(cs << 6) | m] = out;
                }
            }
        } else if (generationMode === 'r_sym') {
            if (!this.symmetryData || !this.symmetryData.canonicalRepresentatives) {
                console.warn("generateRandomRulesetHex: symmetryData not available for r_sym, falling back to random.");
                for (let i = 0; i < 128; i++) tempRuleset[i] = rng() < bias ? 1 : 0;
            } else {
                tempRuleset.fill(0);
                for (const group of this.symmetryData.canonicalRepresentatives) {
                    for (let cs = 0; cs <= 1; cs++) {
                        const out = rng() < bias ? 1 : 0;
                        for (const member of group.members) tempRuleset[(cs << 6) | member] = out;
                    }
                }
            }
        } else {
            for (let i = 0; i < 128; i++) tempRuleset[i] = rng() < bias ? 1 : 0;
        }
        return rulesetToHex(tempRuleset);
    }

    /**
     * Produce a mutated copy of `sourceHex`.
     * - `single`:  flip each of the 128 entries with probability `mutationRate`.
     * - `r_sym`:   flip whole canonical orbit groups (per centerState).
     * - `n_count`: flip whole neighbor-count buckets, seeded from `referenceRuleset`'s
     *              effective output (matches the legacy behaviour where the n_count
     *              mode read the *selected* world's effective rule, not the source).
     * @param {string} sourceHex
     * @param {number} mutationRate
     * @param {string} mutationMode
     * @param {Uint8Array|null} [referenceRuleset=null] - Parsed ruleset whose effective
     *        per-neighbor-count output seeds `n_count` flips. Falls back to "mixed" (2).
     * @param {() => number} [rng=Math.random]
     * @returns {string} 32-char hex
     */
    generateMutatedHex(sourceHex, mutationRate, mutationMode, referenceRuleset = null, rng = Math.random) {
        const rules = hexToRuleset(sourceHex);

        if (mutationMode === 'single') {
            for (let i = 0; i < 128; i++) {
                if (rng() < mutationRate) {
                    rules[i] = 1 - rules[i];
                }
            }
        } else if (mutationMode === 'r_sym') {
            const canonicalGroups = this.symmetryData.canonicalRepresentatives;
            if (!canonicalGroups || canonicalGroups.length === 0) return sourceHex;

            for (const group of canonicalGroups) {
                for (let cs = 0; cs <= 1; cs++) {
                    if (rng() < mutationRate) {
                        const currentOutput = rules[(cs << 6) | group.representative];
                        const newOutput = 1 - currentOutput;
                        for (const member of group.members) {
                            const idx = (cs << 6) | member;
                            rules[idx] = newOutput;
                        }
                    }
                }
            }
        } else if (mutationMode === 'n_count') {
            for (let cs = 0; cs <= 1; cs++) {
                for (let nan = 0; nan <= 6; nan++) {
                    if (rng() < mutationRate) {
                        const currentEffectiveOutput = RulesetService.getEffectiveRuleForNeighborCount(referenceRuleset, cs, nan);
                        const newOutput = (currentEffectiveOutput === 2) ? Math.round(rng()) : 1 - currentEffectiveOutput;

                        for (let mask = 0; mask < 64; mask++) {
                            if (Symmetry.countSetBits(mask) === nan) {
                                const idx = (cs << 6) | mask;
                                rules[idx] = newOutput;
                            }
                        }
                    }
                }
            }
        }

        return rulesetToHex(rules);
    }

    /**
     * Breed two parent ruleset hexes into a child (Phase 5 of the auto-explore roadmap).
     * - `uniform`: per-bit coin flip — each of the 128 outputs is taken from A or B independently.
     * - `r_sym`:   per `(centerState × canonical orbit)` group, pick one parent wholesale and copy
     *              its outputs across every orbit member, so coherent rule families travel together
     *              (exactly like r_sym mutation/generation). Falls back to `uniform` if symmetryData
     *              is unavailable.
     * - `n_count`: per `(centerState × neighbor-count bucket)`, pick one parent wholesale and copy
     *              its outputs across every mask with that active-neighbor count, so totalistic
     *              behaviour is inherited as a unit (mirrors n_count mutation/generation).
     * An optional low post-crossover mutation rate flips each entry independently (single-bit), to
     * inject fresh variation the way breeding pipelines usually do. With `postMutationRate=0` every
     * child bit is taken verbatim from A or B (and breeding identical parents is the identity).
     * Pure — the injectable `rng` keeps it deterministically testable like the rest of the algebra.
     * @param {string} hexA
     * @param {string} hexB
     * @param {'uniform'|'r_sym'|'n_count'} [mode='r_sym']
     * @param {() => number} [rng=Math.random]
     * @param {number} [postMutationRate=0] - Per-entry post-crossover single-bit flip probability.
     * @returns {string} 32-char hex
     */
    crossoverHexes(hexA, hexB, mode = 'r_sym', rng = Math.random, postMutationRate = 0) {
        return this.crossoverPoolHexes([hexA, hexB], mode, rng, postMutationRate);
    }

    /**
     * Recombine a *pool* of parent ruleset hexes into a single child (the genepool generalization of
     * `crossoverHexes`). For each inheritance unit a parent is drawn uniformly at random from the pool
     * and its outputs copied across that whole unit:
     * - `uniform`: per-bit.
     * - `r_sym`:   per `(centerState × canonical orbit)` group. Falls back to `uniform` if symmetryData
     *              is unavailable.
     * - `n_count`: per `(centerState × neighbor-count bucket)`.
     * With a single parent every unit is taken from it (so a 1-parent pool + `postMutationRate` is
     * exactly clone-and-mutate). With two parents the rng-draw order and parent choice are identical to
     * the binary `crossoverHexes` (`floor(rng()*2)` matches `rng() < 0.5`), so existing callers/tests
     * are byte-identical. The injectable `rng` keeps it deterministic.
     * @param {string[]} hexes - One or more 32-char ruleset hexes.
     * @param {'uniform'|'r_sym'|'n_count'} [mode='r_sym']
     * @param {() => number} [rng=Math.random]
     * @param {number} [postMutationRate=0] - Per-entry post-crossover single-bit flip probability.
     * @returns {string} 32-char hex ('Error'/empty pool yields a zeroed ruleset).
     */
    crossoverPoolHexes(hexes, mode = 'r_sym', rng = Math.random, postMutationRate = 0) {
        const parents = (hexes || []).map(hexToRuleset);
        const child = new Uint8Array(128);
        if (parents.length === 0) return rulesetToHex(child);

        // Draw a parent uniformly from the pool; clamp guards an injected rng that returns exactly 1.
        const pickParent = () => parents[Math.min(parents.length - 1, Math.floor(rng() * parents.length))];

        const canonicalGroups = this.symmetryData && this.symmetryData.canonicalRepresentatives;
        if (mode === 'r_sym' && canonicalGroups && canonicalGroups.length > 0) {
            for (const group of canonicalGroups) {
                for (let cs = 0; cs <= 1; cs++) {
                    const parent = pickParent();
                    for (const member of group.members) {
                        const idx = (cs << 6) | member;
                        child[idx] = parent[idx];
                    }
                }
            }
        } else if (mode === 'n_count') {
            for (let cs = 0; cs <= 1; cs++) {
                for (let nan = 0; nan <= 6; nan++) {
                    const parent = pickParent();
                    for (let mask = 0; mask < 64; mask++) {
                        if (Symmetry.countSetBits(mask) === nan) {
                            const idx = (cs << 6) | mask;
                            child[idx] = parent[idx];
                        }
                    }
                }
            }
        } else {
            // uniform (and the r_sym fallback): per-bit draw from the pool.
            for (let i = 0; i < 128; i++) {
                child[i] = pickParent()[i];
            }
        }

        if (postMutationRate > 0) {
            for (let i = 0; i < 128; i++) {
                if (rng() < postMutationRate) child[i] = 1 - child[i];
            }
        }

        return rulesetToHex(child);
    }

    /**
     * The effective output shared by every mask with `numActiveNeighbors` set bits
     * (for a given centerState), or 2 ("mixed") if the outputs disagree or the
     * ruleset is missing/invalid.
     * @param {Uint8Array|null} ruleset
     * @param {number} centerState
     * @param {number} numActiveNeighbors
     * @returns {0|1|2}
     */
    static getEffectiveRuleForNeighborCount(ruleset, centerState, numActiveNeighbors) {
        if (!ruleset) return 2;
        let firstOutput = -1;
        for (let mask = 0; mask < 64; mask++) {
            if (Symmetry.countSetBits(mask) === numActiveNeighbors) {
                const output = ruleset[(centerState << 6) | mask];
                if (firstOutput === -1) firstOutput = output;
                else if (firstOutput !== output) return 2;
            }
        }
        return firstOutput === -1 ? 2 : firstOutput;
    }

    /**
     * For each canonical orbit group, the effective output for centerState 0 and 1
     * (2 when the group's members disagree). Drives the ChromaLab / symmetry editor.
     * @param {Uint8Array|null} ruleset
     * @returns {Array<object>}
     */
    getCanonicalRuleDetails(ruleset) {
        if (!this.symmetryData) {
            console.error("getCanonicalRuleDetails: symmetryData is undefined.");
            return [];
        }
        if (!ruleset) return [];

        return this.symmetryData.canonicalRepresentatives.flatMap(group => {
            let outputState0 = -1, outputState1 = -1;
            let mixed0 = false, mixed1 = false;

            for (const member of group.members) {
                const currentOut0 = ruleset[(0 << 6) | member];
                if (outputState0 === -1) outputState0 = currentOut0;
                else if (outputState0 !== currentOut0) mixed0 = true;

                const currentOut1 = ruleset[(1 << 6) | member];
                if (outputState1 === -1) outputState1 = currentOut1;
                else if (outputState1 !== currentOut1) mixed1 = true;
            }
            return [
                { canonicalBitmask: group.representative, centerState: 0, orbitSize: group.orbitSize, effectiveOutput: mixed0 ? 2 : outputState0, members: group.members },
                { canonicalBitmask: group.representative, centerState: 1, orbitSize: group.orbitSize, effectiveOutput: mixed1 ? 2 : outputState1, members: group.members }
            ];
        });
    }

    /**
     * Bitwise-invert every output in a ruleset hex (1↔0 across all 128 entries).
     * @param {string} hex
     * @returns {string} 32-char hex
     */
    static invertHex(hex) {
        const rulesetArray = hexToRuleset(hex);
        for (let i = 0; i < rulesetArray.length; i++) {
            rulesetArray[i] = 1 - rulesetArray[i];
        }
        return rulesetToHex(rulesetArray);
    }
}
