import { describe, it, expect, vi } from 'vitest';
import { EmbeddingService, EMBEDDING_STATUS, EMBEDDING_MODELS, EMBEDDING_CONFIG } from '../src/services/EmbeddingService.js';

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

// --- v3.1: user-selectable CLIP checkpoint -----------------------------------

describe('EmbeddingService - model selection (v3.1)', () => {
    it('defaults to the first vetted model and exposes it via getModelId', () => {
        const { svc } = makeService(true);
        expect(EMBEDDING_MODELS.some((m) => m.id === EMBEDDING_CONFIG.modelId)).toBe(true);
        expect(svc.getModelId()).toBe(EMBEDDING_CONFIG.modelId);
    });

    it('setModel tears the old worker down and INITs a fresh one with the new id', async () => {
        const { svc, worker } = makeService(true);
        const ready = svc.ensureReady();
        worker().emit({ type: 'READY' });
        await ready;
        const oldWorker = worker();

        const nextId = EMBEDDING_MODELS[1].id;
        svc.setModel(nextId);
        expect(oldWorker.terminated).toBe(true);
        expect(svc.getModelId()).toBe(nextId);
        expect(svc.getStatus()).toBe(EMBEDDING_STATUS.LOADING);
        // setModel kicks off a fresh lazy load: a NEW worker got INIT with the new model id.
        const newWorker = worker();
        expect(newWorker).not.toBe(oldWorker);
        expect(newWorker.lastOfType('INIT').modelId).toBe(nextId);
        newWorker.emit({ type: 'READY' });
        expect(await svc.ensureReady()).toBe(true);
    });

    it('resolves in-flight embeds null on a model switch', async () => {
        const { svc, worker } = makeService(true);
        const ready = svc.ensureReady();
        worker().emit({ type: 'READY' });
        await ready;

        const p = svc.embed(frame);
        svc.setModel(EMBEDDING_MODELS[1].id);
        expect(await p).toBeNull();
    });

    it('is a no-op for the current id or an unknown id', async () => {
        const { svc, worker } = makeService(true);
        const ready = svc.ensureReady();
        worker().emit({ type: 'READY' });
        await ready;
        const w = worker();

        svc.setModel(svc.getModelId());
        expect(w.terminated).toBe(false);
        svc.setModel('Evil/unvetted-model');
        expect(w.terminated).toBe(false);
        expect(svc.getModelId()).toBe(EMBEDDING_CONFIG.modelId);
    });

    it('while disabled, setModel swaps the id without spawning a worker', () => {
        const { svc, worker } = makeService(false);
        svc.setModel(EMBEDDING_MODELS[2].id);
        expect(svc.getModelId()).toBe(EMBEDDING_MODELS[2].id);
        expect(svc.getStatus()).toBe(EMBEDDING_STATUS.DISABLED);
        expect(worker()).toBeNull();
    });

    it('a stale init timeout from a superseded load cannot wreck the new worker (token guard)', async () => {
        vi.useFakeTimers();
        try {
            const { svc, worker } = makeService(true, { initTimeoutMs: 100 });
            const p1 = svc.ensureReady(); // load #1 in flight, never answered
            const w1 = worker();
            svc.setModel(EMBEDDING_MODELS[1].id); // supersedes load #1, starts load #2
            const w2 = worker();
            w2.emit({ type: 'READY' });
            expect(await svc.ensureReady()).toBe(true);
            expect(svc.getStatus()).toBe(EMBEDDING_STATUS.READY);

            // Load #1's timeout fires AFTER the switch: it must not touch worker #2 or the status.
            await vi.advanceTimersByTimeAsync(150);
            expect(await p1).toBe(false); // the stale promise resolves false...
            expect(svc.getStatus()).toBe(EMBEDDING_STATUS.READY); // ...without clobbering status
            expect(w2.terminated).toBe(false);
            expect(w1.terminated).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});
