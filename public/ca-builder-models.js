/**
 * Model definitions shared by the coffee labs and the k-state CA builder.
 *
 * This module deliberately has no package import. A host materializes these pure transition
 * functions with `blockRuleFromTable` from `@hexlife/embed/ca`; keeping that boundary visible makes
 * the examples useful in a browser and keeps the physics independently testable in Node.
 */

const EMPTY = 0;

// Six-state extraction model.
const WATER = 1;
const SATURATED = 2;
const DRY = 3;
const WET = 4;
const SPENT = 5;
const MOBILE = 3;

// Sixteen-state dual-porosity model.
const D_AIR = 0;
const D_LIQ = [1, 2, 3];
const D_DRY = [4, 5, 6];
const D_WET = [
  [7, 8, 9],
  [10, 11, 12],
  [13, 14, 15],
];
const dFree = (state) => state <= 3;
const dLiquid = (state) => state >= 1 && state <= 3;
const dGround = (state) => state >= 4;
const dDry = (state) => state >= 4 && state <= 6;
const dWet = (state) => state >= 7;
const dConc = (state) => state - 1;
const dDryCharge = (state) => state - 4;
const dWetCharge = (state) => Math.floor((state - 7) / 3);
const dWetBound = (state) => (state - 7) % 3;

/**
 * One gravity step on the block partition's ordered triangle.
 *
 * Slots 0 and 2 share a column; slot 1 is down-right. The vertical 0→2 bond goes first. A half
 * bond opens only when the far end of the vertical bond is occupied, which lets a pool spread but
 * keeps an isolated parcel in exact vertical free fall. The coffee labs reflect alternate ticks to
 * cancel the remaining handedness of the single half-bond orientation.
 */
export function coffeeFall(out, mobile) {
  const m0 = mobile(out[0]);
  const m1 = mobile(out[1]);
  const m2 = mobile(out[2]);
  const swap = (a, b) => {
    [out[a], out[b]] = [out[b], out[a]];
  };
  if (m0 && m2 && out[0] > out[2]) {
    swap(0, 2);
    return;
  }
  if (m0 && m1 && out[2] !== EMPTY && out[0] > out[1]) {
    swap(0, 1);
    return;
  }
  if (m1 && m2 && out[0] !== EMPTY && out[1] > out[2]) swap(1, 2);
}

/** Six-state extraction transition: extract, wet, then fall. */
export function coffeeSixTransition(block) {
  const out = [...block];

  const water = out.indexOf(WATER);
  const wet = out.indexOf(WET);
  if (water !== -1 && wet !== -1) {
    out[water] = SATURATED;
    out[wet] = SPENT;
  }

  const hasFluid = out.some((state) => state < MOBILE && state !== EMPTY);
  if (hasFluid) {
    for (let i = 0; i < 3; i++) if (out[i] === DRY) out[i] = WET;
  }

  coffeeFall(out, (state) => state < MOBILE);
  return out;
}

function dTransfer(out, locked, can, act, verticalFirst = false) {
  const open = (a, b) => !locked[a] && !locked[b];
  const take = (a, b) => {
    act(out, a, b);
    locked[a] = true;
    locked[b] = true;
  };
  if (verticalFirst && open(0, 2) && can(out, 0, 2)) {
    take(0, 2);
    return;
  }
  const right = open(0, 1) && can(out, 0, 1);
  const left = open(1, 2) && can(out, 1, 2);
  if (right && !left) take(0, 1);
  else if (left && !right) take(1, 2);
  else if (open(0, 2) && can(out, 0, 2)) take(0, 2);
}

const dCanImbibe = (out, a, b) =>
  (dLiquid(out[a]) && dDry(out[b])) || (dLiquid(out[b]) && dDry(out[a]));
const dActImbibe = (out, a, b) => {
  const liquid = dLiquid(out[a]) ? a : b;
  const ground = liquid === a ? b : a;
  out[ground] = D_WET[dDryCharge(out[ground])][dConc(out[liquid])];
  out[liquid] = D_AIR;
};
const dCanWick = (out, a, b) =>
  (dWet(out[a]) && dDry(out[b])) || (dWet(out[b]) && dDry(out[a]));
const dActWick = (out, a, b) => {
  const source = dWet(out[a]) ? a : b;
  const destination = source === a ? b : a;
  out[destination] =
    D_WET[dDryCharge(out[destination])][dWetBound(out[source])];
  out[source] = D_DRY[dWetCharge(out[source])];
};
const dCanDrain = (out, a, b) => dWet(out[a]) && out[b] === D_AIR;
const dActDrain = (out, a, b) => {
  out[b] = D_LIQ[dWetBound(out[a])];
  out[a] = D_DRY[dWetCharge(out[a])];
};

/**
 * Sixteen-state dual-porosity transition.
 * @param {number[]} block
 * @param {{grindSlots?: number, wicking?: boolean}} [options]
 */
export function coffeeDualTransition(
  block,
  { grindSlots = 2, wicking = true } = {},
) {
  const out = [...block];
  const slots = Math.max(1, Math.min(3, Math.round(grindSlots)));

  // Dissolution inside a wet grain. Slot gating is the transition's local clock.
  for (let i = 3 - slots; i < 3; i++) {
    const state = out[i];
    if (dWet(state) && dWetCharge(state) > 0 && dWetBound(state) < 2) {
      out[i] = D_WET[dWetCharge(state) - 1][dWetBound(state) + 1];
    }
  }

  const locked = [false, false, false];
  dTransfer(out, locked, dCanImbibe, dActImbibe);
  dTransfer(out, locked, wicking ? dCanWick : () => false, dActWick);
  dTransfer(out, locked, dCanDrain, dActDrain, true);

  // Hydrodynamic dispersion between free parcels, exactly conserving dissolved solute.
  let low = -1;
  let high = -1;
  for (let i = 0; i < 3; i++) {
    if (!dLiquid(out[i])) continue;
    if (low === -1 || out[i] < out[low]) low = i;
    if (high === -1 || out[i] > out[high]) high = i;
  }
  if (low !== -1 && high !== low && out[high] - out[low] >= 2) {
    out[low]++;
    out[high]--;
  }

  coffeeFall(out, dFree);
  return out;
}

/** Exact family-count invariant used by the six-state lab. */
export function coffeeSixFamiliesPreserved(block, out) {
  const fluid = (values) => values.filter((state) => state < MOBILE).length;
  return fluid(block) === fluid(out);
}

/** Exact ground, liquid-unit, solute and phase invariants used by the dual-porosity lab. */
export function coffeeDualQuantities(block, out) {
  const ground = (state) => (dGround(state) ? 1 : 0);
  const liquid = (state) => (dLiquid(state) || dWet(state) ? 1 : 0);
  const solute = (state) =>
    dLiquid(state)
      ? dConc(state)
      : dWet(state)
        ? dWetCharge(state) + dWetBound(state)
        : dDry(state)
          ? dDryCharge(state)
          : 0;
  const sum = (values, metric) =>
    values.reduce((total, state) => total + metric(state), 0);
  return (
    [ground, liquid, solute].every(
      (metric) => sum(block, metric) === sum(out, metric),
    ) && block.every((state, index) => dGround(state) === dGround(out[index]))
  );
}

const dualNames = [
  "air",
  "fresh water",
  "medium brew",
  "strong brew",
  "spent dry grain",
  "half-charge dry grain",
  "charged dry grain",
  "spent wet · fresh",
  "spent wet · medium",
  "spent wet · strong",
  "half-charge wet · fresh",
  "half-charge wet · medium",
  "half-charge wet · strong",
  "charged wet · fresh",
  "charged wet · medium",
  "charged wet · strong",
];

export const CA_PRESETS = Object.freeze([
  {
    id: "coffee-six",
    name: "Coffee extraction · 6 states",
    description:
      "Fluid wets grounds, extracts once, and falls. Conserves fluid and ground families; alternate reflected ticks cancel the partition's handedness.",
    backend: "block",
    states: 6,
    rows: 66,
    speed: 18,
    palette: ["#12161a", "#3aa0ff", "#7a4b1e", "#8a6d55", "#5c452f", "#33281f"],
    stateNames: [
      "air",
      "water",
      "saturated water",
      "dry ground",
      "wet ground",
      "spent ground",
    ],
    transition: coffeeSixTransition,
    invariant: coffeeSixFamiliesPreserved,
    invariantLabel: "fluid + ground families",
  },
  {
    id: "coffee-dual",
    name: "Dual-porosity coffee · 16 states",
    description:
      "Grains hold liquid; dissolution, imbibition, wicking, drainage and dispersion are explicit, with alternate reflected ticks for unbiased transport.",
    backend: "block",
    states: 16,
    rows: 66,
    speed: 18,
    palette: [
      "#12161a",
      "#3aa0ff",
      "#b0763c",
      "#6d3f1b",
      "#4a3c31",
      "#7a6350",
      "#9a7b5f",
      "#35485c",
      "#40382a",
      "#422e1e",
      "#425a72",
      "#594c36",
      "#5b422b",
      "#4d6b86",
      "#6b5b40",
      "#6e5034",
    ],
    stateNames: dualNames,
    transition: (block) => coffeeDualTransition(block),
    invariant: coffeeDualQuantities,
    invariantLabel: "ground + liquid + solute",
  },
  {
    id: "blank-block",
    name: "Blank conservative block CA",
    description:
      "An identity k³ table: edit triangle transitions while preserving or breaking conservation deliberately.",
    backend: "block",
    states: 4,
    rows: 66,
    speed: 12,
    palette: ["#11161c", "#55b7ff", "#ffb454", "#d8dee9"],
    stateNames: ["empty", "particle A", "particle B", "solid"],
    transition: (block) => block,
    invariant: (block, out) =>
      [...block].sort((a, b) => a - b).join(",") ===
      [...out].sort((a, b) => a - b).join(","),
    invariantLabel: "per-state census",
  },
  {
    id: "blank-neighborhood",
    name: "Blank radius-1 hex CA",
    description:
      "An identity k⁷ table over the centre plus canonical SW, NW, N, NE, SE and S neighbours.",
    backend: "neighborhood",
    states: 3,
    rows: 66,
    speed: 12,
    palette: ["#11161c", "#62d6a7", "#f3c969"],
    stateNames: ["empty", "state 1", "state 2"],
    transition: (centre) => centre,
    invariant: null,
    invariantLabel: null,
  },
]);

export function caPreset(id) {
  return CA_PRESETS.find((preset) => preset.id === id) || CA_PRESETS[0];
}

/** Source for the preset's rule factory, used by the builder's self-contained HTML export. */
export function standaloneRuleSource(id) {
  if (id === "coffee-six") {
    return `const EMPTY = 0, WATER = 1, SATURATED = 2, DRY = 3, WET = 4, SPENT = 5, MOBILE = 3;
${coffeeFall.toString()}
${coffeeSixTransition.toString()}
const rule = blockRuleFromTable(6, coffeeSixTransition);`;
  }
  if (id === "coffee-dual") {
    return `const EMPTY = 0, WATER = 1;
const D_AIR = 0;
const D_LIQ = [1, 2, 3];
const D_DRY = [4, 5, 6];
const D_WET = [[7, 8, 9], [10, 11, 12], [13, 14, 15]];
const dFree = ${dFree.toString()};
const dLiquid = ${dLiquid.toString()};
const dGround = ${dGround.toString()};
const dDry = ${dDry.toString()};
const dWet = ${dWet.toString()};
const dConc = ${dConc.toString()};
const dDryCharge = ${dDryCharge.toString()};
const dWetCharge = ${dWetCharge.toString()};
const dWetBound = ${dWetBound.toString()};
${coffeeFall.toString()}
${dTransfer.toString()}
const dCanImbibe = ${dCanImbibe.toString()};
const dActImbibe = ${dActImbibe.toString()};
const dCanWick = ${dCanWick.toString()};
const dActWick = ${dActWick.toString()};
const dCanDrain = ${dCanDrain.toString()};
const dActDrain = ${dActDrain.toString()};
${coffeeDualTransition.toString()}
const rule = blockRuleFromTable(16, (block) => coffeeDualTransition(block));`;
  }
  if (id === "blank-neighborhood") {
    return "const rule = ruleFromTable(STATES, (centre, neighbours) => centre);";
  }
  return "const rule = blockRuleFromTable(STATES, (block) => block);";
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic, host-owned initial conditions for a preset and the element's actual dimensions. */
export function seedCaPreset(id, rows, columns, seed = 0xc0ffee) {
  const cells = new Uint8Array(rows * columns);
  const random = mulberry32(seed);
  if (id === "blank-block" || id === "blank-neighborhood") {
    const states = caPreset(id).states;
    for (
      let row = Math.floor(rows * 0.25);
      row < Math.ceil(rows * 0.75);
      row++
    ) {
      for (let col = 0; col < columns; col++) {
        if (random() < 0.16)
          cells[row * columns + col] = 1 + Math.floor(random() * (states - 1));
      }
    }
    return cells;
  }

  const bedTop = Math.floor(rows * 0.35);
  const bedBottom = Math.floor(rows * 0.82);
  const ground = id === "coffee-dual" ? D_DRY[2] : DRY;
  const packing = id === "coffee-dual" ? 0.45 : 0.3;
  for (let row = bedTop; row < bedBottom; row++) {
    for (let col = 0; col < columns; col++) {
      if (random() < packing) cells[row * columns + col] = ground;
    }
  }

  const centre = Math.floor(columns / 2);
  const halfWidth = Math.max(3, Math.floor(columns * 0.12));
  for (let row = Math.max(2, bedTop - 7); row < bedTop - 2; row++) {
    for (let col = centre - halfWidth; col <= centre + halfWidth; col++) {
      if (random() < 0.58)
        cells[row * columns + ((col + columns) % columns)] = WATER;
    }
  }
  return cells;
}
