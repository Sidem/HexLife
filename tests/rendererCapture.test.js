import { describe, expect, it, vi } from 'vitest';
import { captureActiveSelectedView } from '../src/rendering/renderer.js';

describe('captureActiveSelectedView', () => {
    it('captures the torus when the torus view is active', () => {
        const torusCanvas = {};
        const captureTorus = vi.fn(() => torusCanvas);
        const captureFlat = vi.fn(() => ({}));

        expect(captureActiveSelectedView(true, captureTorus, captureFlat)).toBe(torusCanvas);
        expect(captureTorus).toHaveBeenCalledOnce();
        expect(captureFlat).not.toHaveBeenCalled();
    });

    it('captures the flat view when the torus is inactive', () => {
        const flatCanvas = {};
        const captureTorus = vi.fn(() => ({}));
        const captureFlat = vi.fn(() => flatCanvas);

        expect(captureActiveSelectedView(false, captureTorus, captureFlat)).toBe(flatCanvas);
        expect(captureTorus).not.toHaveBeenCalled();
        expect(captureFlat).toHaveBeenCalledOnce();
    });

    it('falls back to the flat view if offscreen torus rendering is unavailable', () => {
        const flatCanvas = {};
        const captureTorus = vi.fn(() => null);
        const captureFlat = vi.fn(() => flatCanvas);

        expect(captureActiveSelectedView(true, captureTorus, captureFlat)).toBe(flatCanvas);
        expect(captureFlat).toHaveBeenCalledOnce();
    });
});
