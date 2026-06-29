/**
 * Animated-GIF recorder — the GIF half of the Capture Studio's video export (WebM is the other
 * half, see {@link WebmRecorder}). Unlike `MediaRecorder`, GIF has no streaming browser API, so we
 * collect RGBA frames during the recording window and encode them on stop via `gifenc` (tiny, MIT,
 * worker-free). Memory is bounded by the caller through `maxFrames` + a capped capture resolution.
 */
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

export class GifRecorder {
    constructor() {
        /** @type {{data: Uint8Array, delay: number}[]} */
        this._frames = [];
        this._width = 0;
        this._height = 0;
        this._recording = false;
        this._maxFrames = Infinity;
    }

    /** GIF capture works wherever a 2D canvas exists; encoding is pure JS. */
    static isSupported() {
        return typeof document !== 'undefined';
    }

    get isRecording() {
        return this._recording;
    }

    get frameCount() {
        return this._frames.length;
    }

    /** Whether the frame buffer has reached the caller-imposed cap. */
    get isFull() {
        return this._frames.length >= this._maxFrames;
    }

    /**
     * Begin collecting frames at a fixed size.
     * @param {{width:number, height:number, maxFrames?:number}} opts
     */
    start({ width, height, maxFrames }) {
        if (this._recording) throw new Error('Already recording.');
        this._frames = [];
        this._width = Math.max(1, Math.round(width));
        this._height = Math.max(1, Math.round(height));
        this._maxFrames = Number.isFinite(maxFrames) && maxFrames > 0 ? maxFrames : Infinity;
        this._recording = true;
    }

    /**
     * Append one frame (a snapshot copy is taken, so the source ImageData can be reused).
     * @param {ImageData} imageData RGBA pixels at the recorder's width×height.
     * @param {number} delayMs Frame display duration in milliseconds.
     * @returns {boolean} false if not recording or already at capacity.
     */
    addFrame(imageData, delayMs) {
        if (!this._recording || this.isFull || !imageData) return false;
        this._frames.push({ data: new Uint8Array(imageData.data), delay: Math.max(10, Math.round(delayMs)) });
        return true;
    }

    /**
     * Encode the collected frames into a GIF blob, then reset. Yields to the event loop
     * periodically so a long encode doesn't freeze the UI.
     * @param {{onProgress?: (fraction:number)=>void}} [opts]
     * @returns {Promise<Blob>}
     */
    async encode({ onProgress } = {}) {
        const gif = GIFEncoder();
        const frames = this._frames;
        for (let i = 0; i < frames.length; i++) {
            const { data, delay } = frames[i];
            const palette = quantize(data, 256);
            const index = applyPalette(data, palette);
            gif.writeFrame(index, this._width, this._height, { palette, delay });
            if (onProgress) onProgress((i + 1) / Math.max(1, frames.length));
            if ((i & 3) === 3) await new Promise((r) => setTimeout(r, 0));
        }
        gif.finish();
        const blob = new Blob([gif.bytes()], { type: 'image/gif' });
        this.cancel();
        return blob;
    }

    /** Discard any collected frames and stop. */
    cancel() {
        this._frames = [];
        this._recording = false;
    }
}
