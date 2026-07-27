export const TAU = Math.PI * 2;

export function getTorusPeriods(cols, rows, hexSize) {
    return {
        x: cols * 1.5 * hexSize,
        y: rows * Math.sqrt(3) * hexSize,
    };
}

export function wrapAngle(angle) {
    return ((angle % TAU) + TAU) % TAU;
}

/**
 * Camera frame for a continuous spherical orbit around the torus.
 *
 * The tangent-derived up vector stays perpendicular to the viewing direction even at the poles,
 * unlike a fixed world-up vector. Pitch can therefore pass through top and bottom indefinitely
 * without a look-at singularity or a sudden camera flip.
 */
export function torusOrbitCamera(yaw, pitch, distance) {
    const wrappedYaw = wrapAngle(yaw);
    const wrappedPitch = wrapAngle(pitch);
    const sinYaw = Math.sin(wrappedYaw);
    const cosYaw = Math.cos(wrappedYaw);
    const sinPitch = Math.sin(wrappedPitch);
    const cosPitch = Math.cos(wrappedPitch);

    return {
        position: [
            distance * cosPitch * sinYaw,
            distance * sinPitch,
            distance * cosPitch * cosYaw,
        ],
        up: [
            -sinPitch * sinYaw,
            cosPitch,
            -sinPitch * cosYaw,
        ],
    };
}

export function torusAnglesForCell(col, row, cols, rows) {
    return {
        u: TAU * col / cols,
        v: TAU * (row + (col % 2 ? 0.5 : 0)) / rows,
    };
}

export function cellFromTorusAngles(u, v, cols, rows) {
    const col = Math.round(wrapAngle(u) * cols / TAU) % cols;
    const rowPosition = wrapAngle(v) * rows / TAU - (col % 2 ? 0.5 : 0);
    return {
        col,
        row: ((Math.round(rowPosition) % rows) + rows) % rows,
    };
}

export function torusPoint(u, v, majorRadius = 1.55, minorRadius = 1) {
    const ringRadius = majorRadius + minorRadius * Math.cos(v);
    return [
        ringRadius * Math.cos(u),
        minorRadius * Math.sin(v),
        -ringRadius * Math.sin(u),
    ];
}
