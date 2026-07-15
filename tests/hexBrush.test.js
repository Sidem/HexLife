import { describe, it, expect } from 'vitest';
import {
    clampBrushSize,
    collectBrushCells,
    getHexLine,
    DEFAULT_BRUSH_SIZE,
} from '../src/core/hexBrush.js';

describe('hexBrush', () => {
    it('defaults and clamps brush size', () => {
        expect(DEFAULT_BRUSH_SIZE).toBe(2);
        expect(clampBrushSize(undefined)).toBe(2);
        expect(clampBrushSize(5)).toBe(5);
        expect(clampBrushSize(0)).toBe(0);
        expect(clampBrushSize(100)).toBe(40);
        expect(clampBrushSize(-1)).toBe(0);
    });

    it('collectBrushCells: size 0 is a single cell', () => {
        const out = new Set();
        collectBrushCells(3, 4, 0, 18, 16, out);
        expect([...out]).toEqual([4 * 18 + 3]);
    });

    it('collectBrushCells: size 1 includes the center and its 6 neighbors', () => {
        const out = new Set();
        // Interior cell so torus wrap is not involved.
        collectBrushCells(5, 5, 1, 20, 20, out);
        expect(out.size).toBe(7);
        expect(out.has(5 * 20 + 5)).toBe(true);
    });

    it('getHexLine connects two adjacent hexes', () => {
        const line = getHexLine(0, 0, 1, 0);
        expect(line.length).toBeGreaterThanOrEqual(2);
        expect(line[0]).toEqual({ col: 0, row: 0 });
        expect(line[line.length - 1]).toEqual({ col: 1, row: 0 });
    });
});
