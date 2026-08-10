import {gzipSync} from 'node:zlib';
import {readFile, readdir} from 'node:fs/promises';
import {beforeAll, describe, expect, it} from 'vitest';
import {
  initStochasticEngine,
  randomU32,
  STOCHASTIC_RNG_VERSION,
  StochasticWorld,
} from '../src/embed/stochastic.js';
import phase0Artifacts from './fixtures/performance/stochastic-phase0-artifacts.json';

const goldenVectors = [
  [0n, 0n, 0, 0, 1_713_891_541],
  [1n, 0n, 0, 0, 3_823_634_032],
  [0x0123_4567_89AB_CDEFn, 0x0FED_CBA9_8765_4321n, 42, 7, 2_762_555_518],
  [0xFFFF_FFFF_FFFF_FFFFn, 0xFFFF_FFFF_FFFF_FFFFn, 0xFFFF_FFFF, 0xFFFF_FFFF, 1_083_123_565],
];

beforeAll(async () => {
  const wasmPath = new URL('../src/core/stochastic-wasm/hexlife_stochastic_wasm_bg.wasm', import.meta.url);
  const bytes = await readFile(wasmPath);
  globalThis.fetch = async () => ({
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  await initStochasticEngine();
});

describe('WorldStochastic Phase-1 counter RNG', () => {
  it('matches the native Philox4x32-10 golden vectors through real Wasm', () => {
    expect(STOCHASTIC_RNG_VERSION).toBe(1);
    for (const [seed, generation, cell, stream, expected] of goldenVectors) {
      expect(randomU32(seed, generation, cell, stream)).toBe(expected);
    }
  });

  it('is tuple-addressed rather than call-order dependent', () => {
    const tuple = [99n, 123n, 17, 4];
    const expected = randomU32(...tuple);
    for (let cell = 0; cell < 100; cell++) randomU32(99n, 123n, cell, 9);
    expect(randomU32(...tuple)).toBe(expected);
    expect(randomU32(99n, 124n, 17, 4)).not.toBe(expected);
    expect(randomU32(99n, 123n, 17, 5)).not.toBe(expected);
  });

  it('validates integer widths before crossing the Wasm boundary', () => {
    expect(() => randomU32(-1, 0, 0, 0)).toThrow(/seed/);
    expect(() => randomU32(0, 2 ** 54, 0, 0)).toThrow(/generation/);
    expect(() => randomU32(0, 0, -1, 0)).toThrow(/cellIndex/);
    expect(() => randomU32(0, 0, 0, 2 ** 32)).toThrow(/streamId/);
  });
});

describe('WorldStochastic Phase-1 artifact shell', () => {
  it('owns geometry, topology, seed, and a live visible-state view without exposing a backend early', () => {
    const world = new StochasticWorld({rows: 6, columns: 8, seed: 0xCAFE_BABEn});
    expect(world.rows).toBe(6);
    expect(world.columns).toBe(8);
    expect(world.numCells).toBe(48);
    expect(world.seed).toBe(0xCAFE_BABEn);
    expect(world.generation).toBe(0n);
    expect(world.state).toBeInstanceOf(Uint8Array);
    expect([...world.state]).toEqual(new Array(48).fill(0));
    expect(world.sample(17, 4)).toBe(randomU32(world.seed, world.generation, 17, 4));
    expect(() => world.tick()).toThrow(/install a neighborhood rule/);
    world.dispose();
    expect(world.state).toBeNull();
  });

  it('refreshes earlier views when a later stochastic world grows the isolated memory', () => {
    const first = new StochasticWorld({rows: 6, columns: 8, seed: 1});
    const second = new StochasticWorld({rows: 300, columns: 346, seed: 2});
    expect(first.state).toHaveLength(48);
    expect(first.state.buffer.byteLength).toBeGreaterThan(0);
    expect(second.state).toHaveLength(103_800);
    first.dispose();
    second.dispose();
  });

  it('rejects topology that cannot close the odd-q torus', () => {
    expect(() => new StochasticWorld({rows: 6, columns: 7, seed: 1})).toThrow(/columns must be even/);
    expect(() => new StochasticWorld({rows: 0, columns: 8, seed: 1})).toThrow(/must be positive/);
  });
});

describe('WorldStochastic Phase-1 distribution isolation', () => {
  it('keeps the frozen default artifact within its size gate', async () => {
    const prior = phase0Artifacts.artifacts['src/core/wasm-engine/hexlife_wasm_bg.wasm'];
    const current = await readFile(new URL('../src/core/wasm-engine/hexlife_wasm_bg.wasm', import.meta.url));
    expect(current.byteLength).toBe(prior.rawBytes);
    expect(gzipSync(current, {level: 9}).byteLength).toBeLessThanOrEqual(prior.gzipBytes * 1.005);
  });

  it('exports only stochastic bindings from the second generated artifact', async () => {
    const glue = await readFile(
      new URL('../src/core/stochastic-wasm/hexlife_stochastic_wasm.js', import.meta.url),
      'utf8',
    );
    expect(glue).toContain('export class WorldStochastic');
    expect(glue).toContain('export function random_u32');
    expect(glue).not.toMatch(/export class World\b/);
    expect(glue).not.toContain('export class WorldK');
  });

  it('has one source entry importing the stochastic artifact and no default-entry edge to it', async () => {
    const embedDir = new URL('../src/embed/', import.meta.url);
    const files = (await readdir(embedDir)).filter((name) => name.endsWith('.js'));
    const importers = [];
    for (const file of files) {
      const source = await readFile(new URL(file, embedDir), 'utf8');
      if (source.includes('/stochastic-wasm/')) importers.push(file);
    }
    expect(importers).toEqual(['stochastic.js']);

    const manifest = JSON.parse(await readFile(new URL('../packages/hexlife-embed/package.json', import.meta.url)));
    expect(manifest.exports['./stochastic']).toEqual({
      types: './src/embed/stochastic.d.ts',
      import: './src/embed/stochastic.js',
      default: './src/embed/stochastic.js',
    });
  });
});
