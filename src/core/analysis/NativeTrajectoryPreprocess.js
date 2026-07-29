// @ts-check

/**
 * Turn packed HXLT frames into the native model's uint8 NCTHW-like input:
 * `[1,time,4,rows,cols/2]`, channel order
 * state-even/state-odd/change-even/change-odd.
 */

/** @param {Uint8Array} frame @param {number} cellIndex */
function bitAt(frame, cellIndex) {
    return (frame[cellIndex >>> 3] >>> (cellIndex & 7)) & 1;
}
/**
 * @param {{frames: Uint8Array[], rows: number, cols: number, tickOffsets?: number[]}} trajectory
 */
export function buildNativeTrajectoryInputs(trajectory) {
    const rows = Math.trunc(Number(trajectory?.rows));
    const cols = Math.trunc(Number(trajectory?.cols));
    const frames = Array.isArray(trajectory?.frames) ? trajectory.frames : [];
    if (rows <= 0 || cols <= 0 || cols % 2 !== 0) throw new Error('Native model requires positive rows and even columns.');
    if (frames.length < 1 || frames.length > 32) throw new Error('Native model requires 1–32 frames.');
    const bytesPerFrame = Math.ceil(rows * cols / 8);
    if (frames.some((frame) => !(frame instanceof Uint8Array) || frame.byteLength !== bytesPerFrame)) {
        throw new Error('Native model received a malformed packed frame.');
    }
    const tickOffsets = trajectory.tickOffsets || frames.map((_, index) => index);
    if (!Array.isArray(tickOffsets) || tickOffsets.length !== frames.length) {
        throw new Error('Native model tick offsets must match frame count.');
    }

    const pairedCols = cols / 2;
    const planeSize = rows * pairedCols;
    const frameSize = planeSize * 4;
    const features = new Uint8Array(frames.length * frameSize);
    for (let time = 0; time < frames.length; time++) {
        const current = frames[time];
        const previous = time > 0 ? frames[time - 1] : null;
        const frameBase = time * frameSize;
        for (let row = 0; row < rows; row++) {
            for (let pair = 0; pair < pairedCols; pair++) {
                const planeIndex = row * pairedCols + pair;
                const evenIndex = row * cols + pair * 2;
                const oddIndex = evenIndex + 1;
                const even = bitAt(current, evenIndex);
                const odd = bitAt(current, oddIndex);
                features[frameBase + planeIndex] = even;
                features[frameBase + planeSize + planeIndex] = odd;
                if (previous) {
                    features[frameBase + planeSize * 2 + planeIndex] = even ^ bitAt(previous, evenIndex);
                    features[frameBase + planeSize * 3 + planeIndex] = odd ^ bitAt(previous, oddIndex);
                }
            }
        }
    }
    return {
        features,
        featureDims: [1, frames.length, 4, rows, pairedCols],
        tickOffsets: Float32Array.from(tickOffsets),
        frameMask: new Float32Array(frames.length).fill(1),
    };
}
