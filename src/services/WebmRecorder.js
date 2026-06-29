/**
 * WebM canvas recorder — the animated half of the media-export flagship (the PNG half lives in
 * the renderer + Application). Wraps a `MediaRecorder` around `canvas.captureStream()` so a user can
 * record the live HexLife canvas to a downloadable .webm clip. Browser-API heavy by nature; the only
 * pure seam (mime-type negotiation) is extracted as {@link pickWebmMimeType} for unit testing.
 */

/** Candidate WebM codecs, best→worst. VP9 is smallest/sharpest where supported. */
const WEBM_MIME_CANDIDATES = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
];

/**
 * Pick the best supported WebM mime type. Pure — takes the support predicate so it can be tested
 * without a real `MediaRecorder`.
 * @param {(type: string) => boolean} isTypeSupported Usually `MediaRecorder.isTypeSupported`.
 * @returns {string} The first supported candidate, or `''` if none (let the recorder pick a default).
 */
export function pickWebmMimeType(isTypeSupported) {
    if (typeof isTypeSupported !== 'function') return '';
    for (const candidate of WEBM_MIME_CANDIDATES) {
        try {
            if (isTypeSupported(candidate)) return candidate;
        } catch { /* some engines throw on odd strings — treat as unsupported */ }
    }
    return '';
}

export class WebmRecorder {
    constructor() {
        /** @type {MediaRecorder|null} */
        this._recorder = null;
        /** @type {Blob[]} */
        this._chunks = [];
        this._mimeType = '';
    }

    /** Whether WebM recording is possible in this environment. */
    static isSupported() {
        return typeof MediaRecorder !== 'undefined'
            && typeof HTMLCanvasElement !== 'undefined'
            && typeof HTMLCanvasElement.prototype.captureStream === 'function';
    }

    get isRecording() {
        return !!this._recorder && (this._recorder.state === 'recording' || this._recorder.state === 'paused');
    }

    get isPaused() {
        return !!this._recorder && this._recorder.state === 'paused';
    }

    /** Pause encoding without ending the clip (MediaRecorder keeps the chunks accumulated so far). */
    pause() {
        if (this._recorder && this._recorder.state === 'recording') this._recorder.pause();
    }

    /** Resume a paused recording. */
    resume() {
        if (this._recorder && this._recorder.state === 'paused') this._recorder.resume();
    }

    /**
     * Begin recording the given canvas.
     * @param {HTMLCanvasElement} canvas The render canvas (live or an offscreen capture canvas).
     * @param {{fps?: number, videoBitsPerSecond?: number}} [opts] Capture frame rate (default 30)
     *   and optional target bitrate (quality). Omitting the bitrate lets the encoder choose.
     * @throws if unsupported, already recording, or the stream/recorder cannot be created.
     */
    start(canvas, { fps = 30, videoBitsPerSecond } = {}) {
        if (this.isRecording) throw new Error('Already recording.');
        if (!WebmRecorder.isSupported()) throw new Error('Recording is not supported in this browser.');
        if (!canvas || typeof canvas.captureStream !== 'function') throw new Error('Canvas is not capturable.');

        const stream = canvas.captureStream(fps);
        this._mimeType = pickWebmMimeType(MediaRecorder.isTypeSupported);
        const options = {};
        if (this._mimeType) options.mimeType = this._mimeType;
        if (Number.isFinite(videoBitsPerSecond) && videoBitsPerSecond > 0) {
            options.videoBitsPerSecond = videoBitsPerSecond;
        }
        this._recorder = new MediaRecorder(stream, options);
        this._chunks = [];
        this._recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) this._chunks.push(e.data);
        };
        this._recorder.start();
    }

    /**
     * Stop recording and resolve the assembled WebM blob.
     * @returns {Promise<Blob>} resolves with the recorded clip (rejects if not recording or on error).
     */
    stop() {
        return new Promise((resolve, reject) => {
            const recorder = this._recorder;
            if (!recorder || recorder.state === 'inactive') {
                reject(new Error('Not recording.'));
                return;
            }
            recorder.onerror = (e) => {
                this._recorder = null;
                reject(e?.error || new Error('Recording failed.'));
            };
            recorder.onstop = () => {
                const blob = new Blob(this._chunks, { type: this._mimeType || 'video/webm' });
                this._chunks = [];
                this._recorder = null;
                resolve(blob);
            };
            recorder.stop();
        });
    }
}
