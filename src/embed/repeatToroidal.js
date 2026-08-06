/**
 * Copy offsets required to cover a viewport with a flat toroidal world.
 *
 * The shader first maps every canonical cell into the period nearest the camera. That gives one
 * complete fundamental domain centred on the view. Extra domains are only necessary once the
 * zoomed viewport extends past that domain (including the radius of its edge hexes).
 *
 * All measurements are backing-store/world units; `zoom` is the shader's world-to-screen scale.
 * @returns {Array<{x: number, y: number}>}
 */
export function repeatOffsetsForViewport(width, height, zoom, periodX, periodY, hexSize) {
    const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const px = Number.isFinite(periodX) && periodX > 0 ? periodX : 1;
    const py = Number.isFinite(periodY) && periodY > 0 ? periodY : 1;
    const radius = Number.isFinite(hexSize) && hexSize > 0 ? hexSize : 0;
    const halfWorldWidth = Math.max(0, width) / (2 * z);
    const halfWorldHeight = Math.max(0, height) / (2 * z);
    const copiesX = Math.max(0, Math.ceil((halfWorldWidth - px / 2 - radius) / px));
    const copiesY = Math.max(0, Math.ceil((halfWorldHeight - py / 2 - radius) / py));
    const offsets = [];

    for (let y = -copiesY; y <= copiesY; y++) {
        for (let x = -copiesX; x <= copiesX; x++) {
            offsets.push({ x: x === 0 ? 0 : x * px, y: y === 0 ? 0 : y * py });
        }
    }
    return offsets;
}
