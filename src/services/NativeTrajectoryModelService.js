// @ts-check

import { EventBus, EVENTS } from './EventBus.js';
import { calibrateNativeReward } from '../core/analysis/NativeTrajectoryModelManifest.js';

export const NATIVE_MODEL_STATUS = Object.freeze({
    DISABLED: 'disabled',
    LOADING: 'loading',
    READY: 'ready',
    ERROR: 'error',
});

/** Resolve against Vite/GitHub Pages' current document base. */
function defaultManifestUrl() {
    if (typeof document !== 'undefined') return new URL('models/hexlife-interest/model.json', document.baseURI).href;
    return '/models/hexlife-interest/model.json';
}

export class NativeTrajectoryModelService {
    /**
     * @param {{enabled?: boolean, manifestUrl?: string, workerFactory?: () => Worker, timeoutMs?: number}} [options]
     */
    constructor(options = {}) {
        this.enabled = !!options.enabled;
        this.manifestUrl = options.manifestUrl || defaultManifestUrl();
        // Keep the literal new Worker(new URL(...)) shape: Vite recognizes it and emits the ONNX
        // runtime as a lazy worker chunk instead of adding it to the main application bundle.
        this.workerFactory = options.workerFactory || (() =>
            new Worker(new URL('../core/NativeTrajectoryModelWorker.js', import.meta.url), { type: 'module' })
        );
        this.timeoutMs = options.timeoutMs || 20000;
        /** @type {string} */
        this.status = this.enabled ? NATIVE_MODEL_STATUS.LOADING : NATIVE_MODEL_STATUS.DISABLED;
        /** @type {string|null} */
        this.message = null;
        /** @type {Worker|null} */
        this.worker = null;
        /** @type {Record<string, any>|null} */
        this.manifest = null;
        /** @type {string|null} */
        this.backend = null;
        /** @type {Promise<boolean>|null} */
        this._readyPromise = null;
        this._nextId = 1;
        /** @type {Map<number, {resolve: (value: {reward:number, rawReward:number, descriptor:Float32Array, modelId:string}) => void, reject: (error: Error) => void}>} */
        this._pending = new Map();
    }

    getStatus() {
        return {
            enabled: this.enabled,
            status: this.status,
            message: this.message,
            modelId: this.manifest?.modelId || null,
            backend: this.backend,
            acceptanceStatus: this.manifest?.acceptance?.status || null,
        };
    }

    _emitStatus() {
        EventBus.dispatch(EVENTS.NATIVE_MODEL_STATUS_CHANGED, this.getStatus());
    }

    /** @param {string} status @param {string|null} [message] */
    _setStatus(status, message = null) {
        this.status = status;
        this.message = message;
        this._emitStatus();
    }

    /** @param {boolean} enabled */
    setEnabled(enabled) {
        const next = !!enabled;
        if (next === this.enabled) return;
        this.enabled = next;
        if (!next) {
            this._dispose();
            this._setStatus(NATIVE_MODEL_STATUS.DISABLED);
        } else {
            this._setStatus(NATIVE_MODEL_STATUS.LOADING);
            this.ensureReady();
        }
    }

    async ensureReady() {
        if (!this.enabled) return false;
        if (this.status === NATIVE_MODEL_STATUS.READY && this.worker) return true;
        if (this._readyPromise) return this._readyPromise;
        if (!this.workerFactory) {
            this._setStatus(NATIVE_MODEL_STATUS.ERROR, 'Web Workers are unavailable.');
            return false;
        }
        this._setStatus(NATIVE_MODEL_STATUS.LOADING);
        let worker;
        try {
            worker = this.workerFactory();
        } catch (error) {
            this._setStatus(
                NATIVE_MODEL_STATUS.ERROR,
                error instanceof Error ? error.message : 'Native model worker failed to start.',
            );
            return false;
        }
        this.worker = worker;
        this._readyPromise = new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this._readyPromise = null;
                this._setStatus(NATIVE_MODEL_STATUS.ERROR, 'Native model load timed out.');
                this._dispose();
                resolve(false);
            }, this.timeoutMs);
            /** @param {boolean} ready */
            const finish = (ready) => {
                clearTimeout(timeout);
                this._readyPromise = null;
                resolve(ready);
            };
            worker.onmessage = (event) => {
                const data = event.data || {};
                if (data.type === 'READY') {
                    this.manifest = data.manifest;
                    this.backend = data.backend;
                    this._setStatus(NATIVE_MODEL_STATUS.READY);
                    finish(true);
                } else if (data.type === 'INIT_ERROR') {
                    this._setStatus(NATIVE_MODEL_STATUS.ERROR, data.error || 'Native model failed to load.');
                    this._dispose();
                    finish(false);
                } else {
                    this._handleEvaluationMessage(data);
                }
            };
            worker.onerror = () => {
                this._setStatus(NATIVE_MODEL_STATUS.ERROR, 'Native model worker failed.');
                this._dispose();
                finish(false);
            };
            worker.postMessage({ type: 'INIT', manifestUrl: this.manifestUrl });
        });
        return this._readyPromise;
    }

    /**
     * @param {{frames: Uint8Array[], rows: number, cols: number, tickOffsets: number[]}} trajectory
     * @param {{signal?: AbortSignal, timeoutMs?: number}} [options]
     * @returns {Promise<{reward: number, rawReward: number, descriptor: Float32Array, modelId: string}>}
     */
    async evaluate(trajectory, options = {}) {
        if (!this.enabled) throw new Error('Native trajectory model is disabled.');
        if (!await this.ensureReady() || !this.worker) throw new Error(this.message || 'Native trajectory model is unavailable.');
        const id = this._nextId++;
        const frameBuffers = trajectory.frames.map((frame) =>
            frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength)
        );
        return new Promise((resolve, reject) => {
            if (options.signal?.aborted) {
                reject(new DOMException('Native model inference was cancelled.', 'AbortError'));
                return;
            }
            const timeout = setTimeout(() => {
                this._pending.delete(id);
                options.signal?.removeEventListener('abort', abort);
                reject(new Error('Native model inference timed out.'));
            }, options.timeoutMs || this.timeoutMs);
            const abort = () => {
                this._pending.delete(id);
                clearTimeout(timeout);
                reject(new DOMException('Native model inference was cancelled.', 'AbortError'));
            };
            options.signal?.addEventListener('abort', abort, { once: true });
            this._pending.set(id, {
                /** @param {{reward:number, rawReward:number, descriptor:Float32Array, modelId:string}} value */
                resolve: (value) => {
                    clearTimeout(timeout);
                    options.signal?.removeEventListener('abort', abort);
                    resolve(value);
                },
                /** @param {Error} error */
                reject: (error) => {
                    clearTimeout(timeout);
                    options.signal?.removeEventListener('abort', abort);
                    reject(error);
                },
            });
            const worker = this.worker;
            if (!worker) {
                this._pending.delete(id);
                clearTimeout(timeout);
                options.signal?.removeEventListener('abort', abort);
                reject(new Error('Native trajectory model worker disappeared.'));
                return;
            }
            try {
                worker.postMessage({
                    type: 'EVALUATE',
                    id,
                    frames: frameBuffers,
                    rows: trajectory.rows,
                    cols: trajectory.cols,
                    tickOffsets: trajectory.tickOffsets,
                }, frameBuffers);
            } catch (error) {
                this._pending.delete(id);
                clearTimeout(timeout);
                options.signal?.removeEventListener('abort', abort);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    /** @param {any} data */
    _handleEvaluationMessage(data) {
        if (data.type !== 'EVALUATE_RESULT' && data.type !== 'EVALUATE_ERROR') return;
        const pending = this._pending.get(data.id);
        if (!pending) return;
        this._pending.delete(data.id);
        if (data.type === 'EVALUATE_ERROR') {
            pending.reject(new Error(data.error || 'Native model inference failed.'));
        } else {
            const rawReward = Number(data.reward);
            if (!Number.isFinite(rawReward) || !(data.descriptor instanceof ArrayBuffer)) {
                pending.reject(new Error('Native model returned an invalid result.'));
                return;
            }
            const descriptor = new Float32Array(data.descriptor);
            if (descriptor.length !== 32 || descriptor.some((value) => !Number.isFinite(value))) {
                pending.reject(new Error('Native model returned an invalid descriptor.'));
                return;
            }
            pending.resolve({
                reward: calibrateNativeReward(rawReward, this.manifest?.rewardCalibration),
                rawReward,
                descriptor,
                modelId: String(data.modelId || this.manifest?.modelId || 'unknown'),
            });
        }
    }

    _dispose() {
        if (this.worker) this.worker.terminate();
        this.worker = null;
        this.manifest = null;
        this.backend = null;
        for (const pending of this._pending.values()) pending.reject(new Error('Native model was unloaded.'));
        this._pending.clear();
    }
}
