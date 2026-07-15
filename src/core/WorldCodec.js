// @ts-check

/**
 * World-code codec: freezes one world — grid, ruleset, the exact cells, and the exact colors — into
 * a single portable string, and back. This is what the Reddit/Devvit app (#26 Phase 2) consumes to
 * build a post: a moderator exports a code from the explorer, pastes it into the post form, and the
 * webview reconstructs *that* world, pixel for pixel.
 *
 * Format:
 *
 *     HXW1.<base64url( flags byte ‖ payload )>
 *
 *     flags bit 0: the payload is deflate-raw compressed.
 *
 *     payload (version 2 — current encode):
 *     offset  size  field
 *     0       3     magic 'HXW'
 *     3       1     version (2)
 *     4       2     rows        (u16 LE)
 *     6       2     cols        (u16 LE)
 *     8       2     speed       (u16 LE, ticks/second)
 *     10      1     palette kind (0 = settings descriptor, 1 = baked RGB LUT)
 *     11      1     cells kind   (0 = bit-packed cells, 1 = generator descriptor)
 *     12      16    ruleset (128 rule bits — the same bytes the 32-char hex spells)
 *     28      1     brush size  (u8, 0–40; explorer neighborhood radius)
 *     29      1     reserved    (0)
 *     30      2     palette length (u16 LE)
 *     32      N     palette …
 *     32+N    …     cells region
 *
 *     Version 1 (legacy decode only): no brush field — palette length sits at offset 28,
 *     header is 30 bytes, brush defaults to 2.
 *
 * **Why a generator descriptor.** A *drawn* or evolved world has to travel as its exact cells — it is
 * one specific arrangement. But a "random fill" or "clumps" specimen is not one arrangement; it is a
 * recipe (`density`, or the cluster params) that produces a *fresh* one every time. Freezing one draw
 * of it would throw away exactly what makes it interesting. So when the explorer exports a world that
 * is sitting on a pristine random-fill/clumps initial state, it ships the generator instead of the
 * cells, and the embed regenerates from it on every start — including the in-post reset button.
 *
 * **Why the palette is a descriptor, not a table.** The resolved LUT is 768 bytes of near-random
 * gradient data; the settings that *generate* it (mode, preset key, custom color maps, flicker-proof
 * flag, hue shift) are a few dozen bytes of highly compressible JSON. The reason a descriptor is
 * safe — and it was not, in the first cut of this codec — is that `Symmetry.precomputeSymmetryGroups`
 * is pure and cheap, so the embed can rebuild the symmetry tables the `symmetry` modes need instead
 * of being handed them. Nothing about the palette has to travel except the settings themselves. The
 * baked-LUT kind is kept as an escape hatch for a caller that has a LUT and no settings.
 *
 * **Why the whole payload is deflated.** A grid at 50% random density is incompressible — that is
 * information theory, not a missing optimisation — but the states people actually want to post are
 * rarely random: a drawn pattern, a cleared grid with a few cells, a stable structure after a long
 * run. Those collapse by 10× or more, which is what makes a large grid postable at all.
 *
 * Compression makes `encode`/`decode` **async** (`CompressionStream` is stream-based). Every caller
 * — the element's boot, the Devvit form handler, the copy button — was already async. If a runtime
 * lacks `CompressionStream`, encoding falls back to an uncompressed payload and the flags byte says
 * so, so decoders never have to guess.
 *
 * Pure (no DOM beyond `btoa`/`atob`/`CompressionStream`, all of which node has natively), like
 * {@link ShareCodec} and {@link InitialStateCodec}: it round-trips in vitest, and Devvit's esbuild
 * can bundle it into both the webview client and the Node server without dragging in `config.js`.
 */

import { clampBrushSize, DEFAULT_BRUSH_SIZE } from './hexBrush.js';

const MAGIC = 'HXW';
/** Current encode version (includes brush size). */
const VERSION = 2;
/** Legacy codes without a brush field. */
const VERSION_LEGACY = 1;
const PREFIX = 'HXW1.';

const FLAG_DEFLATE = 1;

export const PALETTE_SETTINGS = 0;
export const PALETTE_LUT = 1;

export const CELLS_PACKED = 0;
export const CELLS_GENERATOR = 1;

/** The initial-state generators the embed can reproduce — the app's `initialState.mode` strings. */
const GENERATOR_MODES = new Set(['density', 'clusters']);

const HEADER_BYTES_V1 = 30;
const HEADER_BYTES_V2 = 32;
const RULESET_BYTES = 16;
const RULESET_OFFSET = 12;
const LUT_RGB_BYTES = 128 * 2 * 3;
const LUT_RGBA_BYTES = 128 * 2 * 4;

const MAX_SPEED = 65535;

export { DEFAULT_BRUSH_SIZE };

/** @param {string} b64 */
const toBase64Url = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** @param {string} s */
function fromBase64Url(s) {
    const restored = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = restored.length % 4;
    return pad ? restored + '='.repeat(4 - pad) : restored;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string} base64url. Chunked, because `String.fromCharCode(...bytes)` on a big-grid payload
 *   would blow the argument limit.
 */
function bytesToBase64Url(bytes) {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + CHUNK)));
    }
    return toBase64Url(btoa(binary));
}

/** @param {string} s base64url @returns {Uint8Array} */
function base64UrlToBytes(s) {
    const binary = atob(fromBase64Url(s));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/** @returns {boolean} Whether this runtime can deflate at all (it always can, in practice). */
function canCompress() {
    return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array|null>} deflate-raw of `bytes`, or null if the runtime can't.
 */
async function deflate(bytes) {
    if (!canCompress()) return null;
    const stream = new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (bytes))]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array|null>} The inflated bytes, or null if `bytes` isn't valid deflate-raw
 *   (a corrupted paste) or the runtime can't inflate.
 */
async function inflate(bytes) {
    if (!canCompress()) return null;
    try {
        const stream = new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (bytes))]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
        return null;
    }
}

/**
 * The canonical cell packing — the same bit order as `utils.packCells` / the save-file format
 * (`tests/worldCodec.test.js` pins them together). Reimplemented rather than imported because
 * `utils.js` pulls in `config.js`, whose import-time side effect this module must stay clear of.
 * @param {Uint8Array|number[]} cells
 * @returns {Uint8Array}
 */
function packCells(cells) {
    const packed = new Uint8Array(Math.ceil(cells.length / 8));
    for (let i = 0; i < cells.length; i++) {
        if (cells[i]) packed[i >> 3] |= (1 << (i & 7));
    }
    return packed;
}

/**
 * @param {Uint8Array} packed
 * @param {number} n Cell count (drops the trailing pad bits).
 * @returns {Uint8Array} One byte per cell, 0 or 1.
 */
function unpackCells(packed, n) {
    const cells = new Uint8Array(n);
    for (let i = 0; i < n; i++) cells[i] = (packed[i >> 3] >> (i & 7)) & 1;
    return cells;
}

/** @param {string} hex 32 hex chars @returns {Uint8Array|null} 16 bytes, or null if malformed. */
function hexToBytes(hex) {
    if (typeof hex !== 'string' || !/^[0-9a-fA-F]{32}$/.test(hex)) return null;
    const bytes = new Uint8Array(RULESET_BYTES);
    for (let i = 0; i < RULESET_BYTES; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}

/** @param {Uint8Array} bytes @returns {string} 32 uppercase hex chars. */
function bytesToHex(bytes) {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex.toUpperCase();
}

/**
 * The color-settings fields that actually reach `generateColorLUT`. Whitelisted rather than
 * `JSON.stringify(colorSettings)` wholesale: the settings object also carries UI state (preview
 * flags, the gradient's `autoOff` bookkeeping), and none of that belongs in a permanent artifact.
 * @param {object} colorSettings
 * @returns {object}
 */
function paletteDescriptor(colorSettings) {
    /** @type {any} */
    const s = colorSettings || {};
    /** @type {any} */
    const out = { mode: s.mode || 'preset' };
    if (out.mode === 'preset') out.activePreset = s.activePreset || 'default';
    if (out.mode === 'gradient' && s.customGradient) {
        out.customGradient = { on: [...(s.customGradient.on || [])], off: [...(s.customGradient.off || [])] };
    }
    if (out.mode === 'neighbor_count') out.customNeighborColors = s.customNeighborColors || {};
    if (out.mode === 'symmetry') out.customSymmetryColors = s.customSymmetryColors || {};
    if (s.flickerProofPresets) out.flickerProofPresets = true;
    if (s.hueShift) out.hueShift = s.hueShift;
    return out;
}

/**
 * Sanitize a generator descriptor: keep only a known `mode` and its `params`.
 * @param {{mode?: string, params?: object}} generator `{mode, params}` — the app's
 *   `worldSettings[i].initialState`.
 * @returns {{mode: string, params: object}|null} Null if the mode isn't one the embed can reproduce.
 */
function generatorDescriptor(generator) {
    const mode = generator && generator.mode;
    if (typeof mode !== 'string' || !GENERATOR_MODES.has(mode)) return null;
    const params = generator.params && typeof generator.params === 'object' ? generator.params : {};
    return { mode, params };
}

/**
 * Encode one world into a `HXW1.` code.
 *
 * @param {object} world
 * @param {number} world.rows
 * @param {number} world.cols
 * @param {string} world.rulesetHex 32-char hex.
 * @param {Uint8Array|number[]} [world.cells] `rows * cols` entries; truthy = alive. This is the state
 *   the post starts from — the embed replays it verbatim rather than reseeding from a density. Required
 *   unless `generator` is given.
 * @param {{mode?: string, params?: object}|null} [world.generator] A `{mode, params}` initial-state
 *   generator (`'density'` / `'clusters'`). When present it *replaces* `cells`: the code carries the
 *   recipe, and the embed generates a fresh state from it on every start (a random-fill/clumps world).
 * @param {object} [world.colorSettings] ColorController.getSettings(). The preferred palette form:
 *   compact, and the decoder rebuilds the exact same LUT (symmetry tables included).
 * @param {Uint8Array} [world.lut] A baked 128×2 **RGBA** LUT (1024 bytes) — used only when
 *   `colorSettings` is absent. Alpha is dropped (a LUT's is 255 everywhere) and restored on decode.
 * @param {number} [world.speed=40] Ticks/second the post runs at once the viewer hits play.
 * @param {number} [world.brushSize=2] Explorer brush / neighborhood radius (0–40).
 * @returns {Promise<string|null>} The code, or null if the inputs don't describe a world.
 */
export async function encodeWorldCode({
    rows, cols, rulesetHex, cells, colorSettings, lut, speed = 40, generator = null,
    brushSize = DEFAULT_BRUSH_SIZE,
}) {
    const numCells = rows * cols;
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 2 || cols < 2
        || rows > 65535 || cols > 65535) return null;

    const ruleset = hexToBytes(rulesetHex);
    if (!ruleset) return null;

    /** @type {Uint8Array} */
    let palette;
    let paletteKind;
    if (colorSettings) {
        paletteKind = PALETTE_SETTINGS;
        palette = new TextEncoder().encode(JSON.stringify(paletteDescriptor(colorSettings)));
    } else if (lut && lut.length === LUT_RGBA_BYTES) {
        paletteKind = PALETTE_LUT;
        palette = new Uint8Array(LUT_RGB_BYTES);
        for (let i = 0; i < 128 * 2; i++) {
            palette[i * 3] = lut[i * 4];
            palette[i * 3 + 1] = lut[i * 4 + 1];
            palette[i * 3 + 2] = lut[i * 4 + 2];
        }
    } else {
        return null;
    }
    if (palette.length > 65535) return null;

    // The cells region is either the bit-packed grid or, for a random-fill/clumps specimen, the
    // generator that reproduces it. A generator overrides `cells` entirely (see the header note).
    /** @type {Uint8Array} */
    let cellsRegion;
    let cellsKind;
    if (generator) {
        const desc = generatorDescriptor(generator);
        if (!desc) return null;
        cellsKind = CELLS_GENERATOR;
        cellsRegion = new TextEncoder().encode(JSON.stringify(desc));
    } else {
        if (!cells || cells.length !== numCells) return null;
        cellsKind = CELLS_PACKED;
        cellsRegion = packCells(cells);
    }

    const headerBytes = HEADER_BYTES_V2;
    const payload = new Uint8Array(headerBytes + palette.length + cellsRegion.length);
    const view = new DataView(payload.buffer);

    for (let i = 0; i < MAGIC.length; i++) payload[i] = MAGIC.charCodeAt(i);
    payload[3] = VERSION;
    view.setUint16(4, rows, true);
    view.setUint16(6, cols, true);
    view.setUint16(8, Math.min(MAX_SPEED, Math.max(0, Math.round(speed) || 0)), true);
    payload[10] = paletteKind;
    payload[11] = cellsKind;
    payload.set(ruleset, RULESET_OFFSET);
    payload[28] = clampBrushSize(brushSize);
    payload[29] = 0;
    view.setUint16(30, palette.length, true);
    payload.set(palette, headerBytes);
    payload.set(cellsRegion, headerBytes + palette.length);

    const deflated = await deflate(payload);
    // Keep whichever is smaller. Deflate can *grow* incompressible data by a few bytes, and a
    // decoder that must handle the raw case anyway (old runtimes) costs nothing to exercise here.
    const useDeflate = !!deflated && deflated.length < payload.length;
    const body = useDeflate ? /** @type {Uint8Array} */ (deflated) : payload;

    const out = new Uint8Array(1 + body.length);
    out[0] = useDeflate ? FLAG_DEFLATE : 0;
    out.set(body, 1);

    return PREFIX + bytesToBase64Url(out);
}

/**
 * Decode a `HXW1.` code.
 *
 * Never throws: a code arrives from a text field a stranger pasted, and every caller (the Devvit
 * post form, the webview, `<hexlife-world code=…>`) wants a "no" it can render, not an exception.
 *
 * @param {string} code
 * @returns {Promise<{rows: number, cols: number, rulesetHex: string, cells: Uint8Array|null,
 *   generator: {mode: string, params: object}|null, speed: number, brushSize: number,
 *   colorSettings: object|null, lut: Uint8Array|null}|null>} Exactly one of `cells` and
 *   `generator` is non-null. Exactly one of `colorSettings` and `lut` is non-null.
 *   `brushSize` is always set (legacy v1 codes → {@link DEFAULT_BRUSH_SIZE}).
 */
export async function decodeWorldCode(code) {
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
    if (!bytes || bytes.length < HEADER_BYTES_V1) return null;

    if (String.fromCharCode(bytes[0], bytes[1], bytes[2]) !== MAGIC) return null;
    const version = bytes[3];
    if (version !== VERSION && version !== VERSION_LEGACY) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const rows = view.getUint16(4, true);
    const cols = view.getUint16(6, true);
    const speed = view.getUint16(8, true);
    const paletteKind = bytes[10];
    const cellsKind = bytes[11];
    const numCells = rows * cols;
    if (rows < 2 || cols < 2 || numCells === 0) return null;

    /** @type {number} */
    let headerBytes;
    /** @type {number} */
    let brushSize;
    /** @type {number} */
    let paletteLen;
    if (version === VERSION_LEGACY) {
        headerBytes = HEADER_BYTES_V1;
        brushSize = DEFAULT_BRUSH_SIZE;
        paletteLen = view.getUint16(28, true);
    } else {
        headerBytes = HEADER_BYTES_V2;
        if (bytes.length < headerBytes) return null;
        brushSize = clampBrushSize(bytes[28]);
        paletteLen = view.getUint16(30, true);
    }

    const cellsOffset = headerBytes + paletteLen;
    // The palette region must at least be fully present; the cells region is length-checked per kind
    // below. A truncated or corrupted paste lands in one of these (an inflate of garbage fails first).
    if (bytes.length < cellsOffset) return null;

    const rulesetHex = bytesToHex(bytes.subarray(RULESET_OFFSET, RULESET_OFFSET + RULESET_BYTES));
    const paletteBytes = bytes.subarray(headerBytes, cellsOffset);

    /** @type {object|null} */
    let colorSettings = null;
    /** @type {Uint8Array|null} */
    let lut = null;
    if (paletteKind === PALETTE_SETTINGS) {
        try {
            colorSettings = JSON.parse(new TextDecoder().decode(paletteBytes));
        } catch {
            return null;
        }
        if (!colorSettings || typeof colorSettings !== 'object') return null;
    } else if (paletteKind === PALETTE_LUT) {
        if (paletteLen !== LUT_RGB_BYTES) return null;
        lut = new Uint8Array(LUT_RGBA_BYTES);
        for (let i = 0; i < 128 * 2; i++) {
            lut[i * 4] = paletteBytes[i * 3];
            lut[i * 4 + 1] = paletteBytes[i * 3 + 1];
            lut[i * 4 + 2] = paletteBytes[i * 3 + 2];
            lut[i * 4 + 3] = 255;
        }
    } else {
        return null;   // A palette kind from a future version: refuse rather than mis-render.
    }

    /** @type {Uint8Array|null} */
    let cells = null;
    /** @type {{mode: string, params: object}|null} */
    let generator = null;
    if (cellsKind === CELLS_PACKED) {
        if (bytes.length !== cellsOffset + Math.ceil(numCells / 8)) return null;
        cells = unpackCells(bytes.subarray(cellsOffset), numCells);
    } else if (cellsKind === CELLS_GENERATOR) {
        if (bytes.length <= cellsOffset) return null;
        try {
            generator = JSON.parse(new TextDecoder().decode(bytes.subarray(cellsOffset)));
        } catch {
            return null;
        }
        if (!generator || typeof generator !== 'object' || typeof generator.mode !== 'string') return null;
        if (!generator.params || typeof generator.params !== 'object') generator.params = {};
    } else {
        return null;   // A cells kind from a future version: refuse rather than mis-render.
    }

    return { rows, cols, rulesetHex, cells, generator, speed, brushSize, colorSettings, lut };
}

/**
 * True if `code` at least *looks* like a world code (cheap, synchronous check for UI call sites).
 * @param {unknown} code
 * @returns {boolean}
 */
export function isWorldCode(code) {
    return typeof code === 'string' && code.trim().startsWith(PREFIX);
}

/**
 * Whether a world-code palette is safe to **autoplay** in a feed without birth/death strobing.
 *
 * Matches the explorer's "Prevent birth/death flash" guard (`flickerProofPresets`) for preset
 * modes, and the Chroma Lab deflicker check for neighbor/symmetry custom maps. Baked LUTs and
 * gradient modes have no reliable guard → not autoplay-safe. Conservative when unknown.
 *
 * @param {object|null|undefined} colorSettings Decoded world-code settings (or null).
 * @param {Uint8Array|null|undefined} [lut] Baked LUT when settings are absent.
 * @returns {boolean}
 */
export function isFlickerProofPalette(colorSettings, lut = null) {
    if (lut && !colorSettings) return false;
    if (!colorSettings || typeof colorSettings !== 'object') return false;

    const mode = /** @type {any} */ (colorSettings).mode || 'preset';

    // Preset path: generateColorLUT only zeros birth/death when this flag is true.
    if (mode === 'preset') {
        return /** @type {any} */ (colorSettings).flickerProofPresets === true;
    }

    // Gradient has no birth/death override in the LUT builder.
    if (mode === 'gradient') return false;

    if (mode === 'neighbor_count') {
        const map = /** @type {any} */ (colorSettings).customNeighborColors || {};
        const birth = String(map['0-0']?.on ?? '#ffffff').toLowerCase();
        const death = String(map['1-6']?.off ?? '#333333').toLowerCase();
        return birth === death;
    }

    if (mode === 'symmetry') {
        const map = /** @type {any} */ (colorSettings).customSymmetryColors || {};
        const birth = String(map['0-0']?.on ?? '#ffffff').toLowerCase();
        const death = String(map['1-63']?.off ?? '#333333').toLowerCase();
        return birth === death;
    }

    return false;
}

/**
 * Build an Explorer deep-link that loads the given ruleset (ShareCodec `r` param).
 * Optional grid rows ride as `g` when non-default for embeds (64).
 *
 * @param {string} rulesetHex
 * @param {{ rows?: number, origin?: string }} [opts]
 * @returns {string}
 */
export function explorerUrlForRuleset(rulesetHex, opts = {}) {
    const origin = opts.origin || 'https://sidem.github.io/HexLife/';
    const url = new URL(origin.endsWith('/') ? origin : `${origin}/`);
    if (typeof rulesetHex === 'string' && /^[0-9a-fA-F]{32}$/.test(rulesetHex)) {
        url.searchParams.set('r', rulesetHex.toUpperCase());
    }
    if (typeof opts.rows === 'number' && opts.rows > 0 && opts.rows !== 64) {
        url.searchParams.set('g', String(opts.rows));
    }
    return url.toString();
}
