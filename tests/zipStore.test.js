import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/core/analysis/TrajectoryFormat.js';
import { createStoredZip } from '../src/utils/ZipStore.js';

function readStoredEntries(zip) {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const decoder = new TextDecoder();
    const entries = new Map();
    let offset = 0;
    while (view.getUint32(offset, true) === 0x04034B50) {
        const crc = view.getUint32(offset + 14, true);
        const size = view.getUint32(offset + 18, true);
        const nameLength = view.getUint16(offset + 26, true);
        const extraLength = view.getUint16(offset + 28, true);
        const nameStart = offset + 30;
        const dataStart = nameStart + nameLength + extraLength;
        const name = decoder.decode(zip.subarray(nameStart, nameStart + nameLength));
        const bytes = zip.slice(dataStart, dataStart + size);
        entries.set(name, bytes);
        expect(crc32(bytes)).toBe(crc);
        offset = dataStart + size;
    }
    return { entries, centralSignature: view.getUint32(offset, true) };
}

describe('store-only ZIP writer', () => {
    it('packages binary HXLT data and UTF-8 filenames with valid CRCs', () => {
        const zip = createStoredZip([
            { name: 'clip-a.hxlt', bytes: Uint8Array.from([0, 1, 2, 255]) },
            { name: 'métadata.json', bytes: new TextEncoder().encode('{"ok":true}') },
        ], new Date(2026, 6, 29, 12, 0, 0));
        const parsed = readStoredEntries(zip);
        expect([...parsed.entries.get('clip-a.hxlt')]).toEqual([0, 1, 2, 255]);
        expect(new TextDecoder().decode(parsed.entries.get('métadata.json'))).toBe('{"ok":true}');
        expect(parsed.centralSignature).toBe(0x02014B50);
        expect(new DataView(zip.buffer).getUint32(zip.byteLength - 22, true)).toBe(0x06054B50);
    });

    it('refuses path traversal names', () => {
        expect(() => createStoredZip([{ name: '../clip.hxlt', bytes: new Uint8Array() }]))
            .toThrow(/unsafe/i);
    });
});
