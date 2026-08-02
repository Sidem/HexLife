// @ts-check

import { hexToRuleset } from './rulesetHex.js';
import { getCanonicalRepresentative, countSetBits } from './Symmetry.js';

/**
 * Ruleset classification + human-readable notation ("what ruleset is this?").
 *
 * Two related answers live here. {@link classifyRulesetConstraint} names the **strictest structural
 * constraint** a rule satisfies (`totalistic ⊂ n_count ⊂ d_sym ⊂ r_sym ⊂ free`) — a badge-sized fact,
 * derived post-hoc from the 128-entry table, never stored. {@link describeRuleset} additionally
 * classifies a 32-char ruleset hex into one of three *notation* tiers and, where the structure
 * allows, emits a compact birth/survival notation:
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

/**
 * The constraint classes, **strictest first**. They nest: every totalistic rule is also n_count,
 * every n_count rule is also d_sym, every d_sym rule is also r_sym, and `free` is "none of the
 * above". A rule is reported as the
 * strictest class its table satisfies, so the five are mutually exclusive as labels.
 * @typedef {'totalistic'|'n_count'|'d_sym'|'r_sym'|'free'} ConstraintClass
 */
/** @type {ConstraintClass[]} */
export const CONSTRAINT_CLASSES = ['totalistic', 'n_count', 'd_sym', 'r_sym', 'free'];

/**
 * Display metadata per constraint class, for badges/filters. Kept next to the classifier (and
 * DOM-free) so the explorer UI, the embed chrome and the Devvit client can all render the same words.
 * @type {Record<ConstraintClass, {label: string, description: string}>}
 */
export const CONSTRAINT_CLASS_META = {
    totalistic: {
        label: 'Totalistic',
        description: 'Strictest: the outcome depends only on how many cells are alive in total (centre + neighbours), not on which.',
    },
    n_count: {
        label: 'N-count',
        description: 'Outer-totalistic: the outcome depends on the centre cell and how many neighbours are alive, not on where they are.',
    },
    d_sym: {
        label: 'D-sym',
        description: 'Dihedrally symmetric: rotating or reflecting a neighbour arrangement changes nothing.',
    },
    r_sym: {
        label: 'R-sym',
        description: 'Rotationally symmetric: rotations change nothing; an exact R-sym badge means at least one mirrored arrangement behaves differently.',
    },
    free: {
        label: 'Free',
        description: 'Unconstrained: the outcome can differ between rotations of the same neighbourhood — the full 128-entry table is the rule.',
    },
};

/**
 * Strictest constraint class satisfied by a rule table (see {@link CONSTRAINT_CLASSES}).
 * @param {Uint8Array} rules 128-entry table, index `(centerState << 6) | neighborMask`.
 * @param {Array<Map<number, number>>|null} perState {@link orbitOutputs} result (null ⇒ not r-sym).
 * @returns {ConstraintClass}
 */
function classFromTable(rules, perState) {
    // Not rotationally symmetric ⇒ neither of the stricter classes can hold either.
    if (!perState) return 'free';

    // For binary 6-neighbour masks, D6 differs from C6 only by merging the chiral 3m/3m' pair.
    const reflectionSymmetric = perState.every(
        (outputs) => outputs.get(CHIRAL_REPS[0]) === outputs.get(CHIRAL_REPS[1]),
    );

    // n-count: within a centre state, every mask with the same neighbour count agrees.
    const bucket = [new Int8Array(7).fill(-1), new Int8Array(7).fill(-1)];
    for (let cs = 0; cs < 2; cs++) {
        for (let mask = 0; mask < 64; mask++) {
            const n = countSetBits(mask);
            const out = rules[(cs << 6) | mask];
            if (bucket[cs][n] === -1) bucket[cs][n] = out;
            else if (bucket[cs][n] !== out) return reflectionSymmetric ? 'd_sym' : 'r_sym';
        }
    }

    // totalistic: the outcome depends only on the total live count `centerState + n`, so the two
    // buckets that share a sum must agree — (cs=1, n) with (cs=0, n+1). The extreme sums (0 and 7)
    // are reachable from one bucket each, so they constrain nothing.
    for (let n = 0; n <= 5; n++) {
        if (bucket[1][n] !== bucket[0][n + 1]) return 'n_count';
    }
    return 'totalistic';
}

/**
 * Name the strictest structural constraint a ruleset satisfies (roadmap #38). Pure, and cheap
 * enough to call per library card.
 *
 * The class is **derived, never stored**: it falls straight out of the 128-entry table, so it needs
 * no schema change and cannot go stale. Do not write it into `rulesets.json` or treat it as a tag.
 *
 * @param {string|Uint8Array} source 32-char ruleset hex, or the 128-entry rule table itself.
 * @returns {ConstraintClass|null} null when `source` is not a valid hex / 128-entry table (an
 *   invalid hex would otherwise decode to the all-dead rule and be mislabelled `totalistic`).
 */
export function classifyRulesetConstraint(source) {
    let rules;
    if (typeof source === 'string') {
        if (!/^[0-9a-fA-F]{32}$/.test(source)) return null;
        rules = hexToRuleset(source.toUpperCase());
    } else if (source && source.length === 128) {
        rules = source;
    } else {
        return null;
    }
    return classFromTable(rules, orbitOutputs(rules));
}

/**
 * Whether a ruleset satisfies a requested constraint, including stricter nested classes.
 * For example, a D-sym rule satisfies the R-sym filter, while a chiral R-sym rule does not satisfy
 * D-sym. This is the hierarchy-aware predicate used by the Library.
 * @param {string|Uint8Array} source
 * @param {ConstraintClass} requested
 * @returns {boolean}
 */
export function satisfiesRulesetConstraint(source, requested) {
    const own = classifyRulesetConstraint(source);
    const ownRank = own ? CONSTRAINT_CLASSES.indexOf(own) : -1;
    const requestedRank = CONSTRAINT_CLASSES.indexOf(requested);
    return ownRank >= 0 && requestedRank >= 0 && ownRank <= requestedRank;
}

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
 *   constraintClass: ConstraintClass,
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
 * `constraintClass` is the {@link classifyRulesetConstraint} answer, computed from the same table
 * scan. It is *finer* than `type`: `type: 'n-count'` splits into `n_count` and the stricter
 * `totalistic`, and `type: 'raw'` is `free`. `type` drives notation rendering and must not change;
 * prefer `constraintClass` for badges and filters.
 */
export function describeRuleset(hex) {
    if (typeof hex !== 'string' || !/^[0-9a-fA-F]{32}$/.test(hex)) return null;
    const normalized = hex.toUpperCase();
    const rules = hexToRuleset(normalized);
    let aliveOutputs = 0;
    for (let i = 0; i < 128; i++) aliveOutputs += rules[i];

    const perState = orbitOutputs(rules);
    const constraintClass = classFromTable(rules, perState);
    if (!perState) {
        return {
            hex: normalized,
            type: 'raw',
            constraintClass,
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
            constraintClass,
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
        constraintClass,
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

/** Notation label → canonical orbit representative — the inverse of {@link ORBIT_LABELS}. */
const LABEL_TO_REP = new Map([...ORBIT_LABELS].map(([rep, label]) => [label, rep]));

/**
 * Orbit representatives named by one side (the `B…` or `S…` half) of a notation string.
 * A bare digit stands for *every* orbit of that count — the collapsed form {@link activeLabels}
 * emits, and the only form an `n-count` rule ever uses.
 * @param {string} side
 * @returns {Set<number>|null} null on any token this notation does not define.
 */
function parseNotationSide(side) {
    const reps = new Set();
    let i = 0;
    while (i < side.length) {
        const digit = side[i];
        if (!/[0-6]/.test(digit)) return null;
        i++;
        let suffix = '';
        if (i < side.length && /[omp]/i.test(side[i])) {
            suffix = side[i].toLowerCase();
            i++;
            if (side[i] === "'") {
                suffix += "'";
                i++;
            }
        }
        if (suffix) {
            const rep = LABEL_TO_REP.get(digit + suffix);
            // Rejects arrangements that do not exist, e.g. `1o` or `2m'` — a count of 1 has a single
            // orbit, and the chiral prime only distinguishes the two count-3 mirror arrangements.
            if (rep === undefined) return null;
            reps.add(rep);
        } else {
            const count = Number(digit);
            for (const [rep, label] of ORBIT_LABELS) {
                if (labelCount(label) === count) reps.add(rep);
            }
        }
    }
    return reps;
}

/**
 * Parse a `B…/S…` notation string back into a rule table — the inverse of {@link describeRuleset}.
 *
 * Accepts every form this module *emits* plus the obvious typing conveniences: any case for the
 * arrangement suffixes, curly apostrophes for `3m'`, and interior whitespace. Because notation can
 * only name whole rotation orbits, the result is always r-sym or stricter; a `free` rule has no
 * notation and cannot be typed. Empty sides are legal — `B/S` is the all-dead rule.
 *
 * @param {string} notation e.g. `B2/S35`, `B2o2m/S3m6`, `B/S`.
 * @returns {Uint8Array|null} 128-entry table, or null when `notation` is not well-formed.
 */
export function parseRulesetNotation(notation) {
    if (typeof notation !== 'string') return null;
    const compact = notation.replace(/\s+/g, '').replace(/[‘’´`]/g, "'");
    const parts = /^B([0-6omp']*)\/S([0-6omp']*)$/i.exec(compact);
    if (!parts) return null;
    const birth = parseNotationSide(parts[1]);
    const survival = parseNotationSide(parts[2]);
    if (!birth || !survival) return null;

    const perState = [birth, survival];
    const rules = new Uint8Array(128);
    for (let cs = 0; cs < 2; cs++) {
        for (let mask = 0; mask < 64; mask++) {
            rules[(cs << 6) | mask] = perState[cs].has(getCanonicalRepresentative(mask)) ? 1 : 0;
        }
    }
    return rules;
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
