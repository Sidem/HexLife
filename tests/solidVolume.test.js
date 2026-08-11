import {readFile} from 'node:fs/promises';
import {beforeAll, describe, expect, it} from 'vitest';
import {
  createSolidStack,
  initSolidEngine,
  INTERPOLATE_BRIDGE,
  INTERPOLATE_NONE,
  INTERPOLATE_UNION,
  FORMAT_STL,
  FORMAT_PLY,
  FORMAT_3MF,
  KEEP_ALL,
  KEEP_LARGEST,
  KEEP_PLATE_CONNECTED,
  MERGE_GREEDY,
  MERGE_NONE,
  solidMemoryBytes,
} from '../src/embed/solid.js';
import {createSimulation} from '../src/embed/sim.js';
import {isVacuumStable, rulesetToHex, VACUUM_RULE_INDEX} from '../src/core/rulesetHex.js';

// Both artifacts have to be live at once here: the point of this file is that the extruder is an
// engine-agnostic layer SINK, which is only proved by driving it from a real engine. So the fetch
// shim dispatches on the URL rather than serving one binary to everyone.
beforeAll(async () => {
  const solid = await readFile(new URL('../src/core/solid-wasm/hexlife_solid_wasm_bg.wasm', import.meta.url));
  const standard = await readFile(new URL('../src/core/wasm-engine/hexlife_wasm_bg.wasm', import.meta.url));
  const toBuffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  globalThis.fetch = async (url) => ({
    arrayBuffer: async () => toBuffer(String(url).includes('solid') ? solid : standard),
  });
  await initSolidEngine();
});

/** A deterministic 128-bit ruleset whose vacuum rule is forced quiet. */
function vacuumStableRuleset(seed) {
  let state = (seed * 2654435761) >>> 0;
  const table = new Uint8Array(128);
  for (let index = 0; index < 128; index++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    // Bias towards growth so the runs actually build something worth welding.
    table[index] = state % 5 === 0 ? 0 : 1;
  }
  table[VACUUM_RULE_INDEX] = 0;
  return rulesetToHex(table);
}

describe('solid volume ingestion from a real engine', () => {
  it('accepts one bulk layer copy per tick from a binary World', async () => {
    const rows = 12;
    const cols = 14;
    const ticks = 20;
    const sim = await createSimulation({
      rulesetHex: vacuumStableRuleset(7),
      rows,
      columns: cols,
      seed: 12345,
      density: 0.35,
    });
    const stack = createSolidStack({rows, cols, ticks, interpolate: INTERPOLATE_BRIDGE, subLayers: 1});
    const layer = stack.layerView();
    expect(layer).toHaveLength(rows * cols);

    for (let tick = 0; tick < ticks; tick++) {
      layer.set(sim.state);
      stack.pushLayer();
      sim.tick();
    }
    expect(stack.pushedLayers).toBe(ticks);
    expect(() => stack.pushLayer()).toThrow(/already been pushed/);

    const report = stack.finalize({keepComponents: KEEP_ALL});
    expect(stack.isFinalized).toBe(true);
    expect(report.keptVoxels).toBeGreaterThan(0);
    expect(report.droppedVoxels).toBe(0);
    expect(report.keptVoxels + report.droppedVoxels).toBeGreaterThan(0);
    stack.free();
    sim.dispose?.();
  });

  it('is a pure function of the run: same recipe, same volume', async () => {
    const build = async () => {
      const sim = await createSimulation({
        rulesetHex: vacuumStableRuleset(11),
        rows: 9,
        columns: 12,
        seed: 999,
        density: 0.4,
      });
      const stack = createSolidStack({rows: 9, cols: 12, ticks: 15, subLayers: 2, basePlate: 1});
      const layer = stack.layerView();
      for (let tick = 0; tick < 15; tick++) {
        layer.set(sim.state);
        stack.pushLayer();
        sim.tick();
      }
      const report = stack.finalize({keepComponents: KEEP_PLATE_CONNECTED});
      const checksum = stack.volumeChecksum();
      stack.free();
      sim.dispose?.();
      return {checksum, report};
    };
    const first = await build();
    const second = await build();
    expect(second.checksum).toBe(first.checksum);
    expect(second.report).toEqual(first.report);
  });

  /**
   * §9 test 6 with the real thing: actual vacuum-stable rulesets, actual `World` ticks, bridge
   * interpolation — nothing floats.
   *
   * The theorem: vacuum stability means birth requires a live neighbor, so every live cell at t+1
   * has a live cell in its neighborhood-or-self at t, and the bridge layer turns that relation into
   * a face path down to tick 0.
   */
  it('grounds every vacuum-stable ruleset to layer 0 under bridge interpolation', async () => {
    const rows = 9;
    const cols = 12;
    const ticks = 24;
    for (let variant = 0; variant < 12; variant++) {
      const hex = vacuumStableRuleset(variant + 1);
      expect(isVacuumStable(hex)).toBe(true);

      const sim = await createSimulation({
        rulesetHex: hex,
        rows,
        columns: cols,
        seed: 4242 + variant,
        density: 0.25,
      });
      const stack = createSolidStack({rows, cols, ticks, interpolate: INTERPOLATE_BRIDGE, subLayers: 1});
      const layer = stack.layerView();
      for (let tick = 0; tick < ticks; tick++) {
        layer.set(sim.state);
        stack.pushLayer();
        sim.tick();
      }
      const report = stack.finalize({keepComponents: KEEP_ALL});
      expect(report.floating, `ruleset variant ${variant} left matter floating`).toBe(0);
      stack.free();
      sim.dispose?.();
    }
  });
});

describe('solid volume interpolation and components', () => {
  /** Push `layers` (arrays of cell states) through a stack and finalize it. */
  const run = (options, layers, keepComponents = KEEP_ALL) => {
    const stack = createSolidStack({...options, ticks: layers.length});
    const view = stack.layerView();
    for (const cells of layers) {
      view.set(cells);
      stack.pushLayer();
    }
    const report = stack.finalize({keepComponents});
    return {stack, report};
  };

  const cellAt = (cols, row, col) => row * cols + col;

  it('welds diagonal space-time contact only when asked to bridge', () => {
    const rows = 6;
    const cols = 8;
    const first = new Uint8Array(rows * cols);
    first[cellAt(cols, 2, 2)] = 1;
    const second = new Uint8Array(rows * cols);
    second[cellAt(cols, 1, 3)] = 1;

    const bare = run({rows, cols, interpolate: INTERPOLATE_NONE}, [first, second]);
    expect(bare.report.componentCount).toBe(2);
    bare.stack.free();

    const bridged = run({rows, cols, interpolate: INTERPOLATE_BRIDGE, subLayers: 1}, [first, second]);
    expect(bridged.report.componentCount).toBe(1);
    bridged.stack.free();
  });

  it('does not fatten the way union does', () => {
    const rows = 6;
    const cols = 8;
    const first = new Uint8Array(rows * cols);
    first[cellAt(cols, 3, 3)] = 1;
    const second = new Uint8Array(rows * cols);
    for (let col = 0; col < cols; col++) second[cellAt(cols, 3, col)] = 1;

    const bridged = run({rows, cols, interpolate: INTERPOLATE_BRIDGE, subLayers: 1}, [first, second]);
    const unioned = run({rows, cols, interpolate: INTERPOLATE_UNION, subLayers: 1}, [first, second]);
    // Same endpoints, so the difference is entirely in the interpolation layer: union takes the
    // whole row, bridge takes only what actually touches.
    expect(bridged.report.keptVoxels).toBeLessThan(unioned.report.keptVoxels);
    bridged.stack.free();
    unioned.stack.free();
  });

  it('treats the lattice seam as a cut, not a wrap', () => {
    const rows = 6;
    const cols = 8;
    const cells = new Uint8Array(rows * cols);
    for (let row = 0; row < rows; row++) {
      cells[cellAt(cols, row, 0)] = 1;
      cells[cellAt(cols, row, cols - 1)] = 1;
    }
    const {stack, report} = run({rows, cols, interpolate: INTERPOLATE_NONE}, [cells, cells, cells]);
    // Toroidally these two columns are neighbors. On a build plate they are two objects.
    expect(report.componentCount).toBe(2);
    stack.free();
  });

  it('filters by policy and says what it dropped', () => {
    const rows = 6;
    const cols = 10;
    const cells = new Uint8Array(rows * cols);
    cells[cellAt(cols, 1, 1)] = 1;
    cells[cellAt(cols, 2, 1)] = 1;
    cells[cellAt(cols, 3, 1)] = 1;
    cells[cellAt(cols, 1, 8)] = 1;
    const layers = [cells, cells, cells];

    const all = run({rows, cols, interpolate: INTERPOLATE_NONE}, layers, KEEP_ALL);
    expect(all.report).toEqual({
      componentCount: 2,
      keptComponents: 2,
      keptVoxels: 12,
      droppedVoxels: 0,
      floating: 0,
    });
    all.stack.free();

    const largest = run({rows, cols, interpolate: INTERPOLATE_NONE}, layers, KEEP_LARGEST);
    expect(largest.report.keptComponents).toBe(1);
    expect(largest.report.keptVoxels).toBe(9);
    expect(largest.report.droppedVoxels).toBe(3);
    expect(largest.stack.voxelAt(cellAt(cols, 1, 8), 0)).toBe(false);
    largest.stack.free();
  });

  it('drops what never reaches the build surface', () => {
    const rows = 6;
    const cols = 10;
    const grounded = new Uint8Array(rows * cols);
    grounded[cellAt(cols, 2, 2)] = 1;
    const withFloater = new Uint8Array(grounded);
    withFloater[cellAt(cols, 4, 7)] = 1;

    const {stack, report} = run(
      {rows, cols, interpolate: INTERPOLATE_NONE, basePlate: 1},
      [grounded, withFloater, withFloater],
      KEEP_PLATE_CONNECTED,
    );
    expect(report.floating).toBe(1);
    expect(report.keptComponents).toBe(1);
    expect(report.droppedVoxels).toBe(2);
    stack.free();
  });

  it('makes the base plate real matter that everything above it can reach', () => {
    const rows = 4;
    const cols = 8;
    const empty = new Uint8Array(rows * cols);
    const {stack, report} = run({rows, cols, interpolate: INTERPOLATE_NONE, basePlate: 3}, [empty, empty]);
    expect(report.keptVoxels).toBe(3 * rows * cols);
    expect(report.componentCount).toBe(1);
    expect(stack.totalLayers).toBe(3 + 2);
    stack.free();
  });

  it('keeps earlier layer views valid when a later stack grows the memory', () => {
    const small = createSolidStack({rows: 6, cols: 8, ticks: 4, interpolate: INTERPOLATE_NONE});
    const view = small.layerView();
    view[0] = 1;
    // Big enough to force the isolated linear memory to grow, which detaches every existing view.
    const large = createSolidStack({rows: 120, cols: 140, ticks: 60, interpolate: INTERPOLATE_NONE});
    expect(small.layerView()).toHaveLength(48);
    expect(small.layerView()[0]).toBe(1);
    small.layerView().set(new Uint8Array(48).fill(1));
    small.pushLayer();
    expect(small.pushedLayers).toBe(1);
    large.free();
    small.free();
  });

  it('meshes and exports a real STL a slicer can open', async () => {
    const rows = 6;
    const cols = 8;
    const cells = new Uint8Array(rows * cols);
    cells[cellAt(cols, 2, 3)] = 1;
    const {stack} = run({rows, cols, interpolate: INTERPOLATE_NONE}, [cells]);

    const bytes = await stack.export({
      format: FORMAT_STL,
      cellSize: 2,
      layerHeight: 0.8,
      merge: MERGE_NONE,
    });
    // One isolated prism: six lateral quads and two four-triangle caps.
    expect(stack.triangleCount).toBe(20);
    expect(stack.vertexCount).toBe(12);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(84 + 20 * 50);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(80, true)).toBe(20);
    stack.free();
  });

  it('produces byte-identical exports for identical option blocks', async () => {
    const rows = 8;
    const cols = 10;
    const layers = [];
    let rng = 20260811;
    for (let tick = 0; tick < 6; tick++) {
      const cells = new Uint8Array(rows * cols);
      for (let cell = 0; cell < cells.length; cell++) {
        rng = (rng * 1103515245 + 12345) >>> 0;
        cells[cell] = rng % 3 === 0 ? 1 : 0;
      }
      layers.push(cells);
    }
    const build = async () => {
      const {stack} = run(
        {rows, cols, interpolate: INTERPOLATE_BRIDGE, subLayers: 1, basePlate: 1},
        layers,
        KEEP_PLATE_CONNECTED,
      );
      const bytes = await stack.export({format: FORMAT_STL, cellSize: 1.5, layerHeight: 0.6, merge: MERGE_NONE});
      const triangles = stack.triangleCount;
      stack.free();
      return {bytes, triangles};
    };
    const first = await build();
    const second = await build();
    expect(second.triangles).toBe(first.triangles);
    expect(Array.from(second.bytes)).toEqual(Array.from(first.bytes));
  });

  it('survives two exports from one stack even though export grows the memory', async () => {
    const rows = 6;
    const cols = 8;
    const cells = new Uint8Array(rows * cols).fill(1);
    const {stack} = run({rows, cols, interpolate: INTERPOLATE_NONE}, [cells, cells]);
    const first = await stack.export({format: FORMAT_STL, merge: MERGE_NONE});
    const second = await stack.export({format: FORMAT_STL, merge: MERGE_NONE});
    // The second export must not read a detached view or a half-overwritten buffer.
    expect(second.byteLength).toBe(first.byteLength);
    expect(Array.from(second)).toEqual(Array.from(first));
    stack.free();
  });

  it('rejects export options it cannot honour', async () => {
    const rows = 4;
    const cols = 8;
    const {stack} = run({rows, cols, interpolate: INTERPOLATE_NONE}, [new Uint8Array(rows * cols)]);
    await expect(stack.export({format: 'obj'})).rejects.toThrow(/format/);
    await expect(stack.export({merge: 'clever'})).rejects.toThrow(/merge/);
    await expect(stack.export({cellSize: 0, merge: MERGE_NONE})).rejects.toThrow(/positive/);
    stack.free();
  });

  /** An independent CRC-32, so the engine's checksum is checked rather than echoed. */
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  /**
   * Read a zip container the way a slicer would: from the end-of-central-directory record
   * backwards, never by trusting the order entries happen to appear in.
   */
  const readZip = async (bytes) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = bytes.length - 22;
    while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
    expect(end, 'no end-of-central-directory record').toBeGreaterThanOrEqual(0);

    const count = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    const entries = {};
    for (let index = 0; index < count; index++) {
      expect(view.getUint32(at, true)).toBe(0x02014b50);
      const method = view.getUint16(at + 10, true);
      const crc = view.getUint32(at + 16, true);
      const compressed = view.getUint32(at + 20, true);
      const uncompressed = view.getUint32(at + 24, true);
      const nameLength = view.getUint16(at + 28, true);
      const localAt = view.getUint32(at + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));

      expect(view.getUint32(localAt, true)).toBe(0x04034b50);
      const localNameLength = view.getUint16(localAt + 26, true);
      const extraLength = view.getUint16(localAt + 28, true);
      const dataAt = localAt + 30 + localNameLength + extraLength;
      const payload = bytes.subarray(dataAt, dataAt + compressed);

      const stream = new DecompressionStream(method === 8 ? 'deflate-raw' : 'gzip');
      const writer = stream.writable.getWriter();
      const written = writer.write(payload).then(() => writer.close());
      const inflated = new Uint8Array(await new Response(stream.readable).arrayBuffer());
      await written;
      expect(inflated.length, `${name} inflated length`).toBe(uncompressed);

      // A wrong CRC is the failure that opens in one reader and is rejected by the next, so it is
      // recomputed here rather than taken on trust from the header that declares it.
      expect(crc32(inflated), `${name} crc32`).toBe(crc);

      entries[name] = {crc, text: new TextDecoder().decode(inflated)};
      at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    }
    return entries;
  };

  /** A stack whose surface is worth merging: a tall run over an irregular footprint. */
  const tower = () => {
    const rows = 6;
    const cols = 8;
    const cells = new Uint8Array(rows * cols);
    cells[cellAt(cols, 2, 2)] = 1;
    cells[cellAt(cols, 2, 3)] = 1;
    cells[cellAt(cols, 3, 3)] = 1;
    return run({rows, cols, interpolate: INTERPOLATE_NONE}, Array.from({length: 12}, () => cells));
  };

  it('merges greedily by default and collapses the vertical runs', async () => {
    const merged = tower();
    await merged.stack.export({format: FORMAT_STL});
    const mergedTriangles = merged.stack.triangleCount;
    merged.stack.free();

    const bare = tower();
    await bare.stack.export({format: FORMAT_STL, merge: MERGE_NONE});
    const bareTriangles = bare.stack.triangleCount;
    bare.stack.free();

    // Twelve identical layers: every exposed wall is one run, so the walls cost what a single
    // layer's walls cost and only the two caps survive per column.
    expect(mergedTriangles).toBeLessThan(bareTriangles / 3);

    const explicit = tower();
    await explicit.stack.export({format: FORMAT_STL, merge: MERGE_GREEDY});
    expect(explicit.stack.triangleCount).toBe(mergedTriangles);
    explicit.stack.free();
  });

  it('reports how much of the merged mesh is caps', async () => {
    const {stack} = tower();
    await stack.export({format: FORMAT_STL});
    // Merging welds walls and leaves caps alone, so after it the caps are the majority term — the
    // measurement §5.5 defers the ear clipper behind, rather than a guess about it.
    expect(stack.capTriangleCount).toBeGreaterThan(0);
    expect(stack.capTriangleCount).toBeLessThanOrEqual(stack.triangleCount);
    stack.free();
  });

  it('writes an indexed binary PLY smaller than the same surface as STL', async () => {
    const {stack} = tower();
    const ply = await stack.export({format: FORMAT_PLY});
    const stl = await stack.export({format: FORMAT_STL});
    const header = new TextDecoder().decode(ply.subarray(0, 200));
    expect(header.startsWith('ply\nformat binary_little_endian 1.0\n')).toBe(true);
    expect(header).toContain(`element vertex ${stack.vertexCount}\n`);
    expect(header).toContain(`element face ${stack.triangleCount}\n`);
    expect(ply.byteLength).toBeLessThan(stl.byteLength);
    stack.free();
  });

  it('writes a 3MF that is a real zip carrying a real model in millimetres', async () => {
    const {stack} = tower();
    const bytes = await stack.export({format: FORMAT_3MF, cellSize: 2, layerHeight: 0.8});
    const entries = await readZip(bytes);

    expect(Object.keys(entries).sort()).toEqual([
      '3D/3dmodel.model',
      '[Content_Types].xml',
      '_rels/.rels',
    ]);
    // The relationship has to point at the part that actually exists, or a slicer opens the
    // archive, finds no model, and reports an empty file rather than an error.
    expect(entries['_rels/.rels'].text).toContain('Target="/3D/3dmodel.model"');
    expect(entries['[Content_Types].xml'].text).toContain('Extension="model"');

    const model = entries['3D/3dmodel.model'].text;
    expect(model).toContain('<model unit="millimeter"');
    expect(model.match(/<vertex /g)).toHaveLength(stack.vertexCount);
    expect(model.match(/<triangle /g)).toHaveLength(stack.triangleCount);
    expect(model).toContain('<item objectid="1"/>');
    // Every index the triangles reference must exist among the vertices.
    for (const [, v1, v2, v3] of model.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)) {
      for (const index of [v1, v2, v3]) {
        expect(Number(index)).toBeLessThan(stack.vertexCount);
      }
    }
    // Compression is the point of the container, not incidental to it.
    expect(bytes.byteLength).toBeLessThan(new TextEncoder().encode(model).byteLength);
    stack.free();
  });

  it('produces byte-identical containers for identical option blocks', async () => {
    const build = async () => {
      const {stack} = tower();
      const bytes = await stack.export({format: FORMAT_3MF, cellSize: 1.5, layerHeight: 0.6});
      stack.free();
      return bytes;
    };
    const first = await build();
    expect(Array.from(await build())).toEqual(Array.from(first));
  });

  it('keeps the merged and unmerged meshes describing the same object', async () => {
    // The volume is what defines the solid; merging only changes how the surface is written down.
    // So the report — components, kept matter, floating pieces — must not move at all.
    const merged = tower();
    await merged.stack.export({format: FORMAT_3MF});
    const bare = tower();
    await bare.stack.export({format: FORMAT_3MF, merge: MERGE_NONE});
    expect(merged.report).toEqual(bare.report);
    expect(merged.stack.volumeChecksum()).toBe(bare.stack.volumeChecksum());
    merged.stack.free();
    bare.stack.free();
  });

  it('exposes the artifact memory a host needs to budget a run', () => {
    expect(solidMemoryBytes()).toBeGreaterThan(0);
    // Its own memory, not the simulating engine's: the artifacts are separately instantiated.
    expect(solidMemoryBytes() % 65536).toBe(0);
  });

  /**
   * §8 gate 5 — the Solid Garden default export lands under 5 MB.
   *
   * The budget is not negotiable against the grid size: if this fails, the demo's default grid
   * shrinks. So the defaults are read out of the page itself rather than restated here, and the
   * pipeline is actually run — a number copied into a test would only pin the number.
   */
  it('keeps the demo page default export inside the 5 MB budget', async () => {
    const page = await readFile(new URL('../public/solid-garden.html', import.meta.url), 'utf8');
    const host = await readFile(new URL('../public/solid-garden.js', import.meta.url), 'utf8');

    const numeric = (id) => {
      const tag = page.match(new RegExp(`<input id="${id}"[^>]*>`))[0];
      return Number(tag.match(/value="([\d.]+)"/)[1]);
    };
    const selected = (id) => {
      const block = page.slice(page.indexOf(`<select id="${id}"`));
      return block.slice(0, block.indexOf('</select>')).match(/<option value="([^"]+)" selected>/)[1];
    };
    const defaults = {
      rows: numeric('rows'),
      cols: numeric('cols'),
      ticks: numeric('ticks'),
      subLayers: numeric('sub-layers'),
      basePlate: numeric('base-plate'),
      cellSize: numeric('cell-size'),
      layerHeight: numeric('layer-height'),
      interpolate: selected('interpolate'),
      keepComponents: selected('keep'),
      format: selected('format'),
      merge: selected('merge'),
    };
    // The default rule is the first preset, and the page starts from a single seed.
    const rulesetHex = host.match(/hex: '([0-9A-F]{32})'/)[1];
    expect(isVacuumStable(rulesetHex)).toBe(true);

    const initialCells = new Uint8Array(defaults.rows * defaults.cols);
    initialCells[Math.floor(defaults.rows / 2) * defaults.cols + Math.floor(defaults.cols / 2)] = 1;
    const sim = await createSimulation({
      rulesetHex,
      rows: defaults.rows,
      columns: defaults.cols,
      initialCells,
    });
    const stack = createSolidStack({...defaults, ticks: defaults.ticks});
    const layer = stack.layerView();
    for (let tick = 0; tick < defaults.ticks; tick++) {
      layer.set(sim.state);
      stack.pushLayer();
      sim.tick();
    }
    const report = stack.finalize({keepComponents: defaults.keepComponents});
    const bytes = await stack.export(defaults);

    expect(bytes.byteLength, `default export is ${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB`)
      .toBeLessThan(5 * 1024 * 1024);
    // And the default is the configuration that provably prints as one connected piece.
    expect(report.keptComponents).toBe(1);
    expect(report.floating).toBe(0);
    stack.free();
    sim.dispose?.();
  });

  it('refuses a half-pushed finalize and rejects unknown policies', () => {
    const stack = createSolidStack({rows: 4, cols: 8, ticks: 3, interpolate: INTERPOLATE_NONE});
    stack.layerView().set(new Uint8Array(32));
    stack.pushLayer();
    expect(() => stack.finalize()).toThrow(/of 3 layers pushed/);
    expect(() => stack.finalize({keepComponents: 'biggest'})).toThrow(/keepComponents/);
    stack.free();
    expect(() => stack.pushLayer()).toThrow(/freed/);
  });
});
