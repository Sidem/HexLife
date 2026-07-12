import { describe, it, expect } from 'vitest';
import {
    LibraryController,
    normalizeRulesetEntry,
    RULESET_SCHEMA_VERSION,
} from '../src/ui/controllers/LibraryController.js';
import { rulesetName } from '../src/utils/utils.js';
import { decodePack } from '../src/services/LibraryPackCodec.js';

// getDisplayName resolves a ruleset's library name (personal > public) or falls back
// to the deterministic derived mnemonic. Constructed directly with injected library
// data so the test needs no localStorage / EventBus side effects.
function makeController({ user = [], pub = [] } = {}) {
    const lc = new LibraryController();
    lc.userLibrary = user;
    lc.libraryData = { rulesets: pub, patterns: [] };
    return lc;
}

const HEX_A = '12482080480080006880800180010117';
const HEX_B = 'ABCDEF0123456789ABCDEF0123456789';

describe('LibraryController.getDisplayName', () => {
    it('returns the public library name when present, not derived', () => {
        const lc = makeController({ pub: [{ hex: HEX_A, name: 'Spontaneous Gliders' }] });
        expect(lc.getDisplayName(HEX_A)).toEqual({ name: 'Spontaneous Gliders', isDerived: false });
    });

    it('prefers a personal name over a public one', () => {
        const lc = makeController({
            user: [{ hex: HEX_A, name: 'My Favourite' }],
            pub: [{ hex: HEX_A, name: 'Public Name' }],
        });
        expect(lc.getDisplayName(HEX_A)).toEqual({ name: 'My Favourite', isDerived: false });
    });

    it('falls back to the derived mnemonic for an unknown ruleset', () => {
        const lc = makeController();
        expect(lc.getDisplayName(HEX_B)).toEqual({ name: rulesetName(HEX_B), isDerived: true });
    });

    it('is robust when libraryData is missing', () => {
        const lc = new LibraryController(); // no init: libraryData is null
        expect(lc.getDisplayName(HEX_B)).toEqual({ name: rulesetName(HEX_B), isDerived: true });
    });
});

describe('normalizeRulesetEntry (schema v2)', () => {
    it('upgrades a legacy entry, defaulting the new fields without losing data', () => {
        const legacy = { id: '1', name: 'Old', description: 'd', hex: HEX_A, createdAt: 'then' };
        const out = normalizeRulesetEntry(legacy);
        expect(out).toMatchObject({
            id: '1', name: 'Old', description: 'd', hex: HEX_A, createdAt: 'then',
            tags: [], initialState: null, seed: null, thumb: null,
            schemaVersion: RULESET_SCHEMA_VERSION,
        });
    });

    it('preserves a paired initial state, seed, thumb and tags', () => {
        const v2 = {
            id: '2', name: 'New', hex: HEX_B,
            tags: ['gliders'], initialState: { mode: 'density', params: { density: 0.1 } },
            seed: 99, thumb: 'data:image/jpeg;base64,xxx',
        };
        const out = normalizeRulesetEntry(v2);
        expect(out.tags).toEqual(['gliders']);
        expect(out.initialState).toEqual({ mode: 'density', params: { density: 0.1 } });
        expect(out.seed).toBe(99);
        expect(out.thumb).toBe('data:image/jpeg;base64,xxx');
        expect(out.schemaVersion).toBe(RULESET_SCHEMA_VERSION);
    });

    it('coerces a non-array tags field to an empty array', () => {
        expect(normalizeRulesetEntry({ hex: HEX_A, tags: 'oops' }).tags).toEqual([]);
    });
});

describe('LibraryController.saveUserRuleset (schema v2)', () => {
    function makeLc() {
        const lc = new LibraryController();
        lc.userLibrary = [];
        lc.libraryData = { rulesets: [], patterns: [] };
        // saveUserRuleset persists + dispatches; stub those side effects out for the unit test.
        return lc;
    }

    it('normalizes a new entry to v2 with the paired IC retained', () => {
        const lc = makeLc();
        lc.saveUserRuleset({
            name: 'Spiral', hex: HEX_A,
            initialState: { mode: 'clusters', params: { count: 5 } }, seed: 3, tags: ['t'],
        });
        const saved = lc.getUserLibrary()[0];
        expect(saved.schemaVersion).toBe(RULESET_SCHEMA_VERSION);
        expect(saved.initialState).toEqual({ mode: 'clusters', params: { count: 5 } });
        expect(saved.seed).toBe(3);
        expect(saved.tags).toEqual(['t']);
        expect(saved.id).toBeTruthy();
    });

    it('a rename (id match) keeps the previously-paired IC and thumb', () => {
        const lc = makeLc();
        lc.userLibrary = [normalizeRulesetEntry({
            id: '5', name: 'Old name', hex: HEX_A,
            initialState: { mode: 'density', params: { density: 0.5 } }, seed: 7, thumb: 'data:x',
        })];
        lc.saveUserRuleset({ id: '5', name: 'New name', description: 'desc' });
        const saved = lc.getUserLibrary()[0];
        expect(saved.name).toBe('New name');
        expect(saved.description).toBe('desc');
        expect(saved.initialState).toEqual({ mode: 'density', params: { density: 0.5 } });
        expect(saved.seed).toBe(7);
        expect(saved.thumb).toBe('data:x');
    });
});

describe('LibraryController pack export / import', () => {
    function makeLc(user = []) {
        const lc = new LibraryController();
        lc.userLibrary = user.map(normalizeRulesetEntry);
        lc.libraryData = { rulesets: [], patterns: [] };
        return lc;
    }

    it('exportPackJSON round-trips through decodePack back to the same rulesets', () => {
        const lc = makeLc([
            { id: '1', createdAt: 't', name: 'One', hex: HEX_A, tags: ['a'] },
            { id: '2', createdAt: 't', name: 'Two', hex: HEX_B, initialState: { mode: 'density', params: { density: 0.2 } }, seed: 5 },
        ]);
        const { rulesets, warnings } = decodePack(lc.exportPackJSON());
        expect(warnings).toEqual([]);
        expect(rulesets.map(r => r.hex).sort()).toEqual([HEX_A, HEX_B].sort());
        // Volatile fields are stripped by the codec.
        expect(rulesets.every(r => r.id === undefined && r.schemaVersion === undefined)).toBe(true);
    });

    it('importRulesets adds new entries with fresh ids and normalized schema', () => {
        const lc = makeLc();
        const { added, skipped } = lc.importRulesets([
            { name: 'Imported', hex: HEX_A, tags: [], initialState: null, seed: null },
        ]);
        expect(added).toBe(1);
        expect(skipped).toBe(0);
        const saved = lc.getUserLibrary()[0];
        expect(saved.name).toBe('Imported');
        expect(saved.id).toBeTruthy();
        expect(saved.schemaVersion).toBe(RULESET_SCHEMA_VERSION);
    });

    it('importRulesets dedupes by hex and is idempotent on re-import', () => {
        const lc = makeLc([{ id: 'x', name: 'Existing', hex: HEX_A }]);
        const incoming = [
            { name: 'Dup', hex: HEX_A, tags: [], initialState: null, seed: null },
            { name: 'Fresh', hex: HEX_B, tags: [], initialState: null, seed: null },
        ];
        const first = lc.importRulesets(incoming);
        expect(first).toEqual({ added: 1, skipped: 1 });
        expect(lc.getUserLibrary()).toHaveLength(2);
        // Re-importing the same pack adds nothing.
        const second = lc.importRulesets(incoming);
        expect(second).toEqual({ added: 0, skipped: 2 });
        expect(lc.getUserLibrary()).toHaveLength(2);
    });
});
