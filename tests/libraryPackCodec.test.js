import { describe, it, expect } from 'vitest';
import {
    encodePack,
    decodePack,
    mergeRulesets,
    toPublicLibraryEntry,
    PACK_FORMAT,
    PACK_VERSION,
    THUMB_MAX_BYTES,
} from '../src/services/LibraryPackCodec.js';
import { rulesetName } from '../src/utils/utils.js';

const HEX_A = '12482080480080006880800180010117';
const HEX_B = 'abcdef0123456789abcdef0123456789';
const HEX_C = '00112233445566778899aabbccddeeff';
const SMALL_THUMB = 'data:image/jpeg;base64,' + 'A'.repeat(64);

/** A full schema-v2 personal-library entry, including the volatile fields that must not survive. */
function fullRuleset() {
    return {
        id: '1699999999999',
        createdAt: '2026-07-12T00:00:00.000Z',
        schemaVersion: 2,
        name: 'Spiral Weaver',
        description: 'A tidy little glider gun.',
        tags: ['gliders', 'spiral'],
        hex: HEX_A,
        initialState: { mode: 'clusters', params: { count: 5, density: 0.7 } },
        seed: 4242,
        thumb: SMALL_THUMB,
    };
}

/** A full gallery find entry, embedding-keyed (opaque cellKey + descriptorKind embedding). */
function fullFind() {
    return {
        hex: HEX_B,
        mnemonic: rulesetName(HEX_B),
        score: 0.87,
        screenScore: 0.61,
        cyclic: null,
        thumb: SMALL_THUMB,
        perComponent: { criticality: 0.5 },
        winningIC: 1,
        icLabel: 'chaos',
        initialState: { mode: 'density', params: { density: 0.3 } },
        seed: 77,
        generation: 12,
        metrics: { finalRatio: 0.42, blockEntropy: { mean: 0.66 }, sigma: 1.02 },
        rawMetrics: { foo: 1 },
        cellKey: 'e:deadbeefcafef00d',
        descriptorKind: 'embedding',
    };
}

describe('LibraryPackCodec round-trip', () => {
    it('encodes a well-formed pack envelope', () => {
        const json = encodePack({ rulesets: [fullRuleset()] }, { exportedAt: '2026-07-12T12:00:00.000Z', app: 'abc123' });
        const parsed = JSON.parse(json);
        expect(parsed.format).toBe(PACK_FORMAT);
        expect(parsed.version).toBe(PACK_VERSION);
        expect(parsed.exportedAt).toBe('2026-07-12T12:00:00.000Z');
        expect(parsed.app).toBe('abc123');
    });

    it('round-trips a full v2 ruleset entry losslessly (minus volatile id/createdAt/schemaVersion)', () => {
        const { rulesets, warnings } = decodePack(encodePack({ rulesets: [fullRuleset()] }));
        expect(warnings).toEqual([]);
        expect(rulesets).toHaveLength(1);
        const r = rulesets[0];
        expect(r).toEqual({
            name: 'Spiral Weaver',
            hex: HEX_A,
            tags: ['gliders', 'spiral'],
            description: 'A tidy little glider gun.',
            initialState: { mode: 'clusters', params: { count: 5, density: 0.7 } },
            seed: 4242,
            thumb: SMALL_THUMB,
        });
        // Volatile fields never travel.
        expect(r.id).toBeUndefined();
        expect(r.createdAt).toBeUndefined();
        expect(r.schemaVersion).toBeUndefined();
    });

    it('round-trips a full find entry, keeping metrics/rawMetrics verbatim', () => {
        const { finds, warnings } = decodePack(encodePack({ finds: [fullFind()] }));
        expect(warnings).toEqual([]);
        expect(finds).toHaveLength(1);
        const f = finds[0];
        expect(f.score).toBe(0.87);
        expect(f.metrics).toEqual({ finalRatio: 0.42, blockEntropy: { mean: 0.66 }, sigma: 1.02 });
        expect(f.rawMetrics).toEqual({ foo: 1 });
        expect(f.mnemonic).toBe(rulesetName(HEX_B));
        expect(f.initialState).toEqual({ mode: 'density', params: { density: 0.3 } });
        expect(f.seed).toBe(77);
        expect(f.thumb).toBe(SMALL_THUMB);
    });

    it('carries both arrays in one pack', () => {
        const { rulesets, finds } = decodePack(encodePack({ rulesets: [fullRuleset()], finds: [fullFind()] }));
        expect(rulesets).toHaveLength(1);
        expect(finds).toHaveLength(1);
    });

    it('defaults empty arrays when a pack carries neither kind', () => {
        const { rulesets, finds, warnings } = decodePack(encodePack({}));
        expect(rulesets).toEqual([]);
        expect(finds).toEqual([]);
        expect(warnings).toEqual([]);
    });
});

describe('LibraryPackCodec.decodePack rejects unreadable input', () => {
    it('throws on non-JSON', () => {
        expect(() => decodePack('not json {')).toThrow(/valid JSON/i);
    });

    it('throws on a wrong format tag', () => {
        expect(() => decodePack(JSON.stringify({ format: 'something-else', version: 1 }))).toThrow(/HexLife pack/i);
    });

    it('throws on a non-object payload (array / primitive)', () => {
        expect(() => decodePack(JSON.stringify([1, 2, 3]))).toThrow(/expected a JSON object/i);
    });

    it('throws on a future/unsupported version', () => {
        expect(() => decodePack(JSON.stringify({ format: PACK_FORMAT, version: 999 }))).toThrow(/version/i);
    });
});

describe('LibraryPackCodec sanitization (untrusted packs)', () => {
    function decodeRulesets(entries) {
        return decodePack(JSON.stringify({ format: PACK_FORMAT, version: PACK_VERSION, rulesets: entries, finds: [] }));
    }

    it('drops an entry with invalid hex, with a warning', () => {
        const { rulesets, warnings } = decodeRulesets([{ hex: 'nope', name: 'x' }, fullRuleset()]);
        expect(rulesets).toHaveLength(1);
        expect(rulesets[0].hex).toBe(HEX_A);
        expect(warnings.some(w => /invalid ruleset hex/i.test(w))).toBe(true);
    });

    it('falls back to the mnemonic when name is missing/blank', () => {
        const { rulesets } = decodeRulesets([{ hex: HEX_C, name: '   ' }]);
        expect(rulesets[0].name).toBe(rulesetName(HEX_C));
    });

    it('clamps an oversized name and description', () => {
        const { rulesets, warnings } = decodeRulesets([{
            hex: HEX_C,
            name: 'N'.repeat(200),
            description: 'D'.repeat(1000),
        }]);
        expect(rulesets[0].name).toHaveLength(80);
        expect(rulesets[0].description).toHaveLength(500);
        expect(warnings.some(w => /description truncated/i.test(w))).toBe(true);
    });

    it('trims a too-long tag list and too-long individual tags', () => {
        const tags = Array.from({ length: 15 }, (_, i) => `tag${i}`.padEnd(40, 'x'));
        const { rulesets, warnings } = decodeRulesets([{ hex: HEX_C, tags }]);
        expect(rulesets[0].tags).toHaveLength(10);
        expect(rulesets[0].tags.every(t => t.length <= 24)).toBe(true);
        expect(warnings.some(w => /tag list trimmed/i.test(w))).toBe(true);
    });

    it('drops a non-image thumbnail with a warning', () => {
        const { rulesets, warnings } = decodeRulesets([{ hex: HEX_C, thumb: 'javascript:alert(1)' }]);
        expect(rulesets[0].thumb).toBeUndefined();
        expect(warnings.some(w => /not an image data-URL/i.test(w))).toBe(true);
    });

    it('drops an oversized thumbnail at decode', () => {
        const giant = 'data:image/png;base64,' + 'A'.repeat(THUMB_MAX_BYTES + 10);
        const { rulesets, warnings } = decodeRulesets([{ hex: HEX_C, thumb: giant }]);
        expect(rulesets[0].thumb).toBeUndefined();
        expect(warnings.some(w => /over .*KB/i.test(w))).toBe(true);
    });

    it('never encodes an oversized thumbnail (dropped at encode too)', () => {
        const giant = 'data:image/png;base64,' + 'A'.repeat(THUMB_MAX_BYTES + 10);
        const json = encodePack({ rulesets: [{ ...fullRuleset(), thumb: giant }] });
        expect(JSON.parse(json).rulesets[0].thumb).toBeUndefined();
    });

    it('passes an unknown initial-state mode through unchanged', () => {
        const future = { mode: 'reactionDiffusion', params: { feed: 0.055 } };
        const { rulesets, warnings } = decodeRulesets([{ hex: HEX_C, initialState: future }]);
        expect(rulesets[0].initialState).toEqual(future);
        expect(warnings).toEqual([]);
    });

    it('drops a malformed initialState to null, with a warning', () => {
        const { rulesets, warnings } = decodeRulesets([{ hex: HEX_C, initialState: { mode: 5, params: [] } }]);
        expect(rulesets[0].initialState).toBeNull();
        expect(warnings.some(w => /initialState/i.test(w))).toBe(true);
    });
});

describe('LibraryPackCodec embedding-keyed finds', () => {
    it('strips the opaque cellKey and forces descriptorKind stats on decode', () => {
        const { finds } = decodePack(encodePack({ finds: [fullFind()] }));
        expect(finds[0].cellKey).toBeUndefined();
        expect(finds[0].descriptorKind).toBe('stats');
    });

    it('drops a find with a missing/non-numeric score', () => {
        const bad = { ...fullFind(), score: 'high' };
        const { finds, warnings } = decodePack(encodePack({ finds: [bad] }));
        expect(finds).toHaveLength(0);
        expect(warnings.some(w => /score/i.test(w))).toBe(true);
    });
});

describe('LibraryPackCodec.mergeRulesets (dedupe by hex)', () => {
    it('skips incoming entries whose hex already exists', () => {
        const existing = [{ hex: HEX_A, id: 'x' }];
        const incoming = [{ hex: HEX_A, name: 'dup' }, { hex: HEX_B, name: 'new' }];
        const { toAdd, added, skipped } = mergeRulesets(existing, incoming);
        expect(added).toBe(1);
        expect(skipped).toBe(1);
        expect(toAdd).toEqual([{ hex: HEX_B, name: 'new' }]);
    });

    it('dedupes case-insensitively and collapses intra-batch duplicates', () => {
        const existing = [{ hex: HEX_A.toUpperCase() }];
        const incoming = [{ hex: HEX_A }, { hex: HEX_B }, { hex: HEX_B }];
        const { added, skipped } = mergeRulesets(existing, incoming);
        expect(added).toBe(1); // HEX_A matches existing (case-insensitive); one HEX_B kept, the other collapsed
        expect(skipped).toBe(2);
    });

    it('adds everything into an empty library', () => {
        const { added, skipped } = mergeRulesets([], [{ hex: HEX_A }, { hex: HEX_B }]);
        expect(added).toBe(2);
        expect(skipped).toBe(0);
    });
});

describe('LibraryPackCodec.toPublicLibraryEntry', () => {
    it('projects to the committed public shape without volatile fields or thumb', () => {
        const pub = toPublicLibraryEntry(fullRuleset());
        expect(pub).toEqual({
            name: 'Spiral Weaver',
            description: 'A tidy little glider gun.',
            tags: ['gliders', 'spiral'],
            hex: HEX_A,
            initialState: { mode: 'clusters', params: { count: 5, density: 0.7 } },
            seed: 4242,
        });
        expect(pub.thumb).toBeUndefined();
        expect(pub.id).toBeUndefined();
    });

    it('omits initialState/seed when the entry has no paired IC', () => {
        const pub = toPublicLibraryEntry({ name: 'Bare', hex: HEX_C });
        expect(pub).toEqual({ name: 'Bare', description: '', tags: [], hex: HEX_C });
    });
});
