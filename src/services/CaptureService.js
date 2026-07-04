/**
 * CaptureService — orchestrates the Capture Studio: configurable stills (PNG/JPEG) and recordings
 * (WebM/animated GIF) of either the selected world or the full as-seen canvas, at an arbitrary
 * resolution. The pixel work lives in the renderer's 2D compositor (`composeCaptureFrame` /
 * `captureSourceToBlob`); this service owns option resolution, the recording lifecycle (an offscreen
 * capture canvas + its own rAF loop), download, toasts, progress events, and settings persistence.
 *
 * Pure, side-effect-free seams are exported for unit testing: {@link buildCaptureFilename},
 * {@link resolvePresetDimensions}, {@link clampGifDimensions}, {@link webmBitrate},
 * {@link estimateGifBudget}.
 */
import { EventBus, EVENTS } from './EventBus.js';
import * as Renderer from '../rendering/renderer.js';
import { rulesetName, unpackCellsInto } from '../utils/utils.js';
import { WebmRecorder } from './WebmRecorder.js';
import { GifRecorder } from './GifRecorder.js';
import * as PersistenceService from './PersistenceService.js';

const SETTINGS_KEY = 'captureStudio';
const GIF_MAX_EDGE = 600;        // GIF frames are held in memory, so cap the resolution.
const GIF_MAX_FRAMES = 300;      // hard upper bound on banked frames regardless of fps × duration.
const GIF_MIN_FRAME_DELAY_MS = 20; // GIF decoders clamp shorter delays way up (to ~100ms), not down.
const RUN_MAX_FRAMES = 600;      // hard cap on a composed perfect-run GIF (transient + cycle × repeats).
const RUN_MAX_CYCLE_REPEATS = 10;

/** Default Capture Studio options (also the persistence shape). */
export const CAPTURE_DEFAULTS = {
    tab: 'screenshot',
    source: 'selected',          // 'selected' | 'canvas'
    stillPreset: 'native',
    stillFormat: 'png',          // 'png' | 'jpeg'
    stillQuality: 0.92,
    videoPreset: '720',
    videoFormat: 'webm',         // 'webm' | 'gif'
    fps: 30,
    videoQuality: 0.7,           // 0..1, maps to WebM bitrate
    maxDurationSec: 15,
    cycleDurationSec: 2,         // total loop length for the perfect-loop cycle GIF export
    runCycleRepeats: 3,          // perfect-run: how many times to repeat the detected cycle
    runMaxFrames: 300,           // perfect-run: frame cap when no cycle is ever detected
    useCustom: false,
    customWidth: 1280,
    customHeight: 1280,
};

/** Resolution presets offered per source (square for a single world, aspect-matched for the canvas). */
export const STILL_PRESETS = {
    selected: [
        { id: '512', label: '512²' },
        { id: '1024', label: '1024²' },
        { id: 'native', label: 'Native (1280²)' },
        { id: '2048', label: '2048²' },
        { id: '4096', label: '4096²' },
    ],
    canvas: [
        { id: '480', label: '480p' },
        { id: '720', label: '720p' },
        { id: '1080', label: '1080p' },
        { id: '1440', label: '1440p' },
        { id: 'native', label: 'Native (on-screen)' },
    ],
};

/** Video presets are a touch more conservative (GIF dims are clamped further at record time). */
export const VIDEO_PRESETS = {
    selected: [
        { id: '512', label: '512²' },
        { id: '720s', label: '720²' },
        { id: 'native', label: 'Native (1280²)' },
    ],
    canvas: [
        { id: '480', label: '480p' },
        { id: '720', label: '720p' },
        { id: '1080', label: '1080p' },
        { id: 'native', label: 'Native (on-screen)' },
    ],
};

// --- Pure helpers (unit-tested) --------------------------------------------

/** Build a download filename: `hexlife-<ruleset slug>-t<tick>.<ext>`, whitespace collapsed to dashes. */
export function buildCaptureFilename(name, tick, ext) {
    const slug = String(name ?? 'world');
    const t = Number.isFinite(tick) ? tick : 0;
    return `hexlife-${slug}-t${t}.${ext}`.replace(/\s+/g, '-');
}

/**
 * Resolve a preset id to concrete pixel dimensions.
 * @param {string} preset Preset id (square ids like '512'/'native' for the selected source;
 *   height-based ids like '720'/'native' for the canvas source).
 * @param {{source:'selected'|'canvas', liveWidth?:number, liveHeight?:number}} ctx
 * @returns {{width:number, height:number}}
 */
export function resolvePresetDimensions(preset, { source, liveWidth, liveHeight } = {}) {
    if (source === 'selected') {
        const map = { '512': 512, '1024': 1024, '720s': 720, native: 1280, '2048': 2048, '4096': 4096 };
        const s = map[preset] || 1280;
        return { width: s, height: s };
    }
    // canvas — aspect-matched
    const lw = Math.round(liveWidth) || 1280;
    const lh = Math.round(liveHeight) || 720;
    if (preset === 'native') return { width: lw, height: lh };
    const aspect = lh ? lw / lh : 16 / 9;
    const heights = { '480': 480, '720': 720, '1080': 1080, '1440': 1440 };
    const h = heights[preset] || 720;
    return { width: Math.max(1, Math.round(h * aspect)), height: h };
}

/** Clamp dimensions so the longest edge is ≤ maxEdge, preserving aspect (used to bound GIF memory). */
export function clampGifDimensions(width, height, maxEdge = GIF_MAX_EDGE) {
    const m = Math.max(width, height);
    if (m <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
    const s = maxEdge / m;
    return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/** Map (resolution, fps, quality 0..1) to a WebM target bitrate in bits/sec. */
export function webmBitrate(width, height, fps, quality) {
    const q = Math.min(1, Math.max(0, quality));
    const bitsPerPixel = 0.05 + q * 0.20; // ~0.05 (small files) .. 0.25 (crisp)
    return Math.max(250_000, Math.round(width * height * fps * bitsPerPixel));
}

/**
 * Per-frame delay for a perfect-loop cycle GIF: the user picks the total loop duration and each of
 * the cycle's frames gets an equal share, floored at the minimum delay GIF decoders honor (shorter
 * delays get clamped UP to ~100ms by browsers, wrecking the loop). Returns the effective total so
 * the UI can report when the floor stretched the requested duration.
 * @param {number} cycleLength Number of frames in the detected cycle.
 * @param {number} totalDurationSec Requested duration of one full loop, in seconds.
 * @returns {{delayMs: number, effectiveTotalMs: number}}
 */
export function cycleGifTiming(cycleLength, totalDurationSec) {
    const n = Math.max(1, Math.round(cycleLength || 1));
    const requestedMs = Math.max(0, (totalDurationSec || 0) * 1000);
    const delayMs = Math.max(GIF_MIN_FRAME_DELAY_MS, requestedMs / n);
    return { delayMs, effectiveTotalMs: delayMs * n };
}

/**
 * Per-frame GIF delay for a fixed playback rate (the perfect-run recorder plays every recorded state
 * at this cadence). Floored at the minimum delay GIF decoders honor.
 * @param {number} fps Target frames per second (clamped 1..60).
 * @returns {number} delay in milliseconds
 */
export function perFrameDelayMs(fps) {
    const f = Math.min(60, Math.max(1, Math.round(fps || 20)));
    return Math.max(GIF_MIN_FRAME_DELAY_MS, Math.round(1000 / f));
}

/**
 * Compose a perfect-run GIF frame list from the worker's banked trajectory: the transient frames
 * (initial state → cycle entry) followed by the detected cycle repeated `repeats` times. When no
 * cycle was found the transient IS the whole recording (no repetition). Truncated to `maxFrames` to
 * bound memory / encode time; reports whether truncation happened.
 * @param {{state:Uint8Array, rules:Uint8Array}[]} transient
 * @param {{state:Uint8Array, rules:Uint8Array}[]} cycle
 * @param {number} repeats
 * @param {number} maxFrames
 * @returns {{frames: object[], truncated: boolean}}
 */
export function composeRunFrames(transient, cycle, repeats, maxFrames = RUN_MAX_FRAMES) {
    const t = Array.isArray(transient) ? transient : [];
    const c = Array.isArray(cycle) ? cycle : [];
    const reps = Math.min(RUN_MAX_CYCLE_REPEATS, Math.max(1, Math.round(repeats || 1)));
    const frames = [...t];
    for (let r = 0; c.length > 0 && r < reps; r++) frames.push(...c);
    const cap = Math.max(1, Math.round(maxFrames || RUN_MAX_FRAMES));
    const truncated = frames.length > cap;
    return { frames: truncated ? frames.slice(0, cap) : frames, truncated };
}

/** Rough GIF budget for the UI: frame count and an approximate encoded size. */
export function estimateGifBudget(width, height, fps, seconds) {
    const frames = Math.min(GIF_MAX_FRAMES, Math.max(1, Math.round(fps * seconds)));
    const approxBytes = Math.round(frames * width * height * 0.4); // crude post-quantize estimate
    return { frames, approxBytes };
}

/** Human-readable byte size for HUD/budget labels. */
export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

// --- Service ----------------------------------------------------------------

export class CaptureService {
    constructor(appContext) {
        this.appContext = appContext;
        this.webmRecorder = new WebmRecorder();
        this.gifRecorder = new GifRecorder();

        this._recordCanvas = null;
        this._recordCtx = null;
        this._recState = null;     // active recording descriptor or null
        this._rafId = 0;
        this._lastProgressDispatch = 0;

        EventBus.subscribe(EVENTS.COMMAND_EXPORT_WORLD_PNG, this._handleQuickPng);
        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_WORLD_RECORDING, this._handleToggleRecording);
        EventBus.subscribe(EVENTS.COMMAND_QUICK_TOGGLE_RECORDING, this._handleQuickToggleRecording);
        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_RECORDING_PAUSE, this.togglePause);
    }

    get isRecording() {
        return !!this._recState;
    }

    get isPaused() {
        return !!this._recState && this._recState.paused;
    }

    // ---- Settings persistence ----
    loadSettings() {
        const saved = PersistenceService.loadUISetting(SETTINGS_KEY, null);
        return { ...CAPTURE_DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
    }

    saveSettings(settings) {
        PersistenceService.saveUISetting(SETTINGS_KEY, { ...CAPTURE_DEFAULTS, ...settings });
    }

    // ---- Stills ----
    /**
     * Capture and download a single image.
     * @param {{source:'selected'|'canvas', width:number, height:number, format:'png'|'jpeg', quality?:number}} opts
     */
    async captureStill(opts) {
        const wm = this.appContext.worldManager;
        const selectedIndex = wm.getSelectedWorldIndex();
        try {
            const blobP = Renderer.captureSourceToBlob({
                source: opts.source,
                width: opts.width,
                height: opts.height,
                selectedIndex,
                format: opts.format,
                quality: opts.quality,
            });
            const blob = blobP && (await blobP);
            if (!blob) {
                this._toast('Could not capture image.', 'error');
                return false;
            }
            const ext = opts.format === 'jpeg' ? 'jpg' : 'png';
            this._downloadBlob(blob, this._filename(ext));
            this._toast(`Saved ${ext.toUpperCase()} (${opts.width}×${opts.height}).`, 'success');
            return true;
        } catch (err) {
            console.error('Still capture failed:', err);
            this._toast('Could not capture image.', 'error');
            return false;
        }
    }

    // ---- Recording ----
    /**
     * Start recording. Builds an offscreen capture canvas at the target resolution and runs its own
     * rAF loop that composes the chosen source each frame (the main loop keeps the FBOs current).
     * @param {{source:'selected'|'canvas', width:number, height:number, format:'webm'|'gif',
     *   fps:number, quality?:number, maxDurationSec?:number}} opts
     */
    startRecording(opts) {
        if (this.isRecording) return false;

        const format = opts.format === 'gif' ? 'gif' : 'webm';
        const fps = Math.min(60, Math.max(1, Math.round(opts.fps || 30)));
        const maxDurationSec = Math.min(120, Math.max(1, Math.round(opts.maxDurationSec || 15)));
        let { width, height } = opts;

        if (format === 'gif') {
            ({ width, height } = clampGifDimensions(width, height));
        }
        width = Math.max(1, Math.round(width));
        height = Math.max(1, Math.round(height));

        if (format === 'webm' && !WebmRecorder.isSupported()) {
            this._toast('WebM recording is not supported in this browser.', 'error');
            return false;
        }

        this._recordCanvas = document.createElement('canvas');
        this._recordCanvas.width = width;
        this._recordCanvas.height = height;
        this._recordCtx = this._recordCanvas.getContext('2d');
        if (!this._recordCtx) {
            this._toast('Could not start recording.', 'error');
            this._teardownRecording();
            return false;
        }

        const startTime = (typeof performance !== 'undefined' ? performance.now() : 0);
        this._recState = {
            format, fps, width, height, source: opts.source, startTime,
            frameIntervalMs: 1000 / fps,
            maxDurationMs: maxDurationSec * 1000,
            qualityBitrate: webmBitrate(width, height, fps, opts.quality ?? 0.7),
            // Pause bookkeeping: only un-paused time counts toward elapsed / GIF cadence.
            paused: false,
            pausedAccumMs: 0,
            pauseStartedAt: 0,
        };

        try {
            if (format === 'webm') {
                this.webmRecorder.start(this._recordCanvas, { fps, videoBitsPerSecond: this._recState.qualityBitrate });
            } else {
                const maxFrames = estimateGifBudget(width, height, fps, maxDurationSec).frames;
                this.gifRecorder.start({ width, height, maxFrames });
            }
        } catch (err) {
            console.error('Recording start failed:', err);
            this._toast('Could not start recording.', 'error');
            this._teardownRecording();
            return false;
        }

        EventBus.dispatch(EVENTS.WORLD_RECORDING_STATE_CHANGED, { recording: true });
        this._rafId = requestAnimationFrame(this._tick);
        const hint = this.appContext.simulationController?.getIsPaused()
            ? 'Recording started — press play to capture motion. (V to stop, Shift+V to pause)'
            : 'Recording… (V to stop, Shift+V to pause)';
        this._toast(hint, 'info');
        return true;
    }

    /** Effective recorded time, excluding any paused spans. */
    _effectiveElapsed(now) {
        const st = this._recState;
        if (!st) return 0;
        let e = now - st.startTime - st.pausedAccumMs;
        if (st.paused) e -= (now - st.pauseStartedAt);
        return Math.max(0, e);
    }

    _tick = () => {
        const st = this._recState;
        if (!st) return;
        const now = (typeof performance !== 'undefined' ? performance.now() : 0);
        const elapsedMs = this._effectiveElapsed(now);

        // Auto-stop at the max length (un-paused time only).
        if (elapsedMs >= st.maxDurationMs) { this.stopRecording(); return; }

        if (!st.paused) {
            const selectedIndex = this.appContext.worldManager.getSelectedWorldIndex();
            if (st.format === 'webm') {
                // The MediaRecorder stream samples the canvas at fps; just keep it current.
                Renderer.composeCaptureFrame(this._recordCtx, { source: st.source, width: st.width, height: st.height, selectedIndex });
            } else {
                // GIF: sample by frame index against effective time, so pauses don't leave gaps.
                const targetFrames = Math.floor(elapsedMs / st.frameIntervalMs) + 1;
                while (this.gifRecorder.frameCount < targetFrames && !this.gifRecorder.isFull) {
                    Renderer.composeCaptureFrame(this._recordCtx, { source: st.source, width: st.width, height: st.height, selectedIndex });
                    const img = this._recordCtx.getImageData(0, 0, st.width, st.height);
                    this.gifRecorder.addFrame(img, st.frameIntervalMs);
                }
                if (this.gifRecorder.isFull) { this.stopRecording(); return; }
            }
        }

        // Throttled progress for the HUD (~4×/sec).
        if (now - this._lastProgressDispatch > 250) {
            this._lastProgressDispatch = now;
            this._dispatchProgress(elapsedMs);
        }

        this._rafId = requestAnimationFrame(this._tick);
    };

    _dispatchProgress(elapsedMs) {
        const st = this._recState;
        if (!st) return;
        const estBytes = st.format === 'gif'
            ? estimateGifBudget(st.width, st.height, st.fps, elapsedMs / 1000).approxBytes
            : Math.round((st.qualityBitrate / 8) * (elapsedMs / 1000));
        EventBus.dispatch(EVENTS.CAPTURE_RECORDING_PROGRESS, {
            elapsedMs,
            frames: st.format === 'gif' ? this.gifRecorder.frameCount : null,
            format: st.format,
            estBytes,
            paused: st.paused,
        });
    }

    /** Pause the active recording (no-op if idle or already paused). */
    pauseRecording() {
        const st = this._recState;
        if (!st || st.paused) return false;
        st.paused = true;
        st.pauseStartedAt = (typeof performance !== 'undefined' ? performance.now() : 0);
        if (st.format === 'webm') this.webmRecorder.pause();
        this._dispatchProgress(this._effectiveElapsed(st.pauseStartedAt));
        this._toast('Recording paused.', 'info');
        return true;
    }

    /** Resume a paused recording. */
    resumeRecording() {
        const st = this._recState;
        if (!st || !st.paused) return false;
        const now = (typeof performance !== 'undefined' ? performance.now() : 0);
        st.pausedAccumMs += now - st.pauseStartedAt;
        st.paused = false;
        if (st.format === 'webm') this.webmRecorder.resume();
        this._dispatchProgress(this._effectiveElapsed(now));
        this._toast('Recording resumed.', 'info');
        return true;
    }

    /** Toggle pause/resume. */
    togglePause = () => {
        if (!this._recState) return;
        if (this._recState.paused) this.resumeRecording();
        else this.pauseRecording();
    };

    /** Stop recording, finalize the file, and download it. */
    async stopRecording() {
        const st = this._recState;
        if (!st) return false;
        // Freeze the loop immediately so no further frames are collected.
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._rafId = 0;
        this._recState = null;
        EventBus.dispatch(EVENTS.WORLD_RECORDING_STATE_CHANGED, { recording: false });

        try {
            if (st.format === 'webm') {
                const blob = await this.webmRecorder.stop();
                if (!blob || blob.size === 0) {
                    this._toast('Recording was empty.', 'error');
                } else {
                    this._downloadBlob(blob, this._filename('webm'));
                    this._toast('Saved WebM recording.', 'success');
                }
            } else {
                if (this.gifRecorder.frameCount === 0) {
                    this.gifRecorder.cancel();
                    this._toast('Recording was empty.', 'error');
                } else {
                    this._toast('Encoding GIF…', 'info');
                    const blob = await this.gifRecorder.encode();
                    this._downloadBlob(blob, this._filename('gif'));
                    this._toast('Saved animated GIF.', 'success');
                }
            }
        } catch (err) {
            console.error('Recording stop/encode failed:', err);
            this._toast('Could not save recording.', 'error');
        } finally {
            this._teardownRecording();
        }
        return true;
    }

    _teardownRecording() {
        this._recState = null;
        this._recordCanvas = null;
        this._recordCtx = null;
        this._rafId = 0;
    }

    // ---- Frame-exact GIF baking (cycle export + perfect-run recording) ----
    get isExportingCycle() {
        return !!this._cycleExportBusy;
    }

    get isRunRecording() {
        return !!this._runRec;
    }

    /** Two-rAF settle: lets the main render loop redraw a dirty world FBO before an FBO readback. */
    _twoRafs() {
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }

    /**
     * Render an ordered list of worker frames (bit-packed state + rule indices each) into a GIF blob
     * by borrowing world `idx`'s main-thread display buffers one frame at a time: snapshot → write →
     * redraw the FBO at the live camera (exact on-screen zoom) → FBO readback → restore. The worker
     * simulation state is never touched. Caller is responsible for pausing the sim first so live
     * STATE_UPDATEs don't overwrite the borrowed buffers mid-bake.
     * @param {number} idx selected world index
     * @param {{state:Uint8Array, rules:Uint8Array}[]} frames
     * @param {number} delayMs per-frame display duration
     * @param {{width:number, height:number}} dims
     * @returns {Promise<Blob|null>}
     */
    async _renderFramesToGifBlob(idx, frames, delayMs, dims) {
        const proxy = this.appContext.worldManager.worlds?.[idx];
        if (!proxy || !proxy.latestStateArray || !proxy.latestRuleIndexArray) return null;
        const canvas = document.createElement('canvas');
        canvas.width = dims.width;
        canvas.height = dims.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        // Copies, not views — the backing buffers rejoin the worker's reclaim traffic on resume.
        const snapshot = { state: new Uint8Array(proxy.latestStateArray), rules: new Uint8Array(proxy.latestRuleIndexArray) };
        const recorder = new GifRecorder();
        try {
            recorder.start({ width: dims.width, height: dims.height, maxFrames: frames.length });
            for (const frame of frames) {
                // Re-read the arrays each iteration: a straggler STATE_UPDATE may have swapped them.
                unpackCellsInto(frame.state, proxy.latestStateArray, proxy.latestStateArray.length);
                proxy.latestRuleIndexArray.set(frame.rules);
                proxy.renderDirty = true;
                await this._twoRafs();
                Renderer.composeCaptureFrame(ctx, { source: 'selected', width: dims.width, height: dims.height, selectedIndex: idx });
                recorder.addFrame(ctx.getImageData(0, 0, dims.width, dims.height), delayMs);
            }
            return await recorder.encode();
        } finally {
            recorder.cancel();
            // Put the borrowed display buffers back before handing control to the live stream again.
            if (proxy.latestStateArray && proxy.latestRuleIndexArray) {
                proxy.latestStateArray.set(snapshot.state);
                proxy.latestRuleIndexArray.set(snapshot.rules);
                proxy.renderDirty = true;
            }
        }
    }

    /**
     * Export the selected world's detected cycle as a frame-exact, perfectly-looping GIF: one GIF
     * frame per cycle frame (a period-12 cycle → a 12-frame GIF), each shown for an equal share of
     * the requested total loop duration. Frames come straight from the worker's cycle-playback bank
     * (`GET_CYCLE_FRAMES`) — not from timed screen sampling — so the loop seam is exact.
     * @param {{width:number, height:number, totalDurationSec:number}} opts
     * @returns {Promise<boolean>}
     */
    async exportCycleGif({ width, height, totalDurationSec } = {}) {
        if (this.isRecording || this._cycleExportBusy || this._runRec) {
            this._toast('Finish the current capture first.', 'error');
            return false;
        }
        const wm = this.appContext.worldManager;
        if (wm.autoExploreService?.isRunning?.()) {
            this._toast('Stop Auto-Explore before exporting a cycle GIF.', 'error');
            return false;
        }
        const idx = wm.getSelectedWorldIndex();
        const proxy = wm.worlds?.[idx];
        const stats = proxy?.getLatestStats?.();
        if (!proxy || !stats?.isInCycle || !(stats.cycleLength > 0)) {
            this._toast('No cycle detected on the selected world.', 'error');
            return false;
        }

        const dims = clampGifDimensions(Math.max(1, Math.round(width || 0) || 1280), Math.max(1, Math.round(height || 0) || 1280));
        this._cycleExportBusy = true;
        const sim = this.appContext.simulationController;
        const wasPaused = sim ? sim.getIsPaused() : true;
        try {
            // Freeze the STATE_UPDATE stream so the buffers we borrow stay put, then let any in-flight
            // update land before we read the cycle.
            if (!wasPaused) EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, true);
            await this._twoRafs();

            const frames = await proxy.getCycleFrames();
            if (!frames || frames.length === 0) {
                this._toast('The cycle dissolved before it could be captured.', 'error');
                return false;
            }
            if (frames.length > GIF_MAX_FRAMES) {
                this._toast(`Cycle too long to export (${frames.length} frames, max ${GIF_MAX_FRAMES}).`, 'error');
                return false;
            }
            const { delayMs } = cycleGifTiming(frames.length, totalDurationSec);
            this._toast(`Capturing cycle (${frames.length} frames)…`, 'info');
            const blob = await this._renderFramesToGifBlob(idx, frames, delayMs, dims);
            if (!blob) {
                this._toast('Could not capture the cycle.', 'error');
                return false;
            }
            const hex = wm.getCurrentRulesetHex();
            const tick = wm.getSelectedWorldStats().tick || 0;
            this._downloadBlob(blob, buildCaptureFilename(`${rulesetName(hex)}-cycle${frames.length}`, tick, 'gif'));
            this._toast(`Saved perfect-loop GIF (${frames.length} frames).`, 'success');
            return true;
        } catch (err) {
            console.error('Cycle GIF export failed:', err);
            this._toast('Could not export the cycle GIF.', 'error');
            return false;
        } finally {
            if (!wasPaused) EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, false);
            this._cycleExportBusy = false;
        }
    }

    /**
     * Arm a "perfect run" recording of the selected world: pause at the current (initial) state, then
     * — the moment the user presses Play — bank EVERY tick's exact state until the run falls into a
     * cycle (then repeat that cycle `cycleRepeats` times) or hits `maxFrames` without one, and bake a
     * GIF. Frames are the worker's exact trajectory (`START_RUN_RECORDING`), not timed screen samples,
     * so nothing is missed no matter the sim speed; they're rendered at the live camera (exact zoom).
     * Resolves once the GIF is saved (or the recording is cancelled). The recording HUD (V / its Stop
     * button) drives an early stop.
     * @param {{width:number, height:number, maxFrames:number, cycleRepeats:number, fps:number}} opts
     * @returns {Promise<boolean>}
     */
    async armRunRecording({ width, height, maxFrames, cycleRepeats, fps } = {}) {
        if (this.isRecording || this._cycleExportBusy || this._runRec) {
            this._toast('Finish the current capture first.', 'error');
            return false;
        }
        const wm = this.appContext.worldManager;
        if (wm.autoExploreService?.isRunning?.()) {
            this._toast('Stop Auto-Explore before recording a run.', 'error');
            return false;
        }
        const idx = wm.getSelectedWorldIndex();
        const proxy = wm.worlds?.[idx];
        if (!proxy) {
            this._toast('No selected world to record.', 'error');
            return false;
        }

        const dims = clampGifDimensions(Math.max(1, Math.round(width || 0) || 1280), Math.max(1, Math.round(height || 0) || 1280));
        const cap = Math.min(RUN_MAX_FRAMES, Math.max(1, Math.round(maxFrames || 300)));
        const repeats = Math.min(RUN_MAX_CYCLE_REPEATS, Math.max(1, Math.round(cycleRepeats || 3)));
        const delayMs = perFrameDelayMs(fps || 20);

        // Start paused at the current (initial) state; the user presses Play to run it.
        const sim = this.appContext.simulationController;
        if (sim && !sim.getIsPaused()) EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, true);

        this._runRec = { idx, dims, repeats, delayMs, frames: 0 };
        EventBus.dispatch(EVENTS.WORLD_RECORDING_STATE_CHANGED, { recording: true, mode: 'run' });
        this._toast('Run recording armed — press Play to record from the current state.', 'info');

        let result;
        try {
            result = await proxy.startRunRecording(cap, (frames) => {
                if (!this._runRec) return;
                this._runRec.frames = frames;
                EventBus.dispatch(EVENTS.CAPTURE_RECORDING_PROGRESS, { mode: 'run', frames, format: 'gif', elapsedMs: 0, estBytes: 0, paused: false });
            });
        } catch (err) {
            console.error('Run recording failed:', err);
            this._toast('Run recording failed.', 'error');
            this._runRec = null;
            EventBus.dispatch(EVENTS.WORLD_RECORDING_STATE_CHANGED, { recording: false });
            return false;
        }
        return this._bakeRunRecording(result);
    }

    /** Finish a run recording: compose transient + cycle × repeats and bake the GIF. */
    async _bakeRunRecording(result) {
        const ctx = this._runRec;
        this._runRec = null;
        const done = () => EventBus.dispatch(EVENTS.WORLD_RECORDING_STATE_CHANGED, { recording: false });
        if (!ctx || !result || result.cancelled) {
            this._toast('Run recording cancelled.', 'info');
            done();
            return false;
        }

        const { idx, dims, repeats, delayMs } = ctx;
        const { frames, truncated } = composeRunFrames(result.transient, result.cycle, repeats, RUN_MAX_FRAMES);
        if (frames.length === 0) {
            this._toast('Nothing was recorded.', 'error');
            done();
            return false;
        }

        const wm = this.appContext.worldManager;
        const sim = this.appContext.simulationController;
        const wasPaused = sim ? sim.getIsPaused() : true;
        this._cycleExportBusy = true; // lock other captures during the bake
        try {
            if (!wasPaused) EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, true);
            await this._twoRafs();
            this._toast(`Rendering run (${frames.length} frames)…`, 'info');
            const blob = await this._renderFramesToGifBlob(idx, frames, delayMs, dims);
            if (!blob) {
                this._toast('Could not render the run.', 'error');
                return false;
            }
            const hex = wm.getCurrentRulesetHex();
            const tick = wm.getSelectedWorldStats().tick || 0;
            const tag = result.cappedWithoutCycle ? `run${frames.length}` : `run-loop${result.cycleLength}`;
            this._downloadBlob(blob, buildCaptureFilename(`${rulesetName(hex)}-${tag}`, tick, 'gif'));
            const how = result.cappedWithoutCycle
                ? `${frames.length} frames, no cycle found`
                : `cycle ×${repeats}`;
            this._toast(`Saved run GIF (${how}${truncated ? ', truncated' : ''}).`, 'success');
            return true;
        } catch (err) {
            console.error('Run GIF bake failed:', err);
            this._toast('Could not render the run.', 'error');
            return false;
        } finally {
            this._cycleExportBusy = false;
            if (!wasPaused) EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, false);
            done();
        }
    }

    /** Finish an armed run recording early (HUD Stop) — bakes whatever's been captured so far. */
    stopRunRecording() {
        if (!this._runRec) return false;
        const proxy = this.appContext.worldManager.worlds?.[this._runRec.idx];
        proxy?.stopRunRecording();
        return true;
    }

    /** Stop whichever capture is active (used by the shared HUD Stop button). */
    stopActive = () => {
        if (this._runRec) this.stopRunRecording();
        else if (this.isRecording) this.stopRecording();
    };

    /**
     * Resolve concrete dimensions from a saved settings object (used by quick-record so the hotkey
     * needs no modal). Mirrors the modal's `_currentDims`.
     */
    _dimsFromSettings(s) {
        if (s.useCustom) {
            const clamp = (v) => Math.min(8192, Math.max(16, Math.round(Number(v) || 0)));
            return { width: clamp(s.customWidth), height: clamp(s.customHeight) };
        }
        const live = Renderer.getCanvasElement && Renderer.getCanvasElement();
        return resolvePresetDimensions(s.videoPreset, {
            source: s.source,
            liveWidth: live ? live.width : undefined,
            liveHeight: live ? live.height : undefined,
        });
    }

    /** Start recording immediately from the last-used (persisted) settings — no modal. */
    quickStartRecording() {
        const s = this.loadSettings();
        const { width, height } = this._dimsFromSettings(s);
        return this.startRecording({
            source: s.source,
            width, height,
            format: s.videoFormat,
            fps: s.fps,
            quality: s.videoQuality,
            maxDurationSec: s.maxDurationSec,
        });
    }

    // ---- Legacy command shortcuts ----
    _handleQuickPng = () => {
        this.captureStill({ source: 'selected', width: 1280, height: 1280, format: 'png', quality: 1 });
    };

    _handleToggleRecording = () => {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_CAPTURE_STUDIO, { tab: 'video' });
        }
    };

    // Hotkey path: stop if recording, otherwise start immediately with last-used settings (no modal).
    _handleQuickToggleRecording = () => {
        if (this.isRecording) this.stopRecording();
        else this.quickStartRecording();
    };

    // ---- Internals ----
    _filename(ext) {
        const wm = this.appContext.worldManager;
        const hex = wm.getCurrentRulesetHex();
        const tick = wm.getSelectedWorldStats().tick || 0;
        return buildCaptureFilename(rulesetName(hex), tick, ext);
    }

    _downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    _toast(message, type) {
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message, type });
    }
}
