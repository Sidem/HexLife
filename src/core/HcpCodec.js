// @ts-check

/**
 * HCP world-code codec: freezes one `@hexlife/embed/hcp` world — stacking, boundaries, `k`,
 * geometry, the `k^4` rule, generation, alternation, and the exact cells — into a portable string.
 *
 * Distinct prefix (`HXP1.`). Decoding never throws; invalid codes return `null`.
 * The code is the current world: a resume continues at the next tick, not merely the picture.
 */

const MAGIC = 'HXP';
const VERSION = 1;
const PREFIX = 'HXP1.';

const FLAG_DEFLATE = 1;

export const STACKING_HCP = 0;
export const XY_TORUS = 0;
export const XY_WALL = 1;
export const Z_OPEN = 0;
export const Z_TORUS = 1;

export const HCP_PALETTE_NONE = 0;
export const HCP_PALETTE_RGB = 1;

export const MAX_HCP_STATES = 16;
const HEADER_BYTES = 32;
const MAX_SPEED = 65535;
const DEFAULT_SPEED = 10;

/** @param {string} b64 */
const toBase64Url = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** @param {string} s */
function fromBase64Url(s) {
    const restored = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = restored.length % 4;
    return pad ? restored + '='.repeat(4 - pad) : restored;
}

/** @param {Uint8Array} bytes */
function bytesToBase64Url(bytes) {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + CHUNK)));
    }
    return toBase64Url(btoa(binary));
}

/** @param {string} s */
function base64UrlToBytes(s) {
    const binary = atob(fromBase64Url(s));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function canCompress() {
    return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/** @param {Uint8Array} bytes */
async function deflate(bytes) {
    if (!canCompress()) return null;
    const stream = new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (bytes))]).stream()
        .pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** @param {Uint8Array} bytes */
async function inflate(bytes) {
    if (!canCompress()) return null;
    try {
        const stream = new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (bytes))]).stream()
            .pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
        return null;
    }
}

/** @param {number} states */
export function hcpRuleBytes(states) {
    if (!Number.isInteger(states) || states < 2 || states > MAX_HCP_STATES) return 0;
    return states ** 4 * 4;
}

/**
 * @param {number} layers
 * @param {number} rows
 * @param {number} cols
 * @param {number} states
 * @param {number} [stacking]
 * @param {number} [xyBoundary]
 * @param {number} [zBoundary]
 */
export function isValidHcpGeometry(
    layers,
    rows,
    cols,
    states,
    stacking = STACKING_HCP,
    xyBoundary = XY_TORUS,
    zBoundary = Z_OPEN,
) {
    if (!Number.isInteger(layers) || !Number.isInteger(rows) || !Number.isInteger(cols)) return false;
    if (layers < 2 || rows < 3 || cols < 2) return false;
    if (rows > 65535 || cols > 65535 || layers > 65535) return false;
    if (cols % 2 !== 0 || rows % 3 !== 0) return false;
    if (!Number.isInteger(states) || states < 2 || states > MAX_HCP_STATES) return false;
    if (stacking !== STACKING_HCP) return false;
    if (xyBoundary !== XY_TORUS && xyBoundary !== XY_WALL) return false;
    if (zBoundary !== Z_OPEN && zBoundary !== Z_TORUS) return false;
    if (zBoundary === Z_TORUS && layers % 2 !== 0) return false;
    return true;
}

/** @param {unknown} code */
export function isHcpCode(code) {
    return typeof code === 'string' && code.trim().startsWith(PREFIX);
}

/**
 * @param {object} world
 * @param {number} world.layers
 * @param {number} world.rows
 * @param {number} world.cols
 * @param {number} world.states
 * @param {ArrayLike<number>} world.rule
 * @param {ArrayLike<number>} world.cells
 * @param {'hcp'|number} [world.stacking]
 * @param {'torus'|'wall'|number} [world.xyBoundary]
 * @param {'open'|'torus'|number} [world.zBoundary]
 * @param {boolean} [world.blockAlternates]
 * @param {number|bigint} [world.generation]
 * @param {number|bigint} [world.seed]
 * @param {Array<ArrayLike<number>>} [world.palette]
 * @param {number} [world.speed]
 */
export async function encodeHcpCode({
    layers,
    rows,
    cols,
    states,
    rule,
    cells,
    stacking = STACKING_HCP,
    xyBoundary = XY_TORUS,
    zBoundary = Z_OPEN,
    blockAlternates = false,
    generation = 0,
    seed = 0,
    palette,
    speed = DEFAULT_SPEED,
}) {
    const stackTag = stacking === 'hcp' || stacking === STACKING_HCP ? STACKING_HCP : -1;
    const xyTag = xyBoundary === 'torus' || xyBoundary === XY_TORUS
        ? XY_TORUS
        : xyBoundary === 'wall' || xyBoundary === XY_WALL
            ? XY_WALL
            : -1;
    const zTag = zBoundary === 'open' || zBoundary === Z_OPEN
        ? Z_OPEN
        : zBoundary === 'torus' || zBoundary === Z_TORUS
            ? Z_TORUS
            : -1;
    if (stackTag < 0 || xyTag < 0 || zTag < 0) return null;
    if (!isValidHcpGeometry(layers, rows, cols, states, stackTag, xyTag, zTag)) return null;

    const entries = states ** 4;
    if (!rule || rule.length !== entries) return null;
    const ncells = layers * rows * cols;
    if (!cells || cells.length !== ncells) return null;

    const ruleBlob = new Uint8Array(entries * 4);
    const ruleView = new DataView(ruleBlob.buffer);
    for (let i = 0; i < entries; i++) {
        const value = rule[i] >>> 0;
        const a = value & 0xff;
        const b = (value >>> 8) & 0xff;
        const c = (value >>> 16) & 0xff;
        const d = (value >>> 24) & 0xff;
        if (a >= states || b >= states || c >= states || d >= states) return null;
        ruleView.setUint32(i * 4, value, true);
    }

    const cellBytes = new Uint8Array(ncells);
    for (let i = 0; i < ncells; i++) {
        const value = cells[i];
        if (!Number.isInteger(value) || value < 0 || value >= states) return null;
        cellBytes[i] = value;
    }

    /** @type {Uint8Array} */
    let paletteBytes;
    let paletteKind;
    if (palette && palette.length) {
        if (palette.length !== states) return null;
        paletteKind = HCP_PALETTE_RGB;
        paletteBytes = new Uint8Array(states * 3);
        for (let i = 0; i < states; i++) {
            const color = palette[i] || [];
            for (let channel = 0; channel < 3; channel++) {
                const value = Number(color[channel]);
                if (!Number.isFinite(value)) return null;
                paletteBytes[i * 3 + channel] = Math.min(255, Math.max(0, Math.round(value)));
            }
        }
    } else {
        paletteKind = HCP_PALETTE_NONE;
        paletteBytes = new Uint8Array(0);
    }

    const payload = new Uint8Array(HEADER_BYTES + paletteBytes.length + ruleBlob.length + cellBytes.length);
    const view = new DataView(payload.buffer);
    for (let i = 0; i < MAGIC.length; i++) payload[i] = MAGIC.charCodeAt(i);
    payload[3] = VERSION;
    payload[4] = stackTag;
    payload[5] = xyTag;
    payload[6] = zTag;
    payload[7] = states;
    view.setUint16(8, layers, true);
    view.setUint16(10, rows, true);
    view.setUint16(12, cols, true);
    view.setUint16(14, Math.min(MAX_SPEED, Math.max(0, Math.round(speed) || 0)), true);
    payload[16] = paletteKind;
    payload[17] = blockAlternates ? 1 : 0;
    view.setUint16(18, paletteBytes.length, true);
    view.setBigUint64(20, BigInt(generation), true);
    view.setBigUint64(24, BigInt(seed), true);
    payload.set(paletteBytes, HEADER_BYTES);
    payload.set(ruleBlob, HEADER_BYTES + paletteBytes.length);
    payload.set(cellBytes, HEADER_BYTES + paletteBytes.length + ruleBlob.length);

    const deflated = await deflate(payload);
    const useDeflate = !!deflated && deflated.length < payload.length;
    const body = useDeflate ? /** @type {Uint8Array} */ (deflated) : payload;
    const out = new Uint8Array(1 + body.length);
    out[0] = useDeflate ? FLAG_DEFLATE : 0;
    out.set(body, 1);
    return PREFIX + bytesToBase64Url(out);
}

/** @param {string} code */
export async function decodeHcpCode(code) {
    if (typeof code !== 'string') return null;
    const trimmed = code.trim();
    if (!trimmed.startsWith(PREFIX)) return null;

    /** @type {Uint8Array} */
    let outer;
    try {
        outer = base64UrlToBytes(trimmed.slice(PREFIX.length));
    } catch {
        return null;
    }
    if (outer.length < 2) return null;

    const flags = outer[0];
    const body = outer.subarray(1);
    const bytes = (flags & FLAG_DEFLATE) ? await inflate(body) : body;
    if (!bytes || bytes.length < HEADER_BYTES) return null;
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2]) !== MAGIC) return null;
    if (bytes[3] !== VERSION) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const stacking = bytes[4];
    const xyBoundary = bytes[5];
    const zBoundary = bytes[6];
    const states = bytes[7];
    const layers = view.getUint16(8, true);
    const rows = view.getUint16(10, true);
    const cols = view.getUint16(12, true);
    const speed = view.getUint16(14, true);
    const paletteKind = bytes[16];
    const blockAlternates = bytes[17] === 1;
    const paletteLen = view.getUint16(18, true);
    const generation = view.getBigUint64(20, true);
    const seed = view.getBigUint64(24, true);

    if (!isValidHcpGeometry(layers, rows, cols, states, stacking, xyBoundary, zBoundary)) return null;
    const ncells = layers * rows * cols;
    const ruleBytes = hcpRuleBytes(states);
    const expected = HEADER_BYTES + paletteLen + ruleBytes + ncells;
    if (bytes.length !== expected) return null;
    if (paletteKind === HCP_PALETTE_RGB && paletteLen !== states * 3) return null;
    if (paletteKind === HCP_PALETTE_NONE && paletteLen !== 0) return null;
    if (paletteKind !== HCP_PALETTE_NONE && paletteKind !== HCP_PALETTE_RGB) return null;

    const paletteStart = HEADER_BYTES;
    const ruleStart = paletteStart + paletteLen;
    const cellStart = ruleStart + ruleBytes;

    /** @type {number[][]|null} */
    let palette = null;
    if (paletteKind === HCP_PALETTE_RGB) {
        palette = [];
        for (let i = 0; i < states; i++) {
            palette.push([
                bytes[paletteStart + i * 3],
                bytes[paletteStart + i * 3 + 1],
                bytes[paletteStart + i * 3 + 2],
            ]);
        }
    }

    const rule = new Uint32Array(states ** 4);
    const ruleView = new DataView(bytes.buffer, bytes.byteOffset + ruleStart, ruleBytes);
    for (let i = 0; i < rule.length; i++) rule[i] = ruleView.getUint32(i * 4, true);

    const cells = bytes.slice(cellStart, cellStart + ncells);
    for (let i = 0; i < ncells; i++) {
        if (cells[i] >= states) return null;
    }

    return {
        layers,
        rows,
        cols,
        states,
        stacking: 'hcp',
        xyBoundary: xyBoundary === XY_WALL ? 'wall' : 'torus',
        zBoundary: zBoundary === Z_TORUS ? 'torus' : 'open',
        blockAlternates,
        generation,
        seed,
        speed,
        rule,
        cells,
        palette,
    };
}
