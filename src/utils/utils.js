import * as Config from '../core/config.js'; 

let _neighborhoodQueue = [];
let _neighborhoodVisited = new Map();
let _queueHead = 0;

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
 * Gets the index for given coordinates using direct arithmetic.
 * Returns undefined if coordinates are out of bounds or invalid.
 * @param {number} col Column index.
 * @param {number} row Row index.
 * @returns {number|undefined} The index or undefined if not found/invalid.
 */
export function coordsToIndex(col, row) {
    if (typeof col !== 'number' || typeof row !== 'number' ||
        isNaN(col) || isNaN(row) ||
        col < 0 || col >= Config.GRID_COLS ||
        row < 0 || row >= Config.GRID_ROWS) {
        return undefined;
    }
    return row * Config.GRID_COLS + col;
}

/**
 * Generates vertices for a flat-top hexagon centered at (0,0) with radius 1.
 * Order: Starts from right-middle, goes counter-clockwise.
 * @returns {Float32Array} Array of vertex coordinates (x, y), 6 vertices for TRIANGLE_FAN.
 */
export function createFlatTopHexagonVertices() {
    const vertices = [];
    for (let i = 0; i < 6; i++) {
        
        const angle_deg = 60 * i; 
        const angle_rad = Math.PI / 180 * angle_deg;
        vertices.push(Math.cos(angle_rad), Math.sin(angle_rad));
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

    let yOffset = 0;
    if (col % 2 !== 0) { 
        yOffset = vertSpacing / 2;
    }
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
 * @param {number} hexSize Hexagon radius (distance from center to vertex).
 * @returns {boolean} True if the point is inside.
 */
export function isPointInHexagon(pointX, pointY, hexCenterX, hexCenterY, hexSize) {
    const localX = pointX - hexCenterX;
    const localY = pointY - hexCenterY;
    const absX = Math.abs(localX);
    const absY = Math.abs(localY);

    if (absY > hexSize) return false;
    const hexInnerRadius = hexSize * Math.sqrt(3) / 2;
    if (absX <= hexInnerRadius && absY <= hexSize / 2) return true;
    if (absX > hexInnerRadius) return false;
    return absY <= hexSize && 
           absX <= hexInnerRadius - ((hexSize - absY) / Math.sqrt(3));
}


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
        if (gl) { 
             gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        }
    }
    return needResize;
}

/**
 * Formats a 32-char hex ruleset code for display.
 * @param {string} hexCode The 32-char uppercase hex string.
 * @returns {string} Formatted string (e.g., "FFFF FFFF ...") or original if invalid.
 */
export function formatHexCode(hexCode) {
    if (!hexCode || typeof hexCode !== 'string' || hexCode === "N/A" || hexCode === "Error") return hexCode;
    if (hexCode.length !== 32) return hexCode; 

    let formatted = "";
    for (let i = 0; i < 32; i += 4) {
        formatted += hexCode.substring(i, i + 4);
        if (i < 28) { 
             formatted += " ";
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
    const approxGridPixelWidth = Config.GRID_COLS * (Config.HEX_WIDTH * 3 / 4) + (Config.HEX_WIDTH / 4);
    const approxGridPixelHeight = Config.GRID_ROWS * Config.HEX_HEIGHT + (Config.HEX_HEIGHT / 2);
    if (approxGridPixelWidth === 0 || approxGridPixelHeight === 0) return Config.HEX_SIZE;
    const scaleX = Config.RENDER_TEXTURE_SIZE / approxGridPixelWidth;
    const scaleY = Config.RENDER_TEXTURE_SIZE / approxGridPixelHeight;
    const scale = Math.min(scaleX, scaleY) * 0.98; 
    return Config.HEX_SIZE * scale;
}

/**
 * Finds all hexagons within a certain distance from a starting point using a breadth-first search.
 * This function is optimized to avoid memory allocation in the hot path by using pre-allocated,
 * reusable data structures for the queue and visited set.
 *
 * @param {number} startCol The starting column.
 * @param {number} startRow The starting row.
 * @param {number} maxDistance The maximum distance (brush size) from the start.
 * @param {Set<number>} outAffectedSet A Set object that will be cleared and populated with the indices of the affected cells.
 */
export function findHexagonsInNeighborhood(startCol, startRow, maxDistance, outAffectedSet) {
    outAffectedSet.clear();
    if (startCol === null || startRow === null) return;

    _neighborhoodQueue.length = 0;
    _neighborhoodVisited.clear();
    _queueHead = 0;

    const startIndex = startRow * Config.GRID_COLS + startCol;
    if (startIndex < 0 || startIndex >= Config.NUM_CELLS) return;

    _neighborhoodQueue.push([startCol, startRow, 0]);
    _neighborhoodVisited.set(startIndex, 0);
    outAffectedSet.add(startIndex);

    while (_queueHead < _neighborhoodQueue.length) {
        const [cc, cr, cd] = _neighborhoodQueue[_queueHead++]; 
        if (cd >= maxDistance) continue;

        const dirs = (cc % 2 !== 0) ? Config.NEIGHBOR_DIRS_ODD_R : Config.NEIGHBOR_DIRS_EVEN_R;
        for (const [dx, dy] of dirs) {
            const nc = cc + dx;
            const nr = cr + dy;
            const wc = (nc % Config.GRID_COLS + Config.GRID_COLS) % Config.GRID_COLS;
            const wr = (nr % Config.GRID_ROWS + Config.GRID_ROWS) % Config.GRID_ROWS;
            const neighborIndex = wr * Config.GRID_COLS + wc;

            if (!_neighborhoodVisited.has(neighborIndex)) {
                _neighborhoodVisited.set(neighborIndex, cd + 1);
                outAffectedSet.add(neighborIndex);
                _neighborhoodQueue.push([wc, wr, cd + 1]);
            }
        }
    }
}

/**
 * Converts a 128-element Uint8Array ruleset into a 32-character hex string.
 * @param {Uint8Array} rulesetArray The 128-element array of 0s and 1s.
 * @returns {string} The 32-character uppercase hex string, or "Error".
 */
export function rulesetToHex(rulesetArray) {
    if (!rulesetArray || rulesetArray.length !== 128) return "Error";
    let bin = ""; 
    for (let i = 0; i < 128; i++) {
        bin += rulesetArray[i];
    }
    try { 
        return BigInt('0b' + bin).toString(16).toUpperCase().padStart(32, '0'); 
    }
    catch (e) { 
        return "Error"; 
    }
}

/**
 * Converts a 32-character hex string into a 128-element Uint8Array ruleset.
 * @param {string} hexString The 32-character hex string.
 * @returns {Uint8Array} The 128-element Uint8Array. Returns a zeroed array on error.
 */
export function hexToRuleset(hexString) {
    const ruleset = new Uint8Array(128).fill(0);
    if (!hexString || !/^[0-9a-fA-F]{32}$/.test(hexString)) {
        return ruleset;
    }
    try {
        let bin = BigInt('0x' + hexString).toString(2).padStart(128, '0');
        for (let i = 0; i < 128; i++) {
            ruleset[i] = bin[i] === '1' ? 1 : 0;
        }
    } catch (e) { 
        console.error("Error converting hex to ruleset:", hexString, e); 
    }
    return ruleset;
}

/**
 * Mutates a 32-character hex ruleset string by flipping a specified number of random rule bits.
 * @param {string} hexString The 32-character hex string.
 * @param {number} mutationRate The number of individual rules (bits) to flip.
 * @returns {string} The new, mutated 32-character uppercase hex string.
 */
export function mutateRandomBitsInHex(hexString, mutationRate = 1) {
    if (!hexString || !/^[0-9a-fA-F]{32}$/.test(hexString)) {
        console.error("Invalid hex string provided for mutation:", hexString);
        return hexString;
    }

    let bin = BigInt('0x' + hexString).toString(2).padStart(128, '0');
    let binArray = bin.split('');

    const numRules = 128;
    const rate = Math.min(mutationRate, numRules);

    
    const indices = Array.from({ length: numRules }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    
    for (let i = 0; i < rate; i++) {
        const indexToFlip = indices[i];
        binArray[indexToFlip] = binArray[indexToFlip] === '1' ? '0' : '1';
    }

    const newBin = binArray.join('');
    try {
        return BigInt('0b' + newBin).toString(16).toUpperCase().padStart(32, '0');
    } catch (e) {
        console.error("Error converting mutated binary back to hex:", e);
        return hexString; 
    }
}

export function generateShareUrl(worldManager) {
    if (!worldManager) return null;
    const params = new URLSearchParams();

    const rulesetHex = worldManager.getCurrentRulesetHex();
    if (!rulesetHex || rulesetHex === "N/A" || rulesetHex === "Error") {
        console.error("Cannot generate share link: No valid ruleset.");
        return null;
    }
    params.set('r', rulesetHex);

    
    const camera = worldManager.getCurrentCameraState();
    if (camera.zoom !== 1.0 || camera.x !== Config.RENDER_TEXTURE_SIZE / 2 || camera.y !== Config.RENDER_TEXTURE_SIZE / 2) {
        params.set('cam', `${parseFloat(camera.x.toFixed(1))},${parseFloat(camera.y.toFixed(1))},${parseFloat(camera.zoom.toFixed(2))}`);
    }

    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

/**
 * Converts normalized texture coordinates (0-1) to discrete grid coordinates.
 * Searches in a small radius around a rough estimate for the closest valid hex.
 * @param {number} texX The normalized X coordinate in the texture (0 to 1).
 * @param {number} texY The normalized Y coordinate in the texture (0 to 1).
 * @returns {{col: number|null, row: number|null}} The resulting grid coordinates or null if none found.
 */
export function textureCoordsToGridCoords(texX, texY, camera) {
    if (texX < 0 || texX > 1 || texY < 0 || texY > 1) return { col: null, row: null, worldX: null, worldY: null };
    let pixelX = texX * Config.RENDER_TEXTURE_SIZE;
    let pixelY = texY * Config.RENDER_TEXTURE_SIZE;
    const viewCenterX = Config.RENDER_TEXTURE_SIZE / 2;
    const viewCenterY = Config.RENDER_TEXTURE_SIZE / 2;
    const dxFromCenter = pixelX - viewCenterX;
    const dyFromCenter = pixelY - viewCenterY;
    const worldX = camera.x + (dxFromCenter / camera.zoom);
    const worldY = camera.y + (dyFromCenter / camera.zoom);
    const textureHexSize = calculateHexSizeForTexture();
    let minDistSq = Infinity;
    let closestCol = null;
    let closestRow = null;
    const horizSpacing = textureHexSize * 2 * 3 / 4;
    const vertSpacing = textureHexSize * Math.sqrt(3);
    const estimatedColRough = worldX / horizSpacing;
    const estimatedRowRough = worldY / vertSpacing;
    const searchRadius = 2;

    for (let rOffset = -searchRadius; rOffset <= searchRadius; rOffset++) {
        for (let cOffset = -searchRadius; cOffset <= searchRadius; cOffset++) {
            const c = Math.round(estimatedColRough + cOffset);
            const r = Math.round(estimatedRowRough + rOffset);
            if (c < 0 || c >= Config.GRID_COLS || r < 0 || r >= Config.GRID_ROWS) continue;

            const center = gridToPixelCoords(c, r, textureHexSize); 
            const dx = worldX - center.x;
            const dy = worldY - center.y;
            const distSq = dx * dx + dy * dy;

            if (distSq < minDistSq) {
                if (isPointInHexagon(worldX, worldY, center.x, center.y, textureHexSize)) {
                    minDistSq = distSq;
                    closestCol = c;
                    closestRow = r;
                }
            }
        }
    }
    return { col: closestCol, row: closestRow, worldX: worldX, worldY: worldY };
}