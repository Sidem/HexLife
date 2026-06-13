import { describe, it, expect } from 'vitest';
import { pickWebmMimeType } from '../src/services/WebmRecorder.js';

// WebmRecorder is browser-API heavy (MediaRecorder + canvas.captureStream); the only pure seam is
// mime-type negotiation, which decides clip quality/compatibility. These tests pin its preference
// order (VP9 > VP8 > generic webm) and its graceful fallbacks.
describe('pickWebmMimeType', () => {
    it('prefers VP9 when everything is supported', () => {
        expect(pickWebmMimeType(() => true)).toBe('video/webm;codecs=vp9');
    });

    it('falls back to VP8 when VP9 is unsupported', () => {
        const supported = new Set(['video/webm;codecs=vp8', 'video/webm']);
        expect(pickWebmMimeType((t) => supported.has(t))).toBe('video/webm;codecs=vp8');
    });

    it('falls back to generic webm when only it is supported', () => {
        expect(pickWebmMimeType((t) => t === 'video/webm')).toBe('video/webm');
    });

    it('returns empty string when nothing is supported (let the recorder choose a default)', () => {
        expect(pickWebmMimeType(() => false)).toBe('');
    });

    it('returns empty string when given a non-function predicate', () => {
        expect(pickWebmMimeType(undefined)).toBe('');
        expect(pickWebmMimeType(null)).toBe('');
    });

    it('treats a throwing predicate as unsupported and keeps scanning', () => {
        // VP9 throws, VP8 supported → should skip the thrower and land on VP8.
        const predicate = (t) => {
            if (t === 'video/webm;codecs=vp9') throw new Error('boom');
            return t === 'video/webm;codecs=vp8';
        };
        expect(pickWebmMimeType(predicate)).toBe('video/webm;codecs=vp8');
    });
});
