import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    RULESET_CODE_SPEC,
    RULESET_CODE_PATTERN,
    rulesetToCode,
    codeToRuleset,
    codeToHex,
    isRulesetCode,
    parseRulesetInput,
} from '../src/core/rulesetCode.js';
import {
    classifyRulesetConstraint,
    describeRuleset,
    parseRulesetNotation,
    ORBIT_LABELS,
} from '../src/core/rulesetDescriptor.js';
import { rulesetToHex, hexToRuleset } from '../src/core/rulesetHex.js';
import { countSetBits, getCanonicalRepresentative } from '../src/core/Symmetry.js';

/** Build a rule table from a per-rule predicate. */
function tableFrom(fn) {
    const rules = new Uint8Array(128);
    for (let cs = 0; cs < 2; cs++) {
        for (let mask = 0; mask < 64; mask++) {
            rules[(cs << 6) | mask] = fn(cs, mask) ? 1 : 0;
        }
    }
    return rules;
}

/** A code from a raw payload integer, bypassing the encoder — for exhaustive decode sweeps. */
function codeOf(tag, value) {
    return tag + value.toString(16).toUpperCase().padStart(RULESET_CODE_SPEC[tag].chars, '0');
}

/** Deterministic PRNG so a failing random case is reproducible. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('code space', () => {
    it('gives every class exactly as many payload bits as it has degrees of freedom', () => {
        // The bit widths are not arbitrary: they are the orbit counts the classifier itself uses.
        expect(ORBIT_LABELS.size).toBe(14);
        const dihedralOrbits = new Set();
        for (let mask = 0; mask < 64; mask++) {
            const rep = getCanonicalRepresentative(mask);
            dihedralOrbits.add(rep === 0b001101 ? 0b001011 : rep);
        }
        expect(dihedralOrbits.size).toBe(13);

        expect(RULESET_CODE_SPEC.T.bits).toBe(8); // total live count 0..7
        expect(RULESET_CODE_SPEC.N.bits).toBe(2 * 7);
        expect(RULESET_CODE_SPEC.M.bits).toBe(2 * dihedralOrbits.size);
        expect(RULESET_CODE_SPEC.R.bits).toBe(2 * ORBIT_LABELS.size);
    });

    it('uses no hex digit as a tag letter', () => {
        // Load-bearing, not cosmetic: this is why d_sym is tagged `M` and not `D`. With a hex-digit
        // tag, any 32-char hex starting with it truncates into a well-formed short code and decodes
        // silently to the wrong rule — the exact failure the tag exists to prevent.
        for (const tag of Object.keys(RULESET_CODE_SPEC)) {
            expect(/^[0-9A-F]$/.test(tag), tag).toBe(false);
        }
    });

    it('uses the tightest hex width for each payload', () => {
        for (const [tag, spec] of Object.entries(RULESET_CODE_SPEC)) {
            expect(spec.chars, tag).toBe(Math.ceil(spec.bits / 4));
        }
        // M buys semantics, not bytes — 26 and 28 bits both need 7 hex digits.
        expect(RULESET_CODE_SPEC.M.chars).toBe(RULESET_CODE_SPEC.R.chars);
    });

    it('assigns every payload slot to at least one rule entry (no dead bits)', () => {
        for (const [tag, spec] of Object.entries(RULESET_CODE_SPEC)) {
            const used = new Set(spec.slots);
            expect(used.size, tag).toBe(spec.bits);
            expect(Math.max(...spec.slots), tag).toBe(spec.bits - 1);
        }
    });
});

describe('rulesetToCode / codeToRuleset', () => {
    it('round-trips every totalistic and n-count payload exhaustively', () => {
        for (const tag of ['T', 'N']) {
            const { bits } = RULESET_CODE_SPEC[tag];
            for (let value = 0; value < 2 ** bits; value++) {
                const rules = codeToRuleset(codeOf(tag, value));
                expect(rules, `${tag} ${value}`).not.toBeNull();
                // Re-encoding may pick a *stricter* tag (every totalistic rule is also n-count),
                // but the table it denotes must be identical.
                expect([...codeToRuleset(rulesetToCode(rules))], `${tag} ${value}`).toEqual([...rules]);
            }
        }
    });

    it('emits the strictest tag, so each ruleset has exactly one code', () => {
        const tagFor = { totalistic: 'T', n_count: 'N', d_sym: 'M', r_sym: 'R' };
        // Every n-count payload — 2^14 rules, 2^8 of which are also totalistic.
        let totalistic = 0;
        for (let value = 0; value < 2 ** 14; value++) {
            const rules = codeToRuleset(codeOf('N', value));
            const code = rulesetToCode(rules);
            expect(code[0]).toBe(tagFor[classifyRulesetConstraint(rules)]);
            if (code[0] === 'T') totalistic++;
        }
        expect(totalistic).toBe(2 ** 8);
    });

    it('round-trips sampled d-sym and random r-sym payloads', () => {
        for (let value = 0; value < 2 ** 26; value += 9973) {
            const rules = codeToRuleset(codeOf('M', value));
            expect([...codeToRuleset(rulesetToCode(rules))], `M ${value}`).toEqual([...rules]);
        }
        const rand = mulberry32(0xc0ffee);
        for (let i = 0; i < 20000; i++) {
            const value = Math.floor(rand() * 2 ** 28);
            const rules = codeToRuleset(codeOf('R', value));
            expect([...codeToRuleset(rulesetToCode(rules))], `R ${value}`).toEqual([...rules]);
        }
    });

    it('round-trips random unconstrained tables through the unchanged 32-char hex', () => {
        const rand = mulberry32(42);
        for (let i = 0; i < 5000; i++) {
            const rules = tableFrom(() => rand() < 0.5);
            const code = rulesetToCode(rules);
            if (classifyRulesetConstraint(rules) === 'free') {
                expect(code).toMatch(/^[0-9A-F]{32}$/);
                expect(code).toBe(rulesetToHex(rules));
            }
            expect([...codeToRuleset(code)]).toEqual([...rules]);
        }
    });

    it('agrees with the constraint classifier on the tag it chose', () => {
        const rand = mulberry32(7);
        for (let i = 0; i < 3000; i++) {
            const value = Math.floor(rand() * 2 ** 28);
            const rules = codeToRuleset(codeOf('R', value));
            const code = rulesetToCode(rules);
            const spec = RULESET_CODE_SPEC[code[0]];
            expect(spec.constraintClass).toBe(classifyRulesetConstraint(rules));
        }
    });

    it('produces the documented example codes', () => {
        // One real library ruleset per class. These are wire format — changing them is a breaking change.
        expect(rulesetToCode('16686880688080006880800080000001')).toBe('T21');
        expect(rulesetToCode('16686880688080000117177E177E7EE8')).toBe('N080C');
        expect(rulesetToCode('68808000800000007AC8A184C8128420')).toBe('M1000D08');
        expect(rulesetToCode('16284880608080000010024004082001')).toBe('R3000081');
        expect(rulesetToCode('200110000006000C8903020805009804')).toBe('200110000006000C8903020805009804');
    });

    it('accepts a non-canonical tag but normalizes back to the canonical one', () => {
        // B2/S35 is n-count; writing it as an r-sym code is legal input, not legal output.
        const canonical = rulesetToCode('16686880688080000116166916696996');
        expect(canonical[0]).toBe('N');
        const rules = hexToRuleset('16686880688080000116166916696996');
        const rSymPayload = new Uint8Array(28);
        for (let i = 0; i < 128; i++) rSymPayload[RULESET_CODE_SPEC.R.slots[i]] = rules[i];
        let value = 0;
        for (let i = 0; i < 28; i++) value = value * 2 + rSymPayload[i];
        const loose = codeOf('R', value);
        expect(loose).not.toBe(canonical);
        expect(codeToHex(loose)).toBe('16686880688080000116166916696996');
        expect(rulesetToCode(codeToRuleset(loose))).toBe(canonical);
    });
});

describe('malformed input', () => {
    it('rejects payloads that overflow their bit width', () => {
        // N and M leave two slack high bits; a value above the width is corruption, not a rule.
        expect(codeToRuleset('N3FFF')).not.toBeNull();
        expect(codeToRuleset('N4000')).toBeNull();
        expect(codeToRuleset('M3FFFFFF')).not.toBeNull();
        expect(codeToRuleset('M4000000')).toBeNull();
        // R and T fill their digits exactly, so every payload is valid.
        expect(codeToRuleset('RFFFFFFF')).not.toBeNull();
        expect(codeToRuleset('TFF')).not.toBeNull();
    });

    it('rejects wrong lengths, unknown tags and non-hex bodies', () => {
        for (const bad of [
            '', '   ', 'T', 'T2', 'T210', 'N080', 'N080CC', 'R300008', 'R30000811',
            'X3000081', 'B3000081', 'R300008G', 'R-000081', '3000081',
            '16686880688080000117177E177E7EE', '16686880688080000117177E177E7EE88',
            // A 32-char hex truncated to a short-code length must not decode as a short code.
            'D1000D08', 'DEADBEE', 'D5F5EBB9',
        ]) {
            expect(codeToRuleset(bad), bad).toBeNull();
            expect(isRulesetCode(bad), bad).toBe(false);
        }
        expect(codeToRuleset(null)).toBeNull();
        expect(codeToRuleset(undefined)).toBeNull();
        expect(rulesetToCode('nope')).toBeNull();
        expect(rulesetToCode(new Uint8Array(64))).toBeNull();
    });

    it('is whitespace- and case-insensitive', () => {
        expect(codeToHex('  r3000081  ')).toBe('16284880608080000010024004082001');
        expect(codeToHex('R3000081')).toBe('16284880608080000010024004082001');
    });

    it('keeps the tagged and hex grammars disjoint', () => {
        expect(RULESET_CODE_PATTERN.test('T21')).toBe(true);
        expect(RULESET_CODE_PATTERN.test('16284880608080000010024004082001')).toBe(true);
        expect(RULESET_CODE_PATTERN.test('R300008')).toBe(false);
        // No prefix of a 32-char hex is ever a well-formed short code, at any truncation length.
        const hex = 'D5F5EBB9CD2C79E4B3F1F0E6ED1D67AF';
        for (let len = 1; len < 32; len++) {
            expect(isRulesetCode(hex.slice(0, len)), `${len} chars`).toBe(false);
        }
        expect(isRulesetCode(hex)).toBe(true);
    });
});

describe('parseRulesetNotation', () => {
    it('is the inverse of describeRuleset for every notation the app emits', () => {
        const rand = mulberry32(1234);
        let checked = 0;
        for (let i = 0; i < 4000; i++) {
            const value = Math.floor(rand() * 2 ** 28);
            const hex = rulesetToHex(codeToRuleset(codeOf('R', value)));
            const described = describeRuleset(hex);
            expect(described.notation).not.toBeNull();
            expect(rulesetToHex(parseRulesetNotation(described.notation)), described.notation).toBe(hex);
            checked++;
        }
        expect(checked).toBe(4000);
    });

    it('expands a bare digit to every arrangement of that count', () => {
        const bs = parseRulesetNotation('B2/S35');
        const explicit = parseRulesetNotation("B2o2m2p/S3o3m3m'3p5");
        expect([...bs]).toEqual([...explicit]);
        expect(rulesetToHex(bs)).toBe('16686880688080000116166916696996');
        expect(describeRuleset(rulesetToHex(bs)).notation).toBe('B2/S35');
    });

    it('accepts typing conveniences without changing meaning', () => {
        const canonical = rulesetToHex(parseRulesetNotation("B2o/S3m'"));
        expect(rulesetToHex(parseRulesetNotation("B 2o / S 3m'"))).toBe(canonical);
        expect(rulesetToHex(parseRulesetNotation('B2O/S3M’'))).toBe(canonical);
        expect(rulesetToHex(parseRulesetNotation("b2o/s3m'"))).toBe(canonical);
    });

    it('treats the empty notation as the all-dead rule', () => {
        expect(rulesetToHex(parseRulesetNotation('B/S'))).toBe('0'.repeat(32));
    });

    it('rejects arrangements that do not exist', () => {
        for (const bad of [
            "B1o/S3", "B2m'/S3", 'B7/S3', 'B2/S3/S4', 'B2S3', '2/3', 'B2/', '/S3',
            "B3'/S", 'B2oo/S3', 'Bx/S3', '', null, undefined,
        ]) {
            expect(parseRulesetNotation(bad), String(bad)).toBeNull();
        }
    });

    it("only lets the prime mark distinguish the count-3 chiral pair", () => {
        const withPrime = parseRulesetNotation("B3m'/S");
        const without = parseRulesetNotation('B3m/S');
        expect(rulesetToHex(withPrime)).not.toBe(rulesetToHex(without));
        // Each names a single orbit, and the two are mirror images: same number of live outputs.
        const alive = (r) => r.reduce((a, b) => a + b, 0);
        expect(alive(withPrime)).toBe(alive(without));
    });
});

describe('parseRulesetInput', () => {
    it('identifies each accepted format and lands on the same hex', () => {
        const hex = '16686880688080000116166916696996';
        expect(parseRulesetInput(hex)).toMatchObject({ hex, format: 'hex' });
        expect(parseRulesetInput(rulesetToCode(hex))).toMatchObject({ hex, format: 'code' });
        expect(parseRulesetInput('B2/S35')).toMatchObject({ hex, format: 'notation' });
        expect(parseRulesetInput(hex.toLowerCase())).toMatchObject({ hex, format: 'hex' });
    });

    it('returns null rather than guessing', () => {
        for (const bad of ['', '  ', 'hello', 'N4000', 'B9/S9', 'HXW1.abc', null, 42]) {
            expect(parseRulesetInput(bad), String(bad)).toBeNull();
        }
    });
});

describe('the shipped library', () => {
    const library = JSON.parse(
        readFileSync(new URL('../src/core/library/rulesets.json', import.meta.url), 'utf8'),
    );

    it('round-trips every public ruleset through its short code', () => {
        expect(library.length).toBeGreaterThan(0);
        for (const entry of library) {
            const code = rulesetToCode(entry.hex);
            expect(code, entry.name).not.toBeNull();
            expect(codeToHex(code), entry.name).toBe(entry.hex.toUpperCase());
        }
    });

    it('shortens the rulesets that have structure and leaves the rest alone', () => {
        const byLength = {};
        for (const entry of library) {
            const len = rulesetToCode(entry.hex).length;
            byLength[len] = (byLength[len] || 0) + 1;
            const cls = classifyRulesetConstraint(entry.hex);
            expect(len === 32, entry.name).toBe(cls === 'free');
        }
        // Most of the curated library has structure; only `free` rules still need all 32 characters.
        const shortened = library.length - (byLength[32] || 0);
        expect(shortened).toBeGreaterThan(library.length / 2);
    });

    it('keeps notation and short code in agreement', () => {
        for (const entry of library) {
            const described = describeRuleset(entry.hex);
            if (!described.notation) continue;
            expect(rulesetToHex(parseRulesetNotation(described.notation)), entry.name)
                .toBe(entry.hex.toUpperCase());
        }
    });
});

describe('cross-checks against the existing table semantics', () => {
    it('decodes a totalistic code to a table that depends only on the total live count', () => {
        const rules = codeToRuleset('T21');
        const byTotal = new Map();
        for (let cs = 0; cs < 2; cs++) {
            for (let mask = 0; mask < 64; mask++) {
                const total = cs + countSetBits(mask);
                const out = rules[(cs << 6) | mask];
                if (!byTotal.has(total)) byTotal.set(total, out);
                expect(byTotal.get(total)).toBe(out);
            }
        }
        expect(byTotal.size).toBe(8);
    });

    it('decodes an r-sym code to a table constant on every rotation orbit', () => {
        const rules = codeToRuleset('R3000081');
        for (let cs = 0; cs < 2; cs++) {
            for (let mask = 0; mask < 64; mask++) {
                const rep = getCanonicalRepresentative(mask);
                expect(rules[(cs << 6) | mask]).toBe(rules[(cs << 6) | rep]);
            }
        }
    });
});
