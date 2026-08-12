import {gzipSync} from 'node:zlib';
import {readFile, readdir} from 'node:fs/promises';
import {beforeAll, describe, expect, it} from 'vitest';
import {
  initStochasticEngine,
  randomU32,
  STOCHASTIC_RNG_VERSION,
  StochasticWorld,
} from '../src/embed/stochastic.js';
import artifactExceptions from './fixtures/performance/stochastic-artifact-exceptions.json';
import phase0Artifacts from './fixtures/performance/stochastic-phase0-artifacts.json';
// #40 Phase 2's deliberate default-artifact growth, recorded and owner-ruled in its own file rather
// than folded into the §9 record above — that one's ruling explicitly refuses to be widened.
import spacetimeRecord from './fixtures/performance/spacetime-artifact-record.json';

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
  it('keeps the default artifact inside the frozen gate or a recorded exception', async () => {
    // The 0.5% ceiling is not moved. It may only be exceeded by a file named in the tracked
    // exception record, and a recorded exception moves that file's *baseline* and nothing else —
    // so an accepted trade cannot quietly become a licence for further growth.
    // See `stochastic-artifact-exceptions.json`.
    //
    // The 0.5% still applies on top of a recorded baseline, deliberately. §3 frames that figure as
    // build-metadata noise, and holding an exception-listed file to the exact byte would make it
    // *stricter* than an unlisted one — a single flipped constant elsewhere in the crate shifts the
    // compressed size by a handful of bytes, and freezing that is not what the ruling accepted.
    for (const [file, prior] of Object.entries(phase0Artifacts.artifacts)) {
      if (!file.startsWith('src/core/wasm-engine/')) continue;
      const current = await readFile(new URL(`../${file}`, import.meta.url));
      const gzip = gzipSync(current, {level: 9}).byteLength;
      // The most recent accepted ruling for this file wins; unlisted files stay on Phase 0's size.
      const exception = spacetimeRecord.files[file] ?? artifactExceptions.files[file];
      const baseline = exception ? exception.acceptedGzipBytes : prior.gzipBytes;
      expect(gzip, `${file} gzip`).toBeLessThanOrEqual(baseline * 1.005);
    }
    // Every recorded exception names the §9 analysis primitives, never the stochastic engine.
    expect(artifactExceptions.cause).toMatch(/§9/);
    expect(artifactExceptions.notCaused).toMatch(/zero bytes/);
  });

  it('leaves the stochastic artifact untouched by #40', async () => {
    // The whole point of the separate artifact: a feature added to `World` must cost the stochastic
    // engine nothing. #40 Phase 2 added an export to `World`, so this is the check that matters.
    for (const [file, prior] of Object.entries(phase0Artifacts.artifacts)) {
      if (!file.startsWith('src/core/stochastic-wasm/')) continue;
      const current = await readFile(new URL(`../${file}`, import.meta.url));
      expect(gzipSync(current, {level: 9}).byteLength, `${file} gzip`).toBe(prior.gzipBytes);
    }
    expect(spacetimeRecord.whatItDoesNotCost.stochasticArtifact).toMatch(/byte-identical/);
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
