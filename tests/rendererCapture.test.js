import { describe, expect, it, vi } from 'vitest';
import { captureActiveSelectedView } from '../src/rendering/renderer.js';
import { VIEW_MODES } from '../src/rendering/viewModes.js';

describe('captureActiveSelectedView', () => {
    it('captures the torus when the torus view is active', () => {
        const torusCanvas = {};
        const captureTorus = vi.fn(() => torusCanvas);
        const captureFlat = vi.fn(() => ({}));

        expect(captureActiveSelectedView(VIEW_MODES.TORUS, captureTorus, captureFlat)).toBe(torusCanvas);
        expect(captureTorus).toHaveBeenCalledOnce();
        expect(captureFlat).not.toHaveBeenCalled();
    });

    it('captures the flat view when the torus is inactive', () => {
        const flatCanvas = {};
        const captureTorus = vi.fn(() => ({}));
        const captureFlat = vi.fn(() => flatCanvas);

        expect(captureActiveSelectedView(VIEW_MODES.FLAT, captureTorus, captureFlat)).toBe(flatCanvas);
        expect(captureTorus).not.toHaveBeenCalled();
        expect(captureFlat).toHaveBeenCalledOnce();
    });

    it('falls back to the flat view if offscreen torus rendering is unavailable', () => {
        const flatCanvas = {};
        const captureTorus = vi.fn(() => null);
        const captureFlat = vi.fn(() => flatCanvas);

        expect(captureActiveSelectedView(VIEW_MODES.TORUS, captureTorus, captureFlat)).toBe(flatCanvas);
        expect(captureFlat).toHaveBeenCalledOnce();
    });

    // Spacetime has no capture branch yet (#40 §7 leaves it to Phase 3/4), so it must capture flat
    // rather than silently handing back a torus render of a mode the user is not looking at.
    it('captures the flat view in spacetime mode', () => {
        const flatCanvas = {};
        const captureTorus = vi.fn(() => ({}));
        const captureFlat = vi.fn(() => flatCanvas);

        expect(captureActiveSelectedView(VIEW_MODES.SPACETIME, captureTorus, captureFlat)).toBe(flatCanvas);
        expect(captureTorus).not.toHaveBeenCalled();
    });
});
