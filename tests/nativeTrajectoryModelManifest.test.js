import { describe, expect, it } from 'vitest';
import { validateNativeTrajectoryModelManifest } from '../src/core/analysis/NativeTrajectoryModelManifest.js';

function manifest(overrides = {}) {
    return {
        schema: 'hexlife-interest-model-v1',
        trajectorySchema: 'HXLT1',
        topology: 'odd-q-torus-v1',
        preprocessing: 'state-change-parity-v1',
        artifact: 'model.onnx',
        artifactSha256: 'a'.repeat(64),
        outputs: { descriptor: { shape: ['batch', 32] }, reward: { shape: ['batch', 1] } },
        acceptance: { status: 'accepted' },
        ...overrides,
    };
}

describe('native trajectory model manifest', () => {
    it('accepts only the frozen, explicitly accepted contract', () => {
        const accepted = manifest();
        expect(validateNativeTrajectoryModelManifest(accepted)).toBe(accepted);
    });

    it('refuses an unvalidated training export', () => {
        expect(() => validateNativeTrajectoryModelManifest(manifest({
            acceptance: { status: 'unvalidated' },
        }))).toThrow(/not passed acceptance/);
    });

    it('refuses a descriptor-width mismatch', () => {
        expect(() => validateNativeTrajectoryModelManifest(manifest({
            outputs: { descriptor: { shape: ['batch', 16] } },
        }))).toThrow(/32-D/);
    });
});
