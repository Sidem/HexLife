import { describe, expect, it } from 'vitest';
import {
    decodeTrajectory,
    encodeTrajectory,
    MAX_TRAJECTORY_FRAMES,
    TRAJECTORY_SCHEMA,
} from '../src/core/analysis/TrajectoryFormat.js';

function packedFrame(rows, cols, liveIndices = []) {
    const out = new Uint8Array(Math.ceil(rows * cols / 8));
    for (const index of liveIndices) out[index >>> 3] |= 1 << (index & 7);
    return out;
}

describe('HXLT1 trajectory format', () => {
    it('round-trips exact packed frames and metadata', () => {
        const frames = [
            packedFrame(4, 6, [0, 7]),
            packedFrame(4, 6, [1, 8, 23]),
        ];
        const encoded = encodeTrajectory({
            header: {
                id: 'clip-1',
                rows: 4,
                cols: 6,
                tickOffsets: [0, 3],
                ruleset: '0'.repeat(32),
                sourceTick: 17,
            },
            frames,
        });
        const decoded = decodeTrajectory(encoded.bytes);
        expect(decoded.header.schema).toBe(TRAJECTORY_SCHEMA);
        expect(decoded.header.tickOffsets).toEqual([0, 3]);
        expect([...decoded.frames[0]]).toEqual([...frames[0]]);
        expect([...decoded.frames[1]]).toEqual([...frames[1]]);
    });

    it('rejects corrupted payloads', () => {
        const encoded = encodeTrajectory({
            header: { id: 'clip-2', rows: 2, cols: 2, tickOffsets: [0] },
            frames: [packedFrame(2, 2, [0])],
        });
        encoded.bytes[encoded.bytes.length - 1] ^= 1;
        expect(() => decodeTrajectory(encoded.bytes)).toThrow(/checksum/i);
    });

    it('enforces the 32-frame contract and even columns', () => {
        const frame = packedFrame(2, 2);
        expect(() => encodeTrajectory({
            header: { id: 'too-many', rows: 2, cols: 2 },
            frames: Array.from({ length: MAX_TRAJECTORY_FRAMES + 1 }, () => frame),
        })).toThrow(/frame count/i);
        expect(() => encodeTrajectory({
            header: { id: 'odd', rows: 2, cols: 3 },
            frames: [new Uint8Array(1)],
        })).toThrow(/even columns/i);
    });
});
