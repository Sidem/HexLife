/**
 * Palette-independent, lossless-at-source rasterization for the optional perceptual objective.
 *
 * CLIP's vision tower accepts 224x224 images. Instead of rendering the complete world to a large
 * WebGL texture and shrinking it, split the binary state into 224x224 tiles where one automaton cell
 * is exactly one image pixel. The full grid is centered in the tile atlas; padding is black and never
 * replaces a cell. A medium world (222x192) is one tile, large is 2x2, and huge is 3x3.
 *
 * Tile embeddings are pooled by EmbeddingWorker, so every cell reaches the model without application-
 * side resampling while the resulting descriptor remains one fixed-size CLIP vector.
 */

export const CELL_RASTER_VERSION = 'cell-raster-v1';
export const CELL_RASTER_TILE_SIZE = 224;

/**
 * @typedef {{data: Uint8ClampedArray, width: number, height: number}} RasterTile
 * @typedef {{
 *   representation: string,
 *   pixelsPerCell: 1,
 *   gridRows: number,
 *   gridCols: number,
 *   tileRows: number,
 *   tileCols: number,
 *   tiles: RasterTile[],
 * }} CellRaster
 */

/**
 * Convert a row-major binary cell buffer to square RGB-compatible RGBA tiles without scaling.
 * Live cells are white and dead cells/padding are black; alpha is always opaque.
 *
 * @param {Uint8Array|Uint8ClampedArray|null} cells
 * @param {number} rows
 * @param {number} cols
 * @param {number} [tileSize]
 * @returns {CellRaster|null}
 */
export function rasterizeCellState(cells, rows, cols, tileSize = CELL_RASTER_TILE_SIZE) {
    const safeRows = Math.trunc(rows);
    const safeCols = Math.trunc(cols);
    const safeTileSize = Math.trunc(tileSize);
    if (!cells || safeRows <= 0 || safeCols <= 0 || safeTileSize <= 0) return null;
    if (cells.length < safeRows * safeCols) return null;

    const tileRows = Math.ceil(safeRows / safeTileSize);
    const tileCols = Math.ceil(safeCols / safeTileSize);
    const atlasRows = tileRows * safeTileSize;
    const atlasCols = tileCols * safeTileSize;
    const rowOffset = Math.floor((atlasRows - safeRows) / 2);
    const colOffset = Math.floor((atlasCols - safeCols) / 2);
    const tiles = Array.from({ length: tileRows * tileCols }, () => {
        const data = new Uint8ClampedArray(safeTileSize * safeTileSize * 4);
        // ImageData must be opaque. RGB starts at zero, which is also the canonical dead/pad colour.
        for (let i = 3; i < data.length; i += 4) data[i] = 255;
        return { data, width: safeTileSize, height: safeTileSize };
    });

    for (let row = 0; row < safeRows; row++) {
        for (let col = 0; col < safeCols; col++) {
            if (!cells[row * safeCols + col]) continue;
            const atlasRow = row + rowOffset;
            const atlasCol = col + colOffset;
            const tileRow = Math.floor(atlasRow / safeTileSize);
            const tileCol = Math.floor(atlasCol / safeTileSize);
            const localRow = atlasRow % safeTileSize;
            const localCol = atlasCol % safeTileSize;
            const pixel = (localRow * safeTileSize + localCol) * 4;
            const data = tiles[tileRow * tileCols + tileCol].data;
            data[pixel] = 255;
            data[pixel + 1] = 255;
            data[pixel + 2] = 255;
        }
    }

    return {
        representation: CELL_RASTER_VERSION,
        pixelsPerCell: 1,
        gridRows: safeRows,
        gridCols: safeCols,
        tileRows,
        tileCols,
        tiles,
    };
}
