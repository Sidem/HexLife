import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {EMBED_DEMO_OWNERSHIP} from '../public/embed-demo-manifest.js';
import artifacts from './fixtures/performance/stochastic-phase0-artifacts.json';
import contract from './fixtures/performance/stochastic-phase0-contract.json';
import network from './fixtures/performance/stochastic-phase0-network-baseline.json';
import oracles from './fixtures/stochastic/js-oracles.json';

const demosHtml = readFileSync(new URL('../public/embed-demos.html', import.meta.url), 'utf8');
const labSource = readFileSync(new URL('../public/embed-concept-lab.js', import.meta.url), 'utf8');
const coffeeSource = readFileSync(new URL('../public/coffee-percolation.html', import.meta.url), 'utf8');

describe('WorldStochastic Phase-0 ownership freeze', () => {
  it('declares one engine family for every library card and reference instrument', () => {
    const declarations = [...demosHtml.matchAll(/data-demo-id="([^"]+)" data-engine="([^"]+)"/g)]
      .map(([, id, engine]) => ({id, engine}));
    expect(declarations).toHaveLength(EMBED_DEMO_OWNERSHIP.length);
    expect(declarations).toEqual(EMBED_DEMO_OWNERSHIP.map(({id, engine}) => ({id, engine})));
    expect(new Set(EMBED_DEMO_OWNERSHIP.map(({id}) => id)).size).toBe(EMBED_DEMO_OWNERSHIP.length);
    expect(EMBED_DEMO_OWNERSHIP.every(({engine}) => ['binary', 'k-state', 'stochastic', 'hcp'].includes(engine))).toBe(true);
  });

  /**
   * The migration's completion check, and the same test inverted.
   *
   * Until 2026-08-10 this asserted each recorded debt was still *present*, so that nobody could
   * quietly declare victory in the manifest while the host loop was still running. Phase B removed
   * them, so it now asserts the opposite — against the page sources, not the manifest, because the
   * manifest is a claim and the source is the fact.
   */
  it('has removed every recorded running-path debt from the pages themselves', () => {
    for (const {id, debts} of EMBED_DEMO_OWNERSHIP) {
      expect(debts, `${id} still declares a running-path debt`).toEqual([]);
    }

    // Wildfire and Mixing: no host model, no per-tick upload, no host clock.
    expect(labSource).not.toContain('model.step()');
    expect(labSource).not.toContain('createGasModel');
    expect(labSource).not.toContain('createWildfireModel');
    expect(labSource).toContain('world.setRule(item.rule(params))');
    // Outbreak: the common random schedule is the engine's shared stream, and the arms are two
    // native worlds. The one remaining interval only schedules ticks; it does not simulate.
    expect(labSource).not.toContain('createOutbreakModel');
    expect(labSource).toContain('left.tick(1); right.tick(1);');
    expect(labSource).toContain('OUTBREAK_INFECTION_ROWS');
    expect(labSource).not.toContain('function xorCount');
    expect(labSource).toContain('left.world.differenceCount(right.world)');
    // Butterfly: one persistent native mask, compared and published inside Wasm.
    expect(labSource).not.toContain('mask[index] = a[index] ^ b[index]');
    expect(labSource).toContain('mask.compareInto(left.sim, right.sim, diff.world)');
    // Synth: bounded native lanes instead of a per-beat snapshot and an unbounded index array.
    expect(labSource).not.toContain('births.push(i)');
    // The per-beat grid snapshot specifically. `snapshotCells()` survives elsewhere on purpose —
    // Butterfly's `perturb` reads a world out once per reset — and that is not a running path.
    expect(labSource).not.toContain('previous = world.sim.snapshotCells()');
    expect(labSource).toContain('meter.sample(world.sim)');
    expect(labSource).toContain('lanes.filter((index) => index !== null).length');
    expect(labSource).toContain('(world.checksum >>> 0).toString(16)');
    // Coffee: the conjugation is the engine's, on both labs.
    expect(coffeeSource).not.toContain('mirrorGrid(');
    expect(coffeeSource).toContain('lab.world.setBlockAlternates(true)');
    expect(coffeeSource).toContain('lab2.world.setBlockAlternates(true)');
  });

  it('loads the second Wasm artifact per demo rather than per page', () => {
    // Nine pages share one module. A static import would put the stochastic artifact on Crystal
    // Garden, which is the exact cost the separate artifact exists to avoid.
    expect(labSource).not.toMatch(/^import .*@hexlife\/embed\/stochastic/m);
    expect(labSource).toContain("import('@hexlife/embed/stochastic-element')");
    expect(labSource).toContain("import('@hexlife/embed/sim')");
  });
});

describe('WorldStochastic Phase-0 measurement freeze', () => {
  it('pins the required tiers, seven-run statistics, matrix, and thresholds', () => {
    expect(contract.measuredRuns).toBe(7);
    expect(contract.gridTiers).toEqual({
      demo: {rows: 72, columns: 84, cells: 6048},
      medium: {rows: 300, columns: 346, cells: 103800},
      large: {rows: 576, columns: 666, cells: 383616},
    });
    expect(Object.keys(contract.workloads)).toEqual([
      'World',
      'WorldK/neighborhood',
      'WorldK/block',
      'alternating-block',
      'JavaScript/stochastic-neighborhood',
      'JavaScript/lattice-gas',
    ]);
    expect(contract.thresholds.oldEngineMedianRegressionPctMax).toBe(3);
    expect(contract.thresholds.existingArtifactGzipGrowthPctMax).toBe(0.5);
    expect(contract.thresholds.nativeVsJsMediumSpeedupMin).toBe(2);
    expect(contract.thresholds.nativeVsJsLargeSpeedupMin).toBe(3);
    expect(contract.thresholds.coffeeMediumLargeSpeedupMin).toBe(2);
  });

  it('pins a zero-cost stochastic boundary for existing package consumers', () => {
    expect(artifacts.stochasticArtifactPresent).toBe(false);
    expect(Object.keys(artifacts.artifacts).some((path) => /stochastic/i.test(path))).toBe(false);
    expect(network.assertions).toEqual({
      rootStochasticRequests: 0,
      caStochasticRequests: 0,
      rootStochasticInstantiatedBytes: 0,
      caStochasticInstantiatedBytes: 0,
    });
    expect(network.stochasticOnly.available).toBe(false);
  });

  it('replays the current JavaScript differential oracles exactly', () => {
    expect(oracles.fixtures.map(({id}) => id)).toEqual([
      'mixing-chamber',
      'wildfire-command',
      'outbreak-baseline',
      'outbreak-intervention',
    ]);
    execFileSync(process.execPath, [
      fileURLToPath(new URL('../scripts/stochastic-oracle-fixtures.mjs', import.meta.url)),
    ]);
  });
});
