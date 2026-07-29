// @ts-check

import { hexToRuleset } from './rulesetHex.js';
import {
    classifyRulesetConstraint,
    CONSTRAINT_CLASS_META,
    ORBIT_LABELS,
} from './rulesetDescriptor.js';
import { getDihedralCanonicalRepresentative } from './Symmetry.js';

/**
 * A mutation degree is one independently mutable unit in the strictest rule space shared by both
 * rulesets. The spaces are nested:
 *
 *     totalistic (8 sums) ⊂ n_count (14 buckets) ⊂ d_sym (26 orbits)
 *       ⊂ r_sym (28 orbits) ⊂ free (128 bits)
 *
 * This makes the number evolutionary rather than representational. Flipping a six-member rotation
 * orbit is 1°, not six unrelated table edits.
 */
/** @type {Array<'totalistic'|'n_count'|'d_sym'|'r_sym'|'free'>} */
const SPACE_ORDER = ['totalistic', 'n_count', 'd_sym', 'r_sym', 'free'];

const DIHEDRAL_REPRESENTATIVES = [...new Set(
    Array.from({ length: 64 }, (_, mask) => getDihedralCanonicalRepresentative(mask)),
)].sort((a, b) => a - b);

export const RELATEDNESS_SPACE_META = {
    totalistic: { units: 8, label: CONSTRAINT_CLASS_META.totalistic.label },
    n_count: { units: 14, label: CONSTRAINT_CLASS_META.n_count.label },
    d_sym: { units: 26, label: CONSTRAINT_CLASS_META.d_sym.label },
    r_sym: { units: 28, label: CONSTRAINT_CLASS_META.r_sym.label },
    free: { units: 128, label: CONSTRAINT_CLASS_META.free.label },
};

/**
 * @typedef {{
 *   degrees: number,
 *   totalUnits: number,
 *   ratio: number,
 *   space: 'totalistic'|'n_count'|'d_sym'|'r_sym'|'free',
 *   spaceLabel: string,
 *   classA: 'totalistic'|'n_count'|'d_sym'|'r_sym'|'free',
 *   classB: 'totalistic'|'n_count'|'d_sym'|'r_sym'|'free',
 *   isIdentical: boolean,
 *   isClose: boolean,
 * }} RulesetRelatedness
 */

/**
 * @typedef {{hex?: string, name?: string, id?: string, source?: string}} RulesetLibraryEntry
 */

/**
 * Calculate the minimum legal mutation-unit distance between two valid rulesets.
 *
 * When the rules have different strictest classes, their least-strict shared class is used. For
 * example, a totalistic parent and an N-count child are compared in N-count space because one
 * N-count mutation can break totalism while remaining a single coherent mutation.
 *
 * @param {string} hexA
 * @param {string} hexB
 * @returns {RulesetRelatedness|null}
 */
export function rulesetRelatedness(hexA, hexB) {
    const classA = classifyRulesetConstraint(hexA);
    const classB = classifyRulesetConstraint(hexB);
    if (!classA || !classB) return null;

    const space = SPACE_ORDER[Math.max(SPACE_ORDER.indexOf(classA), SPACE_ORDER.indexOf(classB))];
    const rulesA = hexToRuleset(hexA);
    const rulesB = hexToRuleset(hexB);
    const degrees = countDifferentUnits(rulesA, rulesB, space);
    const totalUnits = RELATEDNESS_SPACE_META[space].units;

    return {
        degrees,
        totalUnits,
        ratio: degrees / totalUnits,
        space,
        spaceLabel: RELATEDNESS_SPACE_META[space].label,
        classA,
        classB,
        isIdentical: degrees === 0,
        // Five percent of a space, rounded up, always includes the defining one-mutation case.
        isClose: degrees > 0 && degrees <= Math.ceil(totalUnits * 0.05),
    };
}

/**
 * Find nearest named library entries. Entries with invalid/missing hex are ignored; duplicate ids
 * can be excluded while editing an existing save.
 *
 * @param {string} targetHex
 * @param {RulesetLibraryEntry[]} entries
 * @param {{limit?: number, excludeId?: string|null}} [options]
 * @returns {Array<{entry: RulesetLibraryEntry, relatedness: RulesetRelatedness}>}
 */
export function findRulesetRelatives(targetHex, entries, { limit = 3, excludeId = null } = {}) {
    /** @type {Array<{entry: RulesetLibraryEntry, relatedness: RulesetRelatedness}>} */
    const relatives = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || entry.id === excludeId || !entry.hex || !entry.name) continue;
        const relatedness = rulesetRelatedness(targetHex, entry.hex);
        if (relatedness) relatives.push({ entry, relatedness });
    }
    return relatives
        .sort((a, b) =>
            a.relatedness.degrees - b.relatedness.degrees
            || a.relatedness.ratio - b.relatedness.ratio
            || String(a.entry.name).localeCompare(String(b.entry.name))
        )
        .slice(0, Math.max(0, limit));
}

/**
 * Suggest the next family name from a close relative. An unnumbered base is treated as volume I:
 * `Crystal Tide` → `Crystal Tide II`; `Crystal Tide II` → `Crystal Tide III`.
 * Exact duplicates deliberately receive no new-family suggestion.
 *
 * @param {Array<{entry: {name?: string}, relatedness: RulesetRelatedness}>} relatives
 * @param {Array<{name?: string}>} allEntries
 * @param {number} [maxLength=50]
 * @returns {{name: string, basedOn: string}|null}
 */
export function suggestRulesetFamilyName(relatives, allEntries, maxLength = 50) {
    const nearest = relatives?.[0];
    if (!nearest || nearest.relatedness.isIdentical || !nearest.relatedness.isClose) return null;

    const basedOn = String(nearest.entry.name || '').trim();
    if (!basedOn) return null;
    const { base } = splitRomanSuffix(basedOn);
    let highest = 0;

    for (const entry of allEntries || []) {
        const candidate = String(entry?.name || '').trim();
        if (!candidate) continue;
        const parsed = splitRomanSuffix(candidate);
        if (parsed.base.toLocaleLowerCase() !== base.toLocaleLowerCase()) continue;
        highest = Math.max(highest, parsed.numeral || 1);
    }

    const numeral = toRoman(Math.max(2, highest + 1));
    const suffix = ` ${numeral}`;
    const trimmedBase = base.slice(0, Math.max(1, maxLength - suffix.length)).trimEnd();
    return { name: `${trimmedBase}${suffix}`, basedOn };
}

/**
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @param {'totalistic'|'n_count'|'d_sym'|'r_sym'|'free'} space
 */
function countDifferentUnits(a, b, space) {
    let differences = 0;

    if (space === 'totalistic') {
        for (let sum = 0; sum <= 7; sum++) {
            const cs = sum === 7 ? 1 : 0;
            const count = sum - cs;
            const mask = count === 0 ? 0 : (1 << count) - 1;
            if (a[(cs << 6) | mask] !== b[(cs << 6) | mask]) differences++;
        }
        return differences;
    }

    if (space === 'n_count') {
        for (let cs = 0; cs <= 1; cs++) {
            for (let count = 0; count <= 6; count++) {
                const mask = count === 0 ? 0 : (1 << count) - 1;
                if (a[(cs << 6) | mask] !== b[(cs << 6) | mask]) differences++;
            }
        }
        return differences;
    }

    if (space === 'r_sym') {
        for (let cs = 0; cs <= 1; cs++) {
            for (const representative of ORBIT_LABELS.keys()) {
                if (a[(cs << 6) | representative] !== b[(cs << 6) | representative]) differences++;
            }
        }
        return differences;
    }

    if (space === 'd_sym') {
        for (let cs = 0; cs <= 1; cs++) {
            for (const representative of DIHEDRAL_REPRESENTATIVES) {
                if (a[(cs << 6) | representative] !== b[(cs << 6) | representative]) differences++;
            }
        }
        return differences;
    }

    for (let i = 0; i < 128; i++) if (a[i] !== b[i]) differences++;
    return differences;
}

/**
 * Split only a canonical uppercase Roman numeral separated by whitespace. This avoids treating
 * ordinary endings such as "Remix" as family numbering.
 * @param {string} name
 */
function splitRomanSuffix(name) {
    const match = /^(.*\S)\s+([IVXLCDM]+)$/.exec(name);
    if (!match) return { base: name, numeral: null };
    const numeral = fromRoman(match[2]);
    if (!numeral || toRoman(numeral) !== match[2]) return { base: name, numeral: null };
    return { base: match[1], numeral };
}

/** @param {number} value */
function toRoman(value) {
    if (!Number.isInteger(value) || value < 1 || value > 3999) return String(value);
    /** @type {Array<[number, string]>} */
    const pairs = [
        [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
        [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
        [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
    ];
    let remaining = value;
    let out = '';
    for (const [amount, glyph] of pairs) {
        while (remaining >= amount) {
            out += glyph;
            remaining -= amount;
        }
    }
    return out;
}

/** @param {string} roman */
function fromRoman(roman) {
    /** @type {Record<string, number>} */
    const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let total = 0;
    for (let i = 0; i < roman.length; i++) {
        const value = values[roman[i]];
        const next = values[roman[i + 1]] || 0;
        total += value < next ? -value : value;
    }
    return total;
}
