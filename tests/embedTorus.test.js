import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { clampFloat } from '../src/embed/attrs.js';

/**
 * The `torus` attribute on `<hexlife-world>` (see `docs/embed/hexlife-world.md` § Interaction).
 *
 * The element itself needs a DOM + WebGL2 + wasm, so — as with `torusTransparency.test.js` — the GL
 * state machine and the loop wiring are pinned from source text. That is worth doing here because
 * every invariant below fails *silently and expensively*: a torus that accumulates alpha per
 * intersection only looks slightly wrong, a shader program built at boot only costs a feed of
 * phones a compile each, and a camera that spins on `_rafId` would report a paused world as
 * `playing: true` to every host reading `hexlife-playstate`.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

describe('torus attribute coercion', () => {
    // The element's own call, spelled out: clampFloat(value, TORUS_SPIN_MIN, MAX, DEFAULT).
    const spin = (raw) => clampFloat(raw, 0, 45, 14);

    it('defaults a bare `torus` to the Explorer\'s own rotation speed', () => {
        // `getAttribute` returns '' for a valueless attribute, so this is `<hexlife-world torus>`.
        expect(spin('')).toBe(14);
        expect(spin('banana')).toBe(14);
    });

    it('keeps torus="0" as a still torus rather than treating it as unset', () => {
        // Unlike `seed="0"`, 0 is a meaningful value here: the viewer turns it by hand.
        expect(spin('0')).toBe(0);
    });

    it('clamps rather than rejecting an out-of-range speed', () => {
        expect(spin('90')).toBe(45);
        expect(spin('-5')).toBe(0);
        expect(spin('14')).toBe(14);
    });

    it('pins those bounds to the element that uses them', () => {
        const element = read('src/embed/HexLifeElement.js');
        expect(element).toContain('const TORUS_SPIN_MIN = 0;');
        expect(element).toContain('const TORUS_SPIN_MAX = 45;');
        expect(element).toContain('const TORUS_SPIN_DEFAULT = 14;');
        expect(element).toMatch(
            /clampFloat\(this\.getAttribute\('torus'\), TORUS_SPIN_MIN, TORUS_SPIN_MAX, TORUS_SPIN_DEFAULT\)/,
        );
    });
});

describe('embed torus rendering', () => {
    it('reuses the app\'s torus shaders instead of forking them', () => {
        const renderer = read('src/embed/EmbedRenderer.js');
        expect(renderer).toContain("from '../../shaders/torus_vertex.glsl?raw'");
        expect(renderer).toContain("from '../../shaders/torus_fragment.glsl?raw'");
        expect(renderer).toContain("from '../rendering/torusMath.js'");
        expect(renderer).toContain("from '../rendering/mat4.js'");
    });

    it('depth-selects one off layer instead of accumulating every torus intersection', () => {
        const renderer = read('src/embed/EmbedRenderer.js');
        expect(renderer).toMatch(
            /TORUS_SURFACE_PASS\.LIVE[\s\S]*gl\.depthMask\(true\);[\s\S]*gl\.drawArraysInstanced/,
        );
        expect(renderer).toMatch(
            /gl\.colorMask\(false, false, false, false\);[\s\S]*TORUS_SURFACE_PASS\.OFF[\s\S]*gl\.drawArraysInstanced/,
        );
        expect(renderer).toMatch(
            /gl\.colorMask\(true, true, true, true\);[\s\S]*gl\.depthFunc\(gl\.EQUAL\);[\s\S]*gl\.enable\(gl\.BLEND\);[\s\S]*gl\.depthMask\(false\);[\s\S]*gl\.drawArraysInstanced/,
        );
    });

    it('asks for the depth buffer the three passes depend on', () => {
        expect(read('src/embed/EmbedRenderer.js')).toContain('depth: true');
    });

    it('builds the torus program on first use, not at boot', () => {
        const renderer = read('src/embed/EmbedRenderer.js');
        // A feed card that never leaves the flat view must not pay for a compile + link it will
        // never draw with — the whole reason Follow-up D was allowed to land in the embed at all.
        expect(renderer).toMatch(/_ensureTorusProgram\(\)\s*\{\s*if \(this\._torusProgram\) return true;/);
        expect(renderer).toMatch(/setTorus\(enabled\)[\s\S]*this\._ensureTorusProgram\(\)/);
        const constructorBody = renderer.slice(
            renderer.indexOf('constructor(canvas'),
            renderer.indexOf('    _setupGeometry() {'),
        );
        expect(constructorBody).toContain('this._torusProgram = null;');
        expect(constructorBody).not.toContain('torusVertexShaderSource');
    });
});

describe('embed torus loop', () => {
    it('spins the camera on its own rAF, never the simulation loop', () => {
        const element = read('src/embed/HexLifeElement.js');
        // `playing` is `_rafId !== 0` and `hexlife-playstate` is derived from it, so a camera
        // animation that borrowed `_rafId` would tell every host the paused world was running.
        expect(element).toContain('this._spinRafId = requestAnimationFrame(this._spinFrame);');
        expect(element).toMatch(/_spinFrame\(now\)[\s\S]*this\._advanceSpin\(dt\);[\s\S]*this\._drawViewOnly\(\);/);
        const spinSync = element.slice(
            element.indexOf('_syncSpinLoop() {'),
            element.indexOf('_spinFrame(now) {'),
        );
        expect(spinSync).not.toContain('_rafId = ');
        // Parked while the sim loop is already redrawing, so the torus never turns at double rate.
        expect(spinSync).toContain('&& !this.playing');
    });

    it('advances the same spin from the simulation loop when that one is running', () => {
        const element = read('src/embed/HexLifeElement.js');
        expect(element).toMatch(
            /_frame\(now\)[\s\S]*this\._advanceSpin\(dt\);[\s\S]*this\.sim\.advance\(dt\);/,
        );
    });

    it('treats the attribute as a projection, so toggling it never re-boots the world', () => {
        const element = read('src/embed/HexLifeElement.js');
        expect(element).toContain("'torus', 'brush', 'zoom'");   // observedAttributes
        // Membership of LIVE_ATTRS is what exempts it from the re-boot guard; without that, every
        // toggle would throw the world away and re-roll a generator-driven one.
        const liveAttrs = element.slice(
            element.indexOf('const LIVE_ATTRS = new Set(['),
            element.indexOf('const RULESET_RE'),
        );
        expect(liveAttrs).toContain("'torus'");
    });
});
