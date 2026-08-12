import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
import { SPACETIME_DEFAULTS, computeGeometry } from '../src/rendering/spacetime/SpacetimeView.js';

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
        expect(read('src/rendering/spacetime/SpacetimeView.js')).toContain('gl.deleteTexture(volumeTexture)');
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
        expect(source).toContain('Math.min(options.depth, Config.STATE_HISTORY_RING_SIZE, maxLayers)');
    });

    it('keeps the object inside the orbit camera framing at every grid preset', () => {
        for (const rows of Object.values(Config.GRID_SIZE_PRESETS)) {
            const { cols } = Config.deriveGridDimensions(rows);
            const geometry = computeGeometry(cols, rows, Config.STATE_HISTORY_RING_SIZE);
            const [halfX, halfY, halfZ] = geometry.boxHalf;
            // The footprint is normalised on its longer side, so one axis is exactly the target
            // half-extent and the other is no larger.
            expect(Math.max(halfX, halfZ)).toBeCloseTo(1.6, 6);
            expect(halfY).toBe(2.2);
            // The camera's closest dolly is 4.1 units out — the object must never swallow it.
            expect(Math.hypot(halfX, halfY, halfZ)).toBeLessThan(4);
        }
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

    it('draws from gl_VertexID so the pass owns no buffers', () => {
        expect(read('shaders/spacetime_vertex.glsl')).toContain('gl_VertexID');
        expect(read('src/rendering/spacetime/SpacetimeView.js')).toContain('gl.drawArrays(gl.TRIANGLES, 0, 3)');
    });
});
