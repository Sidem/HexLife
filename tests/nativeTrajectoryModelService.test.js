import { describe, expect, it, vi } from 'vitest';
import { NativeTrajectoryModelService } from '../src/services/NativeTrajectoryModelService.js';

class FakeWorker {
    constructor() {
        this.postMessage = vi.fn((message) => {
            if (message.type === 'INIT') {
                queueMicrotask(() => this.onmessage({
                    data: {
                        type: 'READY',
                        manifest: { modelId: 'native-test' },
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

describe('NativeTrajectoryModelService', () => {
    it('loads lazily and evaluates packed frames', async () => {
        const service = new NativeTrajectoryModelService({
            enabled: true,
            workerFactory: () => new FakeWorker(),
            manifestUrl: '/model.json',
        });
        expect(await service.ensureReady()).toBe(true);
        expect(service.getStatus()).toMatchObject({ status: 'ready', modelId: 'native-test', backend: 'wasm' });
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
});
