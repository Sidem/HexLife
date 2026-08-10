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
    expect(EMBED_DEMO_OWNERSHIP.every(({engine}) => ['binary', 'k-state', 'stochastic'].includes(engine))).toBe(true);
  });

  it('keeps every identified running-path debt explicit until migration removes it', () => {
    const debtById = Object.fromEntries(EMBED_DEMO_OWNERSHIP.map(({id, debts}) => [id, debts]));
    expect(debtById['coffee-percolation']).toContain('two-full-grid-permutations-on-odd-ticks');
    expect(debtById['butterfly-microscope']).toContain('host-xor-scan');
    expect(debtById['cellular-synth']).toContain('host-birth-scan');
    expect(debtById['mixing-chamber']).toContain('four-tick-scratch-allocations');
    expect(debtById['wildfire-command']).toContain('full-grid-js-to-wasm');
    expect(debtById['outbreak-counterfactuals']).toContain('two-full-grid-js-to-wasm');

    expect(labSource).toContain('model.step(); world.setCells(model.cells);');
    expect(labSource).toContain('baseline.step(); intervention.step(); left.setCells(baseline.cells); right.setCells(intervention.cells);');
    expect(labSource).toContain('mask[index] = a[index] ^ b[index]');
    expect(labSource).toContain('for (let i = 0; i < next.length; i++) if (!previous[i] && next[i]) births.push(i)');
    expect(coffeeSource).toContain('mirrorGrid(lab.world, brew);');
    expect(coffeeSource).toContain('mirrorGrid(lab2.world, dBrew);');
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
