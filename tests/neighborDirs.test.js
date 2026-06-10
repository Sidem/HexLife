import { describe, it, expect } from 'vitest';
import { NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R } from '../src/core/config.js';

// The hex neighbor-offset tables are duplicated between src/core/config.js and the Wasm engine
// (hexlife-wasm/src/lib.rs). They MUST stay byte-for-byte identical — a mismatch silently changes
// the simulation. This test pins the JS copies to the canonical literals; the matching Rust test
// `neighbor_dirs_match_canonical` pins the Rust copies. If you edit one table, edit the other and
// update both pinned tests.
describe('NEIGHBOR_DIRS tables stay in sync with the Wasm engine', () => {
    const CANONICAL_ODD_R = [[-1, 1], [-1, 0], [0, -1], [1, 0], [1, 1], [0, 1]];
    const CANONICAL_EVEN_R = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [0, 1]];

    it('NEIGHBOR_DIRS_ODD_R matches the canonical values', () => {
        expect(NEIGHBOR_DIRS_ODD_R).toEqual(CANONICAL_ODD_R);
    });

    it('NEIGHBOR_DIRS_EVEN_R matches the canonical values', () => {
        expect(NEIGHBOR_DIRS_EVEN_R).toEqual(CANONICAL_EVEN_R);
    });

    it('each table has six 2-component integer offsets', () => {
        for (const table of [NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R]) {
            expect(table).toHaveLength(6);
            for (const [dc, dr] of table) {
                expect(Number.isInteger(dc)).toBe(true);
                expect(Number.isInteger(dr)).toBe(true);
            }
        }
    });
});
