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

// ── Hex offset ⇄ axial coordinates ────────────────────────────────────────────
// The grid is a flat-top, odd-q offset layout: odd columns are shifted DOWN by
// half a row (see `gridToPixelCoords`). Offset coordinates are NOT translation-
// invariant on a staggered hex grid — moving a pattern by an odd number of columns
// flips its vertical phase. Axial coordinates ARE translation-invariant, so we
// convert through them whenever a pattern must be moved across the grid.

/**
 * Converts odd-q offset coordinates to axial coordinates.
 * @param {number} col
 * @param {number} row
 * @returns {{q: number, r: number}}
 */
export function offsetToAxial(col, row) {
    const q = col;
    const r = row - ((col - (col & 1)) >> 1);
    return { q, r };
}

/**
 * Converts axial coordinates back to odd-q offset coordinates.
 * @param {number} q
 * @param {number} r
 * @returns {{col: number, row: number}}
 */
export function axialToOffset(q, r) {
    const col = q;
    const row = r + ((q - (q & 1)) >> 1);
    return { col, row };
}

/**
 * Translates a captured pattern to absolute grid coordinates anchored at
 * (anchorCol, anchorRow) while preserving the hex grid's column-stagger phase.
 *
 * A pattern's relative `[dx, dy]` cells were authored against an origin column of
 * parity `originParity`. Naive `anchor + delta` translation breaks the pattern
 * whenever the anchor column's parity differs from the origin's, because odd and
 * even columns sit at different vertical phases. Converting through axial space and
 * back reproduces the exact captured shape at any anchor.
 *
 * @param {Array<[number, number]>} cells Relative offset cells `[dx, dy]`.
 * @param {number} anchorCol Destination anchor column.
 * @param {number} anchorRow Destination anchor row.
 * @param {number} [originParity=0] Parity (0=even, 1=odd) of the capture origin column.
 * @returns {Array<[number, number]>} Absolute `[col, row]` pairs (unclamped).
 */
export function translatePatternCells(cells, anchorCol, anchorRow, originParity = 0) {
    const originCol = originParity & 1; // a reference column of the captured parity
    const origin = offsetToAxial(originCol, 0);
    const anchor = offsetToAxial(anchorCol, anchorRow);
    const dq = anchor.q - origin.q;
    const dr = anchor.r - origin.r;
    const out = [];
    for (const [dx, dy] of cells) {
        const a = offsetToAxial(originCol + dx, dy);
        const { col, row } = axialToOffset(a.q + dq, a.r + dr);
        out.push([col, row]);
    }
    return out;
}

/**
 * Renders a captured pattern as a standalone SVG of flat-top hexagons laid out on
 * the staggered grid (odd columns dropped half a row), so previews match how the
 * pattern actually tiles. Pure — returns markup, touches no DOM.
 *
 * @param {Array<[number, number]>} cells Relative offset cells `[dx, dy]`.
 * @param {object} [options]
 * @param {number} [options.originParity=0] Parity of the capture origin column.
 * @param {number} [options.size=6] Hex radius (centre→vertex) in SVG units.
 * @param {string} [options.className='pattern-preview-svg'] Root `<svg>` class.
 * @returns {string} SVG markup (empty string when there are no cells).
 */
export function patternToHexSVG(cells, options = {}) {
    if (!Array.isArray(cells) || cells.length === 0) return '';
    const { originParity = 0, size = 6, className = 'pattern-preview-svg' } = options;
    const sqrt3 = Math.sqrt(3);
    const horiz = 1.5 * size;       // column spacing
    const vert = sqrt3 * size;      // row spacing

    // Six flat-top vertices relative to a centre.
    const corners = [];
    for (let i = 0; i < 6; i++) {
        const ang = (Math.PI / 180) * (60 * i);
        corners.push([Math.cos(ang) * size, Math.sin(ang) * size]);
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const polys = cells.map(([dx, dy]) => {
        const parity = (originParity + dx) & 1;
        const cx = dx * horiz;
        const cy = dy * vert + (parity ? vert / 2 : 0);
        const pts = corners.map(([ox, oy]) => {
            const x = cx + ox;
            const y = cy + oy;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        }).join(' ');
        return `<polygon points="${pts}" />`;
    }).join('');

    const pad = size * 0.4;
    const vbX = (minX - pad).toFixed(2);
    const vbY = (minY - pad).toFixed(2);
    const vbW = (maxX - minX + pad * 2).toFixed(2);
    const vbH = (maxY - minY + pad * 2).toFixed(2);
    return `<svg viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" class="${className}">${polys}</svg>`;
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

// Two-word digest vocabulary for deriving a human-friendly ruleset identity from a
// hex code (see rulesetName). The hex string stays the canonical identity; this is a
// stable, pronounceable mnemonic so a ruleset isn't only ever 32 hex chars. 64×64 =
// 4096 combinations — enough to tell rulesets apart at a glance for a UI label.
// Keep both arrays append-only: reordering or removing an entry would rename every
// existing ruleset (names are derived positionally), breaking the "deterministic" promise.
const RULESET_NAME_ADJECTIVES = [
    'Amber', 'Arctic', 'Ashen', 'Astral', 'Azure', 'Blazing', 'Bold', 'Bramble',
    'Bright', 'Cinder', 'Cobalt', 'Coral', 'Cosmic', 'Crimson', 'Crystal', 'Dappled',
    'Dawn', 'Dusk', 'Eager', 'Ember', 'Feral', 'Frosted', 'Gilded', 'Glacial',
    'Gleaming', 'Hidden', 'Hollow', 'Humble', 'Ivory', 'Jade', 'Lunar', 'Mellow',
    'Misty', 'Molten', 'Mossy', 'Noble', 'Nimble', 'Onyx', 'Pale', 'Prismatic',
    'Quiet', 'Radiant', 'Restless', 'Rugged', 'Rustic', 'Sable', 'Scarlet', 'Shaded',
    'Silent', 'Silver', 'Solar', 'Stormy', 'Sunlit', 'Tangled', 'Tidal', 'Twilight',
    'Velvet', 'Verdant', 'Vivid', 'Wandering', 'Wild', 'Winter', 'Woven', 'Zephyr',
];
const RULESET_NAME_NOUNS = [
    'Aurora', 'Basin', 'Beacon', 'Bloom', 'Bramble', 'Canyon', 'Cascade', 'Cipher',
    'Cluster', 'Comet', 'Coral', 'Crest', 'Current', 'Delta', 'Drift', 'Echo',
    'Ember', 'Eddy', 'Fern', 'Flare', 'Fractal', 'Glade', 'Glyph', 'Grove',
    'Harbor', 'Haven', 'Hollow', 'Lantern', 'Lattice', 'Loom', 'Marsh', 'Meadow',
    'Mesa', 'Mirage', 'Nebula', 'Nexus', 'Oasis', 'Orbit', 'Petal', 'Pinnacle',
    'Prism', 'Quartz', 'Quasar', 'Ravine', 'Reef', 'Ridge', 'Ripple', 'Spiral',
    'Spire', 'Sprout', 'Strand', 'Summit', 'Tangle', 'Tempest', 'Thicket', 'Tide',
    'Tundra', 'Vale', 'Vapor', 'Vertex', 'Vortex', 'Warren', 'Willow', 'Zenith',
];

/**
 * Derives a stable, human-friendly two-word name from a ruleset hex code, e.g.
 * "Cobalt Lattice". Deterministic: the same hex always yields the same name, with no
 * dependence on Math.random or external state, so it is safe to call from the UI and
 * to unit-test. The hex remains the canonical identity — this is a mnemonic label only.
 * @param {string} hexCode The 32-char hex ruleset string (case-insensitive).
 * @returns {string} A two-word name, or the original input if it isn't a valid hex code.
 */
export function rulesetName(hexCode) {
    if (!hexCode || typeof hexCode !== 'string' || !/^[0-9a-fA-F]{32}$/.test(hexCode)) {
        return hexCode;
    }
    const norm = hexCode.toUpperCase();
    // FNV-1a 32-bit hash over the normalized hex; deterministic and well-distributed.
    let hash = 0x811c9dc5;
    for (let i = 0; i < norm.length; i++) {
        hash ^= norm.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    hash >>>= 0; // coerce to unsigned 32-bit
    const adjIndex = hash % RULESET_NAME_ADJECTIVES.length;
    const nounIndex = Math.floor(hash / RULESET_NAME_ADJECTIVES.length) % RULESET_NAME_NOUNS.length;
    return `${RULESET_NAME_ADJECTIVES[adjIndex]} ${RULESET_NAME_NOUNS[nounIndex]}`;
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
    catch { 
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

/** Per-nibble popcount table (0..15 → number of set bits), for hammingDistanceHex. */
const NIBBLE_POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/**
 * Bit-level Hamming distance between two 32-char ruleset hex strings (0..128). Each of the 32 hex
 * nibbles is XOR'd and its set bits counted via {@link NIBBLE_POPCOUNT}. Used by the behavior
 * archive's family dedupe to reject near-identical hex siblings. Invalid input or a length mismatch
 * returns `Infinity` (so callers treat it as "not in the same family").
 * @param {string} hexA
 * @param {string} hexB
 * @returns {number} Bit distance in [0,128], or Infinity if either input is not a 32-char hex string.
 */
export function hammingDistanceHex(hexA, hexB) {
    if (typeof hexA !== 'string' || typeof hexB !== 'string') return Infinity;
    if (hexA.length !== 32 || hexB.length !== 32) return Infinity;
    if (!/^[0-9a-fA-F]{32}$/.test(hexA) || !/^[0-9a-fA-F]{32}$/.test(hexB)) return Infinity;
    let dist = 0;
    for (let i = 0; i < 32; i++) {
        const xor = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
        dist += NIBBLE_POPCOUNT[xor];
    }
    return dist;
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

/**
 * Bit-packs a per-cell binary state array (each entry truthy = on) into a Uint8Array,
 * 8 cells per byte (bit `i & 7` of byte `i >> 3`). This is the canonical packing used by
 * both the save-file format ({@link cellsToBase64}) and the worker's cycle-frame buffers.
 * @param {Uint8Array|number[]} cells The per-cell state (truthy = on).
 * @returns {Uint8Array} Bit-packed bytes (`ceil(cells.length / 8)` long).
 */
export function packCells(cells) {
    const n = cells.length;
    const packed = new Uint8Array(Math.ceil(n / 8));
    for (let i = 0; i < n; i++) {
        if (cells[i]) packed[i >> 3] |= (1 << (i & 7));
    }
    return packed;
}

/**
 * Unpacks bit-packed bytes (from {@link packCells}) into an existing per-cell target array,
 * writing 0/1 into the first `n` entries. Reuses the caller's buffer to avoid per-call
 * allocation on hot paths (e.g. cycle playback).
 * @param {Uint8Array} packed The bit-packed bytes.
 * @param {Uint8Array|number[]} target The destination per-cell array (length ≥ n).
 * @param {number} n The number of cells to unpack.
 * @returns {Uint8Array|number[]} The same `target`, for convenience.
 */
export function unpackCellsInto(packed, target, n) {
    for (let i = 0; i < n; i++) {
        target[i] = (packed[i >> 3] >> (i & 7)) & 1;
    }
    return target;
}

/**
 * Encodes a per-cell state array (each entry 0 or 1) as a base64 string, bit-packing
 * 8 cells per byte first. This is ~12× more compact than a JSON number array (vs ~1.5×
 * for one byte per cell) and is the save-file state format. Chunked so very large grids
 * (e.g. the "huge" preset) don't overflow the call stack.
 * Decode with {@link base64ToCells}, passing the original cell count.
 * @param {Uint8Array|number[]} cells The per-cell state (truthy = on).
 * @returns {string} A base64-encoded string of the bit-packed bytes.
 */
export function cellsToBase64(cells) {
    const packed = packCells(cells);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < packed.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, packed.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

/**
 * Decodes a base64 string (produced by {@link cellsToBase64}) back into a Uint8Array of
 * per-cell state bytes (each 0 or 1). Because the encoding bit-packs, the exact cell
 * count must be supplied to drop trailing pad bits; if omitted, every bit of every byte
 * is returned (the array length is rounded up to a multiple of 8).
 * @param {string} b64 The base64-encoded bit-packed string.
 * @param {number} [cellCount] The original number of cells.
 * @returns {Uint8Array} The decoded per-cell state (empty array on invalid input).
 */
export function base64ToCells(b64, cellCount) {
    if (typeof b64 !== 'string' || b64.length === 0) return new Uint8Array(0);
    const binary = atob(b64);
    const packed = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) packed[i] = binary.charCodeAt(i);
    const n = (typeof cellCount === 'number' && cellCount >= 0) ? cellCount : packed.length * 8;
    return unpackCellsInto(packed, new Uint8Array(n), n);
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

/**
 * Calculates all hexagon coordinates on a line between two hexes.
 * Uses cube coordinates and linear interpolation.
 * @param {number} x1 Column of the start hex.
 * @param {number} y1 Row of the start hex.
 * @param {number} x2 Column of the end hex.
 * @param {number} y2 Row of the end hex.
 * @returns {Array<{col: number, row: number}>} An array of hex coordinates.
 */
export function getHexLine(x1, y1, x2, y2) {
    // Convert odd-r coordinates to cube coordinates for linear interpolation
    const toCube = (r, q) => ({ x: q - (r - (r&1)) / 2, z: r, y: - (q - (r - (r&1)) / 2) - r });
    const fromCube = (x, _y, z) => ({ col: x + (z - (z&1)) / 2, row: z });

    const p1 = toCube(y1, x1);
    const p2 = toCube(y2, x2);

    const dist = Math.max(Math.abs(p1.x - p2.x), Math.abs(p1.y - p2.y), Math.abs(p1.z - p2.z));
    if (dist === 0) return [{col: x1, row: y1}];

    const points = [];
    for (let i = 0; i <= dist; i++) {
        const t = i / dist;
        const cubeX = p1.x + (p2.x - p1.x) * t;
        const cubeY = p1.y + (p2.y - p1.y) * t;
        const cubeZ = p1.z + (p2.z - p1.z) * t;

        // Round to the nearest hex cube coordinate
        let rx = Math.round(cubeX);
        let ry = Math.round(cubeY);
        let rz = Math.round(cubeZ);
        const x_diff = Math.abs(rx - cubeX);
        const y_diff = Math.abs(ry - cubeY);
        const z_diff = Math.abs(rz - cubeZ);

        if (x_diff > y_diff && x_diff > z_diff) {
            rx = -ry - rz;
        } else if (y_diff > z_diff) {
            ry = -rx - rz;
        } else {
            rz = -rx - ry;
        }

        points.push(fromCube(rx, ry, rz));
    }
    return points;
}