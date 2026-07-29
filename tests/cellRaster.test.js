import { describe, expect, it } from 'vitest';
import {
    CELL_RASTER_VERSION,
    rasterizeCellState,
} from '../src/core/analysis/CellRaster.js';

function rgbAt(tile, x, y) {
    const i = (y * tile.width + x) * 4;
    return Array.from(tile.data.slice(i, i + 4));
}

describe('CellRaster', () => {
    it('maps each cell to one centered, opaque pixel without resampling', () => {
        const cells = new Uint8Array([
            1, 0, 1,
            0, 1, 0,
        ]);
        const raster = rasterizeCellState(cells, 2, 3, 4);

        expect(raster).toMatchObject({
            representation: CELL_RASTER_VERSION,
            pixelsPerCell: 1,
            gridRows: 2,
            gridCols: 3,
            tileRows: 1,
            tileCols: 1,
        });
        const tile = raster.tiles[0];
        // 2 rows are centered in 4px (one row of black padding above and below).
        expect(rgbAt(tile, 0, 1)).toEqual([255, 255, 255, 255]);
        expect(rgbAt(tile, 1, 1)).toEqual([0, 0, 0, 255]);
        expect(rgbAt(tile, 2, 1)).toEqual([255, 255, 255, 255]);
        expect(rgbAt(tile, 1, 2)).toEqual([255, 255, 255, 255]);
        expect(rgbAt(tile, 0, 0)).toEqual([0, 0, 0, 255]);
        expect(rgbAt(tile, 3, 3)).toEqual([0, 0, 0, 255]);
    });

    it('tiles oversized grids without dropping or duplicating live cells', () => {
        const rows = 5;
        const cols = 6;
        const cells = new Uint8Array(rows * cols);
        cells[0] = 1;
        cells[cols - 1] = 1;
        cells[(rows - 1) * cols] = 1;
        cells[cells.length - 1] = 1;
        cells[2 * cols + 3] = 1;

        const raster = rasterizeCellState(cells, rows, cols, 4);
        expect(raster).toMatchObject({ tileRows: 2, tileCols: 2 });
        expect(raster.tiles).toHaveLength(4);

        let whitePixels = 0;
        for (const tile of raster.tiles) {
            for (let i = 0; i < tile.data.length; i += 4) {
                if (tile.data[i] === 255) whitePixels++;
                expect(tile.data[i + 3]).toBe(255);
            }
        }
        expect(whitePixels).toBe(5);
    });

    it('rejects missing, undersized, or invalid inputs', () => {
        expect(rasterizeCellState(null, 2, 2)).toBeNull();
        expect(rasterizeCellState(new Uint8Array(3), 2, 2)).toBeNull();
        expect(rasterizeCellState(new Uint8Array(4), 0, 2)).toBeNull();
        expect(rasterizeCellState(new Uint8Array(4), 2, 2, 0)).toBeNull();
    });
});
