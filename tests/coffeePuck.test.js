import {readFile} from 'node:fs/promises';
import {beforeAll, describe, expect, it} from 'vitest';
import {blockRuleFromTet, HexHcp, initHcpEngine, sitePosition} from '../src/embed/hcp.js';
import {
    diskCenter,
    diskIndices,
    injectionSites,
    makePuckCells,
    PARTITION_PERIOD,
    puckDualQuantities,
    puckDualTransition,
    puckFall,
    puckSixFamiliesPreserved,
    puckSixTransition,
    quietTickLimit,
    siteXY,
} from '../public/coffee-puck-models.js';

beforeAll(async () => {
    const wasmPath = new URL('../src/core/hcp-wasm/hexlife_hcp_wasm_bg.wasm', import.meta.url);
    const bytes = await readFile(wasmPath);
    globalThis.fetch = async () => ({
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    await initHcpEngine();
});

describe('3D coffee tet rules', () => {
    it('preserves six-state families on every LUT entry', () => {
        const rule = blockRuleFromTet(6, puckSixTransition);
        for (let i = 0; i < rule.length; i++) {
            const input = [
                Math.floor(i / 216) % 6,
                Math.floor(i / 36) % 6,
                Math.floor(i / 6) % 6,
                i % 6,
            ];
            const packed = rule[i];
            const output = [packed & 255, (packed >>> 8) & 255, (packed >>> 16) & 255, (packed >>> 24) & 255];
            expect(puckSixFamiliesPreserved(input, output), `[${input}]`).toBe(true);
        }
    });

    it('preserves dual-porosity families on every LUT entry', () => {
        const rule = blockRuleFromTet(16, (tet) => puckDualTransition(tet));
        for (let i = 0; i < rule.length; i++) {
            const input = [
                Math.floor(i / 4096) % 16,
                Math.floor(i / 256) % 16,
                Math.floor(i / 16) % 16,
                i % 16,
            ];
            const packed = rule[i];
            const output = [packed & 255, (packed >>> 8) & 255, (packed >>> 16) & 255, (packed >>> 24) & 255];
            expect(puckDualQuantities(input, output), `[${input}]`).toBe(true);
        }
    });
});

describe('puck host helpers', () => {
    it('does not tilt when both mates are equal', () => {
        const tet = [3, 1, 1, 0];
        puckFall(tet, (state) => state < 3);
        expect(tet).toEqual([3, 1, 1, 0]);
    });

    it('still drops the unique heavier mate', () => {
        const tet = [3, 2, 1, 0];
        puckFall(tet, (state) => state < 3);
        expect(tet).toEqual([3, 0, 1, 2]);
    });

    it('returns distinct disk injection sites', () => {
        const disk = new Set(diskIndices(12, 16));
        for (const mode of ['shower', 'centre', 'dump', 'pulse']) {
            const sites = injectionSites({rows: 12, cols: 16, flow: 5, mode, tick: 7, remaining: 40});
            expect(new Set(sites).size).toBe(sites.length);
            for (const index of sites) expect(disk.has(index)).toBe(true);
        }
    });

    it('ranks centre-stream sites by physical XY, not offset indices', () => {
        const rows = 12;
        const cols = 16;
        const disk = diskIndices(rows, cols);
        const [cx, cy] = diskCenter(rows, cols);
        const dist2 = (index) => {
            const col = index % cols;
            const row = Math.floor(index / cols);
            const [x, y] = siteXY(row, col);
            return (x - cx) ** 2 + (y - cy) ** 2;
        };
        const ranked = [...disk].sort((a, b) => dist2(a) - dist2(b) || a - b);
        const width = Math.max(1, Math.min(ranked.length, Math.floor(disk.length * 0.08) * 2 || 2));
        const pool = new Set(ranked.slice(0, width));
        const sites = injectionSites({rows, cols, flow: 4, mode: 'centre', tick: 0, remaining: 40});
        expect(sites.length).toBeGreaterThan(0);
        expect(pool.has(ranked[0])).toBe(true);
        for (const index of sites) expect(pool.has(index)).toBe(true);
    });

    it('builds a seeded disk with empty headspace and drip layers', () => {
        const a = makePuckCells({layers: 8, rows: 12, cols: 16, packing: 0.6, seed: 0xC0FFEE});
        const b = makePuckCells({layers: 8, rows: 12, cols: 16, packing: 0.6, seed: 0xC0FFEE});
        expect([...a]).toEqual([...b]);
        const layer = 12 * 16;
        expect(a.subarray(0, layer).every((v) => v === 0)).toBe(true);
        expect(a.subarray(7 * layer).every((v) => v === 0)).toBe(true);
        expect(a.some((v) => v === 3)).toBe(true);
    });

    it('scales quiet ticks with layers', () => {
        expect(quietTickLimit(24)).toBe(Math.max(240, 24 * PARTITION_PERIOD));
        expect(quietTickLimit(8, 12)).toBe(240);
    });
});

describe('coffee-puck page source policy', () => {
    it('declares engine hcp and has no host tet loop or per-tick setCells', async () => {
        const page = await readFile(new URL('../public/coffee-puck.html', import.meta.url), 'utf8');
        expect(page).toContain("from '@hexlife/embed/hcp'");
        expect(page).toContain('@hexlife/embed@1.13.3');
        expect(page).not.toMatch(/for\s*\([^)]*ncells/);
        expect(page).toContain('paintIf');
        expect(page).toContain('clearStatesInLayer');
        expect(page).toContain('dualPalette');
        expect(page).toContain('id="opacity"');
        expect(page).toContain('id="diameter"');
        expect(page).toMatch(/id="layers"[^>]*max="48"/);
        expect(page).not.toContain('id="size"');
        expect(page).toMatch(/id="flow"[^>]*max="240"/);
        expect(page).toMatch(/id="water"[^>]*max="8000"/);
        expect(page).toContain('https://cdn.jsdelivr.net/npm/@hexlife/embed@1.13.3/src/embed/hcp.js');
    });
});

describe('gravity centre of mass', () => {
    it('drops one fluid cell with no systematic XY drift from all four parities', () => {
        const rule = blockRuleFromTet(6, puckSixTransition);
        const layers = 8;
        const rows = 12;
        const cols = 8;
        for (const layer of [1, 2]) {
            for (const col of [2, 3]) {
                const world = new HexHcp({states: 6, layers, rows, columns: cols, rule});
                world.setBlockAlternates(true);
                const start = ((layer * rows) + 4) * cols + col;
                world.setCell(start, 1);
                const p0 = sitePosition(col, 4, layer, 1);
                for (let i = 0; i < 60; i++) world.tick();
                let found = -1;
                for (let i = 0; i < world.numCells; i++) {
                    if (world.state[i] === 1) {
                        found = i;
                        break;
                    }
                }
                expect(found).toBeGreaterThanOrEqual(0);
                const layerSize = rows * cols;
                const endLayer = Math.floor(found / layerSize);
                const rem = found - endLayer * layerSize;
                const endRow = Math.floor(rem / cols);
                const endCol = rem - endRow * cols;
                const p1 = sitePosition(endCol, endRow, endLayer, 1);
                expect(p1.z - p0.z, `layer ${layer} col ${col}`).toBeGreaterThan(0);
                const a = Math.sqrt(3);
                expect(Math.abs(p1.x - p0.x)).toBeLessThanOrEqual(a + 1e-9);
                expect(Math.abs(p1.y - p0.y)).toBeLessThanOrEqual(a + 1e-9);
                world.dispose();
            }
        }
    });
});
