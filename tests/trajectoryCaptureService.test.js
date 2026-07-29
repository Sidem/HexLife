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

    it('encodes a labeled series with non-overlapping worker-sampled source ticks', async () => {
        const bytesPerFrame = Math.ceil(Config.NUM_CELLS / 8);
        const makeFrames = () => [new Uint8Array(bytesPerFrame), new Uint8Array(bytesPerFrame)];
        const proxy = {
            isInitialized: true,
            getLatestStats: () => ({ rulesetHex: '0'.repeat(32) }),
            captureTrajectorySeries: vi.fn(async () => [
                { frames: makeFrames(), sourceTick: 40 },
                { frames: makeFrames(), sourceTick: 46 },
                { frames: makeFrames(), sourceTick: 52 },
            ]),
        };
        const service = new TrajectoryCaptureService({
            selectedWorldIndex: 0,
            worlds: [proxy],
            worldSettings: [{ rulesetHex: '1'.repeat(32), initialState: { mode: 'blank' } }],
            autoExploreService: { isRunning: () => false },
        });

        const records = await service.captureSeriesSelected({
            frameCount: 2,
            tickStride: 3,
            sliceCount: 3,
            label: 'boring',
            family: 'still-life-a',
        });

        expect(proxy.captureTrajectorySeries).toHaveBeenCalledWith({
            frameCount: 2,
            tickStride: 3,
            sliceCount: 3,
        });
        expect(records.map((record) => record.header.sourceTick)).toEqual([40, 46, 52]);
        expect(records.map((record) => record.header.collectionIndex)).toEqual([0, 1, 2]);
        expect(new Set(records.map((record) => record.header.collectionId)).size).toBe(1);
        expect(records.every((record) => record.header.label === 'boring')).toBe(true);
        expect(records.every((record) => record.header.family === 'still-life-a')).toBe(true);
    });
});
