// utils.js
import * as Config from './config.js'; 

// --- Coordinate/Index Helpers ---
/**
 * Calculates grid coordinates from a flat array index.
 * @param {number} index The flat array index.
 * @returns {{col: number, row: number}|null} Coordinates or null if index is invalid.
 */
export function indexToCoords(index) {
    if (index < 0 || index >= Config.NUM_CELLS) return null;
    const row = Math.floor(index / Config.GRID_COLS);
    const col = index % Config.GRID_COLS;
    return { col, row };
}

/**
 * Creates a Map for quick coordinate string ("col,row") to index lookup.
 * @returns {Map<string, number>} The generated map.
 */
export function createCoordMap() {
    const map = new Map();
    for (let i = 0; i < Config.NUM_CELLS; i++) {
        const coords = indexToCoords(i);
        if (coords) {
            map.set(`${coords.col},${coords.row}`, i);
        }
    }
    return map;
}
// Pre-create the map for efficiency if grid size is fixed
export const hexCoordMap = createCoordMap();

/**
 * Gets the index for given coordinates using the precomputed map.
 * @param {number} col Column index.
 * @param {number} row Row index.
 * @returns {number|undefined} The index or undefined if not found.
 */
export function coordsToIndex(col, row) {
    return hexCoordMap.get(`${col},${row}`);
}


// --- Geometry Helpers ---
/**
 * Generates vertices for a flat-top hexagon centered at (0,0) with radius 1.
 * @returns {Float32Array} Array of vertex coordinates (x, y).
 */
export function createFlatTopHexagonVertices() {
    const vertices = [];
    for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 180 * (60 * i);
        vertices.push(Math.cos(angle), Math.sin(angle));
    }
    return new Float32Array(vertices);
}

/**
 * Calculates the screen pixel center for a hexagon based on its grid coordinates.
 * Uses flat-top, odd-r layout offset.
 * @param {number} col Column index.
 * @param {number} row Row index.
 * @param {number} hexSize The size (radius) of the hexagon in pixels.
 * @param {number} [startX=0] Optional starting X offset for the grid.
 * @param {number} [startY=0] Optional starting Y offset for the grid.
 * @returns {{x: number, y: number}} Pixel coordinates of the center.
 */
export function gridToPixelCoords(col, row, hexSize, startX = 0, startY = 0) {
    const hexWidth = 2 * hexSize;
    const hexHeight = Math.sqrt(3) * hexSize;
    const horizSpacing = hexWidth * 3 / 4;
    const vertSpacing = hexHeight;

    const yOffset = (col % 2 !== 0) ? vertSpacing / 2 : 0;
    const x = startX + col * horizSpacing;
    const y = startY + row * vertSpacing + yOffset;
    return { x, y };
}

/**
 * Checks if a point (pixel coordinates) is inside a flat-top hexagon.
 * @param {number} pointX Pixel X of the point.
 * @param {number} pointY Pixel Y of the point.
 * @param {number} hexCenterX Pixel X of the hexagon center.
 * @param {number} hexCenterY Pixel Y of the hexagon center.
 * @param {number} hexSize Hexagon radius.
 * @returns {boolean} True if the point is inside.
 */
export function isPointInHexagon(pointX, pointY, hexCenterX, hexCenterY, hexSize) {
    const hexWidth = 2 * hexSize;
    const hexHeight = Math.sqrt(3) * hexSize;
    const halfWidth = hexWidth / 2;
    const halfHeight = hexHeight / 2;
    const localX = pointX - hexCenterX;
    const localY = pointY - hexCenterY;
    const absX = Math.abs(localX);
    const absY = Math.abs(localY);

    if (absX > halfWidth || absY > halfHeight) return false;
    if (absX <= halfWidth / 2) return true;

    const slopeHeightAtX = halfHeight * (halfWidth - absX) / (halfWidth / 2);
    return absY <= slopeHeightAtX;
}


// --- Download Helper ---
/**
 * Triggers a browser download for the given content.
 * @param {string} filename Desired filename.
 * @param {string} content File content.
 * @param {string} [mimeType='text/plain'] MIME type.
 */
export function downloadFile(filename, content, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- Canvas Resize Helper ---
/**
 * Resizes the canvas's drawing buffer to match its display size.
 * @param {HTMLCanvasElement} canvas The canvas element.
 * @param {WebGL2RenderingContext} gl The WebGL context.
 * @returns {boolean} True if the canvas was resized.
 */
export function resizeCanvasToDisplaySize(canvas, gl) {
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;
    const needResize = canvas.width !== displayWidth || canvas.height !== displayHeight;
    if (needResize) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
        if (gl) { // Also set viewport if gl context provided
             gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        }
    }
    return needResize;
}

// --- Ruleset Hex Formatting ---
/**
 * Formats a 32-char hex ruleset code for display.
 * @param {string} hexCode The 32-char uppercase hex string.
 * @returns {string} Formatted string.
 */
export function formatHexCode(hexCode) {
    if (!hexCode || hexCode.length !== 32) return hexCode;
    let formatted = "";
    for (let i = 0; i < 32; i += 4) {
        formatted += hexCode.substring(i, i + 4);
        if (i < 28) {
             formatted += " "; // Add space between groups
        }
    }
    return formatted;
}


/**
 * Calculate appropriate hex size for rendering neatly into the texture.
 * Used by both renderer (for layout) and main (for interaction mapping).
 * @returns {number} The calculated hex size (radius) in pixels for texture rendering.
 */
export function calculateHexSizeForTexture() {
    // Aim to fit the grid somewhat tightly within the texture
    const approxGridWidth = Config.GRID_COLS * Config.HORIZ_SPACING;
    const approxGridHeight = Config.GRID_ROWS * Config.VERT_SPACING;

    const scaleX = Config.RENDER_TEXTURE_SIZE / approxGridWidth;
    const scaleY = Config.RENDER_TEXTURE_SIZE / approxGridHeight;

    // Use a scale slightly smaller than the minimum to ensure padding
    const scale = Math.min(scaleX, scaleY) * 0.95; // Increased padding slightly

    // Calculate the scaled hex size based on the original configured HEX_SIZE
    return Config.HEX_SIZE * scale;
}