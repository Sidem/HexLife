// @ts-check

/**
 * Constraint-aware **short codes** for rulesets — "what is the shortest honest way to write this rule?"
 *
 * The 32-char hex from `rulesetHex.js` spends 128 bits on every ruleset, but a ruleset that satisfies
 * a structural constraint has far fewer degrees of freedom: a rotationally symmetric rule is decided
 * by 2 center states × 14 rotation orbits = 28 bits, a dihedral one by 2 × 13 = 26, an outer-totalistic
 * one by 2 × 7 = 14, and a totalistic one by the 8 possible total live counts. Those counts are exact
 * powers of two and the classes nest (2⁸ ⊂ 2¹⁴ ⊂ 2²⁶ ⊂ 2²⁸), so each class is a perfect bijection with
 * its payload — no wasted codes, no unrepresentable rules.
 *
 * A code is a **tag letter + fixed-width hex payload**:
 *
 * | Class        | Bits | Code       | Length | Example    |
 * |--------------|------|------------|--------|------------|
 * | `totalistic` | 8    | `T` + 2 hex| 3      | `T21`      |
 * | `n_count`    | 14   | `N` + 4 hex| 5      | `N080C`    |
 * | `d_sym`      | 26   | `M` + 7 hex| 8      | `M1000D08` |
 * | `r_sym`      | 28   | `R` + 7 hex| 8      | `R3000081` |
 * | `free`       | 128  | 32 hex     | 32     | unchanged  |
 *
 * `T`/`N`/`M`/`R` are all outside `[0-9A-F]`, so `^[0-9A-F]{32}$` and a tagged code are disjoint:
 * every hex string ever emitted stays valid and unambiguous, and no migration is needed. The tag is
 * what makes decoding total — length alone would also discriminate (2/4/7/32 are distinct), but then
 * a 32-char hex truncated to 7 characters by a bad copy-paste would silently decode as a valid,
 * *wrong* r-sym rule.
 *
 * **`d_sym` is tagged `M`, not `D`, because `D` is a hex digit.** Tagging it `D` would let any
 * 32-char hex beginning with `D` — one in sixteen of them — truncate into a well-formed 8-char code
 * and defeat the whole point of the tag. `M` is for *mirror*-symmetric, the property D6 adds to R6.
 * Note also that `M` saves no characters over `R` (26 and 28 bits both need 7 hex digits); it exists
 * so the tag doubles as the constraint badge, not to compress.
 *
 * **The 32-char hex remains the identity and storage key.** Share links, `rulesets.json`, thumbnail
 * cache keys and model provenance all key on it, and byte-identity there must not break. These codes
 * are a display/input alias: derive them for showing and accept them for typing, never store them.
 *
 * Three properties make decoding error-free:
 *  1. {@link rulesetToCode} always tags with the *strictest* class the table satisfies, so every
 *     ruleset has exactly one canonical code.
 *  2. `N` and `D` carry two slack high bits; {@link codeToRuleset} rejects a payload outside its bit
 *     width instead of silently masking it.
 *  3. {@link rulesetToCode} decodes its own output and compares all 128 entries before returning,
 *     falling back to full hex on any mismatch — a lossy code cannot escape this module.
 *
 * Dependency-light on purpose (rulesetHex + rulesetDescriptor + Symmetry), so `src/embed/` and the
 * Devvit client can adopt it without dragging in `utils.js`/`config.js`.
 */

import { hexToRuleset, rulesetToHex } from './rulesetHex.js';
import { ORBIT_LABELS, classifyRulesetConstraint, parseRulesetNotation } from './rulesetDescriptor.js';
import { getCanonicalRepresentative, countSetBits } from './Symmetry.js';

/** The 14 rotation-orbit representatives, in `ORBIT_LABELS` (B/S notation) order. */
const ROTATION_REPS = [...ORBIT_LABELS.keys()];
/** `3m'` — the chiral orbit that D6 merges into `3m`, leaving 13 dihedral orbits. */
const CHIRAL_MIRROR = 0b001101;
/** `3m` — the representative `3m'` folds into. */
const CHIRAL_KEEP = 0b001011;
const DIHEDRAL_REPS = ROTATION_REPS.filter((rep) => rep !== CHIRAL_MIRROR);

const ROTATION_SLOT = new Map(ROTATION_REPS.map((rep, i) => [rep, i]));
const DIHEDRAL_SLOT = new Map(
    ROTATION_REPS.map((rep) => [rep, DIHEDRAL_REPS.indexOf(rep === CHIRAL_MIRROR ? CHIRAL_KEEP : rep)]),
);

/**
 * Rule index → payload slot, for all 128 entries. Many entries share a slot (that is the whole point
 * of the constraint); for a rule that actually satisfies the class they all agree.
 * @param {(centerState: number, mask: number) => number} slotOf
 * @returns {Uint8Array}
 */
function buildSlotMap(slotOf) {
    const map = new Uint8Array(128);
    for (let cs = 0; cs < 2; cs++) {
        for (let mask = 0; mask < 64; mask++) {
            map[(cs << 6) | mask] = slotOf(cs, mask);
        }
    }
    return map;
}

/**
 * Per-tag wire format. `slots` is MSB-first: slot 0 is the payload's high bit, so a code reads
 * left-to-right in the same order as its `B…/S…` notation.
 * @type {Readonly<Record<string, {constraintClass: import('./rulesetDescriptor.js').ConstraintClass, bits: number, chars: number, slots: Uint8Array}>>}
 */
export const RULESET_CODE_SPEC = Object.freeze({
    T: {
        constraintClass: 'totalistic',
        bits: 8,
        chars: 2,
        // Totalistic depends only on the total live count, centre included.
        slots: buildSlotMap((cs, mask) => cs + countSetBits(mask)),
    },
    N: {
        constraintClass: 'n_count',
        bits: 14,
        chars: 4,
        slots: buildSlotMap((cs, mask) => cs * 7 + countSetBits(mask)),
    },
    M: {
        constraintClass: 'd_sym',
        bits: 26,
        chars: 7,
        slots: buildSlotMap((cs, mask) => {
            const slot = DIHEDRAL_SLOT.get(getCanonicalRepresentative(mask));
            return cs * 13 + /** @type {number} */ (slot);
        }),
    },
    R: {
        constraintClass: 'r_sym',
        bits: 28,
        chars: 7,
        slots: buildSlotMap((cs, mask) => {
            const slot = ROTATION_SLOT.get(getCanonicalRepresentative(mask));
            return cs * 14 + /** @type {number} */ (slot);
        }),
    },
});

/**
 * Constraint class → tag letter. `free` is absent on purpose: it has no short code and keeps the
 * 32-char hex.
 * @type {Readonly<Partial<Record<import('./rulesetDescriptor.js').ConstraintClass, string>>>}
 */
const TAG_FOR_CLASS = Object.freeze({ totalistic: 'T', n_count: 'N', d_sym: 'M', r_sym: 'R' });

/**
 * Matches any well-formed ruleset code: a tagged short code, or the 32-char hex. Shape only — it
 * does not range-check the `N`/`M` slack bits, so {@link isRulesetCode} is the real validator.
 */
export const RULESET_CODE_PATTERN = /^(?:T[0-9A-F]{2}|N[0-9A-F]{4}|[MR][0-9A-F]{7}|[0-9A-F]{32})$/;

/**
 * Coerce a hex string or rule table into a 128-entry table.
 * @param {string|Uint8Array} source
 * @returns {Uint8Array|null}
 */
function coerceRules(source) {
    if (typeof source === 'string') {
        return /^[0-9a-fA-F]{32}$/.test(source) ? hexToRuleset(source.toUpperCase()) : null;
    }
    return source && source.length === 128 ? source : null;
}

/**
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {boolean}
 */
function sameTable(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * Trim + uppercase, without touching anything that is not plausibly a code.
 * @param {unknown} code
 * @returns {string}
 */
function normalizeCode(code) {
    return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

/**
 * The canonical shortest code for a ruleset.
 *
 * Always tags with the strictest constraint class the table satisfies, so this is a function of the
 * ruleset alone — the same rule can never produce two different codes. Rules with no structure
 * (`free`) get the unchanged 32-char hex.
 *
 * @param {string|Uint8Array} source 32-char ruleset hex, or the 128-entry rule table.
 * @returns {string|null} the code, or null when `source` is not a valid ruleset.
 */
export function rulesetToCode(source) {
    const rules = coerceRules(source);
    if (!rules) return null;
    const cls = classifyRulesetConstraint(rules);
    const tag = cls ? TAG_FOR_CLASS[cls] : undefined;
    if (!tag) return rulesetToHex(rules);

    const { bits, chars, slots } = RULESET_CODE_SPEC[tag];
    const payload = new Uint8Array(bits);
    for (let i = 0; i < 128; i++) payload[slots[i]] = rules[i];
    let value = 0;
    for (let i = 0; i < bits; i++) value = value * 2 + payload[i];
    const code = tag + value.toString(16).toUpperCase().padStart(chars, '0');

    // Self-check: whatever we hand out must decode back to this exact table. Cheap (128 comparisons)
    // and it makes a lossy code structurally unemittable rather than merely untested.
    const roundTrip = codeToRuleset(code);
    return roundTrip && sameTable(roundTrip, rules) ? code : rulesetToHex(rules);
}

/**
 * Decode any ruleset code — tagged short code or 32-char hex — into a rule table.
 *
 * Lenient about *which* tag is used: a d-sym rule written as `R…` decodes fine. Re-derive the
 * canonical form with {@link rulesetToCode} if you need one code per ruleset.
 *
 * @param {string} code
 * @returns {Uint8Array|null} 128-entry table, or null when `code` is not well-formed.
 */
export function codeToRuleset(code) {
    const normalized = normalizeCode(code);
    if (/^[0-9A-F]{32}$/.test(normalized)) return hexToRuleset(normalized);

    const spec = RULESET_CODE_SPEC[normalized[0]];
    if (!spec) return null;
    const body = normalized.slice(1);
    if (body.length !== spec.chars || !/^[0-9A-F]+$/.test(body)) return null;
    const value = parseInt(body, 16);
    // `N` and `D` do not fill their last hex digit; a payload above the bit width is corruption,
    // not a rule, and must be rejected rather than masked.
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** spec.bits) return null;

    const rules = new Uint8Array(128);
    for (let i = 0; i < 128; i++) {
        rules[i] = (value >>> (spec.bits - 1 - spec.slots[i])) & 1;
    }
    return rules;
}

/**
 * Decode a ruleset code to the canonical 32-char hex — the app's identity format.
 * @param {string} code
 * @returns {string|null}
 */
export function codeToHex(code) {
    const rules = codeToRuleset(code);
    return rules ? rulesetToHex(rules) : null;
}

/**
 * Whether a string is a well-formed ruleset code (short or full hex), payload range included.
 * @param {string} code
 * @returns {boolean}
 */
export function isRulesetCode(code) {
    return codeToRuleset(code) !== null;
}

/**
 * @typedef {'hex'|'code'|'notation'} RulesetInputFormat
 */

/**
 * Parse anything a user might paste into a ruleset field: a 32-char hex, a tagged short code, or
 * `B…/S…` notation. The single entry point for input surfaces — they should accept all three and
 * then work in `hex`.
 *
 * The three grammars are disjoint (`B` is not a tag letter, and notation always contains `/`), so
 * `format` is a fact about the input rather than a guess.
 *
 * @param {string} text
 * @returns {{hex: string, rules: Uint8Array, format: RulesetInputFormat}|null} null when `text` is
 *   not a ruleset in any accepted format.
 */
export function parseRulesetInput(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    const upper = trimmed.toUpperCase();
    if (/^[0-9A-F]{32}$/.test(upper)) {
        return { hex: upper, rules: hexToRuleset(upper), format: 'hex' };
    }
    if (RULESET_CODE_SPEC[upper[0]]) {
        const rules = codeToRuleset(upper);
        return rules ? { hex: rulesetToHex(rules), rules, format: 'code' } : null;
    }
    const fromNotation = parseRulesetNotation(trimmed);
    if (fromNotation) {
        return { hex: rulesetToHex(fromNotation), rules: fromNotation, format: 'notation' };
    }
    return null;
}
