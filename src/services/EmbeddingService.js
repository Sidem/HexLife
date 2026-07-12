import { EventBus, EVENTS } from './EventBus.js';

/**
 * Optional foundation-model embedding provider for the perceptual auto-explore objective (v3.0,
 * ASAL-style). Owns the lifecycle of a dedicated {@link module:core/EmbeddingWorker} that lazily
 * loads a small CLIP/MobileCLIP image encoder (transformers.js) and turns rendered frames into
 * embedding vectors. Kept entirely off the main thread (and the sim worker threads) so model load and
 * inference never block ticking or rendering.
 *
 * **Default off + graceful degradation are the contract** (see CLAUDE.md): nothing here runs until
 * `setEnabled(true)` is called, and EVERY failure path (model can't load, inference throws, network
 * down, browser too old, timeout) resolves to `null`/`false` rather than throwing — the caller then
 * falls back to the statistical objective with the gallery and score unchanged. The model (tens of MB)
 * is fetched from a CDN on first use and browser-cached by transformers.js for subsequent loads.
 *
 * Testability: the Worker is created via an injectable `workerFactory`, so the request/response
 * plumbing and the degradation paths are unit-testable with a fake worker (no real model needed).
 */

/** Tunable knobs for the embedding provider. */
export const EMBEDDING_CONFIG = {
    /** Whether the perceptual objective is on by default. MUST stay false (the graceful-degradation contract). */
    enabledByDefault: false,
    /** transformers.js-compatible CLIP image model (ONNX weights on the HF Hub, quantized ⇒ tens of MB). */
    modelId: 'Xenova/clip-vit-base-patch16',
    /** ESM build of transformers.js, dynamically imported in the worker (CDN ⇒ no bundle bloat, lazy). */
    cdnUrl: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1',
    /** Backend preference: 'webgpu' (fast) falling back to 'wasm'. 'auto' lets the worker pick. */
    device: 'auto',
    /** Quantization dtype for the ONNX weights ('q8' ⇒ small + fast; 'fp32' for max fidelity). */
    dtype: 'q8',
    /** Square edge (px) frames are downscaled to before embedding (the processor resizes to 224 anyway). */
    frameSize: 224,
    /** Hard ceiling on the one-time model load (ms) before we give up and degrade. */
    initTimeoutMs: 120000,
    /** Per-frame inference deadline (ms) before that embed resolves null (degrade, don't stall the search). */
    embedTimeoutMs: 20000,
};

/**
 * Vetted transformers.js-compatible CLIP image encoders the UI offers (v3.1). Every entry works
 * with the worker's `CLIPVisionModelWithProjection` + `AutoProcessor` load path unchanged; they
 * differ in download size, inference speed, and embedding fidelity/dimensionality. Sizes are the
 * q8-quantized vision-encoder ONNX weights fetched (once, then browser-cached) from the HF Hub.
 */
export const EMBEDDING_MODELS = [
    {
        id: 'Xenova/clip-vit-base-patch16',
        label: 'CLIP ViT-B/16 — balanced (default)',
        detail: '~90 MB download, 512-D embeddings. The tuned default.',
    },
    {
        id: 'Xenova/clip-vit-base-patch32',
        label: 'CLIP ViT-B/32 — faster, coarser',
        detail: '~85 MB download, 512-D embeddings. Coarser patches: quicker, less spatial detail.',
    },
    {
        id: 'Xenova/clip-vit-large-patch14',
        label: 'CLIP ViT-L/14 — best quality, heavy',
        detail: '~300 MB download, 768-D embeddings. WebGPU strongly recommended.',
    },
];

/** Coarse provider status, surfaced to the UI via {@link EVENTS.EMBEDDING_STATUS_CHANGED}. */
export const EMBEDDING_STATUS = Object.freeze({
    DISABLED: 'disabled', // toggle off (the default)
    LOADING: 'loading',   // model download / init in flight
    READY: 'ready',       // model loaded, embeddings available
    ERROR: 'error',       // load/inference failed — degraded to the statistical objective
});

export class EmbeddingService {
    /**
     * @param {object} [opts]
     * @param {boolean} [opts.enabled] Initial enabled state (persisted by the caller; default false).
     * @param {typeof EMBEDDING_CONFIG} [opts.config]
     * @param {() => {postMessage: Function, terminate: Function, onmessage: any, onerror?: any}} [opts.workerFactory]
     *   Factory for the embedding worker (DI for tests). Defaults to the real EmbeddingWorker module worker.
     */
    constructor({ enabled = EMBEDDING_CONFIG.enabledByDefault, config = EMBEDDING_CONFIG, workerFactory = null } = {}) {
        this.config = { ...EMBEDDING_CONFIG, ...config };
        this.enabled = !!enabled;
        this._workerFactory = workerFactory || (() => new Worker(new URL('../core/EmbeddingWorker.js', import.meta.url), { type: 'module' }));
        this.worker = null;
        /** @type {Promise<boolean>|null} Cached readiness promise (load is attempted at most once per worker). */
        this._readyPromise = null;
        // LOADING when enabled (the model loads lazily on the first ensureReady), DISABLED otherwise.
        this.status = this.enabled ? EMBEDDING_STATUS.LOADING : EMBEDDING_STATUS.DISABLED;
        this._reqId = 0;
        /** @type {Map<number, (v: Float32Array|null) => void>} pending embed resolvers, keyed by request id. */
        this._pending = new Map();
        /** @type {Map<string, Float32Array>} Cache of embedded target prompts, keyed `${modelId} ${prompt}`
         *  (v3.2). Text inference is deterministic per model version, so a repeated prompt round-trips at
         *  most once; cleared on teardown (a model switch invalidates every cached vector). */
        this._textCache = new Map();
        /** Worker generation: bumped by every teardown so a stale init timeout/error from a
         *  previous worker (e.g. after a model switch mid-load) can't touch the current one. */
        this._initToken = 0;
    }

    /** @returns {boolean} */
    isEnabled() {
        return this.enabled;
    }

    /** @returns {string} One of EMBEDDING_STATUS. */
    getStatus() {
        return this.status;
    }

    /** @returns {string} The active model id (namespaces the perceptual archive). */
    getModelId() {
        return this.config.modelId;
    }

    /**
     * Switch to a different embedding model (v3.1). Tears the current worker down (resolving any
     * in-flight embeds null) and — when enabled — kicks off a fresh lazy load of the new model.
     * The caller (WorldManager) is responsible for invalidating the model-specific perceptual
     * archive and for refusing the switch mid-run. No-op for the current or an unknown id.
     * @param {string} modelId One of {@link EMBEDDING_MODELS}.
     */
    setModel(modelId) {
        if (modelId === this.config.modelId) return;
        if (!EMBEDDING_MODELS.some((m) => m.id === modelId)) return;
        this._teardown();
        this.config.modelId = modelId;
        if (this.enabled) {
            this._setStatus(EMBEDDING_STATUS.LOADING);
            this.ensureReady();
        } else {
            this._setStatus(EMBEDDING_STATUS.DISABLED);
        }
    }

    _setStatus(status, message) {
        this.status = status;
        EventBus.dispatch(EVENTS.EMBEDDING_STATUS_CHANGED, { status, message: message || null, enabled: this.enabled });
    }

    /**
     * Enable/disable the perceptual objective. Disabling tears the worker down (frees the model);
     * enabling just flips the flag — the model loads lazily on the next {@link ensureReady}. Idempotent.
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        const next = !!enabled;
        if (next === this.enabled) return;
        this.enabled = next;
        if (!next) {
            this._teardown();
            this._setStatus(EMBEDDING_STATUS.DISABLED);
        } else {
            this._setStatus(EMBEDDING_STATUS.LOADING);
            // Kick off the load now so the UI can reflect ready/error before a run starts.
            this.ensureReady();
        }
    }

    /**
     * Ensure the model is loaded. Resolves true once embeddings are available, false on any failure
     * (the caller then degrades to the statistical objective). The load is attempted at most once per
     * worker lifetime; concurrent callers share the cached promise.
     * @returns {Promise<boolean>}
     */
    ensureReady() {
        if (!this.enabled) return Promise.resolve(false);
        if (this._readyPromise) return this._readyPromise;

        this._readyPromise = new Promise((resolve) => {
            let settled = false;
            const token = this._initToken;
            const finish = (ok, message) => {
                if (settled) return;
                settled = true;
                if (token !== this._initToken) {
                    // This load was superseded by a teardown (disable / model switch) — resolve the
                    // stale promise without touching the CURRENT worker or status.
                    resolve(false);
                    return;
                }
                if (ok) {
                    this._setStatus(EMBEDDING_STATUS.READY);
                } else {
                    this._setStatus(EMBEDDING_STATUS.ERROR, message);
                    this._teardown(); // a failed worker is unusable; drop it (re-enable retries fresh)
                }
                resolve(ok);
            };

            try {
                this._setStatus(EMBEDDING_STATUS.LOADING);
                this.worker = this._workerFactory();
                this.worker.onmessage = (event) => this._onWorkerMessage(event.data, finish);
                this.worker.onerror = (e) => finish(false, (e && e.message) || 'worker error');
                this.worker.postMessage({
                    type: 'INIT',
                    modelId: this.config.modelId,
                    cdnUrl: this.config.cdnUrl,
                    device: this.config.device,
                    dtype: this.config.dtype,
                });
                setTimeout(() => finish(false, 'model load timed out'), this.config.initTimeoutMs);
            } catch (err) {
                finish(false, (err && err.message) || 'failed to start embedding worker');
            }
        });
        return this._readyPromise;
    }

    /**
     * Embed one rendered frame into a CLIP image-embedding vector. Resolves null on any failure
     * (disabled, model not ready, inference error, timeout) so the search never stalls or throws.
     * @param {ImageData|{data: Uint8ClampedArray|Uint8Array, width: number, height: number}|null} frame
     * @returns {Promise<Float32Array|null>}
     */
    async embed(frame) {
        if (!this.enabled || !frame || !frame.data) return null;
        // Await the load only when not already ready — so once warm, the EMBED is posted synchronously
        // within this call (no microtask gap), which keeps the request ordering simple and testable.
        if (this.status !== EMBEDDING_STATUS.READY) {
            const ready = await this.ensureReady();
            if (!ready) return null;
        }
        if (!this.worker) return null;

        const id = ++this._reqId;
        // Copy the RGBA bytes into a transferable ArrayBuffer (the source may be a canvas-owned view).
        const bytes = new Uint8ClampedArray(frame.data);
        return new Promise((resolve) => {
            let settled = false;
            const done = (vec) => {
                if (settled) return;
                settled = true;
                this._pending.delete(id);
                resolve(vec);
            };
            this._pending.set(id, done);
            try {
                this.worker.postMessage(
                    { type: 'EMBED', id, width: frame.width, height: frame.height, data: bytes.buffer },
                    [bytes.buffer]
                );
            } catch {
                done(null);
                return;
            }
            setTimeout(() => done(null), this.config.embedTimeoutMs);
        });
    }

    /**
     * Embed a trajectory of frames, preserving order; failed frames resolve to null and are filtered
     * by the caller. Sequential (the worker holds one model) — fine, embeds are off the hot path.
     * @param {Array<ImageData|null>} frames
     * @returns {Promise<Array<Float32Array|null>>}
     */
    async embedTrajectory(frames) {
        const out = [];
        for (const f of frames || []) out.push(await this.embed(f));
        return out;
    }

    /**
     * Embed a natural-language target prompt into a (L2-normalized) CLIP text embedding, comparable by
     * cosine against the image embeddings from {@link embed} (v3.2, ASAL supervised target search).
     * Resolves null on any failure (disabled, empty prompt, model not ready, inference error, timeout)
     * so the search degrades to the statistical objective rather than stalling or throwing. A repeated
     * `(modelId, prompt)` resolves from cache without a second worker round-trip.
     * @param {string} prompt
     * @returns {Promise<Float32Array|null>}
     */
    async embedText(prompt) {
        if (!this.enabled) return null;
        const text = typeof prompt === 'string' ? prompt.trim() : '';
        if (!text) return null;
        const cacheKey = `${this.config.modelId} ${text}`;
        const cached = this._textCache.get(cacheKey);
        if (cached) return cached;

        if (this.status !== EMBEDDING_STATUS.READY) {
            const ready = await this.ensureReady();
            if (!ready) return null;
        }
        if (!this.worker) return null;

        const id = ++this._reqId;
        const vec = await new Promise((resolve) => {
            let settled = false;
            const done = (v) => {
                if (settled) return;
                settled = true;
                this._pending.delete(id);
                resolve(v);
            };
            this._pending.set(id, done);
            try {
                this.worker.postMessage({ type: 'EMBED_TEXT', id, text });
            } catch {
                done(null);
                return;
            }
            setTimeout(() => done(null), this.config.embedTimeoutMs);
        });
        if (vec && vec.length) this._textCache.set(cacheKey, vec);
        return vec;
    }

    _onWorkerMessage(data, finishInit) {
        if (!data) return;
        switch (data.type) {
            case 'READY':
                if (finishInit) finishInit(true);
                break;
            case 'INIT_ERROR':
                if (finishInit) finishInit(false, data.error);
                break;
            case 'EMBED_RESULT': {
                const resolve = this._pending.get(data.id);
                if (resolve) resolve(data.embedding ? new Float32Array(data.embedding) : null);
                break;
            }
            case 'EMBED_ERROR': {
                const resolve = this._pending.get(data.id);
                if (resolve) resolve(null);
                break;
            }
            case 'EMBED_TEXT_RESULT': {
                const resolve = this._pending.get(data.id);
                if (resolve) resolve(data.embedding ? new Float32Array(data.embedding) : null);
                break;
            }
            case 'EMBED_TEXT_ERROR': {
                const resolve = this._pending.get(data.id);
                if (resolve) resolve(null);
                break;
            }
        }
    }

    _teardown() {
        this._initToken++;
        if (this.worker) {
            try { this.worker.terminate(); } catch { /* ignore */ }
            this.worker = null;
        }
        this._readyPromise = null;
        // Resolve any in-flight embeds as null so awaiting callers don't hang.
        for (const resolve of this._pending.values()) resolve(null);
        this._pending.clear();
        // A model switch (the only teardown that changes the vector space) invalidates cached prompts.
        this._textCache.clear();
    }

    /** Tear down the worker and clear state (idempotent). */
    dispose() {
        this._teardown();
    }
}
