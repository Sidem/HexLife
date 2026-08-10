/**
 * Canonical `HSN1` rules for the stochastic embed demos.
 *
 * One definition, used by the production pages *and* by the differential tests that prove the
 * native engine reproduces the frozen JavaScript oracles in `embed-concept-models.js` exactly.
 * Both demos declare `RNG_LEGACY_DEMO_V0`: their published trajectories are part of the demo, so
 * the migration keeps the original counter mapping rather than re-rolling every recorded run.
 */
/* eslint-disable import/no-unresolved */
import {
  compileGasRule,
  compileStochasticRule,
  hexGasCollide,
  independentNeighborChance,
  RNG_LEGACY_DEMO_V0,
} from '@hexlife/embed/stochastic';
/* eslint-enable import/no-unresolved */
import {neighborIndex, randomAt} from './embed-demo-geometry.js';

/**
 * The seeds the frozen oracles were recorded with.
 *
 * Load-bearing, not decorative. `RNG_LEGACY_DEMO_V0` reproduces a published trajectory only when the
 * world's seed is the one the recording used, so these travel with the rules rather than with the
 * page — a page that picked its own seed would run a *different* legal model and every differential
 * test would still pass.
 */
export const WILDFIRE_SEED = 0xF1AE_2026;
export const OUTBREAK_SEED = 0x0B7B_EA4;
export const MIXING_SEED = 0x6A5C_0111;

/** Canonical direction indices boosted by each wind setting, matching the frozen host model. */
const WIND_DIRECTIONS = {east: [0, 1], west: [3, 4], north: [5], south: [2]};

/** Visible states shared by both stochastic demos' palettes. */
export const WILDFIRE_STATES = Object.freeze({clearing: 0, forest: 1, fire: 2, ash: 3});
export const OUTBREAK_STATES = Object.freeze({
  susceptible: 0,
  infectious: 1,
  recovered: 2,
  vaccinated: 3,
});

/**
 * Wildfire Command: exposure-driven ignition, a fixed burn duration, then ash that regrows.
 *
 * Wind is a per-direction probability rather than a separate rule: the 64-entry mask table already
 * indexes which neighbors are burning, so a directional bias costs the engine nothing extra.
 */
export function wildfireStochasticRule(params) {
  const boosted = WIND_DIRECTIONS[params.wind] || [];
  const directionChance = Array.from({length: 6}, (_, direction) => {
    const boost = boosted.includes(direction) ? Number(params.windBoost) : 1;
    return Math.min(0.95, (params.spread / 100) * boost);
  });
  return compileStochasticRule({
    states: 4,
    rng: RNG_LEGACY_DEMO_V0,
    transitions: [
      {
        from: WILDFIRE_STATES.forest,
        neighborState: WILDFIRE_STATES.fire,
        probabilityByMask: independentNeighborChance(directionChance),
        to: WILDFIRE_STATES.fire,
        stream: 101,
      },
      {
        from: WILDFIRE_STATES.fire,
        minAge: params.burnTicks,
        probability: 1,
        to: WILDFIRE_STATES.ash,
      },
      {
        from: WILDFIRE_STATES.ash,
        minAge: params.ashTicks,
        probability: params.regrowth / 100,
        to: WILDFIRE_STATES.forest,
        stream: 103,
      },
    ],
  });
}

/**
 * Wildfire Command's exact generation-zero forest, including the western ignition line.
 *
 * A transcription of the frozen host model's `reset()`, kept here so the migrated page seeds the
 * *same* world the oracle recorded rather than an equivalent-looking one. `stochasticDemos.test.js`
 * asserts byte identity against that model, so a drift here fails rather than quietly re-rolling
 * every published run.
 */
export function wildfireInitialState(rows, columns, params, seed = WILDFIRE_SEED) {
  const cells = new Uint8Array(rows * columns);
  for (let row = 1; row < rows - 1; row++) {
    for (let column = 1; column < columns - 1; column++) {
      const index = row * columns + column;
      if (randomAt(seed, 0, index, 3) < params.forest / 100) cells[index] = 1;
    }
  }
  wildfireIgnite(cells, rows, columns, 'west');
  return cells;
}

/**
 * Set fire to the western line, or to a central spot and its six neighbours.
 *
 * Mutates in place and leaves ages alone, exactly as the host model did — an intervention that
 * silently reset a burning cell's age would extend its burn.
 */
export function wildfireIgnite(cells, rows, columns, where = 'spot') {
  if (where === 'west') {
    for (let row = 2; row < rows - 2; row++) {
      if (row % 3 !== 0) cells[row * columns + 3] = WILDFIRE_STATES.fire;
    }
    return cells;
  }
  const center = Math.floor(rows / 2) * columns + Math.floor(columns / 2);
  cells[center] = WILDFIRE_STATES.fire;
  for (let direction = 0; direction < 6; direction++) {
    const index = neighborIndex(center, direction, rows, columns, false);
    if (index >= 0) cells[index] = WILDFIRE_STATES.fire;
  }
  return cells;
}

/** Clear a three-column firebreak at 61% of the width. */
export function wildfireCutFirebreak(cells, rows, columns) {
  const column = Math.floor(columns * 0.61);
  for (let row = 1; row < rows - 1; row++) {
    for (let offset = -1; offset <= 1; offset++) {
      cells[row * columns + column + offset] = WILDFIRE_STATES.clearing;
    }
  }
  return cells;
}

/** Turn every ash cell back into forest, resetting only those cells' ages. */
export function wildfireRegrowAsh(cells, ages) {
  for (let index = 0; index < cells.length; index++) {
    if (cells[index] === WILDFIRE_STATES.ash) {
      cells[index] = WILDFIRE_STATES.forest;
      ages[index] = 0;
    }
  }
  return cells;
}

/**
 * Outbreak Counterfactuals: one rule for both arms of the study.
 *
 * Susceptible and vaccinated cells share the `307` stream deliberately. That is what makes the two
 * worlds a genuine counterfactual — the same cell draws the same number in both, so the only reason
 * a run diverges is the policy, never the random schedule.
 */
export function outbreakStochasticRule(params) {
  const exposure = params.infection / 100;
  return compileStochasticRule({
    states: 4,
    rng: RNG_LEGACY_DEMO_V0,
    transitions: [
      {
        from: OUTBREAK_STATES.susceptible,
        neighborState: OUTBREAK_STATES.infectious,
        probabilityByMask: independentNeighborChance(exposure),
        to: OUTBREAK_STATES.infectious,
        stream: 307,
      },
      {
        from: OUTBREAK_STATES.infectious,
        minAge: params.infectiousTicks,
        probability: 1,
        to: OUTBREAK_STATES.recovered,
      },
      {
        from: OUTBREAK_STATES.recovered,
        minAge: params.immunityTicks,
        probability: 1,
        to: OUTBREAK_STATES.susceptible,
      },
      {
        from: OUTBREAK_STATES.vaccinated,
        neighborState: OUTBREAK_STATES.infectious,
        probabilityByMask: independentNeighborChance(
          exposure * (1 - params.efficacy / 100),
        ),
        to: OUTBREAK_STATES.infectious,
        stream: 307,
      },
    ],
  });
}

/** Rows whose firings sum to the model's "total infections" counter. */
export const OUTBREAK_INFECTION_ROWS = Object.freeze([0, 3]);

/**
 * The exact generation-zero population for one arm of the study.
 *
 * Both arms share the three index cases and the same seed; only `intervention` adds the vaccinated
 * cohort. That is the whole design — with the exposure stream shared by the susceptible and
 * vaccinated rows, a divergence can only come from the policy.
 */
export function outbreakInitialState(rows, columns, params, {intervention = false} = {}, seed = OUTBREAK_SEED) {
  const cells = new Uint8Array(rows * columns);
  if (intervention) {
    for (let index = 0; index < cells.length; index++) {
      if (randomAt(seed, 0, index, 211) < params.coverage / 100) {
        cells[index] = OUTBREAK_STATES.vaccinated;
      }
    }
  }
  for (const [rowRatio, columnRatio] of [[0.32, 0.35], [0.57, 0.62], [0.72, 0.24]]) {
    cells[Math.floor(rows * rowRatio) * columns + Math.floor(columns * columnRatio)] = OUTBREAK_STATES.infectious;
  }
  return cells;
}

/** Vaccinate a ring of still-susceptible cells around the centre. Intervention arm only. */
export function outbreakVaccinateRing(cells, rows, columns) {
  const centerRow = rows / 2;
  const centerColumn = columns / 2;
  const radius = Math.min(rows, columns) * 0.23;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      if (
        cells[index] === OUTBREAK_STATES.susceptible
        && Math.abs(Math.hypot(row - centerRow, column - centerColumn) - radius) < 1.4
      ) {
        cells[index] = OUTBREAK_STATES.vaccinated;
      }
    }
  }
  return cells;
}

// ---- Diffusion & Mixing Chamber ---------------------------------------------------------------

/** Visible states projected from the six velocity channels of a lattice-gas site. */
export const MIXING_STATES = Object.freeze({
  vacuum: 0,
  amber: 1,
  cyan: 2,
  mixed: 3,
  wall: 4,
});

/**
 * The chamber's collision operator.
 *
 * The physics is the canonical two-species hexagonal operator; the demo's "thermal scattering"
 * control is the separate ±60° rotation term, which is why `scatter: 0` gives a strictly
 * momentum-conserving gas and anything above it does not.
 */
export function mixingGasRule(params) {
  return compileGasRule({collide: hexGasCollide, scatter: params.scatter / 100});
}

/** Deterministic per-channel seeding hash — no engine RNG, so a reset is reproducible offline. */
function chamberNoise(seed, index, channel) {
  let value = (seed ^ Math.imul(index + 1, 0x85EB_CA6B) ^ Math.imul(channel + 1, 0x9E37_79B1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7FEB_352D);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846C_A68B);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/**
 * Build the finite two-reservoir chamber: a complete perimeter wall plus a central membrane.
 *
 * The perimeter is what makes the vessel finite. The canonical neighbor table is toroidal, so
 * without a closed rim a particle would wrap; with it, every outbound channel meets a wall and
 * bounces back instead. `density` is channel occupancy, matching the benchmark workload names.
 */
export function mixingChamber(rows, columns, params, seed = 0x6A5C_0111) {
  const cellCount = rows * columns;
  const channels = new Uint8Array(cellCount * 6);
  const walls = new Uint8Array(cellCount);
  const middle = Math.floor(columns / 2);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      if (
        row === 0
        || row === rows - 1
        || column === 0
        || column === columns - 1
        || column === middle
      ) {
        walls[index] = 1;
        continue;
      }
      const species = column < middle ? MIXING_STATES.amber : MIXING_STATES.cyan;
      for (let channel = 0; channel < 6; channel++) {
        if (chamberNoise(seed, index, channel) < params.density / 100) {
          channels[index * 6 + channel] = species;
        }
      }
    }
  }
  return {channels, walls};
}

/** The membrane sites an "Open membrane" intervention clears — a native wall edit, nothing more. */
export function mixingMembraneSites(rows, columns) {
  const middle = Math.floor(columns / 2);
  const sites = [];
  for (let row = Math.floor(rows * 0.34); row < Math.ceil(rows * 0.66); row++) {
    sites.push(row * columns + middle);
  }
  return sites;
}
