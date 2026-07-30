import { describe, expect, it, vi } from 'vitest';
import { NativeTrajectoryModelService } from '../src/services/NativeTrajectoryModelService.js';

class FakeWorker {
    constructor() {
        this.postMessage = vi.fn((message) => {
            if (message.type === 'INIT') {
                queueMicrotask(() => this.onmessage({
                    data: {
                        type: 'READY',
                        manifest: { modelId: 'native-test', acceptance: { status: 'testing' } },
                        backend: 'wasm',
                    },
                }));
            } else if (message.type === 'EVALUATE') {
                const descriptor = new Float32Array(32);
                descriptor[0] = 0.5;
                queueMicrotask(() => this.onmessage({
                    data: {
                        type: 'EVALUATE_RESULT',
                        id: message.id,
                        descriptor: descriptor.buffer,
                        reward: 1.25,
                        modelId: 'native-test',
                    },
                }));
            }
        });
        this.terminate = vi.fn();
    }
}

class SilentEvaluationWorker extends FakeWorker {
    constructor() {
        super();
        const readyPost = this.postMessage;
        this.postMessage = vi.fn((message) => {
            if (message.type === 'INIT') readyPost(message);
        });
    }
}

describe('NativeTrajectoryModelService', () => {
    it('loads lazily and evaluates packed frames', async () => {
        const service = new NativeTrajectoryModelService({
            enabled: true,
            workerFactory: () => new FakeWorker(),
            manifestUrl: '/model.json',
        });
        expect(await service.ensureReady()).toBe(true);
        expect(service.getStatus()).toMatchObject({
            status: 'ready',
            modelId: 'native-test',
            backend: 'wasm',
            acceptanceStatus: 'testing',
        });
        const result = await service.evaluate({
            frames: [new Uint8Array([1])],
            rows: 2,
            cols: 2,
            tickOffsets: [0],
        });
        expect(result.reward).toBe(1.25);
        expect(result.descriptor).toHaveLength(32);
        expect(result.descriptor[0]).toBe(0.5);
    });

    it('does no worker work while disabled', async () => {
        const service = new NativeTrajectoryModelService({ enabled: false, workerFactory: () => new FakeWorker() });
        await expect(service.evaluate({
            frames: [new Uint8Array([0])],
            rows: 2,
            cols: 2,
            tickOffsets: [0],
        })).rejects.toThrow(/disabled/i);
    });

    it('maps Bradley-Terry utility through the manifest calibration', async () => {
        class CalibratedWorker extends FakeWorker {
            constructor() {
                super();
                this.postMessage = vi.fn((message) => {
                    if (message.type === 'INIT') {
                        queueMicrotask(() => this.onmessage({
                            data: {
                                type: 'READY',
                                manifest: {
                                    modelId: 'calibrated',
                                    acceptance: { status: 'beta' },
                                    rewardCalibration: {
                                        status: 'calibrated',
                                        method: 'reference-quantile-v1',
                                        utilities: [-2, 0, 2],
                                        percentiles: [0, 0.5, 1],
                                    },
                                },
                                backend: 'wasm',
                            },
                        }));
                    } else {
                        const descriptor = new Float32Array(32);
                        queueMicrotask(() => this.onmessage({
                            data: {
                                type: 'EVALUATE_RESULT',
                                id: message.id,
                                descriptor: descriptor.buffer,
                                reward: 1,
                                modelId: 'calibrated',
                            },
                        }));
                    }
                });
            }
        }
        const service = new NativeTrajectoryModelService({
            enabled: true,
            workerFactory: () => new CalibratedWorker(),
        });
        const result = await service.evaluate({
            frames: [new Uint8Array([1])], rows: 1, cols: 1, tickOffsets: [0],
        });
        expect(result.rawReward).toBe(1);
        expect(result.reward).toBe(0.75);
    });

    it('rejects a hung inference at its deadline', async () => {
        const service = new NativeTrajectoryModelService({
            enabled: true,
            workerFactory: () => new SilentEvaluationWorker(),
        });
        await expect(service.evaluate({
            frames: [new Uint8Array([1])], rows: 1, cols: 1, tickOffsets: [0],
        }, { timeoutMs: 10 })).rejects.toThrow(/timed out/i);
        expect(service._pending.size).toBe(0);
    });

    it('cancels pending inference with an AbortSignal', async () => {
        const service = new NativeTrajectoryModelService({
            enabled: true,
            workerFactory: () => new SilentEvaluationWorker(),
        });
        const controller = new AbortController();
        const pending = service.evaluate({
            frames: [new Uint8Array([1])], rows: 1, cols: 1, tickOffsets: [0],
        }, { signal: controller.signal });
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(service._pending.size).toBe(0);
    });
});
