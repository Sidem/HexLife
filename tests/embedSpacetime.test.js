import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRecordingGL } from './helpers/recordingGL.js';
import {
    DEFAULT_DEPTH,
    HexLifeSpacetime,
    SPACETIME_CAMERA,
    SPACETIME_MARCH_DEFAULTS,
    createSpacetimeView,
} from '../src/embed/spacetime.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

const ROWS = 4;
const COLS = 6;
const CELLS = ROWS * COLS;

/**
 * A canvas that owns nothing but the recording context — enough for every path in this entry that
 * is not the GPU itself, which is all of them: the module's job is deciding what to upload and what
 * to leave alone.
 */
function createCanvas(gl) {
    const listeners = new Map();
    return {
        width: 640,
        height: 560,
        clientWidth: 640,
        clientHeight: 560,
        getContext: () => gl,
        addEventListener: (type, handler) => listeners.set(type, handler),
        removeEventListener: (type) => listeners.delete(type),
        dispatchEvent: () => true,
        setPointerCapture() {},
        releasePointerCapture() {},
        hasPointerCapture: () => false,
        listeners,
    };
}

function createView(options = {}) {
    const gl = createRecordingGL();
    const canvas = createCanvas(gl);
    const view = createSpacetimeView(canvas, { rows: ROWS, columns: COLS, depth: 8, ...options });
    return { gl, canvas, view };
}

/** A layer whose every byte identifies the tick that produced it. */
const layerFor = (tick) => new Uint8Array(CELLS).fill(tick & 0xff);

describe('@hexlife/embed/spacetime is a published entry point', () => {
    it('is built, exported, typed and shipped', () => {
        expect(read('vite.embed.config.js')).toContain("spacetime: 'src/embed/spacetime.js'");
        const manifest = JSON.parse(read('packages/hexlife-embed/package.json'));
        expect(manifest.exports['./spacetime']).toEqual({
            types: './src/embed/spacetime.d.ts',
            import: './src/embed/spacetime.js',
            default: './src/embed/spacetime.js',
        });
        // A missing `.d.ts` copy fails quietly: the JS resolves and a TypeScript consumer silently
        // gets `any`. The list is explicit precisely so this can be asserted.
        expect(read('scripts/prepare-embed-package.mjs')).toContain('src/embed/spacetime.d.ts');
        // DOM-free entries declare no side effects; this one registers nothing either.
        expect(manifest.sideEffects).not.toContain('./src/embed/spacetime.js');
    });

    it('is documented wherever the package enumerates itself', () => {
        for (const file of ['packages/hexlife-embed/README.md', 'docs/embed/entrypoints.md']) {
            expect(read(file), `${file} lists /spacetime`).toContain('@hexlife/embed/spacetime');
        }
        for (const file of ['docs/embed/README.md', 'docs/embed/entrypoints.md']) {
            expect(read(file), `${file} links spacetime.md`).toContain('](./spacetime.md)');
        }
        // Same trap as `/solid`: jsDelivr's `/+esm` bundles each subpath standalone, so two entries
        // would end up with separate module state.
        for (const file of ['docs/embed/spacetime.md', 'packages/hexlife-embed/README.md']) {
            expect(read(file)).not.toContain('/+esm');
        }
    });

    it('draws through the very module the Explorer draws with', () => {
        // The point of the extraction: one ray-march, two hosts. If this entry ever grows its own
        // copy of the shaders or the uniform table, the app and the package can drift apart
        // visually and nothing else would catch it.
        const entry = read('src/embed/spacetime.js');
        expect(entry).toContain("from '../rendering/spacetime/SpacetimeCore.js'");
        expect(entry).toContain("from '../rendering/spacetime/SpacetimeVolume.js'");
        expect(entry).not.toContain('.glsl');
        expect(read('src/rendering/spacetime/SpacetimeView.js'))
            .toContain("from './SpacetimeCore.js'");
        // And one colour table, for the same reason: the voxel byte IS an index into it.
        expect(entry).toContain("from './embedPalette.js'");
        expect(read('src/embed/EmbedRenderer.js')).toContain("from './embedPalette.js'");
    });
});

describe('the volume a host feeds', () => {
    it('takes a binary generation with no copy at all', () => {
        const { gl, view } = createView();
        const cells = new Uint8Array(CELLS);
        cells[3] = 1;
        expect(view.pushState(cells)).toBe(true);

        // The layer byte IS the LUT index (rule * 2 + state), so a world with no rule indices is
        // already packed: what reaches the GPU must be the host's own array, not a re-encoding.
        const upload = gl.callsNamed('texSubImage3D').at(-1);
        expect(upload.args[7]).toBe(1);          // exactly one layer
        expect(view.layerCount).toBe(1);
        expect(view.stats.layersPushed).toBe(1);
    });

    it('packs rule indices into the colour index', () => {
        const { view } = createView();
        const cells = Uint8Array.from({ length: CELLS }, (_, i) => i % 2);
        const ruleIndices = Uint8Array.from({ length: CELLS }, (_, i) => i % 128);
        view.pushState(cells, { ruleIndices, tick: 7 });
        expect(view.tipTick).toBe(7);

        // `rule * 2 + state` — the same byte `voxelColor` decodes in the fragment shader.
        const packed = view._packed;
        for (let index = 0; index < CELLS; index++) {
            expect(packed[index]).toBe((index % 128) * 2 + (index % 2));
        }
    });

    it('takes a finished run in one upload, newest kept when it overflows', () => {
        const { gl, view } = createView();
        const before = gl.callsNamed('texSubImage3D').length;
        const generations = [];
        for (let tick = 1; tick <= 12; tick++) generations.push(layerFor(tick));

        expect(view.setHistory(generations)).toBe(8); // depth, not 12
        const uploads = gl.callsNamed('texSubImage3D').slice(before);
        expect(uploads).toHaveLength(1);
        expect(uploads[0].args[7]).toBe(8);
        // The tip is what the user is looking at, so an overflowing run drops its OLDEST ticks.
        expect(uploads[0].args[10]).toBe(8 * CELLS);
        expect(view.layerCount).toBe(8);
    });

    it('clamps depth to what the device will actually give', () => {
        const gl = createRecordingGL({ getParameter: () => 6 });
        const view = new HexLifeSpacetime(createCanvas(gl), { rows: ROWS, columns: COLS, depth: 240 });
        expect(view.maxLayers).toBe(6);
        expect(view.depth).toBe(6);
        // The texture is allocated at the granted depth, never at the requested one.
        expect(gl.callsNamed('texStorage3D')[0].args).toEqual([
            gl.TEXTURE_2D_ARRAY, 1, gl.R8UI, COLS, ROWS, 6,
        ]);
    });

    it('defaults to the Explorer ring depth and the Explorer march', () => {
        expect(DEFAULT_DEPTH).toBe(240);
        expect(SPACETIME_MARCH_DEFAULTS.layerAlpha).toBe(0.12);
        expect(SPACETIME_MARCH_DEFAULTS.maxSteps).toBe(512);
        const { view } = createView({ depth: undefined });
        expect(view.depth).toBe(240);
        expect(view.getOptions()).toEqual({ ...SPACETIME_MARCH_DEFAULTS });
    });
});

describe('what a redraw is allowed to cost', () => {
    it('re-uploads nothing for a camera move, a slice, or a palette change', () => {
        const { gl, view } = createView();
        view.setHistory([layerFor(1), layerFor(2), layerFor(3)]);
        const uploadsAfterFeeding = gl.callsNamed('texSubImage3D').length;

        view.orbit(0.3, -0.1);
        view.dolly(1.2);
        view.setCrossSection(1);
        view.setOptions({ layerAlpha: 0 });
        view.draw();
        // The whole reason the voxel byte is a LUT index: a repaint of the history costs 1 KB.
        view.setPalette({ palette: 'monochrome' });
        view.draw();

        expect(gl.callsNamed('texSubImage3D')).toHaveLength(uploadsAfterFeeding);
        expect(gl.callsNamed('texSubImage2D')).toHaveLength(1);
        expect(gl.callsNamed('texSubImage2D')[0].args[8]).toBe(128 * 2 * 4);
        expect(gl.callsNamed('drawArrays')).toHaveLength(2);
    });

    it('declines to draw an empty object instead of clearing to a lie', () => {
        const { gl, view } = createView();
        expect(view.draw()).toBe(false);
        // It still clears — the canvas is the host's, and a stale frame would be worse — but it
        // issues no draw call, so a host can key a placeholder off the return value.
        expect(gl.callsNamed('clear')).toHaveLength(1);
        expect(gl.callsNamed('drawArrays')).toHaveLength(0);

        view.pushLayer(layerFor(1));
        expect(view.draw()).toBe(true);
    });

    it('gives back every GL object it took', () => {
        const { gl, view } = createView();
        view.pushLayer(layerFor(1));
        expect(gl.liveObjects()).toEqual({ program: 1, texture: 2 }); // the volume and the LUT
        view.destroy();
        expect(gl.liveObjects()).toEqual({});
        expect(() => view.draw()).toThrow(/destroyed/);
    });
});

describe('the camera and the cross-section', () => {
    it('keeps the dolly inside the framing the object is built for', () => {
        const { view } = createView();
        for (let i = 0; i < 40; i++) view.dolly(1.5);
        expect(view.camera.distance).toBe(SPACETIME_CAMERA.maxDistance);
        for (let i = 0; i < 40; i++) view.dolly(0.5);
        expect(view.camera.distance).toBe(SPACETIME_CAMERA.minDistance);
        view.resetCamera();
        expect(view.camera.yaw).toBeCloseTo(SPACETIME_CAMERA.yaw, 12);
        expect(view.camera.pitch).toBeCloseTo(SPACETIME_CAMERA.pitch, 12);
        expect(view.camera.distance).toBe(SPACETIME_CAMERA.distance);
    });

    it('wraps both angles rather than stopping at the poles', () => {
        const { view } = createView({ camera: { yaw: 0, pitch: 0 } });
        view.orbit(0, Math.PI * 2.5);
        expect(view.camera.pitch).toBeCloseTo(Math.PI * 0.5, 6);
        view.orbit(-1, 0);
        expect(view.camera.yaw).toBeCloseTo(Math.PI * 2 - 1, 6);
    });

    it('reads a scrub bar the way the Explorer reports one', () => {
        const { view } = createView();
        view.setHistory([layerFor(1), layerFor(2), layerFor(3), layerFor(4)]);
        // `offset` is ticks back from the live tip — the same payload STATE_HISTORY_CHANGED carries.
        view.setScrub({ offset: 0, isScrubbing: true });
        expect(view.crossSection).toBe(3);
        view.setScrub({ offset: 2, isScrubbing: true });
        expect(view.crossSection).toBe(1);
        view.setScrub({ offset: 99, isScrubbing: true });
        expect(view.crossSection).toBe(0);
        // Not scrubbing means no plane: the object is shown whole.
        view.setScrub({ offset: 2, isScrubbing: false });
        expect(view.crossSection).toBe(-1);
    });

    it('drops the plane when the layers under it are dropped', () => {
        const { view } = createView();
        view.setHistory([layerFor(1), layerFor(2)]);
        view.setCrossSection(1);
        expect(view.crossSection).toBe(1);
        view.reset();
        expect(view.crossSection).toBe(-1);
        expect(view.layerCount).toBe(0);
    });
});

describe('Solid Garden consumes the entry from the package', () => {
    const page = read('public/solid-garden.html');
    const host = read('public/solid-garden.js');

    it('pins every entry to one exact published version, the package\'s own file', () => {
        const version = JSON.parse(read('packages/hexlife-embed/package.json')).version;
        for (const entry of ['api', 'sim', 'render', 'spacetime', 'solid']) {
            expect(page).toContain(
                `"@hexlife/embed/${entry}": "https://cdn.jsdelivr.net/npm/@hexlife/embed@${version}/src/embed/${entry}.js"`,
            );
        }
        expect(page).not.toContain('+esm');
        expect(page).not.toContain('@hexlife/embed@latest');
        // The page says which version it is built on; a stale claim there is a lie to the reader.
        expect(page).toContain(`@hexlife/embed@${version}</strong>`);
    });

    it('loads the 3D view optionally, so a lagging CDN costs only the preview', () => {
        // jsDelivr trails a publish by hours. Everything this page is FOR — growing the run,
        // welding it, reporting it, downloading it — must survive that window.
        expect(host).toContain("import('@hexlife/embed/spacetime')");
        expect(host).not.toMatch(/^import .*@hexlife\/embed\/spacetime/m);
        expect(host).toContain('staying flat');
    });

    it('feeds the preview the same states it feeds the extruder', () => {
        // Not a second derivation: `snapshots` is the array pushed into the solid stack, and the
        // object on screen has to be the object in the file.
        expect(host).toContain('solid.setHistory(layers)');
        expect(host).toMatch(/for \(let tick = 0; tick < snapshots\.length; tick \+= plan\.stride\)/);
        // Sized to exactly the layers it will hold, so a finished run fills the frame.
        expect(host).toContain('depth: layers,');
        // And the scrub bar cuts the solid rather than only redrawing the flat view.
        expect(host).toContain('spacetime.setCrossSection(slice ? Math.round(clamped / tickStride) : null)');
    });

    it('has both canvases in one frame, with the switch deciding which takes the pointer', () => {
        expect(page).toContain('id="stage-3d"');
        expect(page).toContain('id="stage"');
        expect(page).toContain('data-view="solid"');
        const css = read('public/solid-garden.css');
        // `visibility: hidden` and not `display: none`: a canvas removed from layout loses nothing,
        // but it also takes no pointer events — which is exactly how painting and orbiting are kept
        // from fighting over one drag, with no code to arbitrate them.
        expect(css).toContain("[data-view='solid'] #stage,");
        expect(css).toContain('visibility: hidden');
        // The `hidden` attribute loses to an author `display`, every time (see .garden-overlay).
        expect(css).toMatch(/\.garden-scrub\[hidden\]\s*\{\s*display: none;/);
    });
});
