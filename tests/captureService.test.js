import { describe, it, expect } from 'vitest';
import {
    buildCaptureFilename,
    resolvePresetDimensions,
    clampGifDimensions,
    webmBitrate,
    estimateGifBudget,
    cycleGifTiming,
    perFrameDelayMs,
    composeRunFrames,
    formatBytes,
} from '../src/services/CaptureService.js';

// CaptureService is browser-API heavy (canvas, MediaRecorder, FBO readback); these tests pin the
// pure option-resolution seams that decide filename, output dimensions, bitrate, and GIF budget.

describe('buildCaptureFilename', () => {
    it('builds a slugged, dash-collapsed filename', () => {
        expect(buildCaptureFilename('Brave Otter', 1234, 'png')).toBe('hexlife-Brave-Otter-t1234.png');
    });
    it('defaults a missing tick to 0 and missing name to "world"', () => {
        expect(buildCaptureFilename(undefined, undefined, 'webm')).toBe('hexlife-world-t0.webm');
    });
});

describe('resolvePresetDimensions', () => {
    it('returns square dimensions for the selected-world source', () => {
        expect(resolvePresetDimensions('512', { source: 'selected' })).toEqual({ width: 512, height: 512 });
        expect(resolvePresetDimensions('native', { source: 'selected' })).toEqual({ width: 1280, height: 1280 });
        expect(resolvePresetDimensions('4096', { source: 'selected' })).toEqual({ width: 4096, height: 4096 });
    });
    it('falls back to native (1280²) for an unknown selected preset', () => {
        expect(resolvePresetDimensions('bogus', { source: 'selected' })).toEqual({ width: 1280, height: 1280 });
    });
    it('matches the live aspect for the canvas source', () => {
        // 16:9 live canvas, 720p preset → 1280×720.
        expect(resolvePresetDimensions('720', { source: 'canvas', liveWidth: 1920, liveHeight: 1080 }))
            .toEqual({ width: 1280, height: 720 });
    });
    it('returns the live size verbatim for the canvas "native" preset', () => {
        expect(resolvePresetDimensions('native', { source: 'canvas', liveWidth: 1600, liveHeight: 900 }))
            .toEqual({ width: 1600, height: 900 });
    });
});

describe('clampGifDimensions', () => {
    it('leaves small dimensions untouched', () => {
        expect(clampGifDimensions(400, 300)).toEqual({ width: 400, height: 300 });
    });
    it('scales the longest edge down to the cap, preserving aspect', () => {
        expect(clampGifDimensions(1280, 720, 600)).toEqual({ width: 600, height: 338 });
    });
});

describe('webmBitrate', () => {
    it('scales with resolution, fps, and quality, and never drops below the floor', () => {
        const low = webmBitrate(640, 360, 30, 0);
        const high = webmBitrate(640, 360, 30, 1);
        expect(high).toBeGreaterThan(low);
        expect(webmBitrate(1, 1, 1, 0)).toBeGreaterThanOrEqual(250_000);
    });
});

describe('estimateGifBudget', () => {
    it('computes a frame count from fps × seconds, capped', () => {
        expect(estimateGifBudget(320, 320, 10, 5).frames).toBe(50);
        expect(estimateGifBudget(320, 320, 60, 60).frames).toBe(300); // hard cap
    });
    it('returns a positive approximate size', () => {
        expect(estimateGifBudget(320, 320, 10, 5).approxBytes).toBeGreaterThan(0);
    });
});

describe('cycleGifTiming', () => {
    it('splits the requested loop duration evenly across the cycle frames', () => {
        // 12-frame cycle over 1.2s → 100ms per frame, loop lands exactly on the request.
        expect(cycleGifTiming(12, 1.2)).toEqual({ delayMs: 100, effectiveTotalMs: 1200 });
    });
    it('floors the per-frame delay at the minimum GIF decoders honor', () => {
        // 10 frames over 0.05s would be 5ms/frame — decoders clamp that UP to ~100ms, so we floor
        // at 20ms and report the stretched effective total instead.
        expect(cycleGifTiming(10, 0.05)).toEqual({ delayMs: 20, effectiveTotalMs: 200 });
    });
    it('treats a degenerate cycle length as a single frame', () => {
        expect(cycleGifTiming(0, 2)).toEqual({ delayMs: 2000, effectiveTotalMs: 2000 });
        expect(cycleGifTiming(undefined, 2)).toEqual({ delayMs: 2000, effectiveTotalMs: 2000 });
    });
});

describe('perFrameDelayMs', () => {
    it('maps fps to a per-frame delay, floored at the GIF minimum', () => {
        expect(perFrameDelayMs(20)).toBe(50);   // 1000/20
        expect(perFrameDelayMs(10)).toBe(100);  // 1000/10
        expect(perFrameDelayMs(60)).toBe(20);   // 1000/60 = 16.6 → floored to 20
        expect(perFrameDelayMs(0)).toBe(50);    // clamped up to 20fps default
    });
});

describe('composeRunFrames', () => {
    const f = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));
    it('appends the cycle repeated N times after the transient', () => {
        const { frames, truncated } = composeRunFrames(f(3), f(2), 3, 600);
        expect(frames.length).toBe(3 + 2 * 3);
        expect(truncated).toBe(false);
    });
    it('emits the transient alone when no cycle was found', () => {
        const { frames } = composeRunFrames(f(5), [], 3, 600);
        expect(frames.length).toBe(5);
    });
    it('truncates to the frame cap and reports it', () => {
        const { frames, truncated } = composeRunFrames(f(10), f(10), 10, 50);
        expect(frames.length).toBe(50);
        expect(truncated).toBe(true);
    });
    it('clamps the repeat count into range', () => {
        expect(composeRunFrames(f(1), f(1), 0, 600).frames.length).toBe(1 + 1); // min 1 repeat
        expect(composeRunFrames(f(1), f(1), 99, 600).frames.length).toBe(1 + 10); // max 10 repeats
    });
});

describe('formatBytes', () => {
    it('formats across units', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(2048)).toBe('2.0 KB');
        expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
        expect(formatBytes(20 * 1024)).toBe('20 KB');
    });
});
