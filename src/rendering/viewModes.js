/**
 * The projection the selected world is drawn through.
 *
 * This replaced a `torusEnabled` boolean (#40 Phase 0): a boolean cannot name a third projection,
 * and every call site that asked "is the torus on?" really wanted "which projection is active?".
 *
 * Like the torus before it, this is **view state**: it never mutates the flat per-world camera and
 * never enters a share link. Only the mode itself is persisted (a UI setting), not the geometry.
 */
export const VIEW_MODES = Object.freeze({
    FLAT: 'flat',
    TORUS: 'torus',
    SPACETIME: 'spacetime',
});

const ALL_VIEW_MODES = Object.freeze(Object.values(VIEW_MODES));

export function isViewMode(mode) {
    return ALL_VIEW_MODES.includes(mode);
}

/** Coerce anything (a stale persisted value, a typo'd console call) to a mode the renderer knows. */
export function normalizeViewMode(mode, fallback = VIEW_MODES.FLAT) {
    return isViewMode(mode) ? mode : fallback;
}

/**
 * True for the projections driven by the orbit camera — drag to orbit, wheel to dolly, and no
 * flat-grid pointer interaction. Both 3D modes share `torusOrbitCamera`, so they share the input
 * strategy and the animation/dirty gate too.
 */
export function isOrbitViewMode(mode) {
    return mode === VIEW_MODES.TORUS || mode === VIEW_MODES.SPACETIME;
}
