import { describe, it, expect } from 'vitest';
import { LibraryController } from '../src/ui/controllers/LibraryController.js';
import { rulesetName } from '../src/utils/utils.js';

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
