import { describe, expect, it } from 'vitest';
import {
    sanitizeTorusViewSettings,
    TORUS_VIEW_DEFAULTS,
} from '../src/services/TorusViewSettings.js';

describe('torus view settings', () => {
    it('uses stable defaults for missing and malformed values', () => {
        expect(sanitizeTorusViewSettings({
            offOpacity: 'nope',
            radiusRatio: null,
            autoRotate: 'yes',
            rotationSpeed: undefined,
        })).toEqual(TORUS_VIEW_DEFAULTS);
    });

    it('clamps persisted slider values to the supported rendering range', () => {
        expect(sanitizeTorusViewSettings({
            offOpacity: -1,
            radiusRatio: 9,
            autoRotate: false,
            rotationSpeed: 100,
        })).toEqual({
            offOpacity: 0,
            radiusRatio: 3,
            autoRotate: false,
            rotationSpeed: 45,
        });
    });

    it('allows fully opaque off cells', () => {
        expect(sanitizeTorusViewSettings({ offOpacity: 1 }).offOpacity).toBe(1);
        expect(sanitizeTorusViewSettings({ offOpacity: 5 }).offOpacity).toBe(1);
    });
});
