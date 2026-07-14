import { describe, it, expect } from 'vitest';
import { parseStateFile } from '../src/utils/stateFile.js';
import { cellsToBase64 } from '../src/utils/utils.js';

const HEX = '12482080480080006880800180010117';
const cells = Uint8Array.from({ length: 8 * 10 }, (_, i) => (i % 3 === 0 ? 1 : 0));

describe('parseStateFile', () => {
    it('reads the v2 base64 format the app writes (and a Saved Starts export)', () => {
        const file = { rows: 8, cols: 10, rulesetHex: HEX, format: 'b64', stateB64: cellsToBase64(cells), worldTick: 1204 };
        const out = parseStateFile(file);
        expect(out.error).toBeUndefined();
        expect(Array.from(out.cells)).toEqual(Array.from(cells));
        expect(out).toMatchObject({ rows: 8, cols: 10, rulesetHex: HEX, worldTick: 1204 });
    });

    it('still reads the legacy number-array format', () => {
        const out = parseStateFile({ rows: 8, cols: 10, rulesetHex: HEX, state: Array.from(cells) });
        expect(Array.from(out.cells)).toEqual(Array.from(cells));
        expect(out.worldTick).toBe(0);
    });

    it('rejects files that are missing dims, ruleset or state', () => {
        expect(parseStateFile(null).error).toBeTruthy();
        expect(parseStateFile({ cols: 10, rulesetHex: HEX, state: [] }).error).toMatch(/dimensions/i);
        expect(parseStateFile({ rows: 8, cols: 10, state: [] }).error).toMatch(/ruleset/i);
        expect(parseStateFile({ rows: 8, cols: 10, rulesetHex: HEX }).error).toMatch(/state data/i);
    });

    it('rejects a payload whose length disagrees with the file\'s own dims', () => {
        const out = parseStateFile({ rows: 8, cols: 10, rulesetHex: HEX, state: [1, 0, 1] });
        expect(out.error).toMatch(/doesn't match/i);
    });

    it('rejects corrupt base64 without throwing', () => {
        const out = parseStateFile({ rows: 8, cols: 10, rulesetHex: HEX, stateB64: '!!! not base64 !!!' });
        expect(out.error).toBeTruthy();
    });
});
