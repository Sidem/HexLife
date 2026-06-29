import { describe, it, expect } from 'vitest';
import {
    buildCaptureFilename,
    resolvePresetDimensions,
    clampGifDimensions,
    webmBitrate,
    estimateGifBudget,
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

describe('formatBytes', () => {
    it('formats across units', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(2048)).toBe('2.0 KB');
        expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
        expect(formatBytes(20 * 1024)).toBe('20 KB');
    });
});
