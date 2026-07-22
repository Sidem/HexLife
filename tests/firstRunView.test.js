import { describe, it, expect } from 'vitest';
import {
    legibleFirstRunZoom,
    LEGIBLE_HEX_PITCH_PX,
    MAX_FIRST_RUN_ZOOM,
    GRID_SIZE_PRESETS,
} from '../src/core/gridMath.js';

/**
 * Roadmap #34 (UX audit fix 7 — "first legibility"). The audit's finding was that time-to-first-
 * wonder is fast (2 clicks) but the *first frame* is dense monochrome static: at zoom 1 the default
 * 192-row grid draws ~6.7px hex rows, so the named gliders of the default ruleset are not legible.
 *
 * The fix opens a first-time visitor at a zoom derived from the grid, so every grid-size preset
 * starts at a comparable apparent cell size. These are the properties that have to hold whatever
 * the constants are tuned to.
 */
describe('legibleFirstRunZoom (#34)', () => {
    const TEXTURE = 1280; // Config.RENDER_TEXTURE_SIZE

    it('scales the default grid up to the legible hex pitch', () => {
        const zoom = legibleFirstRunZoom(GRID_SIZE_PRESETS.medium, TEXTURE);
        const pitch = (TEXTURE / GRID_SIZE_PRESETS.medium) * zoom;
        expect(pitch).toBeCloseTo(LEGIBLE_HEX_PITCH_PX, 6);
    });

    it('opens every preset at roughly the same apparent cell size, or as close as the clamp allows', () => {
        for (const rows of Object.values(GRID_SIZE_PRESETS)) {
            const zoom = legibleFirstRunZoom(rows, TEXTURE);
            const pitch = (TEXTURE / rows) * zoom;
            // Either the target pitch is hit exactly, or a clamp bound is why it isn't: a finer
            // grid runs out of allowed zoom, a coarser one is already legible unaided.
            const clamped = zoom === 1 || zoom === MAX_FIRST_RUN_ZOOM;
            expect(clamped || Math.abs(pitch - LEGIBLE_HEX_PITCH_PX) < 1e-6).toBe(true);
        }
    });

    it('never zooms out past the whole grid', () => {
        // A grid coarse enough to be legible unaided must open at exactly 1, not below it: zoom < 1
        // would frame empty space around the world.
        expect(legibleFirstRunZoom(32, TEXTURE)).toBe(1);
        expect(legibleFirstRunZoom(GRID_SIZE_PRESETS.small, TEXTURE)).toBeGreaterThanOrEqual(1);
    });

    it('caps the opening zoom so a huge grid does not open on a keyhole', () => {
        expect(legibleFirstRunZoom(GRID_SIZE_PRESETS.huge, TEXTURE)).toBe(MAX_FIRST_RUN_ZOOM);
        expect(legibleFirstRunZoom(100000, TEXTURE)).toBe(MAX_FIRST_RUN_ZOOM);
    });

    it('falls back to 1 on degenerate input rather than producing NaN camera state', () => {
        // A NaN zoom would poison camera.x/y through the pan clamp and blank the view.
        expect(legibleFirstRunZoom(0, TEXTURE)).toBe(1);
        expect(legibleFirstRunZoom(GRID_SIZE_PRESETS.medium, 0)).toBe(1);
        expect(legibleFirstRunZoom(undefined, undefined)).toBe(1);
    });
});
