import {readFile} from 'node:fs/promises';
import {beforeAll, describe, expect, it} from 'vitest';
import {
  createOutbreakModel,
  createWildfireModel,
  neighborIndex,
  randomAt,
} from '../public/embed-concept-models.js';
import {
  neighborIndex as geometryNeighborIndex,
  randomAt as geometryRandomAt,
} from '../public/embed-demo-geometry.js';
import {
  outbreakInitialState,
  outbreakStochasticRule,
  outbreakVaccinateRing,
  wildfireCutFirebreak,
  wildfireIgnite,
  wildfireInitialState,
  wildfireRegrowAsh,
  wildfireStochasticRule,
  OUTBREAK_INFECTION_ROWS,
  OUTBREAK_SEED,
  WILDFIRE_SEED,
} from '../public/embed-stochastic-rules.js';
import {initStochasticEngine, StochasticWorld} from '../src/embed/stochastic.js';
import oracles from './fixtures/stochastic/js-oracles.json';

/**
 * The migration's own contract: the *page* now builds these worlds, so the page's builders have to
 * be the frozen ones.
 *
 * `stochasticPhase2.test.js` already proves the native engine reproduces the JavaScript oracle when
 * it is handed the oracle's own initial state. That leaves exactly one gap, and it is the one a
 * migration actually falls into: the production page no longer runs the oracle, so nothing would
 * notice if it seeded a *different* world and then reproduced that one perfectly. These tests close
 * it end to end — extracted seeding is byte-identical to the frozen model, and a world built the way
 * the page builds it lands on the recorded checksums.
 */

const WILDFIRE_PARAMS = {
  forest: 78,
  spread: 18,
  wind: 'none',
  windBoost: 2,
  burnTicks: 2,
  ashTicks: 20,
  regrowth: 5,
};

const OUTBREAK_PARAMS = {
  infection: 12,
  infectiousTicks: 6,
  immunityTicks: 36,
  coverage: 20,
  efficacy: 85,
};

beforeAll(async () => {
  const wasmPath = new URL('../src/core/stochastic-wasm/hexlife_stochastic_wasm_bg.wasm', import.meta.url);
  const bytes = await readFile(wasmPath);
  globalThis.fetch = async () => ({
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  await initStochasticEngine();
});

function oracleAt(id, generation) {
  return oracles.fixtures.find((fixture) => fixture.id === id).generations
    .find((entry) => entry.generation === generation);
}

describe('frozen demo geometry has exactly one definition', () => {
  it('is the same function the oracle models use', () => {
    expect(neighborIndex).toBe(geometryNeighborIndex);
    expect(randomAt).toBe(geometryRandomAt);
  });

  it('still refuses to wrap a finite grid and still hashes by tuple', () => {
    expect(neighborIndex(0, 0, 18, 24, false)).toBe(-1);
    expect(neighborIndex(0, 0, 18, 24, true)).toBeGreaterThanOrEqual(0);
    expect(randomAt(WILDFIRE_SEED, 0, 17, 3)).toBe(randomAt(WILDFIRE_SEED, 0, 17, 3));
    expect(randomAt(WILDFIRE_SEED, 0, 17, 3)).not.toBe(randomAt(WILDFIRE_SEED, 1, 17, 3));
  });
});

describe('Wildfire Command page builders match the frozen model', () => {
  it('seeds the identical generation-zero forest and ignition line', () => {
    const model = createWildfireModel(60, 70);
    model.reset(WILDFIRE_PARAMS);
    expect([...wildfireInitialState(60, 70, WILDFIRE_PARAMS)]).toEqual([...model.cells]);
    // The seed is part of the published run, not a page-level choice.
    expect(WILDFIRE_SEED).toBe(0xF1AE_2026);
  });

  it('applies the same three interventions', () => {
    const model = createWildfireModel(60, 70);
    model.reset(WILDFIRE_PARAMS);

    const spot = Uint8Array.from(model.cells);
    model.ignite('spot');
    expect([...wildfireIgnite(spot, 60, 70, 'spot')]).toEqual([...model.cells]);

    const cut = Uint8Array.from(model.cells);
    model.cutFirebreak();
    expect([...wildfireCutFirebreak(cut, 60, 70)]).toEqual([...model.cells]);

    // Ash only exists after some burning, so run the model far enough to make the test meaningful.
    for (let generation = 0; generation < 30; generation++) model.step();
    expect(model.cells.some((state) => state === 3)).toBe(true);
    const regrown = Uint8Array.from(model.cells);
    const ages = Uint16Array.from(model.age);
    model.regrowNow();
    expect([...wildfireRegrowAsh(regrown, ages)]).toEqual([...model.cells]);
    expect([...ages]).toEqual([...model.age]);
  });

  it('reproduces the recorded trajectory when built exactly as the page builds it', () => {
    const world = new StochasticWorld({
      rows: 60,
      columns: 70,
      seed: WILDFIRE_SEED,
      rule: wildfireStochasticRule(WILDFIRE_PARAMS),
      cells: wildfireInitialState(60, 70, WILDFIRE_PARAMS),
    });
    for (const generation of oracles.selectedGenerations) {
      while (Number(world.generation) < generation) world.tick();
      const oracle = oracleAt('wildfire-command', generation);
      expect(world.checksum(), `wildfire visible checksum at ${generation}`).toBe(oracle.visibleChecksum);
      expect(world.auxiliaryChecksum(), `wildfire age checksum at ${generation}`).toBe(oracle.auxiliaryChecksum);
    }
    world.dispose();
  });
});

describe('Outbreak Counterfactuals page builders match the frozen model', () => {
  for (const intervention of [false, true]) {
    it(`seeds the identical ${intervention ? 'intervention' : 'baseline'} population`, () => {
      const model = createOutbreakModel(54, 64, {intervention});
      model.reset(OUTBREAK_PARAMS);
      expect([...outbreakInitialState(54, 64, OUTBREAK_PARAMS, {intervention})]).toEqual([...model.cells]);
      expect(OUTBREAK_SEED).toBe(0x0B7B_EA4);
    });
  }

  it('vaccinates the same ring', () => {
    const model = createOutbreakModel(54, 64, {intervention: true});
    model.reset(OUTBREAK_PARAMS);
    const ring = Uint8Array.from(model.cells);
    model.vaccinateRing();
    expect([...outbreakVaccinateRing(ring, 54, 64)]).toEqual([...model.cells]);
  });

  it('reproduces both recorded arms, including the ring intervention at generation 20', () => {
    for (const intervention of [false, true]) {
      const world = new StochasticWorld({
        rows: 54,
        columns: 64,
        seed: OUTBREAK_SEED,
        rule: outbreakStochasticRule(OUTBREAK_PARAMS),
        cells: outbreakInitialState(54, 64, OUTBREAK_PARAMS, {intervention}),
      });
      const id = intervention ? 'outbreak-intervention' : 'outbreak-baseline';
      for (const generation of oracles.selectedGenerations) {
        while (Number(world.generation) < generation) {
          // The page applies the ring exactly here, through the intervention API and with the ages
          // carried across — the oracle's ring does not reset anybody's clock either.
          if (intervention && Number(world.generation) === 20) {
            const cells = world.snapshotCells();
            const ages = world.snapshotElapsedAges();
            world.setCells(outbreakVaccinateRing(cells, 54, 64), ages);
          }
          world.tick();
        }
        const oracle = oracleAt(id, generation);
        expect(world.checksum(), `${id} visible checksum at ${generation}`).toBe(oracle.visibleChecksum);
        expect(world.auxiliaryChecksum(), `${id} age checksum at ${generation}`).toBe(oracle.auxiliaryChecksum);
        const counts = world.transitionCounts();
        const infections = OUTBREAK_INFECTION_ROWS.reduce((sum, row) => sum + (counts[row] ?? 0), 0);
        expect(infections, `${id} infections at ${generation}`).toBe(oracle.totalInfections);
      }
      world.dispose();
    }
  });
});
