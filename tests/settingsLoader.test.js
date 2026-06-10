import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Config from '../src/core/config.js';
import { SettingsLoader } from '../src/services/SettingsLoader.js';

// loadFromUrl reads window.location / window.history / document.title. The test env is `node`,
// so we install minimal stubs and drive them via `setSearch`.
function setSearch(search) {
    globalThis.window = {
        location: { search, pathname: '/HexLife/' },
        history: { replaceState() {} },
    };
    globalThis.document = { title: 'HexLife' };
}

describe('SettingsLoader.loadFromUrl', () => {
    afterEach(() => {
        delete globalThis.window;
        delete globalThis.document;
    });

    it('returns an empty object when no params are present', () => {
        setSearch('');
        expect(SettingsLoader.loadFromUrl()).toEqual({});
    });

    it('parses a single shared ruleset (`r`)', () => {
        const hex = Config.INITIAL_RULESET_CODE;
        setSearch(`?r=${hex}`);
        const out = SettingsLoader.loadFromUrl();
        expect(out.fromUrl).toBe(true);
        expect(out.rulesetHex).toBe(hex);
    });

    it('ignores a malformed single ruleset', () => {
        setSearch('?r=NOTHEX');
        const out = SettingsLoader.loadFromUrl();
        expect(out.rulesetHex).toBeUndefined();
    });

    it('parses per-world rulesets (`r_all`)', () => {
        const list = Array.from({ length: Config.NUM_WORLDS }, (_, i) =>
            i.toString(16).padStart(32, '0').toUpperCase(),
        );
        setSearch(`?r_all=${list.join(',')}`);
        const out = SettingsLoader.loadFromUrl();
        expect(out.rulesets).toEqual(list);
    });

    it('parses the compact density list (`d`)', () => {
        const densities = Array.from({ length: Config.NUM_WORLDS }, (_, i) => i / 10);
        setSearch(`?d=${densities.join(',')}`);
        const out = SettingsLoader.loadFromUrl();
        expect(out.densities).toEqual(densities);
    });

    it('rejects a density list of the wrong length', () => {
        setSearch('?d=0.1,0.2');
        const out = SettingsLoader.loadFromUrl();
        expect(out.densities).toBeUndefined();
    });

    it('round-trips the full initial-state JSON (`is`)', () => {
        const states = Array.from({ length: Config.NUM_WORLDS }, (_, i) => ({
            mode: 'density',
            params: { density: i / 10 },
        }));
        const encoded = encodeURIComponent(JSON.stringify(states));
        setSearch(`?is=${encoded}`);
        const out = SettingsLoader.loadFromUrl();
        expect(out.initialStates).toEqual(states);
    });

    it('parses enabled mask, selected world, grid size, and camera', () => {
        setSearch('?e=257&w=2&g=96&cam=100.5,200.5,1.75');
        const out = SettingsLoader.loadFromUrl();
        expect(out.enabledMask).toBe(257);
        expect(out.selectedWorldIndex).toBe(2);
        expect(out.gridRows).toBe(96);
        expect(out.camera).toEqual({ x: 100.5, y: 200.5, zoom: 1.75 });
    });

    it('rejects an out-of-range selected world and grid size', () => {
        setSearch(`?w=${Config.NUM_WORLDS}&g=4`);
        const out = SettingsLoader.loadFromUrl();
        expect(out.selectedWorldIndex).toBeUndefined();
        expect(out.gridRows).toBeUndefined();
    });

    it('mirrors generateShareUrl encoding for a representative setup', () => {
        // Build a query string the way WorldManager.generateShareUrl does, then parse it back.
        const params = new URLSearchParams();
        const hex = Config.INITIAL_RULESET_CODE;
        params.set('r', hex);
        params.set('d', ['0.000', '0.250', '0.500'].concat(
            Array(Config.NUM_WORLDS - 3).fill('0.500'),
        ).join(','));
        let enabledMask = 0;
        for (let i = 0; i < Config.NUM_WORLDS; i++) if (i !== 1) enabledMask |= (1 << i);
        params.set('e', String(enabledMask));
        params.set('w', '0');

        setSearch(`?${params.toString()}`);
        const out = SettingsLoader.loadFromUrl();
        expect(out.rulesetHex).toBe(hex);
        expect(out.densities.length).toBe(Config.NUM_WORLDS);
        expect(out.enabledMask).toBe(enabledMask);
        expect(out.selectedWorldIndex).toBe(0);
    });
});
