// @ts-check

import { hexToRuleset } from './rulesetHex.js';
import { getCanonicalRepresentative } from './Symmetry.js';

/**
 * Ruleset classification + human-readable notation ("what ruleset is this?").
 *
 * Classifies a 32-char ruleset hex into one of three tiers and, where the structure allows,
 * emits a compact birth/survival notation:
 *
 * - `n-count` — every (centerState × neighbor-count) bucket is uniform. Classic outer-totalistic
 *   rule; notation is plain `B<counts>/S<counts>` (counts 0–6), e.g. `B2/S35`.
 * - `r-sym`  — every (centerState × rotation orbit) group is uniform, but at least one count
 *   splits across orbits. Notation extends B/S with the hex-CA community's benzene-style
 *   arrangement suffixes: `o` = adjacent, `m` = one apart, `p` = opposite (ortho/meta/para).
 *   The two mirror-image 3-neighbor arrangements are the only chiral pair; they are `3m` and
 *   `3m'`. A count whose orbits are all active collapses to the bare digit, so `n-count`
 *   notation is the degenerate case of this one.
 * - `raw`    — at least one orbit is mixed. No compact notation exists; the 32-char hex (or a
 *   128-entry table) is the rule.
 *
 * Dependency-light on purpose (rulesetHex + Symmetry only): imported by the explorer UI, the
 * `<hexlife-world>` embed chrome, and the Devvit server/client, none of which may drag in
 * utils.js/config.js.
 */

/**
 * Canonical orbit representative → notation label, in display order.
 * Representatives are `getCanonicalRepresentative` values (minimum over the 6 rotations of the
 * 6-bit neighbor mask). 14 orbits total: one each for counts 0/1/5/6, three for 2 and 4
 * (o/m/p), four for 3 (o, the chiral m/m' pair, p).
 */
export const ORBIT_LABELS = new Map([
    [0b000000, '0'],
    [0b000001, '1'],
    [0b000011, '2o'],
    [0b000101, '2m'],
    [0b001001, '2p'],
    [0b000111, '3o'],
    [0b001011, '3m'],
    [0b001101, "3m'"],
    [0b010101, '3p'],
    [0b001111, '4o'],
    [0b010111, '4m'],
    [0b011011, '4p'],
    [0b011111, '5'],
    [0b111111, '6'],
]);

/** The two chiral count-3 orbit representatives (mirror images of each other). */
const CHIRAL_REPS = [0b001011, 0b001101];

/** Display order of orbit labels within a notation string. */
const ORBIT_ORDER = [...ORBIT_LABELS.values()];

/**
 * Neighbor count of an orbit label ('2o' → 2, '5' → 5).
 * @param {string} label
 * @returns {number}
 */
function labelCount(label) {
    return parseInt(label[0], 10);
}

/**
 * Group a ruleset's outputs by (centerState × rotation orbit).
 * @param {Uint8Array} rules 128-entry table, index `(centerState << 6) | neighborMask`.
 * @returns {Array<Map<number, number>>|null} Per center state, orbit rep → uniform output —
 *   or null when any orbit has mixed outputs (the rule is not rotationally symmetric).
 */
function orbitOutputs(rules) {
    const perState = [new Map(), new Map()];
    for (let cs = 0; cs < 2; cs++) {
        for (let mask = 0; mask < 64; mask++) {
            const rep = getCanonicalRepresentative(mask);
            const out = rules[(cs << 6) | mask];
            const seen = perState[cs].get(rep);
            if (seen === undefined) perState[cs].set(rep, out);
            else if (seen !== out) return null;
        }
    }
    return perState;
}

/**
 * Active orbit labels for one center state, count-collapsed: when every orbit of a numeric
 * count is active, the bare digit stands for all of them (`2o,2m,2p` → `2`).
 * @param {Map<number, number>} outputs orbit rep → output for this center state.
 * @returns {string[]} labels in display order.
 */
function activeLabels(outputs) {
    const active = new Set();
    for (const [rep, label] of ORBIT_LABELS) {
        if (outputs.get(rep) === 1) active.add(label);
    }
    const labels = [];
    for (let count = 0; count <= 6; count++) {
        const ofCount = ORBIT_ORDER.filter((l) => labelCount(l) === count);
        const activeOfCount = ofCount.filter((l) => active.has(l));
        if (activeOfCount.length === ofCount.length && activeOfCount.length > 0) {
            labels.push(String(count));
        } else {
            labels.push(...activeOfCount);
        }
    }
    return labels;
}

/**
 * Classify a ruleset hex and derive its notation.
 *
 * @param {string} hex 32-char ruleset hex.
 * @returns {{
 *   hex: string,
 *   type: 'n-count' | 'r-sym' | 'raw',
 *   notation: string | null,
 *   birth: string[],
 *   survival: string[],
 *   reflectionSymmetric: boolean,
 *   aliveOutputs: number,
 *   summary: string,
 * } | null} null when `hex` is not a 32-char hex string (an invalid hex would otherwise decode
 * as the all-dead rule and mislabel garbage as `B/S`).
 * `birth`/`survival` are orbit labels (bare digits for fully-active counts; always bare digits
 * for `n-count` rules) and empty for `raw`. `aliveOutputs` counts the 128 table entries mapping
 * to alive — the one honest number a `raw` rule still has. `reflectionSymmetric` is whether the
 * chiral 3m/3m' pair agrees for both center states (vacuously true for `n-count`, false for
 * `raw` since we cannot tell).
 */
export function describeRuleset(hex) {
    if (typeof hex !== 'string' || !/^[0-9a-fA-F]{32}$/.test(hex)) return null;
    const normalized = hex.toUpperCase();
    const rules = hexToRuleset(normalized);
    let aliveOutputs = 0;
    for (let i = 0; i < 128; i++) aliveOutputs += rules[i];

    const perState = orbitOutputs(rules);
    if (!perState) {
        return {
            hex: normalized,
            type: 'raw',
            notation: null,
            birth: [],
            survival: [],
            reflectionSymmetric: false,
            aliveOutputs,
            summary:
                `No rotational symmetry — the full 128-entry rule table is the rule ` +
                `(${aliveOutputs}/128 outputs alive).`,
        };
    }

    const birth = activeLabels(perState[0]);
    const survival = activeLabels(perState[1]);
    const notation = `B${birth.join('')}/S${survival.join('')}`;

    const isNCount = [...birth, ...survival].every((l) => /^\d$/.test(l));
    const reflectionSymmetric = perState.every(
        (outputs) => outputs.get(CHIRAL_REPS[0]) === outputs.get(CHIRAL_REPS[1]),
    );

    if (isNCount) {
        return {
            hex: normalized,
            type: 'n-count',
            notation,
            birth,
            survival,
            reflectionSymmetric,
            aliveOutputs,
            summary:
                `Neighbor-count rule: a dead cell is born with ` +
                `${listCounts(birth)} live neighbor(s); a live cell survives with ` +
                `${listCounts(survival)}.`,
        };
    }

    return {
        hex: normalized,
        type: 'r-sym',
        notation,
        birth,
        survival,
        reflectionSymmetric,
        aliveOutputs,
        summary:
            `Rotationally symmetric rule: outcomes depend on the arrangement of neighbors, ` +
            `not just their count (o = adjacent, m = one apart, p = opposite` +
            `${reflectionSymmetric ? '' : "; 3m/3m' are mirror arrangements"}).`,
    };
}

/**
 * "2, 3 or 5" / "3" / "no" — for the plain-English n-count summary.
 * @param {string[]} labels
 * @returns {string}
 */
function listCounts(labels) {
    if (labels.length === 0) return 'no';
    if (labels.length === 1) return labels[0];
    return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}
