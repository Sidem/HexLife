/**
 * Minimal column-major 4x4 matrix helpers for the torus view.
 * Matrices follow WebGL's convention and `multiply(a, b)` returns a × b.
 */

export function identity() {
    return new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ]);
}

export function multiply(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column++) {
        for (let row = 0; row < 4; row++) {
            let value = 0;
            for (let k = 0; k < 4; k++) {
                value += a[k * 4 + row] * b[column * 4 + k];
            }
            out[column * 4 + row] = value;
        }
    }
    return out;
}

export function perspective(fovYRadians, aspect, near, far) {
    const f = 1 / Math.tan(fovYRadians / 2);
    const rangeInverse = 1 / (near - far);
    return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (near + far) * rangeInverse, -1,
        0, 0, 2 * near * far * rangeInverse, 0,
    ]);
}

export function lookAt(eye, target, up) {
    let zx = eye[0] - target[0];
    let zy = eye[1] - target[1];
    let zz = eye[2] - target[2];
    const zLength = Math.hypot(zx, zy, zz) || 1;
    zx /= zLength;
    zy /= zLength;
    zz /= zLength;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    const xLength = Math.hypot(xx, xy, xz) || 1;
    xx /= xLength;
    xy /= xLength;
    xz /= xLength;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    return new Float32Array([
        xx, yx, zx, 0,
        xy, yy, zy, 0,
        xz, yz, zz, 0,
        -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
        -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
        -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
        1,
    ]);
}
