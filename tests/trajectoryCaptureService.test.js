import { describe, expect, it, vi } from 'vitest';
import * as Config from '../src/core/config.js';
import { TrajectoryCaptureService } from '../src/services/TrajectoryCaptureService.js';

describe('TrajectoryCaptureService', () => {
    it('uses the worker-sampled source tick rather than lagging proxy stats', async () => {
        const bytesPerFrame = Math.ceil(Config.NUM_CELLS / 8);
        const frames = [new Uint8Array(bytesPerFrame), new Uint8Array(bytesPerFrame)];
        const proxy = {
            isInitialized: true,
            lastResetSeed: 123,
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
        });

        expect(proxy.captureTrajectory).toHaveBeenCalledWith({ frameCount: 2, tickStride: 3 });
        expect(captured.header.sourceTick).toBe(11);
        expect(captured.header.tickOffsets).toEqual([0, 3]);
        expect(captured.header.label).toBe('interesting');
        expect(captured.frames).toBe(frames);
    });

    it('stamps corpus provenance on a judged-world series and keeps one collection id', async () => {
        const bytesPerFrame = Math.ceil(Config.NUM_CELLS / 8);
        const makeFrames = () => [new Uint8Array(bytesPerFrame), new Uint8Array(bytesPerFrame)];
        const proxy = {
            isInitialized: true,
            lastResetSeed: 456,
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
            worldSettings: [{
                rulesetHex: '1'.repeat(32),
                initialState: { mode: 'density', params: { density: 0.5 } },
            }],
            autoExploreService: { isRunning: () => false },
        });

        const { clips } = await service.captureJudgedWorld(0, {
            label: 'boring',
            family: 'still-life-a',
            scenario: 'still_life',
            frameCount: 2,
            tickStride: 3,
            sliceCount: 3,
            sessionId: 'session-1',
        });

        expect(proxy.captureTrajectorySeries).toHaveBeenCalledWith({
            frameCount: 2,
            tickStride: 3,
            sliceCount: 3,
        });
        const headers = clips.map((clip) => clip.header);
        expect(headers.map((header) => header.sourceTick)).toEqual([40, 46, 52]);
        expect(headers.map((header) => header.collectionIndex)).toEqual([0, 1, 2]);
        expect(new Set(headers.map((header) => header.collectionId)).size).toBe(1);
        expect(headers.every((header) => header.batchId === 'session-1')).toBe(true);
        expect(headers.every((header) => header.label === 'boring')).toBe(true);
        expect(headers.every((header) => header.family === 'still-life-a')).toBe(true);
        expect(headers.every((header) => header.scenario === 'still_life')).toBe(true);
        expect(headers.every((header) => header.corpusProtocol === 'corpus-v1')).toBe(true);
        expect(headers.every((header) => header.seed === 456)).toBe(true);
    });

    it('refuses judged-world capture without valid provenance or a known seed', async () => {
        const proxy = {
            isInitialized: true,
            lastResetSeed: null,
            getLatestStats: () => ({ rulesetHex: '0'.repeat(32) }),
        };
        const service = new TrajectoryCaptureService({
            worlds: [proxy],
            worldSettings: [{ rulesetHex: '0'.repeat(32) }],
            autoExploreService: { isRunning: () => false },
        });

        await expect(service.captureJudgedWorld(0, {
            label: 'unlabeled', family: 'family-a', scenario: 'glider',
        })).rejects.toThrow('interesting or boring');
        await expect(service.captureJudgedWorld(0, {
            label: 'interesting', family: 'Not valid', scenario: 'glider',
        })).rejects.toThrow('not protocol-valid');
        await expect(service.captureJudgedWorld(0, {
            label: 'interesting', family: 'family-a', scenario: 'nonsense',
        })).rejects.toThrow('Unknown scenario');
        await expect(service.captureJudgedWorld(0, {
            label: 'interesting', family: 'family-a', scenario: 'glider',
        })).rejects.toThrow('no known reset seed');
    });
});
