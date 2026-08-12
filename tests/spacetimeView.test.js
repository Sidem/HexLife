import { beforeEach, describe, expect, it } from 'vitest';
import { createRecordingGL } from './helpers/recordingGL.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Config from '../src/core/config.js';
import { EVENTS } from '../src/services/EventBus.js';
import {
    VIEW_MODES,
    isOrbitViewMode,
    isViewMode,
    normalizeViewMode,
} from '../src/rendering/viewModes.js';
import {
    SPACETIME_DEFAULTS,
    computeGeometry,
    depthCapForGrid,
} from '../src/rendering/spacetime/SpacetimeView.js';
import { SpacetimeVolume } from '../src/rendering/spacetime/SpacetimeVolume.js';
import {
    SPACETIME_VIEW_DEFAULTS,
    sanitizeSpacetimeViewSettings,
} from '../src/services/SpacetimeViewSettings.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

describe('view mode enum (#40 Phase 0)', () => {
    it('names exactly the three projections', () => {
        expect(Object.values(VIEW_MODES)).toEqual(['flat', 'torus', 'spacetime']);
        expect(isViewMode('torus')).toBe(true);
        expect(isViewMode('sphere')).toBe(false);
    });

    it('falls back to flat for anything it does not know', () => {
        // A persisted value from a future build, or a typo'd console call, must not strand the
        // renderer in a mode it cannot draw.
        expect(normalizeViewMode('spacetime')).toBe('spacetime');
        expect(normalizeViewMode(undefined)).toBe('flat');
        expect(normalizeViewMode(true)).toBe('flat');
        expect(normalizeViewMode('nonsense', VIEW_MODES.TORUS)).toBe('torus');
    });

    it('groups the orbit-camera modes', () => {
        expect(isOrbitViewMode(VIEW_MODES.FLAT)).toBe(false);
        expect(isOrbitViewMode(VIEW_MODES.TORUS)).toBe(true);
        expect(isOrbitViewMode(VIEW_MODES.SPACETIME)).toBe(true);
    });

    it('left no boolean torus surface behind', () => {
        expect(EVENTS.VIEW_MODE_CHANGED).toBe('renderer:viewModeChanged');
        expect(EVENTS.COMMAND_SET_VIEW_MODE).toBe('command:setViewMode');
        expect(EVENTS.TORUS_VIEW_CHANGED).toBeUndefined();
        expect(EVENTS.COMMAND_TOGGLE_TORUS_VIEW).toBeUndefined();

        const viewControls = read('src/ui/ViewControls.js');
        expect(viewControls).not.toContain('setTorusEnabled');
        // The old boolean key is read once for migration and never written again.
        expect(viewControls).not.toMatch(/saveUISetting\(\s*['"]torusViewEnabled['"]/);
    });
});

describe('spacetime view is free until it is used (#40 §2.1)', () => {
    const renderer = read('src/rendering/renderer.js');

    it('never compiles the ray-march program in initRenderer', () => {
        const initRenderer = renderer.slice(
            renderer.indexOf('export function initRenderer'),
            renderer.indexOf('function _calculateAndCacheLayout'),
        );
        expect(initRenderer.length).toBeGreaterThan(500);
        expect(initRenderer).not.toContain('spacetime');
        expect(initRenderer).not.toContain('Spacetime');
        expect(renderer).not.toContain('spacetime_fragment.glsl');
        expect(renderer).not.toContain('spacetime_vertex.glsl');
    });

    it('reaches the module only through a dynamic import', () => {
        expect(renderer).toContain("import('./spacetime/SpacetimeView.js')");
        expect(renderer).not.toMatch(/^import .*SpacetimeView\.js/m);
    });

    it('releases the volume texture when the mode is left', () => {
        expect(renderer).toMatch(
            /if \(next === VIEW_MODES\.SPACETIME\) _loadSpacetimeView\(\);\s*\n\s*else _releaseSpacetimeVolume\(\);/,
        );
        expect(read('src/rendering/spacetime/SpacetimeVolume.js'))
            .toContain('this.gl.deleteTexture(this.texture)');
    });

    it('ships in its own chunk, with nothing of it in the main bundle (#40 §8.2)', () => {
        // The strongest form of "no extra bundle chunk loaded": look at what the build actually
        // emitted. Skipped when `dist/` is absent so a plain `npm test` does not require a build —
        // CI builds, and the numbers are recorded in the plan's §6.
        const assets = path.join(REPO_ROOT, 'dist', 'assets');
        if (!existsSync(assets)) return;
        const files = readdirSync(assets);
        const chunk = files.find((f) => /^SpacetimeView-.*\.js$/.test(f));
        expect(chunk, 'the projection must be its own chunk').toBeDefined();

        const main = files.find((f) => /^index-.*\.js$/.test(f));
        const mainSource = readFileSync(path.join(assets, main), 'utf8');
        // Shader source, ray-march uniforms, and the volume must all be absent from the main chunk.
        for (const marker of ['usampler2DArray', 'u_ringBase', 'texStorage3D', 'SpacetimeVolume']) {
            expect(mainSource.includes(marker), `main chunk leaked ${marker}`).toBe(false);
        }
        const chunkSource = readFileSync(path.join(assets, chunk), 'utf8');
        expect(chunkSource).toContain('usampler2DArray');
    });

    it('leaves the flat render path untouched (#40 §8.2)', () => {
        // The flat path must issue the GL calls it always did. Rather than trust that, take the
        // functions that path actually runs and require that every spacetime mention inside them is
        // behind the mode check — so the branch is provably unreachable while the mode is off.
        const slice = (from, to) => renderer.slice(renderer.indexOf(from), renderer.indexOf(to));
        const renderMainScene = slice('function renderMainScene', 'function drawTorus');
        const spacetimeMentions = renderMainScene.match(/[Ss]pacetime/g) ?? [];
        expect(spacetimeMentions).toHaveLength(1);
        expect(renderMainScene).toContain(
            'else if (viewMode === VIEW_MODES.SPACETIME) projectionDrawn = drawSpacetime();',
        );

        // The per-world FBO pass and the orbit animation gate never mention it at all.
        const worldPass = slice('function renderWorldsToTextures', 'function renderMainScene');
        expect(worldPass).not.toMatch(/[Ss]pacetime/);
        const orbitAnimation = slice('function updateOrbitAnimation', 'function setViewMode');
        expect(orbitAnimation).not.toMatch(/[Ss]pacetime/);
    });

    it('gives back every GL object it took when the mode is left (#40 §8.3)', () => {
        // Leaving the mode releases the volume; the compiled program and the fetched chunk are kept
        // deliberately, so a second toggle is instant. `dispose` is the full teardown.
        const view = read('src/rendering/spacetime/SpacetimeView.js');
        expect(view).toMatch(/releaseVolume\(\)\s*\{\s*\n\s*volume\?\.dispose\(\);/);
        expect(view).toMatch(/dispose:\s*\(\)\s*=>\s*\{\s*\n\s*releaseVolume\(\);/);
        expect(view).toContain('gl.deleteProgram(program)');
        // Nothing else in the projection creates a GL object, so nothing else can leak one.
        const created = [
            ...view.matchAll(/gl\.create(\w+)\(/g),
            ...read('src/rendering/spacetime/SpacetimeVolume.js').matchAll(/gl\.create(\w+)\(/g),
        ].map((m) => m[1]);
        expect(new Set(created)).toEqual(new Set(['Texture']));
    });

    it('subscribes to the layer stream only on the first switch into the mode', () => {
        // Even the EventBus subscriptions are opt-in: a session that never opens the mode holds no
        // handler for SPACETIME_LAYER at all, so there is nothing for a stray message to reach.
        expect(renderer).toContain('_subscribeSpacetimeStream();');
        const initRenderer = renderer.slice(
            renderer.indexOf('export function initRenderer'),
            renderer.indexOf('function _calculateAndCacheLayout'),
        );
        expect(initRenderer).not.toContain('SPACETIME');
        expect(initRenderer).not.toContain('_subscribeSpacetimeStream');
    });
});

describe('spacetime volume sizing', () => {
    it('asks for the ring depth and no more', () => {
        // Depth comes from the existing ring. Raising STATE_HISTORY_RING_SIZE to get a taller
        // object would cost every user worker memory forever (#40 §2.2).
        expect(Config.STATE_HISTORY_RING_SIZE).toBe(240);
        expect(SPACETIME_DEFAULTS.depth).toBe(Config.STATE_HISTORY_RING_SIZE);
    });

    it('clamps depth to the device layer cap, which WebGL2 only guarantees at 256', () => {
        const source = read('src/rendering/spacetime/SpacetimeView.js');
        expect(source).toContain('gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)');
        // All three clamps in one place: the user's request, the preset cap, the ring, the device.
        expect(source).toContain('depthCapForGrid(Config.GRID_ROWS)');
        expect(source).toContain('Config.STATE_HISTORY_RING_SIZE');
        expect(source).toContain('maxLayers');
    });

    it('caps the huge preset below the full ring and takes the whole ring everywhere else', () => {
        // One byte per cell per layer: the huge preset is 92 MB of texture at the full 240, which is
        // more GPU memory than the extra height buys. Every other preset fits comfortably (#40 §3).
        const megabytes = (rows) => {
            const { cols } = Config.deriveGridDimensions(rows);
            return (cols * rows * depthCapForGrid(rows)) / (1024 * 1024);
        };
        for (const rows of Object.values(Config.GRID_SIZE_PRESETS)) {
            expect(depthCapForGrid(rows)).toBeLessThanOrEqual(Config.STATE_HISTORY_RING_SIZE);
            expect(megabytes(rows)).toBeLessThan(64);
        }
        expect(depthCapForGrid(Config.GRID_SIZE_PRESETS.huge ?? 576)).toBe(128);
        expect(depthCapForGrid(192)).toBe(240);
        // An unrecognised row count must still be bounded rather than falling through to undefined.
        expect(depthCapForGrid(123)).toBe(240);
    });

    it('keeps the object inside the orbit camera framing at every grid preset', () => {
        for (const rows of Object.values(Config.GRID_SIZE_PRESETS)) {
            const { cols } = Config.deriveGridDimensions(rows);
            const depth = depthCapForGrid(rows);
            const { boxMin, boxMax } = computeGeometry(cols, rows, depth);
            const halfX = boxMax[0];
            const halfZ = boxMax[2];
            // The footprint is normalised on its longer side, so one axis is exactly the target
            // half-extent and the other is no larger.
            expect(Math.max(halfX, halfZ)).toBeCloseTo(1.6, 6);
            // A full ring spans the whole time axis; the object is bottom-anchored.
            expect(boxMin[1]).toBe(-2.2);
            expect(boxMax[1]).toBeCloseTo(2.2, 6);
            // The camera's closest dolly is 4.1 units out — the object must never swallow it.
            expect(Math.hypot(halfX, 2.2, halfZ)).toBeLessThan(4);
        }
    });

    it('grows the object upward as the ring fills instead of stretching it', () => {
        // layerHeight comes from the ring CAPACITY, so a half-full ring is a half-height object with
        // ticks the same thickness — not a full-height object with fat ones.
        const full = computeGeometry(222, 192, 240, 240);
        const half = computeGeometry(222, 192, 240, 120);
        expect(half.layerHeight).toBe(full.layerHeight);
        expect(half.boxMin[1]).toBe(full.boxMin[1]);          // same floor
        expect(half.boxMax[1]).toBeCloseTo(0, 6);             // half the height
        expect(computeGeometry(222, 192, 240, 0).boxMax[1]).toBe(-2.2); // nothing recorded yet
    });

    it('centres the footprint on the flat grid the renderer already lays out', () => {
        const cols = 222;
        const rows = 192;
        const { hexSize, gridCenter } = computeGeometry(cols, rows, 240);
        // Same extents as utils.getGridWorldBounds, in object units.
        const minX = -hexSize;
        const maxX = (cols - 1) * 1.5 * hexSize + hexSize;
        const minY = -Math.sqrt(3) * hexSize / 2;
        const maxY = rows * Math.sqrt(3) * hexSize;
        expect(gridCenter[0]).toBeCloseTo((minX + maxX) / 2, 9);
        expect(gridCenter[1]).toBeCloseTo((minY + maxY) / 2, 9);
    });
});

describe('the texture ring mirrors the scrub ring (#40 Phase 2)', () => {
    const COLS = 4;
    const ROWS = 3;
    const CELLS = COLS * ROWS;
    /** A layer whose every byte identifies the tick that produced it. */
    const layerFor = (tick) => new Uint8Array(CELLS).fill(tick & 0xff);

    let gl;
    let volume;
    beforeEach(() => {
        gl = createRecordingGL();
        volume = new SpacetimeVolume(gl, COLS, ROWS, 5);
    });

    it('starts empty and grows one layer per tick', () => {
        expect(volume.isEmpty).toBe(true);
        expect(volume.length).toBe(0);
        volume.push(layerFor(1), 1);
        volume.push(layerFor(2), 2);
        expect(volume.length).toBe(2);
        expect(volume.base).toBe(0);
        expect(volume.tipTick).toBe(2);
        expect(volume.isEmpty).toBe(false);
        // One upload per tick, one layer each — never a re-upload of the layers already there.
        const uploads = gl.callsNamed('texSubImage3D');
        expect(uploads).toHaveLength(2);
        expect(uploads.every((c) => c.args[7] === 1)).toBe(true);
    });

    it('overwrites the oldest layer at capacity instead of shuffling the rest', () => {
        for (let tick = 1; tick <= 8; tick++) volume.push(layerFor(tick), tick);
        expect(volume.length).toBe(5);          // capacity, not 8
        expect(volume.head).toBe(3);            // 8 % 5
        expect(volume.base).toBe(3);            // oldest live layer is physical slot 3
        // Eight ticks cost exactly eight single-layer uploads. A ring that shifted its contents
        // would cost O(depth) per tick, which is the whole reason the shader unwraps from `base`.
        const uploads = gl.callsNamed('texSubImage3D');
        expect(uploads).toHaveLength(8);
        expect(uploads.every((c) => c.args[7] === 1)).toBe(true);
        expect(uploads.map((c) => c.args[4])).toEqual([0, 1, 2, 3, 4, 0, 1, 2]);
    });

    it('backfills the ring in one upload and keeps the newest when it overflows', () => {
        const frames = 8;
        const bytes = new Uint8Array(frames * CELLS);
        for (let i = 0; i < frames; i++) bytes.set(layerFor(i + 1), i * CELLS);
        const applied = volume.backfill(bytes, frames);
        expect(applied).toBe(5);
        expect(volume.length).toBe(5);
        expect(volume.base).toBe(0);
        const uploads = gl.callsNamed('texSubImage3D');
        expect(uploads).toHaveLength(1);
        expect(uploads[0].args[7]).toBe(5);            // all five layers, one call
        expect(uploads[0].args[10]).toBe(5 * CELLS);   // the NEWEST five, oldest three dropped
    });

    it('drops the recorded future on a truncate without touching a texel', () => {
        for (let tick = 1; tick <= 4; tick++) volume.push(layerFor(tick), tick);
        gl.clear();
        expect(volume.truncate(2)).toBe(2);
        expect(volume.length).toBe(2);
        expect(volume.head).toBe(2);
        expect(volume.base).toBe(0);
        // Truncation is index arithmetic. Re-uploading to "erase" the dropped layers would cost a
        // full volume write for something the shader simply stops addressing.
        expect(gl.callsNamed('texSubImage3D')).toHaveLength(0);
        // Clamped, never negative: a length past what is held keeps everything.
        expect(volume.truncate(99)).toBe(0);
        expect(volume.length).toBe(2);
    });

    it('empties on a reset so the object vanishes and regrows', () => {
        for (let tick = 1; tick <= 3; tick++) volume.push(layerFor(tick), tick);
        gl.clear();
        volume.reset();
        expect(volume.isEmpty).toBe(true);
        expect(volume.length).toBe(0);
        expect(volume.tipTick).toBe(-1);
        expect(gl.callsNamed('texSubImage3D')).toHaveLength(0);
        volume.push(layerFor(9), 9);
        expect(volume.length).toBe(1);
    });

    it('uploads one byte per cell with the alignment an odd column count needs', () => {
        // 222 columns at the medium preset is not a multiple of the default 4-byte unpack
        // alignment, and WebGL rejects the upload outright ("ArrayBufferView not big enough")
        // without this. The pairing matters as much as the value: leaving it at 1 would corrupt
        // every other texture upload in the renderer.
        const wide = new SpacetimeVolume(createRecordingGL(), 222, 192, 2);
        wide.push(new Uint8Array(222 * 192), 1);
        const alignment = wide.gl.callsNamed('pixelStorei').map((c) => c.args[1]);
        expect(alignment).toEqual([1, 4]);
    });

    it('deletes exactly the texture it created', () => {
        expect(gl.liveObjects().texture).toBe(1);
        volume.dispose();
        expect(gl.liveObjects().texture ?? 0).toBe(0);
        expect(gl.callsNamed('deleteTexture')).toHaveLength(1);
        volume.dispose(); // idempotent — a double release must not double-delete
        expect(gl.callsNamed('deleteTexture')).toHaveLength(1);
    });
});

describe('spacetime layer opacity is a user setting (#40 Phase 3)', () => {
    it('defaults to the translucent value the frame-time gate was measured at', () => {
        expect(SPACETIME_VIEW_DEFAULTS.layerAlpha).toBe(0.12);
        expect(SPACETIME_DEFAULTS.layerAlpha).toBe(SPACETIME_VIEW_DEFAULTS.layerAlpha);
    });

    it('clamps anything a stale or hand-edited setting could hold', () => {
        expect(sanitizeSpacetimeViewSettings({ layerAlpha: 0 }).layerAlpha).toBe(0);
        expect(sanitizeSpacetimeViewSettings({ layerAlpha: 5 }).layerAlpha).toBe(1);
        expect(sanitizeSpacetimeViewSettings({ layerAlpha: -1 }).layerAlpha).toBe(0);
        expect(sanitizeSpacetimeViewSettings({ layerAlpha: 'x' }).layerAlpha).toBe(0.12);
        expect(sanitizeSpacetimeViewSettings({}).layerAlpha).toBe(0.12);
    });

    it('is reachable and restorable from the view controls', () => {
        const viewControls = read('src/ui/ViewControls.js');
        // An opacity control for a mode with no way in would be furniture.
        expect(viewControls).toContain('view-controls-spacetime');
        expect(viewControls).toContain('VIEW_MODES.SPACETIME');
        // Phase 0 withheld spacetime from persistence because it was unfinished. Phases 2–3 finish it.
        expect(viewControls).toMatch(/PERSISTED_VIEW_MODES = \[[^\]]*VIEW_MODES\.SPACETIME/s);
    });
});

describe('the ray-march shader', () => {
    const fragment = read('shaders/spacetime_fragment.glsl');

    it('reads the byte as a direct index into the live 128x2 palette LUT', () => {
        expect(fragment).toContain('float rule = float(voxel >> 1u);');
        expect(fragment).toContain('float state = float(voxel & 1u);');
        expect(fragment).toContain('vec2((rule + 0.5) / 128.0, (state + 0.5) / 2.0)');
    });

    it('stops the opaque ray at the first live voxel', () => {
        expect(fragment).toMatch(/if \(u_layerAlpha <= 0\.0\) \{[\s\S]*outColor = vec4\(lit, 1\.0\);\s*\n\s*return;/);
        expect(fragment).toContain('if (alpha > 0.99) break;');
    });

    it('bounds the march by a step cap rather than the grid resolution', () => {
        expect(fragment).toContain('for (int i = 0; i < u_maxSteps; ++i)');
        expect(SPACETIME_DEFAULTS.maxSteps).toBeGreaterThanOrEqual(Config.STATE_HISTORY_RING_SIZE);
    });

    it('spends the step budget over the whole ray instead of stopping inside the object', () => {
        // A near-horizontal ray crosses the entire footprint: at the large presets that is thousands
        // of lateral steps, far past the cap. Exhausting the cap mid-object erases everything behind
        // that point, so the step widens to fit the budget rather than the march ending early.
        expect(fragment).toContain('float budgetStep = (tExit - t) / float(max(u_maxSteps, 1));');
        expect(fragment).toContain('float marchStep = max(min(slabStep, lateralStep), budgetStep);');
    });

    it('charges opacity per unit distance, so the object is as see-through from any angle', () => {
        // Sampling density is view-dependent — one sample per tick down the time axis, several per
        // hex along the footprint. Charging u_layerAlpha per SAMPLE made a side-on view several
        // times more opaque than a top-down one and hid the interior behind its own shell.
        expect(fragment).toContain('float alphaExponent = marchStep / max(u_layerHeight, 1e-6);');
        expect(fragment).toContain('pow(1.0 - clamp(u_layerAlpha, 0.0, 1.0), alphaExponent)');
        expect(fragment).toContain('float voxelAlpha = stepAlpha * (1.0 - alpha);');
        // The per-sample charge is gone: u_layerAlpha now reaches the accumulation only through
        // stepAlpha, and otherwise only picks opaque mode.
        expect(fragment).not.toMatch(/u_layerAlpha \* \(1\.0 - alpha\)/);
    });

    it('shades continuously across eye level rather than seaming the object in half', () => {
        // The cap normal is taken from the ray's vertical direction, which flips sign exactly at the
        // horizon. Shading it at full strength drew a hard bright/dark line across the middle of a
        // side-on object. It is faded in by how vertical the ray is, so both sides meet at the wall.
        expect(fragment).toContain(
            'normalize(mix(wallNormal, vec3(0.0, -signDirection.y, 0.0), absDirection.y))',
        );
        // Half-Lambert: a face turned away from the key light is dimmed, never erased to ambient.
        expect(fragment).toContain('float lambert = 0.5 + 0.5 * dot(normal, LIGHT_DIRECTION);');
        expect(fragment).not.toContain('max(dot(normal,');
    });

    it('draws from gl_VertexID so the pass owns no buffers', () => {
        expect(read('shaders/spacetime_vertex.glsl')).toContain('gl_VertexID');
        expect(read('src/rendering/spacetime/SpacetimeView.js')).toContain('gl.drawArrays(gl.TRIANGLES, 0, 3)');
    });

    it('unwraps the ring rather than requiring the layers be stored in order', () => {
        expect(fragment).toContain('int slot = (u_ringBase + layer) % u_ringDepth;');
        expect(fragment).toContain('if (layer < 0 || layer >= u_layers) return 0u;');
    });

    it('draws the scrub position as an opaque cross-section', () => {
        expect(fragment).toContain('if (layer == u_highlightLayer)');
        expect(fragment).toMatch(/layer == u_highlightLayer\)[\s\S]{0,240}outColor = vec4\(accumulated, 1\.0\);/);
    });

    it('draws nothing at all when no history has been recorded', () => {
        expect(fragment).toContain('if (u_layers <= 0) discard;');
    });
});
