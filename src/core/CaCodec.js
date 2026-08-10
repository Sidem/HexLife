// @ts-check

/**
 * k-state world-code codec: freezes one `@hexlife/embed/ca` world — grid, `k`, the backend, the rule
 * table, the exact cells and the palette — into a single portable string, and back.
 *
 * The k-state twin of {@link WorldCodec}, and deliberately **not** an extension of it.
 *
 * ## Why a distinct prefix rather than an `HXW1` version bump
 *
 * `HXW1` assumes binary cells everywhere: its cells region is a *bitset*, its rule is a fixed
 * 128-bit table, and its decoder returns `cells[i] ∈ {0, 1}`. A k-state payload shares none of that.
 * A version bump inside `HXW1.` would let a deployed decoder — one already in someone's page, which
 * we cannot update — read the header, recognise the magic, and then either half-read a payload whose
 * every region has a different meaning, or reject it on a version check we have to hope it wrote.
 * `HXK1.` makes the refusal structural: `decodeWorldCode` bails on the prefix before it parses a
 * single byte, and `isWorldCode` is false. There is no version of this code that an `HXW1` reader
 * can mistake for a world it understands.
 *
 * Format:
 *
 *     HXK1.<base64url( flags byte ‖ payload )>
 *
 *     flags bit 0: the payload is deflate-raw compressed.
 *
 *     payload (version 1):
 *     offset  size  field
 *     0       3     magic 'HXK'
 *     3       1     version (1)
 *     4       2     rows          (u16 LE)
 *     6       2     cols          (u16 LE)
 *     8       2     speed         (u16 LE, ticks/second)
 *     10      1     states        (k)
 *     11      1     backend       (0 = neighborhood, 1 = block)
 *     12      1     palette kind  (0 = none, 1 = k RGB triples)
 *     13      1     reserved      (0)
 *     14      2     palette length (u16 LE)
 *     16      N     palette …
 *     16+N    R     rule blob
 *     16+N+R  C     cells (one byte per cell — cells are already `u8`)
 *
 * **The rule blob's length is derived, not stored.** It is exactly `k⁷` bytes for `neighborhood` and
 * `k³` `u16` LE entries for `block`, both fixed by `(k, backend)` which the header already carries.
 * Storing it would only create a second source of truth for a decoder to disagree with; deriving it
 * turns a truncated or padded paste into an exact byte-count mismatch, which is caught below.
 *
 * **Why the cells are not packed.** `HXW1` bit-packs because its cells are one bit each. Here a cell
 * is a state in `0..k` for a `k` that is not a power of two in general, so a bit-packing would need
 * either a wasteful `ceil(log2 k)` field or arithmetic coding. Deflate over the plain bytes beats
 * both on the states people actually simulate — a physical model is mostly vacuum with structure in
 * it, which is exactly what deflate is good at — and keeps the region trivially checkable.
 *
 * Pure (no DOM beyond `btoa`/`atob`/`CompressionStream`, all of which node has natively), like
 * {@link WorldCodec}: it round-trips in vitest and is safe to import in a Node host.
 */

const MAGIC = 'HXK';
const VERSION = 1;
const PREFIX = 'HXK1.';

const FLAG_DEFLATE = 1;

/** Backend tags. Must match `worldk.rs` and `ca.js`; `caCodec.test.js` pins them together. */
export const BACKEND_NEIGHBORHOOD = 0;
export const BACKEND_BLOCK = 1;

/**
 * State caps, duplicated from `ca.js` (which duplicates them from `worldk.rs`) rather than imported:
 * this module must stay free of the wasm binding so a Node host can validate a code without loading
 * an engine. `caCodec.test.js` asserts the copies agree.
 */
const MAX_NEIGHBORHOOD_STATES = 6;
const MAX_BLOCK_STATES = 16;

/** The block partition needs `rows % 3 == 0`, or it has a seam at the row wrap. */
const BLOCK_ROW_MULTIPLE = 3;

export const CA_PALETTE_NONE = 0;
export const CA_PALETTE_RGB = 1;

const HEADER_BYTES = 16;
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

/** @param {Uint8Array} bytes @returns {string} base64url, chunked so a big grid can't blow the arg limit. */
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

/** @returns {boolean} */
function canCompress() {
    return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/** @param {Uint8Array} bytes @returns {Promise<Uint8Array|null>} */
async function deflate(bytes) {
    if (!canCompress()) return null;
    const stream = new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (bytes))]).stream()
        .pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** @param {Uint8Array} bytes @returns {Promise<Uint8Array|null>} Null on a corrupted paste. */
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

/**
 * How many **entries** the rule table for `(states, backend)` has, and how wide each one is.
 *
 * The single place the two backends' rule shapes are described, so the encoder, the decoder and the
 * length check cannot disagree about them.
 *
 * @param {number} states
 * @param {number} backend
 * @returns {{entries: number, bytesPerEntry: number, bytes: number}|null} Null for an unusable pair.
 */
export function caRuleShape(states, backend) {
    if (!Number.isInteger(states) || states < 2) return null;
    if (backend === BACKEND_NEIGHBORHOOD) {
        if (states > MAX_NEIGHBORHOOD_STATES) return null;
        const entries = states ** 7;
        return { entries, bytesPerEntry: 1, bytes: entries };
    }
    if (backend === BACKEND_BLOCK) {
        if (states > MAX_BLOCK_STATES) return null;
        const entries = states ** 3;
        return { entries, bytesPerEntry: 2, bytes: entries * 2 };
    }
    return null;
}

/**
 * Whether a `(rows, cols, states, backend)` tuple describes a world the engine will actually build.
 *
 * Checked here as well as in wasm on purpose: a code arrives from a text field a stranger pasted, and
 * the decoder's contract is to hand back a "no" rather than to hand back a descriptor that throws the
 * moment someone constructs a `HexCA` from it.
 *
 * @param {number} rows
 * @param {number} cols
 * @param {number} states
 * @param {number} backend
 * @returns {boolean}
 */
export function isValidCaGeometry(rows, cols, states, backend) {
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 2 || cols < 2) return false;
    if (rows > 65535 || cols > 65535) return false;
    // The column wrap has to preserve the hex parity the neighbour table depends on.
    if (cols % 2 !== 0) return false;
    if (!caRuleShape(states, backend)) return false;
    // The three-phase triangular partition is seamless only if the sublattice residue survives the
    // row wrap. 64 rows — the element's own default — fails this; 63 and 66 pass.
    if (backend === BACKEND_BLOCK && rows % BLOCK_ROW_MULTIPLE !== 0) return false;
    return true;
}

/**
 * Encode one k-state world into an `HXK1.` code.
 *
 * @param {object} world
 * @param {number} world.rows Multiple of 3 when `backend` is `'block'`.
 * @param {number} world.cols Even.
 * @param {number} world.states `k`.
 * @param {'neighborhood'|'block'|number} [world.backend='neighborhood']
 * @param {ArrayLike<number>} world.rule The table from `ruleFromTable` / `blockRuleFromTable`.
 * @param {ArrayLike<number>} world.cells `rows * cols` state values in `0..k`.
 * @param {Array<ArrayLike<number>>} [world.palette] `k` entries of `[r, g, b]`, 0–255. Omitted ⇒ the
 *   code carries no colours and the host picks them.
 * @param {number} [world.speed=10] Ticks/second.
 * @returns {Promise<string|null>} The code, or null if the inputs don't describe a world.
 */
export async function encodeCaCode({ rows, cols, states, backend = 'neighborhood', rule, cells, palette, speed = DEFAULT_SPEED }) {
    const tag = backendTag(backend);
    if (tag === null) return null;
    if (!isValidCaGeometry(rows, cols, states, tag)) return null;

    const shape = caRuleShape(states, tag);
    if (!shape || !rule || rule.length !== shape.entries) return null;

    const numCells = rows * cols;
    if (!cells || cells.length !== numCells) return null;

    // Both regions are validated here rather than trusted, so an out-of-range value becomes a null
    // return at encode time instead of a wasm throw at the other end of a paste.
    const ruleBlob = new Uint8Array(shape.bytes);
    if (shape.bytesPerEntry === 1) {
        for (let i = 0; i < shape.entries; i++) {
            const value = rule[i];
            if (!Number.isInteger(value) || value < 0 || value >= states) return null;
            ruleBlob[i] = value;
        }
    } else {
        const maxPacked = states ** 3;
        const view = new DataView(ruleBlob.buffer);
        for (let i = 0; i < shape.entries; i++) {
            const value = rule[i];
            if (!Number.isInteger(value) || value < 0 || value >= maxPacked) return null;
            view.setUint16(i * 2, value, true);
        }
    }

    const cellBytes = new Uint8Array(numCells);
    for (let i = 0; i < numCells; i++) {
        const value = cells[i];
        if (!Number.isInteger(value) || value < 0 || value >= states) return null;
        cellBytes[i] = value;
    }

    /** @type {Uint8Array} */
    let paletteBytes;
    let paletteKind;
    if (palette && palette.length) {
        if (palette.length !== states) return null;
        paletteKind = CA_PALETTE_RGB;
        paletteBytes = new Uint8Array(states * 3);
        for (let i = 0; i < states; i++) {
            const c = palette[i] || [];
            for (let channel = 0; channel < 3; channel++) {
                const value = Number(c[channel]);
                if (!Number.isFinite(value)) return null;
                paletteBytes[i * 3 + channel] = Math.min(255, Math.max(0, Math.round(value)));
            }
        }
    } else {
        paletteKind = CA_PALETTE_NONE;
        paletteBytes = new Uint8Array(0);
    }

    const payload = new Uint8Array(HEADER_BYTES + paletteBytes.length + ruleBlob.length + cellBytes.length);
    const view = new DataView(payload.buffer);

    for (let i = 0; i < MAGIC.length; i++) payload[i] = MAGIC.charCodeAt(i);
    payload[3] = VERSION;
    view.setUint16(4, rows, true);
    view.setUint16(6, cols, true);
    view.setUint16(8, Math.min(MAX_SPEED, Math.max(0, Math.round(speed) || 0)), true);
    payload[10] = states;
    payload[11] = tag;
    payload[12] = paletteKind;
    payload[13] = 0;
    view.setUint16(14, paletteBytes.length, true);
    payload.set(paletteBytes, HEADER_BYTES);
    payload.set(ruleBlob, HEADER_BYTES + paletteBytes.length);
    payload.set(cellBytes, HEADER_BYTES + paletteBytes.length + ruleBlob.length);

    const deflated = await deflate(payload);
    // Keep whichever is smaller — deflate can grow incompressible data, and the decoder has to
    // handle the raw case anyway for runtimes without `CompressionStream`.
    const useDeflate = !!deflated && deflated.length < payload.length;
    const body = useDeflate ? /** @type {Uint8Array} */ (deflated) : payload;

    const out = new Uint8Array(1 + body.length);
    out[0] = useDeflate ? FLAG_DEFLATE : 0;
    out.set(body, 1);

    return PREFIX + bytesToBase64Url(out);
}

/**
 * Decode an `HXK1.` code.
 *
 * Never throws, for the same reason `decodeWorldCode` doesn't: a code arrives from a text field a
 * stranger pasted, and every caller wants a "no" it can render.
 *
 * @param {string} code
 * @returns {Promise<{rows: number, cols: number, states: number, backend: 'neighborhood'|'block',
 *   rule: Uint8Array|Uint16Array, cells: Uint8Array, palette: number[][]|null, speed: number}|null>}
 *   `rule` is a `Uint8Array` for `'neighborhood'` and a `Uint16Array` for `'block'` — the exact types
 *   `HexCA#setRule` wants, so a decoded world needs no further conversion.
 */
export async function decodeCaCode(code) {
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
    const rows = view.getUint16(4, true);
    const cols = view.getUint16(6, true);
    const speed = view.getUint16(8, true);
    const states = bytes[10];
    const tag = bytes[11];
    const paletteKind = bytes[12];
    const paletteLen = view.getUint16(14, true);

    if (!isValidCaGeometry(rows, cols, states, tag)) return null;
    const shape = /** @type {{entries: number, bytesPerEntry: number, bytes: number}} */ (caRuleShape(states, tag));

    const numCells = rows * cols;
    // Exact, not "at least": the rule blob's length is derived from the header, so a payload of any
    // other size is a truncated paste, a padded one, or a code from a format this decoder does not
    // know. All three are a "no".
    if (bytes.length !== HEADER_BYTES + paletteLen + shape.bytes + numCells) return null;

    /** @type {number[][]|null} */
    let palette = null;
    if (paletteKind === CA_PALETTE_RGB) {
        if (paletteLen !== states * 3) return null;
        palette = [];
        for (let i = 0; i < states; i++) {
            const at = HEADER_BYTES + i * 3;
            palette.push([bytes[at], bytes[at + 1], bytes[at + 2]]);
        }
    } else if (paletteKind === CA_PALETTE_NONE) {
        if (paletteLen !== 0) return null;
    } else {
        return null;   // A palette kind from a future version: refuse rather than mis-render.
    }

    const ruleOffset = HEADER_BYTES + paletteLen;
    const cellsOffset = ruleOffset + shape.bytes;

    /** @type {Uint8Array|Uint16Array} */
    let rule;
    if (shape.bytesPerEntry === 1) {
        rule = new Uint8Array(shape.entries);
        for (let i = 0; i < shape.entries; i++) {
            const value = bytes[ruleOffset + i];
            if (value >= states) return null;
            rule[i] = value;
        }
    } else {
        const maxPacked = states ** 3;
        rule = new Uint16Array(shape.entries);
        for (let i = 0; i < shape.entries; i++) {
            const value = view.getUint16(ruleOffset + i * 2, true);
            if (value >= maxPacked) return null;
            rule[i] = value;
        }
    }

    const cells = new Uint8Array(numCells);
    for (let i = 0; i < numCells; i++) {
        const value = bytes[cellsOffset + i];
        if (value >= states) return null;
        cells[i] = value;
    }

    return {
        rows,
        cols,
        states,
        backend: tag === BACKEND_BLOCK ? 'block' : 'neighborhood',
        rule,
        cells,
        palette,
        speed,
    };
}

/**
 * True if `code` at least *looks* like a k-state world code (cheap, synchronous, for UI call sites).
 * @param {unknown} code
 * @returns {boolean}
 */
export function isCaCode(code) {
    return typeof code === 'string' && code.trim().startsWith(PREFIX);
}

/**
 * Normalize a backend to its wire tag.
 * @param {'neighborhood'|'block'|number} backend
 * @returns {number|null} Null for anything that is not a backend.
 */
export function backendTag(backend) {
    if (backend === BACKEND_NEIGHBORHOOD || backend === 'neighborhood') return BACKEND_NEIGHBORHOOD;
    if (backend === BACKEND_BLOCK || backend === 'block') return BACKEND_BLOCK;
    return null;
}
