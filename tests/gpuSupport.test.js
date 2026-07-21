import { describe, it, expect } from 'vitest';
import {
    detectBrowserFamily,
    detectGraphicsPath,
    isSoftwareRenderer,
    GPU_HELP_BY_BROWSER,
} from '../src/utils/gpuSupport.js';

/**
 * GPU capability detection (see src/utils/gpuSupport.js).
 *
 * Both surfaces gate on this: the Explorer refuses to start without hardware acceleration, and the
 * Devvit card refuses to mount a world with no WebGL2 at all. That makes a false `no-webgl2` a way
 * to blank out a Reddit post on a perfectly good device — so the two things pinned here are the
 * classifier and the promise that detection itself can never throw.
 *
 * (`createGpuHelpPanel` builds DOM and these tests run in node; it's verified in the browser.)
 */

describe('isSoftwareRenderer', () => {
    it('recognizes the CPU rasterizers each engine falls back to', () => {
        expect(isSoftwareRenderer('Google Inc. / ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))')).toBe(true);
        expect(isSoftwareRenderer('Mesa / llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
        expect(isSoftwareRenderer('Mozilla / Software WebRender')).toBe(true);
    });

    it('leaves real GPUs alone', () => {
        expect(isSoftwareRenderer('NVIDIA Corporation / NVIDIA GeForce RTX 4070')).toBe(false);
        expect(isSoftwareRenderer('Apple / Apple M2')).toBe(false);
        expect(isSoftwareRenderer('Qualcomm / Adreno (TM) 730')).toBe(false);
        // The masked strings a phone webview usually reports. Unknown is not software: guessing
        // "software" here would block the card on every device that withholds driver info.
        expect(isSoftwareRenderer('WebKit / WebKit WebGL')).toBe(false);
        expect(isSoftwareRenderer('unknown / unknown')).toBe(false);
    });

    it('survives junk instead of a string', () => {
        expect(isSoftwareRenderer('')).toBe(false);
        expect(isSoftwareRenderer(null)).toBe(false);
        expect(isSoftwareRenderer(undefined)).toBe(false);
    });
});

describe('detectBrowserFamily', () => {
    it('maps every Chromium skin to the one settings path they share', () => {
        for (const ua of [
            'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
            'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0',
            'Mozilla/5.0 (Linux; Android 13) Chrome/126.0.0.0 Mobile Safari/537.36',
            'Mozilla/5.0 (iPhone) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1',
        ]) {
            expect(detectBrowserFamily(ua)).toBe('chromium');
        }
    });

    it('picks Firefox over Chromium even where the UA carries both hints', () => {
        expect(detectBrowserFamily('Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/128.0')).toBe('firefox');
        expect(detectBrowserFamily('Mozilla/5.0 (iPhone) FxiOS/128.0 Mobile/15E148 Safari/605.1.15')).toBe('firefox');
    });

    it('only calls it Safari when no Chromium token is present', () => {
        expect(detectBrowserFamily('Mozilla/5.0 (Macintosh) Version/17.5 Safari/605.1.15')).toBe('safari');
    });

    it('falls back to the generic instructions rather than nothing', () => {
        expect(detectBrowserFamily('')).toBe('unknown');
        expect(detectBrowserFamily('curl/8.4.0')).toBe('unknown');
    });

    it('has help text for every family it can return', () => {
        for (const family of ['chromium', 'firefox', 'safari', 'unknown']) {
            expect(GPU_HELP_BY_BROWSER[family]?.steps.length).toBeGreaterThan(0);
        }
    });
});

describe('detectGraphicsPath', () => {
    it('reports no-webgl2 instead of throwing when there is no DOM at all', () => {
        // Node has no `document`, which is the harshest version of "canvas unavailable". A detector
        // that throws here would take down the boot it was added to protect.
        expect(() => detectGraphicsPath()).not.toThrow();
        expect(detectGraphicsPath().status).toBe('no-webgl2');
    });
});
