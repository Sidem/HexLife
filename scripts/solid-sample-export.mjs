/**
 * Export a real object from the solid extrusion engine, for the phase gates that only a human can
 * clear: `docs/SOLID-PLAN.md` Phase 2 and Phase 3 both end with "opens clean in a slicer, as one
 * object", and no test can assert that.
 *
 * It doubles as the §8 budget harness — it prints triangle counts, byte counts, and stage timings
 * for the reference volume, which is what the Phase 3 gates are measured against.
 *
 *   node scripts/solid-sample-export.mjs [--rows 30] [--cols 36] [--ticks 100]
 *                                        [--sub 1] [--plate 2] [--seed 12345]
 *                                        [--format stl] [--merge none] [--out dist/solid-sample]
 *
 * Loaded through Vite (`ssrLoadModule`) rather than imported: `solid.js` resolves its Wasm with a
 * `?url` import that plain Node rejects, and the point is to exercise the SAME module the package
 * ships rather than a copy that can drift.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
    const options = {
        rows: 30,
        cols: 36,
        ticks: 100,
        sub: 1,
        plate: 2,
        seed: 12345,
        density: 0.35,
        ruleset: null,
        interpolate: 'bridge',
        keep: 'plate-connected',
        format: 'stl',
        merge: 'none',
        cellSize: 2,
        layerHeight: 0.8,
        out: 'dist/solid-sample',
    };
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index].replace(/^--/, '');
        const value = argv[index + 1];
        if (!(key in options)) throw new Error(`unknown option --${key}`);
        options[key] = typeof options[key] === 'number' ? Number(value) : value;
    }
    return options;
}

/**
 * A vacuum-stable growth ruleset — the Crystal Garden family. Vacuum stability is what makes the
 * bridge connectivity guarantee apply, so this is the configuration that provably prints as one
 * connected piece rather than the one that merely usually does.
 */
function crystalGardenRuleset(rulesetToHex, VACUUM_RULE_INDEX) {
    const table = new Uint8Array(128);
    for (let index = 0; index < 128; index++) {
        const centre = index >> 6;
        const liveNeighbors = popcount(index & 63);
        // Grow towards a neighbor or two, hold what already exists: a dense, connected crystal.
        table[index] = centre === 1 ? 1 : liveNeighbors >= 1 && liveNeighbors <= 2 ? 1 : 0;
    }
    table[VACUUM_RULE_INDEX] = 0;
    return rulesetToHex(table);
}

function popcount(value) {
    let count = 0;
    while (value) {
        value &= value - 1;
        count++;
    }
    return count;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const server = await createServer({
        root: REPO_ROOT,
        configFile: false,
        logLevel: 'error',
        server: { middlewareMode: true, watch: null },
    });

    try {
        // The loaders fetch their Wasm by URL, which has no meaning in Node. Serve both artifacts
        // off disk, dispatching on the URL so the solid engine and the simulating engine coexist.
        const solidWasm = readFileSync(path.join(REPO_ROOT, 'src/core/solid-wasm/hexlife_solid_wasm_bg.wasm'));
        const standardWasm = readFileSync(path.join(REPO_ROOT, 'src/core/wasm-engine/hexlife_wasm_bg.wasm'));
        const toBuffer = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        globalThis.fetch = async (url) => ({
            arrayBuffer: async () => toBuffer(String(url).includes('solid') ? solidWasm : standardWasm),
        });

        const solid = await server.ssrLoadModule('/src/embed/solid.js');
        const sim = await server.ssrLoadModule('/src/embed/sim.js');
        const rulesetHexModule = await server.ssrLoadModule('/src/core/rulesetHex.js');

        await solid.initSolidEngine();

        const hex = options.ruleset
            ?? crystalGardenRuleset(rulesetHexModule.rulesetToHex, rulesetHexModule.VACUUM_RULE_INDEX);
        if (!rulesetHexModule.isVacuumStable(hex)) {
            console.warn('warning: ruleset is not vacuum-stable, so nothing guarantees a connected object');
        }

        const world = await sim.createSimulation({
            rulesetHex: hex,
            rows: options.rows,
            columns: options.cols,
            seed: options.seed,
            density: options.density,
        });

        const startedAt = performance.now();
        const stack = solid.createSolidStack({
            rows: options.rows,
            cols: options.cols,
            ticks: options.ticks,
            interpolate: options.interpolate,
            subLayers: options.sub,
            basePlate: options.plate,
        });
        const layer = stack.layerView();
        for (let tick = 0; tick < options.ticks; tick++) {
            layer.set(world.state);
            stack.pushLayer();
            world.tick();
        }
        const ingestedAt = performance.now();

        const report = stack.finalize({ keepComponents: options.keep });
        const finalizedAt = performance.now();

        const bytes = await stack.export({
            format: options.format,
            cellSize: options.cellSize,
            layerHeight: options.layerHeight,
            merge: options.merge,
        });
        const exportedAt = performance.now();

        const outDir = path.join(REPO_ROOT, options.out);
        mkdirSync(outDir, { recursive: true });
        const name = `hexlife-${options.rows}x${options.cols}x${options.ticks}-${options.merge}.${options.format}`;
        const file = path.join(outDir, name);
        writeFileSync(file, bytes);

        const mm = (value) => `${value.toFixed(1)} mm`;
        console.log(`ruleset       ${hex}`);
        console.log(`grid          ${options.rows} rows x ${options.cols} cols, ${options.ticks} ticks`);
        console.log(`interpolate   ${options.interpolate}, subLayers ${options.sub}, basePlate ${options.plate}`);
        console.log(`volume        ${stack.totalLayers} layers, ${(stack.volumeBytes / 1024).toFixed(1)} KiB packed`);
        console.log(`size          ${mm(options.cols * 1.5 * options.cellSize)} x `
            + `${mm(options.rows * Math.sqrt(3) * options.cellSize)} x ${mm(stack.totalLayers * options.layerHeight)}`);
        console.log(`components    ${report.componentCount} found, ${report.keptComponents} kept, `
            + `${report.floating} floating`);
        console.log(`voxels        ${report.keptVoxels} kept, ${report.droppedVoxels} dropped`);
        console.log(`mesh          ${stack.triangleCount} triangles, ${stack.vertexCount} welded vertices`);
        console.log(`bytes         ${(bytes.byteLength / 1024 / 1024).toFixed(2)} MiB (${options.format}, merge=${options.merge})`);
        console.log(`timing        ingest ${(ingestedAt - startedAt).toFixed(0)} ms, `
            + `finalize ${(finalizedAt - ingestedAt).toFixed(0)} ms, `
            + `export ${(exportedAt - finalizedAt).toFixed(0)} ms, `
            + `total ${(exportedAt - startedAt).toFixed(0)} ms`);
        console.log(`wrote         ${path.relative(REPO_ROOT, file)}`);

        stack.free();
        world.dispose?.();
    } finally {
        await server.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
