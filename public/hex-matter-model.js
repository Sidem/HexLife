/**
 * The Hex Matter sandbox: eight materials, their transport, and their reactions.
 *
 * Pure and package-free, exactly like `ca-builder-models.js`: a host materialises
 * {@link matterTransition} once with `blockRuleFromTable` from `@hexlife/embed/ca` and the engine
 * owns every tick after that. Keeping the physics here is what lets `tests/hexMatter.test.js` run
 * the whole model against a port of the engine's own block partition, in Node, with no Wasm.
 *
 * ## Why a liquid cell knows which column it is in
 *
 * The partition's triangle is `{cell, SE(cell), S(cell)}` — three cells at three *different*
 * heights, half a row apart each. That matters more than it sounds. On a flat-top odd-q lattice no
 * two neighbouring hexes share a height, so a rule that only ever moves mass downhill has no
 * horizontal move at all, and a liquid settles into a 30° cone: the slope of the diagonal bond, and
 * a fixed point of *every* purely downhill block rule. Sorting the three slots by density cannot
 * escape it, because every arrangement of `{gas, liquid, liquid}` but the sorted one puts mass
 * higher. Measured, not argued — `levels a dropped column of water` fails on any such rule.
 *
 * What breaks it is the one bond that is a step to the *same row*. Which slot pair that is depends
 * only on the base cell's column parity: from an even column the SE/SW neighbour is in the same row,
 * from an odd column it is one row below. A rule table is a function of three states and nothing
 * else, so the parity has to travel *in* the state — hence two states each for the materials that
 * need it:
 *
 *   - **fall**  — slots 0 → 2, one row straight down, the same column.
 *   - **slide** — one row down and one column across. Every material takes it; it is what gives a
 *     heap its angle of repose.
 *   - **lift**  — the same row, one column across, which on screen is half a hex *up*. Only
 *     something with no shear strength can make that step, so only a liquid does, and that single
 *     bond is the whole difference between a cone of water and a pool that finds its level.
 *
 * Air and the two liquids carry the bit; sand, stone, steam, plant and ember do not, because
 * nothing consults theirs. Each block re-encodes its output from the slot it lands in, so the
 * checkerboard is restored continuously and a brush stroke — which paints one fixed state value
 * into both column parities — costs at most a few ticks of local confusion. {@link repairParity}
 * is the host's belt to that pair of braces.
 */

/** The eight materials. These indices are the sandbox's public vocabulary. */
export const AIR = 0;
export const WATER = 1;
export const OIL = 2;
export const SAND = 3;
export const STONE = 4;
export const EMBER = 5;
export const STEAM = 6;
export const PLANT = 7;

export const MATERIALS = 8;
export const MATERIAL_NAMES = ['air', 'water', 'oil', 'sand', 'stone', 'ember', 'steam', 'plant'];
export const MATERIAL_COLORS = ['#091018', '#3ba7ff', '#e5a84b', '#d6bd78', '#65717f', '#ff654f', '#d9f2ff', '#61ae5b'];

/** How many ticks a flame lasts with nothing to eat. Three, so it sees all six of its neighbours. */
export const EMBER_LIFE = 3;

/**
 * Engine states. `k = 13`, inside the block backend's cap of 16.
 *
 * Air and the liquids come in an even-column and an odd-column flavour; the ember comes in three,
 * one per tick of flame left, which is also why it visibly cools as it dies.
 */
export const STATES = 13;
const AIR_EVEN = 0;
const WATER_EVEN = 2;
const OIL_EVEN = 4;
const SAND_STATE = 6;
const STONE_STATE = 7;
const STEAM_STATE = 8;
const PLANT_STATE = 9;
/** Indexed by remaining life − 1, so `EMBER_STATES[EMBER_LIFE - 1]` is a fresh flame. */
const EMBER_STATES = [10, 11, 12];

const MATERIAL_OF_STATE = [AIR, AIR, WATER, WATER, OIL, OIL, SAND, STONE, STEAM, PLANT, EMBER, EMBER, EMBER];
/** Column parity carried by each state, or −1 where the material does not carry one. */
const PARITY_OF_STATE = [0, 1, 0, 1, 0, 1, -1, -1, -1, -1, -1, -1, -1];
/** Remaining flame, or 0 for everything that is not an ember. */
const LIFE_OF_STATE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3];
/** Even-column state per material; the odd-column one is the next index where there is one. */
const EVEN_STATE_OF = [AIR_EVEN, WATER_EVEN, OIL_EVEN, SAND_STATE, STONE_STATE, EMBER_STATES[EMBER_LIFE - 1], STEAM_STATE, PLANT_STATE];

/** The colour of every engine state, in state order — the palette the element is given. */
export const STATE_COLORS = [
    '#091018', '#091018',
    '#3ba7ff', '#3ba7ff',
    '#e5a84b', '#e5a84b',
    '#d6bd78', '#65717f', '#d9f2ff', '#61ae5b',
    '#e04a2f', '#ff8b3d', '#ffca45',
];

/**
 * Bulk densities, in units where air is 3. Only the ordering is used, but the ordering is the
 * physics: quartz sand (≈1.6) sinks through both liquids, light oil (≈0.9) floats on water, and
 * water vapour at 100 °C (≈0.6 kg/m³) rises through air (1.2). Stone and plant never move, so their
 * entry only has to be unreachable.
 *
 * An ember is a glowing *particle*, not a flame — charcoal, around 0.4 — so it falls through air
 * and then floats on whatever liquid it lands on. Giving it flame's buoyancy instead was measurably
 * wrong: it rose off its own fuel within a tick and the fire never caught. The buoyant product of
 * the fire is the steam it gives off, which is what rises.
 */
export const DENSITY = [3, 6, 5, 8, 255, 4, 2, 255];

export const materialOf = (state) => MATERIAL_OF_STATE[state] ?? AIR;
export const lifeOf = (state) => LIFE_OF_STATE[state] ?? 0;
/** The column parity a state carries, or −1 for the materials that do not carry one. */
export const parityOf = (state) => PARITY_OF_STATE[state] ?? -1;

/** The state a `material` must take to sit in `column`. Embers are handed a full flame. */
export function stateFor(material, column) {
    const even = EVEN_STATE_OF[material];
    return PARITY_OF_STATE[even] === -1 ? even : even + (column & 1);
}

const isFixed = (material) => material === STONE || material === PLANT;
const isGas = (material) => material === AIR || material === STEAM || material === EMBER;
const isLiquid = (material) => material === WATER || material === OIL;
const isFuel = (material) => material === OIL || material === PLANT;

/**
 * One block of the partition.
 *
 * At most one reaction and at most one movement per block, so nothing is consumed twice and the
 * per-material census only ever changes where a reaction says it does.
 *
 * @param {ArrayLike<number>} block Three states, in the partition's slot order.
 * @param {{gravity?: number, reactions?: string}} [params]
 * @returns {number[]} Three states.
 */
export function matterTransition(block, {gravity = 3, reactions = 'full'} = {}) {
    const m = [materialOf(block[0]), materialOf(block[1]), materialOf(block[2])];
    const life = [lifeOf(block[0]), lifeOf(block[1]), lifeOf(block[2])];

    // The base column's parity, voted for by whichever slots carry one. Slots 0 and 2 are the base
    // column; slot 1 is the neighbour, so its bit votes the other way. A majority rather than the
    // first vote keeps a single mis-parity cell — a fresh brush stroke — from inverting the
    // geometry of the blocks around it.
    let votes = 0;
    let cast = 0;
    for (let slot = 0; slot < 3; slot++) {
        const parity = PARITY_OF_STATE[block[slot]] ?? -1;
        if (parity === -1) continue;
        votes += slot === 1 ? 1 - parity : parity;
        cast++;
    }
    const base = cast === 0 ? 0 : Number(votes * 2 > cast);
    const parityAt = (slot) => (slot === 1 ? 1 - base : base);
    const done = () => [encode(m[0], life[0], parityAt(0)), encode(m[1], life[1], parityAt(1)), encode(m[2], life[2], parityAt(2))];

    if (reactions !== 'transport') react(m, life, reactions);

    const grade = Math.max(0, Math.min(3, Math.round(gravity)));
    if (grade === 0) return done();

    const density = (slot) => DENSITY[m[slot]];
    const movable = (slot) => !isFixed(m[slot]);
    const swap = (a, b) => {
        const held = m[a]; m[a] = m[b]; m[b] = held;
        const spark = life[a]; life[a] = life[b]; life[b] = spark;
    };

    // 1. Fall. Slots 0 and 2 are one row apart in the same column, so this is the only bond that is
    //    purely vertical — and the only one a parcel in free fall ever needs.
    if (movable(0) && movable(2) && density(0) > density(2)) { swap(0, 2); return done(); }
    if (grade === 1) return done();

    // 2. Slide. Both half-bonds are half a hex downhill; each is gated on the parcel above having
    //    nowhere to fall straight to, so a parcel with clear air below keeps dropping vertically
    //    instead of drifting. This is the bond that gives a heap its angle of repose.
    if (!isGas(m[2]) && movable(0) && movable(1) && density(0) > density(1)) { swap(0, 1); return done(); }
    if (!isGas(m[0]) && movable(1) && movable(2) && density(1) > density(2)) { swap(1, 2); return done(); }
    if (grade === 2) return done();

    // 3. Lift — liquids only. The same row, one column across, half a hex up. A liquid in an odd
    //    column at slot 1 means the base column is even, so the row-level pair is (0, 1) and the
    //    step is 1 → 0; a liquid in an odd column at slot 2 means the base column is odd, the pair
    //    is (1, 2), and the step is 2 → 1. A liquid at slot 0 is never in the row-level pair.
    if (PARITY_OF_STATE[block[1]] === 1 && isLiquid(m[1]) && isGas(m[0]) && !isGas(m[2])) { swap(0, 1); return done(); }
    if (PARITY_OF_STATE[block[2]] === 1 && isLiquid(m[2]) && isGas(m[1]) && !isGas(m[0])) { swap(1, 2); return done(); }
    return done();
}

function encode(material, life, parity) {
    if (material === EMBER) return EMBER_STATES[Math.max(1, Math.min(EMBER_LIFE, life)) - 1];
    const even = EVEN_STATE_OF[material];
    return PARITY_OF_STATE[even] === -1 ? even : even + parity;
}

/**
 * The chemistry, in place on the block's materials. One reaction per block.
 *
 * Fire is the part worth reading. An ember is a flame, not a fuel: it lights what it touches and
 * lives only as long as it is eating. A block sees two of a cell's six neighbours per tick, so a
 * flame that starved on the first tick whose two mates happened to be air would gutter out before
 * it ever reached the pool it is standing in — hence {@link EMBER_LIFE}, three ticks, exactly the
 * partition's period. What comes out is a front that advances while there is fuel, dies back where
 * there is not, and takes a spark dropped in clear air out in three ticks flat.
 *
 * Combustion emits steam because burning a hydrocarbon or a carbohydrate really does emit water
 * vapour, and because smoke needs somewhere to go. Steam then condenses on cold stone, so a sealed
 * vessel with a fire in it runs a whole water cycle: boil, rise, condense on the roof, rain.
 *
 * @param {number[]} m Materials, mutated.
 * @param {number[]} life Remaining flame per slot, mutated.
 * @param {string} mode `'full'` · `'no-fire'`, which drops combustion and keeps everything else.
 */
function react(m, life, mode) {
    const find = (predicate) => m.findIndex(predicate);
    const ember = find((material) => material === EMBER);
    if (ember !== -1) {
        const water = find((material) => material === WATER);
        const fuel = mode === 'full' ? find(isFuel) : -1;
        if (water !== -1) { m[water] = STEAM; m[ember] = AIR; life[ember] = 0; return; }
        if (fuel !== -1) {
            m[fuel] = EMBER;
            life[fuel] = EMBER_LIFE;
            for (let slot = 0; slot < 3; slot++) if (m[slot] === EMBER) life[slot] = EMBER_LIFE;
            return;
        }
        for (let slot = 0; slot < 3; slot++) {
            if (m[slot] !== EMBER) continue;
            life[slot] -= 1;
            if (life[slot] <= 0) { m[slot] = STEAM; life[slot] = 0; }
        }
        return;
    }
    const steam = find((material) => material === STEAM);
    if (steam !== -1 && m.some((material) => material === STONE)) { m[steam] = WATER; return; }
    // Growth at the waterline: a plant needs the water and the open air both within reach, which
    // keeps a pond from becoming a thicket the moment it touches a leaf.
    const plant = find((material) => material === PLANT);
    const water = find((material) => material === WATER);
    if (plant !== -1 && water !== -1 && m.some((material) => material === AIR)) m[water] = PLANT;
}

/**
 * Fold a per-state census down to the eight materials.
 * @param {ArrayLike<number>} census
 * @returns {number[]}
 */
export function materialCensus(census) {
    const out = new Array(MATERIALS).fill(0);
    for (let state = 0; state < census.length; state++) out[materialOf(state)] += census[state];
    return out;
}

/**
 * Put every cell back on the sublattice its column belongs to, leaving the material alone.
 *
 * The engine's brush paints one fixed state value, so half of every stroke lands with the wrong
 * bit. The rule tolerates that and re-encodes its way out of it, but a whole painted region
 * carrying one parity can outvote the truth inside itself, so the host repairs the field when a
 * stroke ends.
 *
 * @param {Uint8Array} cells
 * @param {number} columns
 * @returns {number[]} Indices that were wrong, so a caller can write back only those.
 */
export function repairParity(cells, columns) {
    const wrong = [];
    for (let index = 0; index < cells.length; index++) {
        const state = cells[index];
        const parity = PARITY_OF_STATE[state] ?? -1;
        if (parity === -1) continue;
        const want = state - parity + (index % columns & 1);
        if (state !== want) { cells[index] = want; wrong.push(index); }
    }
    return wrong;
}

/** Per-material conservation, for the invariant readout. `true` when the block only moved things. */
export function conservesMaterials(block, out) {
    const tally = (states) => {
        const counts = new Array(MATERIALS).fill(0);
        for (const state of states) counts[materialOf(state)]++;
        return counts.join(',');
    };
    return tally(block) === tally(out);
}

/**
 * The authored vessel: a stone basin split by an interior wall, a filled reservoir with an oil
 * slick riding on it, a sand bank on the shelf next door, a planted shore, and one ember already in
 * the slick.
 *
 * Every material is placed where its own behaviour is legible — the reservoir levels, the slick
 * separates, the bank slumps to its angle of repose, the fire runs along the slick and boils what
 * it reaches. Steam is the one material the vessel has to make for itself.
 *
 * @param {number} rows
 * @param {number} columns
 * @param {(index: number, salt: number) => number} noise Deterministic 0..1 hash.
 * @returns {Uint8Array}
 */
export function seedMatterVessel(rows, columns, noise) {
    const cells = new Uint8Array(rows * columns);
    const put = (row, column, material) => {
        if (row < 0 || row >= rows || column < 0 || column >= columns) return;
        cells[row * columns + column] = stateFor(material, column);
    };
    const fill = (fromRow, toRow, fromColumn, toColumn, material) => {
        for (let row = Math.max(0, Math.floor(fromRow)); row < Math.min(rows, Math.ceil(toRow)); row++) {
            for (let column = Math.max(0, Math.floor(fromColumn)); column < Math.min(columns, Math.ceil(toColumn)); column++) {
                put(row, column, material);
            }
        }
    };

    fill(0, rows, 0, columns, AIR);

    const floor = Math.floor(rows * 0.88);
    const wall = Math.floor(columns * 0.52);
    // The basin: an outer rim plus one interior wall, so the floor is a deep reservoir on the left
    // and a shallow shelf on the right. Once the water tops the wall it has to find the same level
    // on both sides of it, which is the single clearest reading of the model there is.
    fill(floor, rows, 0, columns, STONE);
    fill(Math.floor(rows * 0.62), floor, wall, wall + 2, STONE);
    fill(0, 2, 0, columns, STONE);
    for (let row = 0; row < rows; row++) { put(row, 0, STONE); put(row, 1, STONE); put(row, columns - 1, STONE); put(row, columns - 2, STONE); }

    // Reservoir, and the slick riding on it.
    fill(floor - 9, floor, 3, wall, WATER);
    fill(floor - 12, floor - 9, 6, wall - 5, OIL);

    // A sand bank on the shelf, heaped steeply enough that it has somewhere to slump to.
    const bankTop = floor - 15;
    const bankAt = wall + Math.floor((columns - wall) * 0.34);
    for (let row = bankTop; row < floor; row++) {
        const half = Math.floor((row - bankTop) * 0.5) + 2;
        fill(row, row + 1, bankAt - half, bankAt + half, SAND);
    }

    // A planted shore at the far wall, and weather above everything.
    for (let row = floor - 7; row < floor; row++) fill(row, row + 1, columns - 8, columns - 4, PLANT);
    for (let row = 6; row < 14; row++) {
        for (let column = 4; column < columns - 4; column++) {
            const roll = noise(row * columns + column, 0x6a77e2);
            if (roll < 0.05) put(row, column, SAND);
            else if (roll < 0.09) put(row, column, WATER);
        }
    }

    // One ember, already in the slick, so the fire has something to eat the moment you press play.
    put(floor - 11, 12, EMBER);
    return cells;
}
