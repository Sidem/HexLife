// @ts-check

/**
 * HXLT1: exact, renderer-independent HexLife trajectory interchange.
 *
 * Layout:
 *   5 bytes  ASCII "HXLT1"
 *   4 bytes  little-endian uint32 JSON header length
 *   N bytes  UTF-8 JSON header
 *   ...      concatenated row-major, LSB-first bit-packed frames
 */

export const TRAJECTORY_SCHEMA = 'HXLT1';
export const TRAJECTORY_TOPOLOGY = 'odd-q-torus-v1';
export const TRAJECTORY_MIME = 'application/vnd.hexlife.trajectory';
export const TRAJECTORY_EXTENSION = 'hxlt';
export const MAX_TRAJECTORY_FRAMES = 32;

const MAGIC = new TextEncoder().encode(TRAJECTORY_SCHEMA);
const PREFIX_BYTES = MAGIC.length + 4;

/** @param {Uint8Array} bytes */
export function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
/** @param {number} value */
function crcHex(value) {
    return (value >>> 0).toString(16).padStart(8, '0');
}

/**
 * @param {Record<string, any>} header
 * @param {Uint8Array} payload
 */
function validate(header, payload) {
    if (!header || header.schema !== TRAJECTORY_SCHEMA) throw new Error('Unsupported trajectory schema.');
    if (typeof header.id !== 'string' || !header.id) throw new Error('Trajectory id is required.');
    const rows = Math.trunc(Number(header.rows));
    const cols = Math.trunc(Number(header.cols));
    const frameCount = Math.trunc(Number(header.frameCount));
    if (rows <= 0 || cols <= 0 || cols % 2 !== 0) throw new Error('Trajectory grid must have positive rows and even columns.');
    if (frameCount < 1 || frameCount > MAX_TRAJECTORY_FRAMES) throw new Error(`Trajectory frame count must be 1–${MAX_TRAJECTORY_FRAMES}.`);

    const bytesPerFrame = Math.ceil(rows * cols / 8);
    if (header.bytesPerFrame !== bytesPerFrame) throw new Error('Trajectory bytesPerFrame does not match its grid.');
    if (header.payloadBytes !== bytesPerFrame * frameCount || payload.byteLength !== header.payloadBytes) {
        throw new Error('Trajectory payload length mismatch.');
    }
    if (!Array.isArray(header.tickOffsets) || header.tickOffsets.length !== frameCount) {
        throw new Error('Trajectory tickOffsets must match its frame count.');
    }
    const offsets = header.tickOffsets.map((value) => Math.trunc(Number(value)));
    if (offsets[0] !== 0 || offsets.some((value) => value < 0)) throw new Error('Trajectory tickOffsets must start at zero.');
    for (let index = 1; index < offsets.length; index++) {
        if (offsets[index] <= offsets[index - 1]) throw new Error('Trajectory tickOffsets must be strictly increasing.');
    }
    if (String(header.payloadCrc32).toLowerCase() !== crcHex(crc32(payload))) {
        throw new Error('Trajectory payload checksum mismatch.');
    }
    const usedTailBits = (rows * cols) % 8;
    if (usedTailBits) {
        const allowed = (1 << usedTailBits) - 1;
        for (let frame = 0; frame < frameCount; frame++) {
            if ((payload[(frame + 1) * bytesPerFrame - 1] & ~allowed) !== 0) {
                throw new Error('Trajectory payload has non-zero unused tail bits.');
            }
        }
    }
}

/**
 * @param {{header: Record<string, any>, frames: Uint8Array[]}} record
 * @returns {{bytes: Uint8Array, header: Record<string, any>}}
 */
export function encodeTrajectory(record) {
    const frames = Array.isArray(record?.frames) ? record.frames : [];
    const rows = Math.trunc(Number(record?.header?.rows));
    const cols = Math.trunc(Number(record?.header?.cols));
    const bytesPerFrame = Math.ceil(rows * cols / 8);
    if (frames.length < 1 || frames.length > MAX_TRAJECTORY_FRAMES) {
        throw new Error(`Trajectory frame count must be 1–${MAX_TRAJECTORY_FRAMES}.`);
    }
    if (frames.some((frame) => !(frame instanceof Uint8Array) || frame.byteLength !== bytesPerFrame)) {
        throw new Error('Every trajectory frame must be a correctly-sized packed Uint8Array.');
    }
    const payload = new Uint8Array(bytesPerFrame * frames.length);
    frames.forEach((frame, index) => payload.set(frame, index * bytesPerFrame));
    const header = {
        ...record.header,
        schema: TRAJECTORY_SCHEMA,
        topology: record.header.topology || TRAJECTORY_TOPOLOGY,
        frameCount: frames.length,
        tickOffsets: record.header.tickOffsets || frames.map((_, index) => index),
        bytesPerFrame,
        payloadBytes: payload.byteLength,
        payloadCrc32: crcHex(crc32(payload)),
        captureSchema: record.header.captureSchema || 'worker-packed-v1',
        label: record.header.label || 'unlabeled',
    };
    validate(header, payload);

    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const bytes = new Uint8Array(PREFIX_BYTES + headerBytes.byteLength + payload.byteLength);
    bytes.set(MAGIC, 0);
    new DataView(bytes.buffer).setUint32(MAGIC.length, headerBytes.byteLength, true);
    bytes.set(headerBytes, PREFIX_BYTES);
    bytes.set(payload, PREFIX_BYTES + headerBytes.byteLength);
    return { bytes, header };
}

/**
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {{header: Record<string, any>, frames: Uint8Array[]}}
 */
export function decodeTrajectory(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength < PREFIX_BYTES || MAGIC.some((value, index) => bytes[index] !== value)) {
        throw new Error('Not an HXLT1 trajectory.');
    }
    const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MAGIC.length, true);
    const headerEnd = PREFIX_BYTES + headerLength;
    if (headerLength <= 1 || headerEnd > bytes.byteLength) throw new Error('Invalid HXLT1 header length.');
    let header;
    try {
        header = JSON.parse(new TextDecoder().decode(bytes.subarray(PREFIX_BYTES, headerEnd)));
    } catch {
        throw new Error('Invalid HXLT1 JSON header.');
    }
    const payload = bytes.subarray(headerEnd);
    validate(header, payload);
    const frames = [];
    for (let frame = 0; frame < header.frameCount; frame++) {
        const start = frame * header.bytesPerFrame;
        frames.push(payload.slice(start, start + header.bytesPerFrame));
    }
    return { header, frames };
}
