// @ts-check

import { crc32 } from '../core/analysis/TrajectoryFormat.js';

const LOCAL_FILE_HEADER = 0x04034B50;
const CENTRAL_DIRECTORY_HEADER = 0x02014B50;
const END_OF_CENTRAL_DIRECTORY = 0x06054B50;
const UTF8_FLAG = 0x0800;
const ZIP_VERSION = 20;

/** @param {Date} date */
function dosDateTime(date) {
    const year = Math.max(1980, Math.min(2107, date.getFullYear()));
    return {
        date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    };
}

/** @param {DataView} view @param {number} offset @param {number} value */
function u16(view, offset, value) {
    view.setUint16(offset, value, true);
}

/** @param {DataView} view @param {number} offset @param {number} value */
function u32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
}

/**
 * Build a portable, store-only ZIP. HXLT payloads are already bit-packed, so compression adds
 * little value; avoiding a ZIP dependency keeps collection available in the offline Explorer.
 *
 * @param {{name: string, bytes: Uint8Array}[]} files
 * @param {Date} [modifiedAt]
 * @returns {Uint8Array}
 */
export function createStoredZip(files, modifiedAt = new Date()) {
    if (!Array.isArray(files) || files.length < 1 || files.length > 0xFFFF) {
        throw new Error('ZIP requires 1–65535 files.');
    }
    const timestamp = dosDateTime(modifiedAt);
    const entries = files.map((file) => {
        const name = String(file?.name || '').replaceAll('\\', '/');
        if (!name || name.startsWith('/') || name.includes('../')) throw new Error('ZIP file name is unsafe.');
        if (!(file.bytes instanceof Uint8Array)) throw new Error('ZIP file content must be a Uint8Array.');
        const nameBytes = new TextEncoder().encode(name);
        if (nameBytes.byteLength > 0xFFFF) throw new Error('ZIP file name is too long.');
        return {
            nameBytes,
            bytes: file.bytes,
            crc: crc32(file.bytes),
            localOffset: 0,
        };
    });

    const localBytes = entries.reduce((sum, entry) => sum + 30 + entry.nameBytes.byteLength + entry.bytes.byteLength, 0);
    const centralBytes = entries.reduce((sum, entry) => sum + 46 + entry.nameBytes.byteLength, 0);
    const output = new Uint8Array(localBytes + centralBytes + 22);
    const view = new DataView(output.buffer);
    let offset = 0;

    for (const entry of entries) {
        entry.localOffset = offset;
        u32(view, offset, LOCAL_FILE_HEADER);
        u16(view, offset + 4, ZIP_VERSION);
        u16(view, offset + 6, UTF8_FLAG);
        u16(view, offset + 8, 0);
        u16(view, offset + 10, timestamp.time);
        u16(view, offset + 12, timestamp.date);
        u32(view, offset + 14, entry.crc);
        u32(view, offset + 18, entry.bytes.byteLength);
        u32(view, offset + 22, entry.bytes.byteLength);
        u16(view, offset + 26, entry.nameBytes.byteLength);
        u16(view, offset + 28, 0);
        offset += 30;
        output.set(entry.nameBytes, offset);
        offset += entry.nameBytes.byteLength;
        output.set(entry.bytes, offset);
        offset += entry.bytes.byteLength;
    }

    const centralOffset = offset;
    for (const entry of entries) {
        u32(view, offset, CENTRAL_DIRECTORY_HEADER);
        u16(view, offset + 4, ZIP_VERSION);
        u16(view, offset + 6, ZIP_VERSION);
        u16(view, offset + 8, UTF8_FLAG);
        u16(view, offset + 10, 0);
        u16(view, offset + 12, timestamp.time);
        u16(view, offset + 14, timestamp.date);
        u32(view, offset + 16, entry.crc);
        u32(view, offset + 20, entry.bytes.byteLength);
        u32(view, offset + 24, entry.bytes.byteLength);
        u16(view, offset + 28, entry.nameBytes.byteLength);
        u16(view, offset + 30, 0);
        u16(view, offset + 32, 0);
        u16(view, offset + 34, 0);
        u16(view, offset + 36, 0);
        u32(view, offset + 38, 0);
        u32(view, offset + 42, entry.localOffset);
        offset += 46;
        output.set(entry.nameBytes, offset);
        offset += entry.nameBytes.byteLength;
    }

    u32(view, offset, END_OF_CENTRAL_DIRECTORY);
    u16(view, offset + 4, 0);
    u16(view, offset + 6, 0);
    u16(view, offset + 8, entries.length);
    u16(view, offset + 10, entries.length);
    u32(view, offset + 12, centralBytes);
    u32(view, offset + 16, centralOffset);
    u16(view, offset + 20, 0);
    return output;
}
