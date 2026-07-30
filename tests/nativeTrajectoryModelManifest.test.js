import { describe, expect, it } from 'vitest';
import {
    calibrateNativeReward,
    validateNativeTrajectoryModelManifest,
} from '../src/core/analysis/NativeTrajectoryModelManifest.js';

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
        corpus: { protocolId: 'corpus-v1', rootSha256: 'b'.repeat(64) },
        ...overrides,
    };
}

describe('native trajectory model manifest', () => {
    it('accepts only the frozen, explicitly accepted contract', () => {
        const accepted = manifest();
        expect(validateNativeTrajectoryModelManifest(accepted)).toBe(accepted);
    });

    it('accepts an explicitly marked manual-testing artifact', () => {
        const testing = manifest({ acceptance: { status: 'testing' }, corpus: {} });
        expect(validateNativeTrajectoryModelManifest(testing)).toBe(testing);
    });

    it('accepts a beta only with monotonic reference-quantile calibration', () => {
        const beta = manifest({
            acceptance: { status: 'beta' },
            rewardCalibration: {
                status: 'calibrated',
                method: 'reference-quantile-v1',
                utilities: [-3, 0, 2],
                percentiles: [0, 0.6, 1],
            },
        });
        expect(validateNativeTrajectoryModelManifest(beta)).toBe(beta);
        expect(calibrateNativeReward(-5, beta.rewardCalibration)).toBe(0);
        expect(calibrateNativeReward(1, beta.rewardCalibration)).toBe(0.8);
        expect(calibrateNativeReward(10, beta.rewardCalibration)).toBe(1);
    });

    it('refuses a beta with missing or non-monotonic calibration', () => {
        expect(() => validateNativeTrajectoryModelManifest(manifest({
            acceptance: { status: 'beta' },
        }))).toThrow(/calibrated/);
        expect(() => validateNativeTrajectoryModelManifest(manifest({
            acceptance: { status: 'beta' },
            rewardCalibration: {
                status: 'calibrated',
                method: 'reference-quantile-v1',
                utilities: [0, -1],
                percentiles: [0, 1],
            },
        }))).toThrow(/monotonic/);
    });

    it('refuses accepted artifacts without the frozen corpus checksum', () => {
        expect(() => validateNativeTrajectoryModelManifest(manifest({
            corpus: {},
        }))).toThrow(/Corpus v1/);
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
