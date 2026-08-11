import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {beforeAll, describe, expect, it} from 'vitest';
import {
  createSolidStack,
  initSolidEngine,
  INTERPOLATE_BRIDGE,
  INTERPOLATE_NONE,
  SOLID_STATES_BINARY,
  solidEngineVersion,
} from '../src/embed/solid.js';
import neighborDirs from '../src/core/neighbor-dirs.json';
import artifactBaseline from './fixtures/performance/solid-artifact-baseline.json';

beforeAll(async () => {
  const wasmPath = new URL('../src/core/solid-wasm/hexlife_solid_wasm_bg.wasm', import.meta.url);
  const bytes = await readFile(wasmPath);
  globalThis.fetch = async () => ({
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  await initSolidEngine();
});

describe('solid Phase-0 artifact isolation', () => {
  it('leaves the default and stochastic artifacts byte-identical to their pre-#39 state', async () => {
    // The whole justification for a third artifact is that it costs the other two nothing. That is
    // a claim about bytes, so it is checked as one — not as a size budget, which would let a small
    // leak hide inside the tolerance.
    for (const [file, expected] of Object.entries(artifactBaseline.artifacts)) {
      const bytes = await readFile(new URL(`../${file}`, import.meta.url));
      expect(bytes.byteLength, `${file} size`).toBe(expected.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), `${file} sha256`).toBe(expected.sha256);
    }
  });

  it('exports only solid bindings from the third generated artifact', async () => {
    const glue = await readFile(
      new URL('../src/core/solid-wasm/hexlife_solid_wasm.js', import.meta.url),
      'utf8',
    );
    expect(glue).toContain('export class WorldSolid');
    expect(glue).toContain('export function solid_engine_version');
    expect(glue).not.toMatch(/export class World\b/);
    expect(glue).not.toContain('export class WorldK');
    expect(glue).not.toContain('export class WorldStochastic');
  });

  it('has one source entry importing the solid artifact and no edge from any other entry', async () => {
    const embedDir = new URL('../src/embed/', import.meta.url);
    const files = (await readdir(embedDir)).filter((name) => name.endsWith('.js'));
    const importers = [];
    for (const file of files) {
      const source = await readFile(new URL(file, embedDir), 'utf8');
      if (source.includes('/solid-wasm/')) importers.push(file);
    }
    expect(importers).toEqual(['solid.js']);
  });

  it('does not reach back into the default or stochastic artifacts', async () => {
    const source = await readFile(new URL('../src/embed/solid.js', import.meta.url), 'utf8');
    expect(source).not.toContain('/wasm-engine/');
    expect(source).not.toContain('/stochastic-wasm/');
  });

  it('is wired into all four places an embed entry point has to be declared', async () => {
    const root = new URL('../', import.meta.url);

    const viteConfig = await readFile(new URL('vite.embed.config.js', root), 'utf8');
    expect(viteConfig).toContain("solid: 'src/embed/solid.js'");

    // Omitting the `.d.ts` from the explicit copy list is the exact bug that script exists to
    // catch: the JS resolves, the types 404, and a TypeScript consumer silently gets `any`.
    const prepare = await readFile(new URL('scripts/prepare-embed-package.mjs', root), 'utf8');
    expect(prepare).toContain("['src/embed/solid.d.ts', 'dist/embed-package/src/embed/solid.d.ts']");

    const manifest = JSON.parse(await readFile(new URL('packages/hexlife-embed/package.json', root)));
    expect(manifest.exports['./solid']).toEqual({
      types: './src/embed/solid.d.ts',
      import: './src/embed/solid.js',
      default: './src/embed/solid.js',
    });
    // DOM-free and registers nothing, so it must stay out of `sideEffects` or a bundler will keep
    // the whole artifact alive for a consumer that only imported a type.
    expect(manifest.sideEffects).not.toContain('./src/embed/solid.js');

    const appManifest = JSON.parse(await readFile(new URL('package.json', root)));
    expect(appManifest.scripts['build:wasm:solid']).toContain('--features solid');
    expect(appManifest.scripts['build:wasm:solid']).toContain('src/core/solid-wasm');
    expect(appManifest.scripts['build:embed']).toContain('build:wasm:solid');
  });
});

describe('solid Phase-0 geometry contract', () => {
  it('fixes the allocation plan from ticks, sub-layers, and the base plate', () => {
    const stack = createSolidStack({rows: 30, cols: 36, ticks: 100, subLayers: 1, basePlate: 2});
    expect(stack.rows).toBe(30);
    expect(stack.cols).toBe(36);
    expect(stack.numCells).toBe(1080);
    expect(stack.ticks).toBe(100);
    expect(stack.basePlate).toBe(2);
    expect(stack.solidStates).toBe(SOLID_STATES_BINARY);
    expect(stack.interpolate).toBe(INTERPOLATE_BRIDGE);
    expect(stack.totalLayers).toBe(2 + 100 * 2);
    expect(stack.volumeBytes).toBe(Math.ceil((1080 * 202) / 8));
    stack.free();
    expect(() => stack.totalLayers).toThrow(/freed/);
  });

  it("treats interpolate:'none' as zero synthesized layers whatever subLayers says", () => {
    const stack = createSolidStack({
      rows: 6,
      cols: 8,
      ticks: 10,
      interpolate: INTERPOLATE_NONE,
      subLayers: 3,
    });
    expect(stack.subLayers).toBe(0);
    expect(stack.totalLayers).toBe(10);
    stack.free();
  });

  it('rejects geometry that cannot close the odd-q torus or bound the volume', () => {
    expect(() => createSolidStack({rows: 6, cols: 7, ticks: 4})).toThrow(/columns must be even/);
    expect(() => createSolidStack({rows: 0, cols: 8, ticks: 4})).toThrow(/positive/);
    expect(() => createSolidStack({rows: 6, cols: 8, ticks: 0})).toThrow(/positive/);
    expect(() => createSolidStack({rows: 6, cols: 8, ticks: 4, solidStates: 0})).toThrow(/solidStates/);
    expect(() => createSolidStack({rows: 6, cols: 8, ticks: 4, interpolate: 'smooth'})).toThrow(
      /interpolate/,
    );
    expect(() => createSolidStack({rows: 4096, cols: 4096, ticks: 1024, subLayers: 0})).toThrow(
      /ceiling/,
    );
  });

  it('reports a version hosts can record with a recipe', () => {
    expect(solidEngineVersion()).toBe(1);
  });

  it('shares the canonical neighbor table on both lattice parities', () => {
    // §4: the mesh's adjacency must BE the simulation's adjacency. If these disagree, every lateral
    // cull decision is silently wrong and the result is a plausible-looking broken object — the
    // worst failure mode this engine has.
    //
    // The parity is by COLUMN despite the `odd_r`/`even_r` key names: this is a flat-top odd-q
    // lattice, so it is the columns that step half a row. Reading those names as rows produces a
    // table that is wrong on exactly half the grid.
    const rows = 6;
    const cols = 8;
    const stack = createSolidStack({rows, cols, ticks: 2});
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const table = col % 2 === 0 ? neighborDirs.even_r : neighborDirs.odd_r;
        const cell = row * cols + col;
        for (let direction = 0; direction < 6; direction++) {
          const [dc, dr] = table[direction];
          const expectedCol = (((col + dc) % cols) + cols) % cols;
          const expectedRow = (((row + dr) % rows) + rows) % rows;
          expect(stack.neighborOf(cell, direction)).toBe(expectedRow * cols + expectedCol);
        }
      }
    }
    expect(() => stack.neighborOf(rows * cols, 0)).toThrow(/out of range/);
    expect(() => stack.neighborOf(0, 6)).toThrow(/out of range/);
    stack.free();
  });
});
