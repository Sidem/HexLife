import { describe, it, expect, vi } from 'vitest';
import { SavedStrategy } from '../src/core/initialStateStrategies/SavedStrategy.js';
import { cellsToBase64 } from '../src/utils/utils.js';

function makeSource(rows, cols) {
    const cells = new Uint8Array(rows * cols);
    for (let i = 0; i < cells.length; i++) cells[i] = (i * 7 + Math.floor(i / cols)) % 3 === 0 ? 1 : 0;
    return cells;
}

function paramsFor(cells, rows, cols, extra = {}) {
    return { rows, cols, stateB64: cellsToBase64(cells), density: 0.33, ...extra };
}

describe('SavedStrategy', () => {
    const strategy = new SavedStrategy();

    it('reproduces the captured grid exactly when dims match', () => {
        const rows = 24, cols = 28;
        const src = makeSource(rows, cols);
        const out = new Uint8Array(rows * cols);
        const rng = vi.fn(() => 0.5);

        strategy.generate(out, paramsFor(src, rows, cols), rng, { GRID_ROWS: rows, GRID_COLS: cols });

        expect(Array.from(out)).toEqual(Array.from(src));
        expect(rng).not.toHaveBeenCalled();
    });

    it('resamples deterministically (and rng-free) when the grid size differs', () => {
        const src = makeSource(24, 28);
        const params = paramsFor(src, 24, 28);
        const config = { GRID_ROWS: 12, GRID_COLS: 14 };
        const rng = vi.fn(() => 0.5);

        const a = new Uint8Array(12 * 14);
        const b = new Uint8Array(12 * 14);
        strategy.generate(a, params, rng, config);
        strategy.generate(b, params, () => Math.random(), config);

        expect(Array.from(a)).toEqual(Array.from(b));
        expect(rng).not.toHaveBeenCalled();
        // Nearest-neighbour: the target cell (0,0) maps back to source (0,0).
        expect(a[0]).toBe(src[0]);
    });

    it('upsamples to a larger grid without going out of bounds', () => {
        const src = makeSource(8, 10);
        const out = new Uint8Array(20 * 24);
        strategy.generate(out, paramsFor(src, 8, 10), () => 0.5, { GRID_ROWS: 20, GRID_COLS: 24 });
        expect(out.length).toBe(20 * 24);
        expect(out.some(v => v === 1)).toBe(true);
    });

    it('takes the source dims from params, not the live config', () => {
        const src = makeSource(6, 6);
        // A config claiming different dims must not change how the payload is decoded.
        const out = new Uint8Array(6 * 6);
        strategy.generate(out, paramsFor(src, 6, 6), () => 0.5, { GRID_ROWS: 6, GRID_COLS: 6 });
        expect(Array.from(out)).toEqual(Array.from(src));
    });

    it('falls back to density (using rng) when the payload is missing or malformed', () => {
        const config = { GRID_ROWS: 4, GRID_COLS: 4 };
        for (const params of [
            { rows: 4, cols: 4, density: 1 },                       // no stateB64
            { rows: 4, cols: 4, stateB64: '!!!not base64!!!', density: 1 },
            { rows: 0, cols: 0, stateB64: 'AAAA', density: 1 },     // nonsense dims
        ]) {
            const out = new Uint8Array(16);
            const rng = vi.fn(() => 0.1);
            expect(() => strategy.generate(out, params, rng, config)).not.toThrow();
            // density 1 => the DensityStrategy's "single opposite seed" fill, all-on but the center.
            expect(out.filter(v => v === 1).length).toBe(15);
        }
    });
});
