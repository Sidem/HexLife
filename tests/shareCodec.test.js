import { describe, it, expect } from 'vitest';
import * as Config from '../src/core/config.js';
import { ShareCodec } from '../src/services/ShareCodec.js';

const HEX = '12482080480080006880800180010117';

function densityWorlds(densities, { disabled = [] } = {}) {
    return Array.from({ length: Config.NUM_WORLDS }, (_, i) => ({
        rulesetHex: HEX,
        initialState: { mode: 'density', params: { density: densities[i] } },
        enabled: !disabled.includes(i),
    }));
}

// Parse a full URL produced by encode() back through parseParams.
function parseUrl(url) {
    return ShareCodec.parseParams(new URL(url).searchParams);
}

describe('ShareCodec.parseParams', () => {
    it('returns {} for empty params', () => {
        expect(ShareCodec.parseParams(new URLSearchParams(''))).toEqual({});
    });
});

describe('ShareCodec encode -> parse round-trip', () => {
    const origin = 'https://sidem.github.io';
    const pathname = '/HexLife/';
    const center = Config.RENDER_TEXTURE_SIZE / 2;

    it('round-trips a shared ruleset, custom densities, disabled world, selection and camera', () => {
        const densities = Array.from({ length: Config.NUM_WORLDS }, (_, i) => (i + 1) / 20);
        const snapshot = {
            worldSettings: densityWorlds(densities, { disabled: [1] }),
            selectedWorldIndex: Config.DEFAULT_SELECTED_WORLD_INDEX === 0 ? 2 : 0,
            camera: { x: 100.5, y: 200.5, zoom: 1.75 },
            gridRows: Config.GRID_ROWS,
            origin,
            pathname,
        };

        const url = ShareCodec.encode(snapshot);
        expect(url.startsWith(`${origin}${pathname}?`)).toBe(true);

        const out = parseUrl(url);
        expect(out.fromUrl).toBe(true);
        // Single shared ruleset → `r`
        expect(out.rulesetHex).toBe(HEX);
        // Densities round-trip to 3-decimal precision.
        expect(out.densities.map(d => d.toFixed(3))).toEqual(densities.map(d => d.toFixed(3)));
        // World 1 disabled.
        expect((out.enabledMask & (1 << 1)) === 0).toBe(true);
        expect(out.selectedWorldIndex).toBe(snapshot.selectedWorldIndex);
        expect(out.camera).toEqual({ x: 100.5, y: 200.5, zoom: 1.75 });
    });

    it('uses r_all for per-world rulesets', () => {
        const worldSettings = densityWorlds(Array(Config.NUM_WORLDS).fill(0.5));
        worldSettings[0].rulesetHex = 'F'.repeat(32);
        const url = ShareCodec.encode({
            worldSettings,
            selectedWorldIndex: Config.DEFAULT_SELECTED_WORLD_INDEX,
            camera: { x: center, y: center, zoom: 1.0 },
            gridRows: Config.GRID_ROWS,
            origin,
            pathname,
        });
        const out = parseUrl(url);
        expect(out.rulesets).toHaveLength(Config.NUM_WORLDS);
        expect(out.rulesets[0]).toBe('F'.repeat(32));
        expect(out.rulesetHex).toBeUndefined();
    });

    it('omits default-valued params (default densities, default selection, default camera)', () => {
        const worldSettings = densityWorlds(
            Config.DEFAULT_INITIAL_DENSITIES.slice(0, Config.NUM_WORLDS),
        );
        const url = ShareCodec.encode({
            worldSettings,
            selectedWorldIndex: Config.DEFAULT_SELECTED_WORLD_INDEX,
            camera: { x: center, y: center, zoom: 1.0 },
            gridRows: Config.GRID_ROWS,
            origin,
            pathname,
        });
        const params = new URL(url).searchParams;
        expect(params.has('d')).toBe(false);
        expect(params.has('w')).toBe(false);
        expect(params.has('cam')).toBe(false);
        expect(params.has('e')).toBe(false);
        expect(params.has('g')).toBe(false);
        expect(params.get('r')).toBe(HEX);
    });

    it('round-trips full initial-state JSON (`is`) for non-density modes', () => {
        const worldSettings = Array.from({ length: Config.NUM_WORLDS }, (_, i) => ({
            rulesetHex: HEX,
            initialState:
                i === 0
                    ? { mode: 'cluster', params: { count: 3, radius: 5 } }
                    : { mode: 'density', params: { density: 0.5 } },
            enabled: true,
        }));
        const url = ShareCodec.encode({
            worldSettings,
            selectedWorldIndex: Config.DEFAULT_SELECTED_WORLD_INDEX,
            camera: { x: center, y: center, zoom: 1.0 },
            gridRows: Config.GRID_ROWS,
            origin,
            pathname,
        });
        const out = parseUrl(url);
        expect(out.initialStates).toHaveLength(Config.NUM_WORLDS);
        expect(out.initialStates[0]).toEqual({ mode: 'cluster', params: { count: 3, radius: 5 } });
    });
});
