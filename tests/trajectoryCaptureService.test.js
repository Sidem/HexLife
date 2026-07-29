import { describe, expect, it, vi } from 'vitest';
import * as Config from '../src/core/config.js';
import { TrajectoryCaptureService } from '../src/services/TrajectoryCaptureService.js';

describe('TrajectoryCaptureService', () => {
    it('uses the worker-sampled source tick rather than lagging proxy stats', async () => {
        const bytesPerFrame = Math.ceil(Config.NUM_CELLS / 8);
        const frames = [new Uint8Array(bytesPerFrame), new Uint8Array(bytesPerFrame)];
        const proxy = {
            isInitialized: true,
            getLatestStats: () => ({ tick: 7, rulesetHex: '0'.repeat(32) }),
            captureTrajectory: vi.fn(async () => ({ frames, sourceTick: 11 })),
        };
        const service = new TrajectoryCaptureService({
            selectedWorldIndex: 0,
            worlds: [proxy],
            worldSettings: [{
                rulesetHex: '0'.repeat(32),
                initialState: { mode: 'density', params: { density: 0.5 } },
            }],
            autoExploreService: { isRunning: () => false },
        });

        const captured = await service.captureSelected({
            frameCount: 2,
            tickStride: 3,
            label: 'interesting',
            family: 'glider-mutants-a',
        });

        expect(proxy.captureTrajectory).toHaveBeenCalledWith({ frameCount: 2, tickStride: 3 });
        expect(captured.header.sourceTick).toBe(11);
        expect(captured.header.tickOffsets).toEqual([0, 3]);
        expect(captured.header.label).toBe('interesting');
        expect(captured.header.family).toBe('glider-mutants-a');
        expect(captured.frames).toBe(frames);
    });
});
