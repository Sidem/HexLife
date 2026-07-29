import { describe, expect, it } from 'vitest';
import { buildNativeTrajectoryInputs } from '../src/core/analysis/NativeTrajectoryPreprocess.js';

function packed(rows, cols, live = []) {
    const out = new Uint8Array(Math.ceil(rows * cols / 8));
    for (const index of live) out[index >>> 3] |= 1 << (index & 7);
    return out;
}

describe('native trajectory preprocessing', () => {
    it('splits column parity and derives ordered change planes', () => {
        const inputs = buildNativeTrajectoryInputs({
            rows: 2,
            cols: 4,
            frames: [
                packed(2, 4, [0]),
                packed(2, 4, [1]),
            ],
            tickOffsets: [0, 1],
        });
        expect(inputs.featureDims).toEqual([1, 2, 4, 2, 2]);
        const plane = 4;
        const second = plane * 4;
        expect(inputs.features[0]).toBe(1); // t0 state-even
        expect(inputs.features[second + plane]).toBe(1); // t1 state-odd
        expect(inputs.features[second + plane * 2]).toBe(1); // t1 changed-even
        expect(inputs.features[second + plane * 3]).toBe(1); // t1 changed-odd
        expect([...inputs.frameMask]).toEqual([1, 1]);
    });

    it('rejects malformed frames', () => {
        expect(() => buildNativeTrajectoryInputs({
            rows: 2,
            cols: 4,
            frames: [new Uint8Array(2)],
        })).toThrow(/malformed/i);
    });
});
