import {readFile} from 'node:fs/promises';
import {beforeAll, describe, expect, it} from 'vitest';
import {
    blockRuleFromTet,
    HexHcp,
    hcpSiteXyz,
    initHcpEngine,
    isConservative,
    isIsotropic,
    sitePosition,
} from '../src/embed/hcp.js';

beforeAll(async () => {
    const wasmPath = new URL('../src/core/hcp-wasm/hexlife_hcp_wasm_bg.wasm', import.meta.url);
    const bytes = await readFile(wasmPath);
    globalThis.fetch = async () => ({
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    await initHcpEngine();
});

function identityRule(k) {
    return blockRuleFromTet(k, (tet) => tet);
}

describe('hcp engine contracts', () => {
    it('matches JS and Rust site positions', () => {
        const js = sitePosition(3, 2, 1, 2);
        const rust = hcpSiteXyz(3, 2, 1, 2);
        expect(rust[0]).toBeCloseTo(js.x, 12);
        expect(rust[1]).toBeCloseTo(js.y, 12);
        expect(rust[2]).toBeCloseTo(js.z, 12);
    });

    it('reports identity as conservative and isotropic', () => {
        const rule = identityRule(4);
        expect(isConservative(4, rule)).toBe(true);
        expect(isIsotropic(4, rule)).toBe(true);
    });

    it('leaves an identity world unchanged and skip-on matches skip-off', () => {
        const on = new HexHcp({states: 4, layers: 4, rows: 6, columns: 8, rule: identityRule(4)});
        const off = new HexHcp({states: 4, layers: 4, rows: 6, columns: 8, rule: identityRule(4)});
        const cells = new Uint8Array(on.numCells);
        for (let i = 0; i < cells.length; i++) cells[i] = i % 4;
        on.setCells(cells);
        off.setCells(cells);
        off.setSkippingEnabled(false);
        for (let i = 0; i < 48; i++) {
            on.tick();
            off.tick();
        }
        expect([...on.state]).toEqual([...cells]);
        expect([...off.state]).toEqual([...on.state]);
        expect(on.checksum()).toBe(off.checksum());
        on.dispose();
        off.dispose();
    });

    it('paints and clears one layer without scanning the volume from JS', () => {
        const world = new HexHcp({states: 4, layers: 4, rows: 6, columns: 8});
        world.fill(1);
        expect(world.paintIf(0, [0, 1, 2], 1, 2)).toBe(3);
        expect(world.state[0]).toBe(2);
        expect(world.state[48]).toBe(1);
        const removed = world.clearStatesInLayer(3, 1 << 1);
        expect(removed[1]).toBe(48);
        expect(world.state[3 * 48]).toBe(0);
        const layer = world.layerCensus(0);
        expect(layer[2]).toBe(3);
        world.dispose();
    });

    it('records demo-size tick cost for the §11 audit', () => {
        const rule = identityRule(6);
        const world = new HexHcp({states: 6, layers: 24, rows: 48, columns: 56, rule});
        world.setSkippingEnabled(false);
        const cells = new Uint8Array(world.numCells);
        for (let i = 0; i < cells.length; i++) cells[i] = i % 6;
        world.setCells(cells);
        world.tick(6);
        const samples = [];
        for (let i = 0; i < 7; i++) {
            const start = performance.now();
            world.tick(12);
            samples.push(performance.now() - start);
        }
        samples.sort((a, b) => a - b);
        const p95 = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)];
        const perTick = p95 / 12;
        expect(perTick).toBeLessThan(4);
        world.dispose();
    });

    it('open Z never wraps layer L-1 onto 0', () => {
        const world = new HexHcp({states: 2, layers: 4, rows: 6, columns: 8, zBoundary: 'open'});
        const bottom = 3 * 48;
        for (let dir = 6; dir < 9; dir++) {
            expect(world.neighborOf(bottom, dir) >>> 0).toBe(0xffffffff);
        }
        world.dispose();
    });
});
