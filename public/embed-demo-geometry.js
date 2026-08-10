/**
 * Frozen lattice geometry and noise shared by the demo oracles and the migrated production pages.
 *
 * These three functions are *part of the published demos*, not implementation detail: the initial
 * state of every stochastic demo is derived from `randomAt`, and every finite demo's "no wrap" rule
 * is `neighborIndex(..., false)`. Both the frozen JavaScript oracle in `embed-concept-models.js` and
 * the native-engine pages import them from here so there is exactly one definition — a second copy
 * would let a migrated page seed a *different* world while every differential test still passed.
 *
 * Nothing here ticks a world. The models file keeps the host engines; this keeps the geometry.
 */

const ODD_COLUMN = [[-1, 1], [-1, 0], [0, -1], [1, 0], [1, 1], [0, 1]];
const EVEN_COLUMN = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [0, 1]];

/**
 * The canonical hex neighbour in `direction`, or `-1` off a finite grid's edge.
 *
 * `wrap: false` is what makes a demo's vessel finite: the engine's own neighbour table is toroidal,
 * so a demo that wants walls has to say so when it builds its initial state.
 */
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

/**
 * The frozen demo hash, addressed by `(seed, generation, index, salt)`.
 *
 * The same shape as the engine's counter RNG and for the same reason — no cursor, no call-order
 * dependence — which is why `RNG_LEGACY_DEMO_V0` can reproduce a published trajectory exactly.
 * Migrated pages use it only to *seed* a world; the ticks themselves happen in Wasm.
 */
export function randomAt(seed, generation, index, salt = 0) {
  let value = (seed ^ Math.imul(generation + 1, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b) ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

/** `1 - (1 - p)ⁿ` — independent exposure from `n` matching neighbours. */
export function combinedExposureProbability(perNeighborChance, exposedNeighbors) {
  const chance = Math.max(0, Math.min(1, perNeighborChance));
  return 1 - (1 - chance) ** Math.max(0, exposedNeighbors);
}
