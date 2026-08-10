const ODD_COLUMN = [[-1, 1], [-1, 0], [0, -1], [1, 0], [1, 1], [0, 1]];
const EVEN_COLUMN = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [0, 1]];

export function neighborIndex(index, direction, rows, columns, wrap = false) {
  const row = Math.floor(index / columns);
  const column = index % columns;
  const [dc, dr] = (column & 1 ? ODD_COLUMN : EVEN_COLUMN)[direction];
  let nextRow = row + dr;
  let nextColumn = column + dc;
  if (wrap) {
    nextRow = (nextRow + rows) % rows;
    nextColumn = (nextColumn + columns) % columns;
  } else if (nextRow < 0 || nextRow >= rows || nextColumn < 0 || nextColumn >= columns) {
    return -1;
  }
  return nextRow * columns + nextColumn;
}

export function randomAt(seed, generation, index, salt = 0) {
  let value = (seed ^ Math.imul(generation + 1, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b) ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

export function combinedExposureProbability(perNeighborChance, exposedNeighbors) {
  const chance = Math.max(0, Math.min(1, perNeighborChance));
  return 1 - (1 - chance) ** Math.max(0, exposedNeighbors);
}

export function createGasModel(rows, columns, options = {}) {
  const seed = options.seed ?? 0x6a5c0111;
  const cells = new Uint8Array(rows * columns);
  const velocity = new Uint8Array(cells.length);
  let generation = 0;
  let collisions = 0;
  let membraneOpen = false;
  let params = {};

  function reset(nextParams = {}) {
    params = {density: 34, scatter: 8, ...nextParams};
    cells.fill(0);
    velocity.fill(0);
    generation = 0;
    collisions = 0;
    membraneOpen = false;
    const middle = Math.floor(columns / 2);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const index = row * columns + column;
        if (row === 0 || row === rows - 1 || column === 0 || column === columns - 1 || column === middle) {
          cells[index] = 3;
        } else if (randomAt(seed, 0, index, 11) < params.density / 100) {
          cells[index] = column < middle ? 1 : 2;
          velocity[index] = Math.floor(randomAt(seed, 0, index, 29) * 6);
        }
      }
    }
    return cells;
  }

  function openMembrane() {
    const middle = Math.floor(columns / 2);
    const start = Math.floor(rows * 0.34);
    const end = Math.ceil(rows * 0.66);
    for (let row = start; row < end; row++) cells[row * columns + middle] = 0;
    membraneOpen = true;
  }

  function step() {
    const claims = new Uint8Array(cells.length);
    const destinations = new Int32Array(cells.length).fill(-1);
    const nextCells = new Uint8Array(cells);
    const nextVelocity = new Uint8Array(velocity);
    collisions = 0;

    for (let index = 0; index < cells.length; index++) {
      if (cells[index] !== 1 && cells[index] !== 2) continue;
      let direction = velocity[index];
      if (randomAt(seed, generation, index, 71) < params.scatter / 100) {
        direction = (direction + (randomAt(seed, generation, index, 73) < 0.5 ? 1 : 5)) % 6;
      }
      const target = neighborIndex(index, direction, rows, columns, false);
      if (target < 0 || cells[target] === 3 || cells[target] === 1 || cells[target] === 2) {
        nextVelocity[index] = (direction + 3) % 6;
        collisions++;
        continue;
      }
      destinations[index] = target;
      claims[target]++;
      nextVelocity[index] = direction;
    }

    for (let index = 0; index < cells.length; index++) {
      const target = destinations[index];
      if (target < 0) continue;
      if (claims[target] === 1) {
        nextCells[target] = cells[index];
        nextVelocity[target] = nextVelocity[index];
        nextCells[index] = 0;
        nextVelocity[index] = 0;
      } else {
        nextVelocity[index] = (nextVelocity[index] + 3 + (index & 1)) % 6;
        collisions++;
      }
    }
    cells.set(nextCells);
    velocity.set(nextVelocity);
    generation++;
    return cells;
  }

  return {
    cells, velocity, reset, step, openMembrane,
    get generation() { return generation; },
    get collisions() { return collisions; },
    get membraneOpen() { return membraneOpen; },
  };
}

export function createWildfireModel(rows, columns, options = {}) {
  const seed = options.seed ?? 0xf1ae2026;
  const cells = new Uint8Array(rows * columns);
  const age = new Uint16Array(cells.length);
  let generation = 0;
  let params = {};

  function reset(nextParams = {}) {
    params = {forest: 76, spread: 22, wind: 'none', windBoost: 2, burnTicks: 2, ashTicks: 18, regrowth: 3, ...nextParams};
    cells.fill(0);
    age.fill(0);
    generation = 0;
    for (let row = 1; row < rows - 1; row++) {
      for (let column = 1; column < columns - 1; column++) {
        const index = row * columns + column;
        if (randomAt(seed, 0, index, 3) < params.forest / 100) cells[index] = 1;
      }
    }
    ignite('west');
    return cells;
  }

  function ignite(where = 'spot') {
    if (where === 'west') {
      for (let row = 2; row < rows - 2; row++) if (row % 3 !== 0) cells[row * columns + 3] = 2;
    } else {
      const center = Math.floor(rows / 2) * columns + Math.floor(columns / 2);
      cells[center] = 2;
      for (let direction = 0; direction < 6; direction++) {
        const index = neighborIndex(center, direction, rows, columns, false);
        if (index >= 0) cells[index] = 2;
      }
    }
  }

  function cutFirebreak() {
    const column = Math.floor(columns * 0.61);
    for (let row = 1; row < rows - 1; row++) {
      for (let offset = -1; offset <= 1; offset++) cells[row * columns + column + offset] = 0;
    }
  }

  function regrowNow() {
    for (let index = 0; index < cells.length; index++) if (cells[index] === 3) { cells[index] = 1; age[index] = 0; }
  }

  function windDirections() {
    return {east: [0, 1], west: [3, 4], north: [5], south: [2]}[params.wind] || [];
  }

  function step() {
    const next = new Uint8Array(cells);
    const windy = windDirections();
    for (let index = 0; index < cells.length; index++) {
      if (cells[index] === 1) {
        let survival = 1;
        for (let direction = 0; direction < 6; direction++) {
          const neighbor = neighborIndex(index, direction, rows, columns, false);
          if (neighbor >= 0 && cells[neighbor] === 2) {
            const boost = windy.includes(direction) ? Number(params.windBoost) : 1;
            survival *= 1 - Math.min(0.95, params.spread / 100 * boost);
          }
        }
        if (randomAt(seed, generation, index, 101) < 1 - survival) { next[index] = 2; age[index] = 0; }
      } else if (cells[index] === 2) {
        age[index]++;
        if (age[index] >= params.burnTicks) { next[index] = 3; age[index] = 0; }
      } else if (cells[index] === 3) {
        age[index]++;
        if (age[index] >= params.ashTicks && randomAt(seed, generation, index, 103) < params.regrowth / 100) {
          next[index] = 1;
          age[index] = 0;
        }
      }
    }
    cells.set(next);
    generation++;
    return cells;
  }

  return {cells, age, reset, step, ignite, cutFirebreak, regrowNow, get generation() { return generation; }};
}

export function createOutbreakModel(rows, columns, options = {}) {
  const seed = options.seed ?? 0x0b7bea4;
  const intervention = Boolean(options.intervention);
  const cells = new Uint8Array(rows * columns);
  const age = new Uint16Array(cells.length);
  let generation = 0;
  let totalInfections = 0;
  let params = {};

  function reset(nextParams = {}) {
    params = {infection: 12, infectiousTicks: 6, immunityTicks: 32, coverage: 18, efficacy: 82, ...nextParams};
    cells.fill(0);
    age.fill(0);
    generation = 0;
    totalInfections = 0;
    if (intervention) {
      for (let index = 0; index < cells.length; index++) {
        if (randomAt(seed, 0, index, 211) < params.coverage / 100) cells[index] = 3;
      }
    }
    const points = [[0.32, 0.35], [0.57, 0.62], [0.72, 0.24]];
    for (const [rowRatio, columnRatio] of points) {
      const center = Math.floor(rows * rowRatio) * columns + Math.floor(columns * columnRatio);
      cells[center] = 1;
      age[center] = 0;
    }
    return cells;
  }

  function vaccinateRing() {
    if (!intervention) return;
    const centerRow = rows / 2;
    const centerColumn = columns / 2;
    const radius = Math.min(rows, columns) * 0.23;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const index = row * columns + column;
        if (cells[index] === 0 && Math.abs(Math.hypot(row - centerRow, column - centerColumn) - radius) < 1.4) cells[index] = 3;
      }
    }
  }

  function step() {
    const next = new Uint8Array(cells);
    for (let index = 0; index < cells.length; index++) {
      const state = cells[index];
      if (state === 0 || state === 3) {
        let exposed = 0;
        for (let direction = 0; direction < 6; direction++) {
          const neighbor = neighborIndex(index, direction, rows, columns, true);
          if (cells[neighbor] === 1) exposed++;
        }
        if (exposed) {
          const efficacy = state === 3 ? params.efficacy / 100 : 0;
          const probability = combinedExposureProbability(params.infection / 100 * (1 - efficacy), exposed);
          if (randomAt(seed, generation, index, 307) < probability) {
            next[index] = 1;
            age[index] = 0;
            totalInfections++;
          }
        }
      } else if (state === 1) {
        age[index]++;
        if (age[index] >= params.infectiousTicks) { next[index] = 2; age[index] = 0; }
      } else if (state === 2) {
        age[index]++;
        if (params.immunityTicks > 0 && age[index] >= params.immunityTicks) { next[index] = 0; age[index] = 0; }
      }
    }
    cells.set(next);
    generation++;
    return cells;
  }

  return {
    cells, age, reset, step, vaccinateRing,
    get generation() { return generation; },
    get totalInfections() { return totalInfections; },
  };
}
