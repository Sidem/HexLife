import {readFile, readdir} from 'node:fs/promises';
import {beforeAll, describe, expect, it} from 'vitest';
import {hcpEngineVersion, HexHcp, initHcpEngine} from '../src/embed/hcp.js';

beforeAll(async () => {
    const wasmPath = new URL('../src/core/hcp-wasm/hexlife_hcp_wasm_bg.wasm', import.meta.url);
    const bytes = await readFile(wasmPath);
    globalThis.fetch = async () => ({
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    await initHcpEngine();
});

describe('hcp Phase-1 artifact isolation', () => {
    it('exports only HCP bindings from the fourth generated artifact', async () => {
        const glue = await readFile(
            new URL('../src/core/hcp-wasm/hexlife_hcp_wasm.js', import.meta.url),
            'utf8',
        );
        expect(glue).toContain('export class WorldHcp');
        expect(glue).toContain('export function hcp_engine_version');
        expect(glue).not.toMatch(/export class World\b/);
        expect(glue).not.toContain('export class WorldK');
        expect(glue).not.toContain('export class WorldStochastic');
        expect(glue).not.toContain('export class WorldSolid');
    });

    it('has one source entry importing the HCP artifact and no edge from any other entry', async () => {
        const embedDir = new URL('../src/embed/', import.meta.url);
        const files = (await readdir(embedDir)).filter((name) => name.endsWith('.js'));
        const importers = [];
        for (const file of files) {
            const source = await readFile(new URL(file, embedDir), 'utf8');
            if (source.includes('/hcp-wasm/')) importers.push(file);
        }
        expect(importers).toEqual(['hcp.js']);
    });

    it('does not reach back into the other three artifacts', async () => {
        const source = await readFile(new URL('../src/embed/hcp.js', import.meta.url), 'utf8');
        expect(source).not.toContain('/wasm-engine/');
        expect(source).not.toContain('/stochastic-wasm/');
        expect(source).not.toContain('/solid-wasm/');
    });

    it('is wired into all four places an embed entry point has to be declared', async () => {
        const root = new URL('../', import.meta.url);
        const viteConfig = await readFile(new URL('vite.embed.config.js', root), 'utf8');
        expect(viteConfig).toContain("hcp: 'src/embed/hcp.js'");
        expect(viteConfig).toContain("'hcp-element': 'src/embed/hcp-element.js'");

        const prepare = await readFile(new URL('scripts/prepare-embed-package.mjs', root), 'utf8');
        expect(prepare).toContain("['src/embed/hcp.d.ts', 'dist/embed-package/src/embed/hcp.d.ts']");
        expect(prepare).toContain("['src/embed/hcp-element.d.ts', 'dist/embed-package/src/embed/hcp-element.d.ts']");
        expect(prepare).toContain("['src/core/HcpCodec.d.ts', 'dist/embed-package/src/core/HcpCodec.d.ts']");

        const manifest = JSON.parse(await readFile(new URL('packages/hexlife-embed/package.json', root)));
        expect(manifest.exports['./hcp']).toEqual({
            types: './src/embed/hcp.d.ts',
            import: './src/embed/hcp.js',
            default: './src/embed/hcp.js',
        });
        expect(manifest.exports['./hcp-element']).toEqual({
            types: './src/embed/hcp-element.d.ts',
            import: './src/embed/hcp-element.js',
            default: './src/embed/hcp-element.js',
        });
        expect(manifest.sideEffects).toContain('./src/embed/hcp-element.js');
        expect(manifest.sideEffects).not.toContain('./src/embed/hcp.js');

        const appManifest = JSON.parse(await readFile(new URL('package.json', root)));
        expect(appManifest.scripts['build:wasm:hcp']).toContain('--features hcp');
        expect(appManifest.scripts['build:wasm:hcp']).toContain('src/core/hcp-wasm');
        expect(appManifest.scripts['build:embed']).toContain('build:wasm:hcp');
    });

    it('constructs an empty world and reports a version', () => {
        const world = new HexHcp({states: 4, layers: 4, rows: 6, columns: 8});
        expect(world.numCells).toBe(192);
        expect(world.layers).toBe(4);
        expect([...world.state]).toEqual(new Array(192).fill(0));
        expect(hcpEngineVersion()).toBe(1);
        world.dispose();
    });

    it('rejects geometry that cannot close the lattice', () => {
        expect(() => new HexHcp({states: 4, layers: 4, rows: 6, columns: 7})).toThrow(/even/);
        expect(() => new HexHcp({states: 4, layers: 4, rows: 7, columns: 8})).toThrow(/3/);
        expect(() => new HexHcp({states: 4, layers: 1, rows: 6, columns: 8})).toThrow();
        expect(() => new HexHcp({states: 4, layers: 4, rows: 6, columns: 8, stacking: 'fcc'})).toThrow(/hcp/);
    });
});

describe('hcp engine source policy', () => {
    it('keeps coffee vocabulary out of the engine', async () => {
        const rust = await readFile(new URL('../hexlife-wasm/src/hcp.rs', import.meta.url), 'utf8');
        const js = await readFile(new URL('../src/embed/hcp.js', import.meta.url), 'utf8');
        for (const source of [rust, js]) {
            expect(source).not.toMatch(/coffee|wet|spent|brew|puck/i);
        }
    });
});
