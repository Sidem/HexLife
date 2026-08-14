import {readFile} from 'node:fs/promises';
import {beforeAll, describe, expect, it} from 'vitest';
import {blockRuleFromTet, HexHcp, initHcpEngine} from '../src/embed/hcp.js';
import {decodeHcpCode, encodeHcpCode, isHcpCode} from '../src/core/HcpCodec.js';

beforeAll(async () => {
    const wasmPath = new URL('../src/core/hcp-wasm/hexlife_hcp_wasm_bg.wasm', import.meta.url);
    const bytes = await readFile(wasmPath);
    globalThis.fetch = async () => ({
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    await initHcpEngine();
});

describe('HXP1 codec', () => {
    it('round-trips rule, geometry, alternation, generation and state', async () => {
        const rule = blockRuleFromTet(3, ([a, b, c, d]) => [d, c, b, a]);
        const cells = new Uint8Array(4 * 6 * 8);
        for (let i = 0; i < cells.length; i++) cells[i] = i % 3;
        const world = new HexHcp({
            states: 3, layers: 4, rows: 6, columns: 8, rule, cells, zBoundary: 'open',
        });
        world.setBlockAlternates(true);
        world.tick(5);
        const code = await encodeHcpCode({
            layers: world.layers,
            rows: world.rows,
            cols: world.columns,
            states: world.states,
            rule,
            cells: world.state,
            zBoundary: world.zBoundary,
            xyBoundary: world.xyBoundary,
            blockAlternates: world.blockAlternates,
            generation: world.generation,
            speed: 12,
            palette: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
        });
        expect(isHcpCode(code)).toBe(true);
        const decoded = await decodeHcpCode(code);
        expect(decoded.layers).toBe(4);
        expect(decoded.rows).toBe(6);
        expect(decoded.cols).toBe(8);
        expect(decoded.blockAlternates).toBe(true);
        expect(Number(decoded.generation)).toBe(5);
        expect([...decoded.cells]).toEqual([...world.state]);

        const resumed = new HexHcp({
            states: decoded.states,
            layers: decoded.layers,
            rows: decoded.rows,
            columns: decoded.cols,
            rule: decoded.rule,
            cells: decoded.cells,
            zBoundary: decoded.zBoundary,
        });
        resumed.setBlockAlternates(decoded.blockAlternates);
        resumed.setGeneration(Number(decoded.generation));
        world.tick();
        resumed.tick();
        expect([...resumed.state]).toEqual([...world.state]);
        world.dispose();
        resumed.dispose();
    });

    it('returns null for invalid codes and never throws', async () => {
        expect(await decodeHcpCode('nope')).toBeNull();
        expect(await decodeHcpCode('HXP1.%%%')).toBeNull();
        expect(await decodeHcpCode('HXK1.abc')).toBeNull();
        expect(isHcpCode(null)).toBe(false);
    });
});
