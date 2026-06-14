import { describe, it, expect, vi } from 'vitest';
import { EmbeddingService, EMBEDDING_STATUS } from '../src/services/EmbeddingService.js';

/** A fake module worker: records posted messages, lets a test push worker→host messages. */
function makeFakeWorker() {
    const fw = {
        onmessage: null,
        onerror: null,
        posted: [],
        terminated: false,
        postMessage(msg) { fw.posted.push(msg); },
        terminate() { fw.terminated = true; },
        emit(data) { if (fw.onmessage) fw.onmessage({ data }); },
        lastOfType(type) { return [...fw.posted].reverse().find((m) => m.type === type); },
    };
    return fw;
}

/** Construct a service wired to a fresh fake worker; returns both. */
function makeService(enabled = true, configOverrides = {}) {
    let fw = null;
    const svc = new EmbeddingService({
        enabled,
        config: { initTimeoutMs: 1000, embedTimeoutMs: 1000, ...configOverrides },
        workerFactory: () => { fw = makeFakeWorker(); return fw; },
    });
    return { svc, worker: () => fw };
}

const frame = { width: 2, height: 2, data: new Uint8ClampedArray(2 * 2 * 4) };

describe('EmbeddingService — disabled (default) is inert', () => {
    it('never spawns a worker and embed resolves null', async () => {
        const { svc, worker } = makeService(false);
        expect(svc.isEnabled()).toBe(false);
        expect(svc.getStatus()).toBe(EMBEDDING_STATUS.DISABLED);
        expect(await svc.ensureReady()).toBe(false);
        expect(await svc.embed(frame)).toBeNull();
        expect(worker()).toBeNull(); // no worker was ever created
    });
});

describe('EmbeddingService — model load', () => {
    it('posts INIT and resolves ready on READY', async () => {
        const { svc, worker } = makeService(true);
        const p = svc.ensureReady();
        expect(worker().lastOfType('INIT')).toBeTruthy();
        worker().emit({ type: 'READY' });
        expect(await p).toBe(true);
        expect(svc.getStatus()).toBe(EMBEDDING_STATUS.READY);
    });

    it('degrades to error (and tears the worker down) on INIT_ERROR', async () => {
        const { svc, worker } = makeService(true);
        const p = svc.ensureReady();
        const w = worker(); // created by the factory inside ensureReady
        w.emit({ type: 'INIT_ERROR', error: 'no webgpu' });
        expect(await p).toBe(false);
        expect(svc.getStatus()).toBe(EMBEDDING_STATUS.ERROR);
        expect(w.terminated).toBe(true);
    });

    it('caches the readiness promise (INIT posted once for concurrent callers)', async () => {
        const { svc, worker } = makeService(true);
        const p1 = svc.ensureReady();
        const p2 = svc.ensureReady();
        worker().emit({ type: 'READY' });
        await Promise.all([p1, p2]);
        expect(worker().posted.filter((m) => m.type === 'INIT')).toHaveLength(1);
    });

    it('degrades when the worker factory throws (e.g. Worker unsupported)', async () => {
        const svc = new EmbeddingService({
            enabled: true,
            config: { initTimeoutMs: 1000 },
            workerFactory: () => { throw new Error('Worker not available'); },
        });
        expect(await svc.ensureReady()).toBe(false);
        expect(svc.getStatus()).toBe(EMBEDDING_STATUS.ERROR);
    });
});

describe('EmbeddingService — embedding', () => {
    it('posts EMBED and resolves the returned vector', async () => {
        const { svc, worker } = makeService(true);
        const ready = svc.ensureReady();
        worker().emit({ type: 'READY' });
        await ready;

        const p = svc.embed(frame);
        const sent = worker().lastOfType('EMBED');
        expect(sent).toBeTruthy();
        const vec = new Float32Array([0.1, 0.2, 0.3]);
        worker().emit({ type: 'EMBED_RESULT', id: sent.id, embedding: vec.buffer });
        const out = await p;
        expect(out).toBeInstanceOf(Float32Array);
        expect(Array.from(out)).toEqual([
            Math.fround(0.1), Math.fround(0.2), Math.fround(0.3),
        ]);
    });

    it('resolves null on EMBED_ERROR', async () => {
        const { svc, worker } = makeService(true);
        const ready = svc.ensureReady();
        worker().emit({ type: 'READY' });
        await ready;

        const p = svc.embed(frame);
        const sent = worker().lastOfType('EMBED');
        worker().emit({ type: 'EMBED_ERROR', id: sent.id, error: 'inference failed' });
        expect(await p).toBeNull();
    });

    it('resolves null on a null/dataless frame without posting', async () => {
        const { svc, worker } = makeService(true);
        const ready = svc.ensureReady();
        worker().emit({ type: 'READY' });
        await ready;
        const before = worker().posted.length;
        expect(await svc.embed(null)).toBeNull();
        expect(worker().posted.length).toBe(before);
    });

    it('times out to null when the worker never replies', async () => {
        vi.useFakeTimers();
        try {
            const { svc, worker } = makeService(true, { embedTimeoutMs: 50 });
            const ready = svc.ensureReady();
            worker().emit({ type: 'READY' });
            await ready;

            const p = svc.embed(frame);
            await vi.advanceTimersByTimeAsync(60);
            expect(await p).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('EmbeddingService — enable/disable lifecycle', () => {
    it('setEnabled(false) tears down and goes inert', async () => {
        const { svc, worker } = makeService(true);
        const ready = svc.ensureReady();
        worker().emit({ type: 'READY' });
        await ready;
        const w = worker();

        svc.setEnabled(false);
        expect(svc.isEnabled()).toBe(false);
        expect(svc.getStatus()).toBe(EMBEDDING_STATUS.DISABLED);
        expect(w.terminated).toBe(true);
        expect(await svc.embed(frame)).toBeNull();
    });

    it('in-flight embeds resolve null when the worker is torn down', async () => {
        const { svc, worker } = makeService(true);
        const ready = svc.ensureReady();
        worker().emit({ type: 'READY' });
        await ready;

        const p = svc.embed(frame);
        svc.dispose();
        expect(await p).toBeNull();
    });
});
