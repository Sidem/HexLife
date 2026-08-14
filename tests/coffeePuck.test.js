import {readFile} from 'node:fs/promises';
import {beforeAll, describe, expect, it} from 'vitest';
import {blockRuleFromTet, HexHcp, initHcpEngine, sitePosition} from '../src/embed/hcp.js';
import {settleDecision} from '../public/coffee-puck-lab.js';
import {
    bedRange,
    diskCenter,
    diskIndices,
    DRIP_LAYERS,
    HEADSPACE_LAYERS,
    injectionSites,
    makePuckCells,
    PARTITION_PERIOD,
    puckDualQuantities,
    puckDualTransition,
    puckFall,
    puckSixFamiliesPreserved,
    puckSixTransition,
    quietTickLimit,
    SIX_PALETTE,
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

    it('lets a lone mate step into an empty hole so surface water can drain', () => {
        const tet = [0, 1, 0, 0];
        puckFall(tet, (state) => state < 3);
        expect(tet).toEqual([0, 0, 0, 1]);
    });

    it('lets a lone mate go around a grain', () => {
        const tet = [3, 1, 0, 0];
        puckFall(tet, (state) => state < 3);
        expect(tet).toEqual([3, 0, 0, 1]);
    });

    it('does not slide along the face when the apex is occupied', () => {
        const tet = [1, 0, 0, 3];
        puckFall(tet, (state) => state < 3);
        expect(tet).toEqual([1, 0, 0, 3]);
    });

    it('spends a dry grain on first contact with water', () => {
        const out = puckSixTransition([1, 3, 0, 0]);
        expect(out).toContain(5);
        expect(out).toContain(2);
        expect(out).not.toContain(3);
    });

    it('keeps dry, wet, spent and saturated visually far apart', () => {
        const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        expect(SIX_PALETTE[2][0]).toBeGreaterThan(SIX_PALETTE[2][2]);
        expect(SIX_PALETTE[2][0]).toBeGreaterThan(100);
        expect(dist(SIX_PALETTE[3], SIX_PALETTE[4])).toBeGreaterThan(80);
        expect(dist(SIX_PALETTE[4], SIX_PALETTE[5])).toBeGreaterThan(50);
        expect(dist(SIX_PALETTE[3], SIX_PALETTE[5])).toBeGreaterThan(120);
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
        const {lo, hi} = bedRange(8);
        expect(lo).toBeGreaterThan(1);
        expect(hi).toBeLessThan(7);
        expect(a.subarray(0, lo * layer).every((v) => v === 0)).toBe(true);
        expect(a.subarray(hi * layer).every((v) => v === 0)).toBe(true);
        expect(a.some((v) => v === 3)).toBe(true);
        expect(HEADSPACE_LAYERS).toBe(4);
        expect(DRIP_LAYERS).toBe(4);
    });

    it('scales quiet ticks with layers', () => {
        expect(quietTickLimit(24)).toBe(Math.max(240, 24 * PARTITION_PERIOD));
        expect(quietTickLimit(8, 12)).toBe(240);
    });

    it('does not treat a half alternate-period as settled', async () => {
        const host = await readFile(new URL('../public/coffee-puck-lab.js', import.meta.url), 'utf8');
        expect(host).toContain('SETTLE_TICKS_ALTERNATING');
        expect(host).toContain('headspaceHoldsFluid');
        expect(host).toContain('brewHasSettled');
        expect(host).toContain('settleDecision');
        expect(host).toContain('showerHasRoom');
        expect(host).not.toMatch(/brew\.still >= PARTITION_PERIOD \|\| brew\.tick > limit/);
        expect(host).not.toMatch(/if \(brew\.tick > limit\) return true/);
        expect(host).toContain('poured < budget && showerRoom');
    });
});

describe('coffee-puck page source policy', () => {
    it('lives on the coffee lab page, not as its own instrument', async () => {
        const lab = await readFile(new URL('../public/coffee-percolation.html', import.meta.url), 'utf8');
        const redirect = await readFile(new URL('../public/coffee-puck.html', import.meta.url), 'utf8');
        const host = await readFile(new URL('../public/coffee-puck-lab.js', import.meta.url), 'utf8');
        expect(redirect).toContain('coffee-percolation.html#puck');
        expect(lab).toContain('id="tab-puck"');
        expect(lab).toContain('id="p-yield"');
        expect(lab).toContain('id="p-model"');
        expect(host).toContain('puckDualTransition');
        expect(lab).toMatch(/from '\.\/coffee-puck-lab\.js\?v=/);
        expect(lab).toContain('@hexlife/embed@1.13.5');
        expect(lab).toContain("https://cdn.jsdelivr.net/npm/@hexlife/embed@1.13.5/src/embed/hcp.js");
        expect(lab).toContain('<hexlife-hcp');
        expect(host).toContain("import('@hexlife/embed/hcp')");
        expect(host).not.toMatch(/for\s*\([^)]*ncells/);
        expect(host).toContain('paintIf');
        expect(host).toContain('clearStatesInLayer');
        expect(lab).toContain('id="p-opacity"');
        expect(lab).toContain('id="p-spin"');
        expect(lab).toContain('id="p-diameter"');
        expect(lab).toMatch(/id="p-layers"[^>]*max="48"/);
    });
});

describe('3D host pour actually enters the bed', () => {
    it('drops dual-porosity water through empty headspace', () => {
        const rule = blockRuleFromTet(16, (tet) => puckDualTransition(tet));
        const layers = 8;
        const rows = 12;
        const cols = 8;
        const world = new HexHcp({states: 16, layers, rows, columns: cols, rule});
        world.setBlockAlternates(true);
        world.setCell(2 * cols + 2, 1);
        const layerSize = rows * cols;
        for (let i = 0; i < 48; i++) world.tick();
        let layer0 = 0;
        let below = 0;
        for (let i = 0; i < world.numCells; i++) {
            if (world.state[i] !== 1 && world.state[i] !== 2 && world.state[i] !== 3) continue;
            if (i < layerSize) layer0 += 1;
            else below += 1;
        }
        expect(below, `layer0=${layer0} below=${below}`).toBeGreaterThan(0);
        expect(layer0).toBe(0);
        world.dispose();
    });

    it('keeps pouring a dual puck instead of stalling with budget left', () => {
        const rule = blockRuleFromTet(16, (tet) => puckDualTransition(tet));
        const layers = 8;
        const rows = 12;
        const cols = 16;
        const world = new HexHcp({states: 16, layers, rows, columns: cols, rule});
        world.setBlockAlternates(true);
        world.setCells(makePuckCells({
            layers, rows, cols, packing: 0.55, seed: 0xC0FFEE, groundState: 6,
        }));
        const budget = Math.round(world.numCells * 0.06);
        let poured = 0;
        let still = 0;
        let stalled = 0;
        for (let tick = 0; tick < 400 && poured < budget; tick++) {
            const sites = injectionSites({
                rows, cols, flow: 12, mode: 'shower', tick, remaining: budget - poured,
            });
            const n = world.paintIf(0, sites, 0, 1);
            poured += n;
            const changed = world.tick();
            if (n === 0) stalled += 1;
            still = (n || changed !== 0) ? 0 : still + 1;
        }
        expect(poured, `poured ${poured} of ${budget}, stalled ${stalled}, still ${still}`).toBe(budget);
        world.dispose();
    });

    it('does not treat leftover budget as a choke while the shower has air', () => {
        const period = 12;
        const limit = 288;
        const leftover = {
            still: 12, poured: 3468, budget: 3871,
            headspaceFluid: false, showerRoom: true, period, limit,
        };
        expect(settleDecision(leftover), '403-cell leftover after 289×12 pours').toBe(false);
        expect(settleDecision({...leftover, still: 0})).toBe(false);
        expect(settleDecision({...leftover, still: 289, headspaceFluid: true})).toBe(false);
        expect(settleDecision({
            still: 288, poured: 3468, budget: 3871,
            headspaceFluid: true, showerRoom: false, period, limit,
        }), 'full shower + long quiet is a real choke').toBe(true);
        expect(settleDecision({
            still: 12, poured: 3871, budget: 3871,
            headspaceFluid: false, showerRoom: true, period, limit,
        }), 'budget met and quiet').toBe(true);
    });

    it('does not choke a demo-size dual shower under the host settle rule', () => {
        const rule = blockRuleFromTet(16, (tet) => puckDualTransition(tet));
        const layers = 24;
        const rows = 48;
        const cols = 56;
        const world = new HexHcp({states: 16, layers, rows, columns: cols, rule});
        world.setBlockAlternates(true);
        world.setCells(makePuckCells({
            layers, rows, cols, packing: 0.55, seed: 0xC0FFEE, groundState: 6,
        }));
        const budget = Math.round(world.numCells * 0.06);
        const period = 12;
        const limit = quietTickLimit(layers, period);
        const {lo} = bedRange(layers);
        const disk = diskIndices(rows, cols);
        let poured = 0;
        let still = 0;
        let tick = 0;
        let falseChoke = null;
        const headspaceFluid = () => {
            for (let layer = 0; layer < lo; layer++) {
                const census = world.layerCensus(layer);
                if ((census[1] || 0) + (census[2] || 0) + (census[3] || 0) > 0) return true;
            }
            return false;
        };
        const showerRoom = () => disk.some((index) => world.state[index] === 0);
        for (; tick < 800 && poured < budget; tick++) {
            const sites = injectionSites({
                rows, cols, flow: 12, mode: 'shower', tick, remaining: budget - poured,
            });
            const n = world.paintIf(0, sites, 0, 1);
            poured += n;
            world.clearStatesInLayer(layers - 1, 0b1110);
            const changed = world.tick();
            still = (n || changed !== 0) ? 0 : still + 1;
            const settled = settleDecision({
                still, poured, budget,
                headspaceFluid: headspaceFluid(),
                showerRoom: showerRoom(),
                period, limit,
            });
            if (settled && poured < budget) {
                falseChoke = {tick, poured, still};
                break;
            }
        }
        expect(falseChoke, falseChoke
            ? `host settle fired at tick ${falseChoke.tick} with ${budget - falseChoke.poured} unpoured`
            : '').toBeNull();
        expect(poured, `choked with ${budget - poured} unpoured at tick ${tick}`).toBe(budget);
        world.dispose();
    });
});

describe('gravity centre of mass', () => {
    it('drops one fluid cell with no systematic XY drift from all four parities', () => {
        const rule = blockRuleFromTet(6, puckSixTransition);
        const layers = 8;
        const rows = 12;
        const cols = 8;
        const drifts = [];
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
                drifts.push([p1.x - p0.x, p1.y - p0.y]);
                world.dispose();
            }
        }
        const meanX = drifts.reduce((sum, [dx]) => sum + dx, 0) / drifts.length;
        const meanY = drifts.reduce((sum, [, dy]) => sum + dy, 0) / drifts.length;
        const a = Math.sqrt(3);
        expect(Math.abs(meanX)).toBeLessThan(a);
        expect(Math.abs(meanY)).toBeLessThan(a);
    });

    it('does not walk a centre-stream pour out one side of an empty column', () => {
        const rule = blockRuleFromTet(6, puckSixTransition);
        const layers = 16;
        const rows = 12;
        const cols = 16;
        const world = new HexHcp({states: 6, layers, rows, columns: cols, rule});
        world.setBlockAlternates(true);
        const [cx, cy] = diskCenter(rows, cols);
        const disk = diskIndices(rows, cols);
        const centre = disk.reduce((best, index) => {
            const col = index % cols;
            const row = Math.floor(index / cols);
            const [x, y] = siteXY(row, col);
            const d = (x - cx) ** 2 + (y - cy) ** 2;
            return d < best.d ? {index, d, col, row} : best;
        }, {index: disk[0], d: Infinity, col: 0, row: 0});
        world.setCell(centre.row * cols + centre.col, 1);
        const p0 = sitePosition(centre.col, centre.row, 0, 1);
        for (let i = 0; i < 80; i++) world.tick();
        let sumX = 0;
        let sumY = 0;
        let count = 0;
        const layerSize = rows * cols;
        for (let i = 0; i < world.numCells; i++) {
            if (world.state[i] !== 1 && world.state[i] !== 2) continue;
            const layer = Math.floor(i / layerSize);
            const rem = i - layer * layerSize;
            const row = Math.floor(rem / cols);
            const col = rem - row * cols;
            const p = sitePosition(col, row, layer, 1);
            sumX += p.x;
            sumY += p.y;
            count += 1;
        }
        expect(count).toBeGreaterThan(0);
        const a = Math.sqrt(3);
        expect(Math.abs(sumX / count - p0.x)).toBeLessThan(2.5 * a);
        expect(Math.abs(sumY / count - p0.y)).toBeLessThan(2.5 * a);
        world.dispose();
    });
});
