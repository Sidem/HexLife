// @ts-check

/**
 * Stochastic world-code codec: freezes one `@hexlife/embed/stochastic` world into a portable string.
 *
 * The third prefix, alongside `HXW1` (binary) and `HXK1` (k-state), and for the same structural
 * reason: a deployed decoder must refuse a payload whose every region means something else rather
 * than half-read it. `HXS1.` carries state a k-state code has no concept of — a seed, a generation,
 * a compiled probability rule, and per-cell auxiliary state — so it gets its own magic.
 *
 * **Capture policy.** A code is the *exact current world*, and resuming from it resets to that
 * world. It deliberately does not carry a second, earlier snapshot: the whole point of the seed and
 * generation being in the payload is that the next tick is reproducible from here, so "reset" has a
 * well-defined meaning without doubling every payload.
 *
 * Format:
 *
 *     HXS1.<base64url( flags byte ‖ payload )>
 *
 *     flags bit 0: the payload is deflate-raw compressed.
 *
 *     payload (version 1):
 *     offset  size  field
 *     0       3     magic 'HXS'
 *     3       1     version (1)
 *     4       1     RNG version — bumping it is a reproducibility break, so it is stored
 *     5       1     backend (0 = neighborhood, 1 = lattice-gas)
 *     6       2     rows            (u16 LE)
 *     8       2     columns         (u16 LE)
 *     10      1     visible states
 *     11      1     palette kind    (0 = none, 1 = RGB triples)
 *     12      2     palette length  (u16 LE)
 *     14      2     speed           (u16 LE, ticks/second)
 *     16      8     seed            (u64 LE)
 *     24      8     generation      (u64 LE)
 *     32      4     rule length     (u32 LE)
 *     36      P     palette …
 *     36+P    R     compiled rule bytes (`HSN1` or `HSG1`)
 *     …       A     auxiliary state, whose shape the backend fixes:
 *                     neighborhood — N visible cells, then N `u16` elapsed ages
 *                     lattice-gas  — N `u16` velocity channels, then N wall bytes
 *
 * The rule length *is* stored here, unlike `HXK1`: a stochastic rule's size depends on how many
 * transition rows an author wrote, not on `(states, backend)`, so there is nothing to derive it
 * from. Everything else is derived and checked, so a truncated paste is an exact byte mismatch.
 *
 * Pure (no DOM beyond `btoa`/`atob`/`CompressionStream`, all of which Node has natively), so a host
 * can validate a pasted code without loading the stochastic engine at all.
 */

const MAGIC = 'HXS';
const VERSION = 1;
const PREFIX = 'HXS1.';

const FLAG_DEFLATE = 1;
const HEADER_BYTES = 36;
const MAX_SPEED = 65535;
const DEFAULT_SPEED = 10;

export const STOCHASTIC_BACKEND_NEIGHBORHOOD = 0;
export const STOCHASTIC_BACKEND_LATTICE_GAS = 1;

export const STOCHASTIC_PALETTE_NONE = 0;
export const STOCHASTIC_PALETTE_RGB = 1;

// Duplicated from `stochastic.js` (which duplicates them from `stochastic.rs`) rather than imported:
// this module must stay free of the Wasm binding. `stochasticCodec.test.js` asserts they agree.
const MAX_STATES = 16;
const GAS_VISIBLE_STATES = 5;

/** @param {string} b64 */
const toBase64Url = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** @param {string} s */
function fromBase64Url(s) {
    const restored = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = restored.length % 4;
    return pad ? restored + '='.repeat(4 - pad) : restored;
}

/** @param {Uint8Array} bytes @returns {string} */
function bytesToBase64Url(bytes) {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + CHUNK)));
    }
    return toBase64Url(btoa(binary));
}

/** @param {string} s @returns {Uint8Array} */
function base64UrlToBytes(s) {
    const binary = atob(fromBase64Url(s));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

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
 * Bytes of auxiliary state a backend stores per cell, beyond the header.
 * @param {number} backend @param {number} numCells @returns {number}
 */
export function stochasticAuxiliaryBytes(backend, numCells) {
    if (backend === STOCHASTIC_BACKEND_NEIGHBORHOOD) return numCells + numCells * 2;
    if (backend === STOCHASTIC_BACKEND_LATTICE_GAS) return numCells * 2 + numCells;
    return -1;
}

/**
 * Whether a geometry/backend pair describes a world the engine will actually build.
 *
 * Checked here as well as in Wasm on purpose: a code arrives from a text field a stranger pasted,
 * and the decoder's contract is to hand back a "no" rather than a descriptor that throws the moment
 * someone constructs a world from it.
 *
 * @param {number} rows @param {number} columns @param {number} states @param {number} backend
 * @returns {boolean}
 */
export function isValidStochasticGeometry(rows, columns, states, backend) {
    if (!Number.isInteger(rows) || !Number.isInteger(columns)) return false;
    if (rows < 1 || columns < 2 || rows > 65535 || columns > 65535) return false;
    // The column wrap has to preserve the hex parity the neighbor table depends on.
    if (columns % 2 !== 0) return false;
    if (backend === STOCHASTIC_BACKEND_NEIGHBORHOOD) return states >= 2 && states <= MAX_STATES;
    if (backend === STOCHASTIC_BACKEND_LATTICE_GAS) return states === GAS_VISIBLE_STATES;
    return false;
}

/** @param {unknown} value */
export function isStochasticCode(value) {
    return typeof value === 'string' && value.startsWith(PREFIX) && value.length > PREFIX.length;
}

/** @param {bigint|number} value @param {string} label @returns {bigint} */
function toBigInt(value, label) {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    throw new RangeError(`encodeStochasticCode: ${label} must be a non-negative integer or bigint.`);
}

/**
 * Freeze a stochastic world into an `HXS1.` code.
 *
 * @param {{
 *   backend: number, rows: number, columns: number, states: number,
 *   seed: bigint|number, generation: bigint|number, rule: Uint8Array,
 *   speed?: number, palette?: ArrayLike<number>|null,
 *   cells?: ArrayLike<number>|null, elapsedAges?: ArrayLike<number>|null,
 *   channels?: ArrayLike<number>|null, walls?: ArrayLike<number>|null,
 * }} world
 * @returns {Promise<string>}
 */
export async function encodeStochasticCode(world) {
    const {backend, rows, columns, states, rule} = world;
    if (!isValidStochasticGeometry(rows, columns, states, backend)) {
        throw new RangeError('encodeStochasticCode: unusable geometry, states, or backend.');
    }
    if (!(rule instanceof Uint8Array) || rule.length === 0) {
        throw new RangeError('encodeStochasticCode: a compiled rule is required.');
    }
    const numCells = rows * columns;
    const palette = world.palette ? Uint8Array.from(world.palette) : new Uint8Array(0);
    if (palette.length && palette.length !== states * 3) {
        throw new RangeError(`encodeStochasticCode: a palette must hold ${states} RGB triples.`);
    }
    const requestedSpeed = world.speed;
    const speed = Number.isInteger(requestedSpeed)
        ? Math.min(MAX_SPEED, Math.max(0, /** @type {number} */ (requestedSpeed)))
        : DEFAULT_SPEED;

    const auxiliaryBytes = stochasticAuxiliaryBytes(backend, numCells);
    const payload = new Uint8Array(HEADER_BYTES + palette.length + rule.length + auxiliaryBytes);
    const view = new DataView(payload.buffer);
    for (let i = 0; i < 3; i++) payload[i] = MAGIC.charCodeAt(i);
    payload[3] = VERSION;
    payload[4] = 1; // Philox tuple mapping version; see STOCHASTIC_RNG_VERSION.
    payload[5] = backend;
    view.setUint16(6, rows, true);
    view.setUint16(8, columns, true);
    payload[10] = states;
    payload[11] = palette.length ? STOCHASTIC_PALETTE_RGB : STOCHASTIC_PALETTE_NONE;
    view.setUint16(12, palette.length, true);
    view.setUint16(14, speed, true);
    view.setBigUint64(16, toBigInt(world.seed, 'seed'), true);
    view.setBigUint64(24, toBigInt(world.generation, 'generation'), true);
    view.setUint32(32, rule.length, true);

    let offset = HEADER_BYTES;
    payload.set(palette, offset);
    offset += palette.length;
    payload.set(rule, offset);
    offset += rule.length;

    if (backend === STOCHASTIC_BACKEND_NEIGHBORHOOD) {
        const cells = requireLength(world.cells, numCells, 'cells');
        payload.set(cells, offset);
        offset += numCells;
        const ages = world.elapsedAges ? requireLength(world.elapsedAges, numCells, 'elapsedAges') : null;
        for (let i = 0; i < numCells; i++) view.setUint16(offset + i * 2, ages ? ages[i] : 0, true);
    } else {
        const channels = requireLength(world.channels, numCells * 6, 'channels');
        for (let cell = 0; cell < numCells; cell++) {
            let packed = 0;
            for (let direction = 0; direction < 6; direction++) {
                packed |= (channels[cell * 6 + direction] & 3) << (2 * direction);
            }
            view.setUint16(offset + cell * 2, packed, true);
        }
        offset += numCells * 2;
        const walls = world.walls ? requireLength(world.walls, numCells, 'walls') : null;
        for (let i = 0; i < numCells; i++) payload[offset + i] = walls && walls[i] ? 1 : 0;
    }

    const compressed = await deflate(payload);
    const useDeflate = compressed && compressed.length < payload.length;
    const body = useDeflate ? compressed : payload;
    const framed = new Uint8Array(body.length + 1);
    framed[0] = useDeflate ? FLAG_DEFLATE : 0;
    framed.set(body, 1);
    return PREFIX + bytesToBase64Url(framed);
}

/**
 * @param {ArrayLike<number>|null|undefined} source
 * @param {number} length
 * @param {string} label
 * @returns {ArrayLike<number>}
 */
function requireLength(source, length, label) {
    if (!source || source.length !== length) {
        throw new RangeError(`encodeStochasticCode: ${label} must hold exactly ${length} entries.`);
    }
    return source instanceof Uint8Array || source instanceof Uint16Array ? source : Uint8Array.from(source);
}

/**
 * Decode an `HXS1.` code. Never throws: a bad paste returns `null`.
 *
 * @param {string} code
 * @returns {Promise<null | {
 *   backend: number, rows: number, columns: number, states: number, speed: number,
 *   seed: bigint, generation: bigint, rule: Uint8Array, palette: Uint8Array|null,
 *   cells: Uint8Array|null, elapsedAges: Uint16Array|null,
 *   channels: Uint8Array|null, walls: Uint8Array|null,
 * }>}
 */
export async function decodeStochasticCode(code) {
    if (!isStochasticCode(code)) return null;
    let framed;
    try {
        framed = base64UrlToBytes(code.slice(PREFIX.length));
    } catch {
        return null;
    }
    if (framed.length < 2) return null;
    let payload = framed.subarray(1);
    if (framed[0] & FLAG_DEFLATE) {
        const inflated = await inflate(payload);
        if (!inflated) return null;
        payload = inflated;
    }
    if (payload.length < HEADER_BYTES) return null;
    if (String.fromCharCode(payload[0], payload[1], payload[2]) !== MAGIC) return null;
    if (payload[3] !== VERSION || payload[4] !== 1) return null;

    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const backend = payload[5];
    const rows = view.getUint16(6, true);
    const columns = view.getUint16(8, true);
    const states = payload[10];
    if (!isValidStochasticGeometry(rows, columns, states, backend)) return null;
    const paletteKind = payload[11];
    const paletteLength = view.getUint16(12, true);
    if (paletteKind === STOCHASTIC_PALETTE_NONE ? paletteLength !== 0 : paletteLength !== states * 3) {
        return null;
    }
    const speed = view.getUint16(14, true);
    const seed = view.getBigUint64(16, true);
    const generation = view.getBigUint64(24, true);
    const ruleLength = view.getUint32(32, true);

    const numCells = rows * columns;
    const expected = HEADER_BYTES + paletteLength + ruleLength
        + stochasticAuxiliaryBytes(backend, numCells);
    if (payload.length !== expected) return null;

    let offset = HEADER_BYTES;
    const palette = paletteLength ? payload.slice(offset, offset + paletteLength) : null;
    offset += paletteLength;
    const rule = payload.slice(offset, offset + ruleLength);
    offset += ruleLength;

    if (backend === STOCHASTIC_BACKEND_NEIGHBORHOOD) {
        const cells = payload.slice(offset, offset + numCells);
        if (cells.some((state) => state >= states)) return null;
        offset += numCells;
        const elapsedAges = new Uint16Array(numCells);
        for (let i = 0; i < numCells; i++) elapsedAges[i] = view.getUint16(offset + i * 2, true);
        return {
            backend, rows, columns, states, speed, seed, generation, rule, palette,
            cells, elapsedAges, channels: null, walls: null,
        };
    }

    const channels = new Uint8Array(numCells * 6);
    for (let cell = 0; cell < numCells; cell++) {
        const packed = view.getUint16(offset + cell * 2, true);
        for (let direction = 0; direction < 6; direction++) {
            const species = (packed >>> (2 * direction)) & 3;
            if (species === 3) return null;
            channels[cell * 6 + direction] = species;
        }
    }
    offset += numCells * 2;
    const walls = payload.slice(offset, offset + numCells);
    if (walls.some((wall) => wall > 1)) return null;
    return {
        backend, rows, columns, states, speed, seed, generation, rule, palette,
        cells: null, elapsedAges: null, channels, walls,
    };
}
