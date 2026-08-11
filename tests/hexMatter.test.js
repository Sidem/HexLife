/**
 * The Hex Matter sandbox, run as physics rather than inspected as source.
 *
 * Every assertion here is a statement about what the material *does* when the engine's own block
 * partition is applied to it — a pool finds its level, a heap keeps its angle, oil floats, sand
 * sinks, fire needs fuel, steam condenses. `tests/helpers/blockPartition.js` is the engine's tick
 * loop; `public/hex-matter-model.js` is the rule the page installs. Nothing in between.
 */
import {describe, expect, it} from 'vitest';
import {createBlockWorld} from './helpers/blockPartition.js';
import {
    AIR,
    DENSITY,
    EMBER,
    EMBER_LIFE,
    MATERIALS,
    MATERIAL_COLORS,
    MATERIAL_NAMES,
    OIL,
    PLANT,
    SAND,
    STATES,
    STATE_COLORS,
    STEAM,
    STONE,
    WATER,
    conservesMaterials,
    lifeOf,
    materialCensus,
    materialOf,
    matterTransition,
    parityOf as parityOfState,
    repairParity,
    seedMatterVessel,
    stateFor,
} from '../public/hex-matter-model.js';

const ROWS = 66;
const COLUMNS = 60;
const FULL = {gravity: 3, reactions: 'full'};
const TRANSPORT = {gravity: 3, reactions: 'transport'};

function vessel(params = TRANSPORT, {rows = ROWS, columns = COLUMNS} = {}) {
    const world = createBlockWorld(rows, columns, (block) => matterTransition(block, params), {alternates: true});
    const put = (row, column, material) => { world.state[row * columns + column] = stateFor(material, column); };
    const fill = (fromRow, toRow, fromColumn, toColumn, material) => {
        for (let row = fromRow; row < toRow; row++) for (let column = fromColumn; column < toColumn; column++) put(row, column, material);
    };
    fill(0, rows, 0, columns, AIR);
    fill(0, 2, 0, columns, STONE);
    fill(rows - 2, rows, 0, columns, STONE);
    for (let row = 0; row < rows; row++) { put(row, 0, STONE); put(row, 1, STONE); put(row, columns - 1, STONE); put(row, columns - 2, STONE); }
    return Object.assign(world, {put, fill});
}

/** Topmost row holding `material`, per interior column; `null` where the column has none. */
function surface(world, material) {
    const tops = [];
    for (let column = 2; column < world.columns - 2; column++) {
        let top = null;
        for (let row = 0; row < world.rows; row++) {
            if (materialOf(world.at(row, column)) === material) { top = row; break; }
        }
        tops.push(top);
    }
    return tops;
}

function occupied(world, material) {
    return surface(world, material).filter((row) => row !== null);
}

function tally(world) {
    const counts = new Array(MATERIALS).fill(0);
    for (const state of world.state) counts[materialOf(state)]++;
    return counts;
}

function changedCells(world, ticks) {
    const before = Uint8Array.from(world.state);
    world.run(ticks);
    let changed = 0;
    for (let index = 0; index < world.state.length; index++) if (world.state[index] !== before[index]) changed++;
    return changed;
}

describe('hex matter vocabulary', () => {
    it('fits eight materials, two sublattices and a flame lifetime inside the block cap', () => {
        expect(STATES).toBe(13);
        expect(STATES).toBeLessThanOrEqual(16);
        expect(STATE_COLORS).toHaveLength(STATES);
        expect(MATERIAL_NAMES).toHaveLength(MATERIALS);
        expect(MATERIAL_COLORS).toHaveLength(MATERIALS);
        for (let material = 0; material < MATERIALS; material++) {
            for (const column of [0, 1, 2, 47]) expect(materialOf(stateFor(material, column))).toBe(material);
        }
        // Only the materials whose geometry depends on it carry the column parity.
        expect(stateFor(WATER, 4)).not.toBe(stateFor(WATER, 5));
        expect(stateFor(OIL, 4)).not.toBe(stateFor(OIL, 5));
        expect(stateFor(AIR, 4)).not.toBe(stateFor(AIR, 5));
        expect(stateFor(SAND, 4)).toBe(stateFor(SAND, 5));
        expect(lifeOf(stateFor(EMBER, 0))).toBe(EMBER_LIFE);
    });

    it('orders the densities the way the materials are ordered in nature', () => {
        // Sand sinks through both liquids; oil floats on water; an ember is a coal, so it falls
        // through air and floats on the fuel it lands in; only steam rises.
        expect(DENSITY[SAND]).toBeGreaterThan(DENSITY[WATER]);
        expect(DENSITY[WATER]).toBeGreaterThan(DENSITY[OIL]);
        expect(DENSITY[OIL]).toBeGreaterThan(DENSITY[EMBER]);
        expect(DENSITY[EMBER]).toBeGreaterThan(DENSITY[AIR]);
        expect(DENSITY[AIR]).toBeGreaterThan(DENSITY[STEAM]);
    });

    it('never lets transport alone create or destroy a material', () => {
        for (let index = 0; index < STATES ** 3; index++) {
            const block = [Math.floor(index / (STATES * STATES)), Math.floor(index / STATES) % STATES, index % STATES];
            const out = matterTransition(block, TRANSPORT);
            expect(out).toHaveLength(3);
            expect(out.every((state) => Number.isInteger(state) && state >= 0 && state < STATES)).toBe(true);
            expect(conservesMaterials(block, out)).toBe(true);
        }
    });

    it('always emits a consistent checkerboard, whatever it was handed', () => {
        // Slots 0 and 2 are the base column and must agree; slot 1 is the neighbour and must not.
        // This has to hold for every input, including the inconsistent ones a brush stroke makes.
        for (let index = 0; index < STATES ** 3; index++) {
            const block = [Math.floor(index / (STATES * STATES)), Math.floor(index / STATES) % STATES, index % STATES];
            const out = matterTransition(block, FULL);
            const parity = out.map(parityOfState);
            if (parity[0] !== -1 && parity[2] !== -1) expect(parity[0]).toBe(parity[2]);
            if (parity[0] !== -1 && parity[1] !== -1) expect(parity[1]).toBe(1 - parity[0]);
            if (parity[2] !== -1 && parity[1] !== -1) expect(parity[1]).toBe(1 - parity[2]);
        }
    });
});

describe('hex matter transport', () => {
    it('levels a dropped column of water into a flat pool', () => {
        const world = vessel();
        world.fill(10, 30, 26, 34, WATER);
        const poured = tally(world)[WATER];
        world.run(2500);

        const tops = occupied(world, WATER);
        // It reaches both walls and its surface is flat to within the one row a partial layer
        // cannot avoid — not the 30° cone a purely downhill rule settles into.
        expect(tops.length).toBe(COLUMNS - 4);
        expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
        expect(tally(world)[WATER]).toBe(poured);
        // and no air is left trapped inside the pool.
        const floorRow = ROWS - 3;
        for (let column = 2; column < COLUMNS - 2; column++) {
            expect(materialOf(world.at(floorRow, column))).toBe(WATER);
        }
    });

    it('finds one level across a barrier once the water tops it', () => {
        const world = vessel();
        const wall = 30;
        world.fill(ROWS - 14, ROWS - 2, wall, wall + 2, STONE);
        world.fill(20, ROWS - 14, 4, wall, WATER);
        world.run(4000);

        const left = occupied(world, WATER).slice(0, wall - 4);
        const right = occupied(world, WATER).slice(wall);
        expect(right.length).toBeGreaterThan(20);
        expect(Math.abs(Math.min(...left) - Math.min(...right))).toBeLessThanOrEqual(1);
    });

    it('keeps a sand heap standing where the same rule flattens water', () => {
        const sand = vessel();
        sand.fill(10, 30, 26, 34, SAND);
        sand.run(2500);
        const sandTops = occupied(sand, SAND);

        const water = vessel();
        water.fill(10, 30, 26, 34, WATER);
        water.run(2500);
        const waterTops = occupied(water, WATER);

        // The heap keeps a real angle of repose; the pool has none at all.
        expect(Math.max(...sandTops) - Math.min(...sandTops)).toBeGreaterThan(6);
        expect(sandTops.length).toBeLessThan(waterTops.length);
    });

    it('floats oil on water and sinks sand through both', () => {
        const world = vessel();
        // Deliberately upside down: oil at the bottom, sand on top of the water above it.
        world.fill(ROWS - 12, ROWS - 8, 6, COLUMNS - 6, OIL);
        world.fill(ROWS - 20, ROWS - 12, 6, COLUMNS - 6, WATER);
        world.fill(ROWS - 24, ROWS - 20, 10, COLUMNS - 10, SAND);
        world.run(4000);

        const column = Math.floor(COLUMNS / 2);
        const stack = [];
        for (let row = 0; row < ROWS; row++) {
            const material = materialOf(world.at(row, column));
            if (material !== AIR && material !== STONE) stack.push(material);
        }
        const firstOf = (material) => stack.indexOf(material);
        expect(firstOf(OIL)).toBeGreaterThanOrEqual(0);
        expect(firstOf(OIL)).toBeLessThan(firstOf(WATER));
        expect(firstOf(WATER)).toBeLessThan(firstOf(SAND));
    });

    it('drops a lone parcel straight down instead of drifting sideways', () => {
        const world = vessel();
        // Well apart, and both column parities. Measured in flight: once it lands it may settle one
        // column into the notch beside it, which is a real half-hex of downhill and not a drift.
        const columns = [12, 25, 38, 51];
        for (const column of columns) world.put(6, column, SAND);
        world.run(60);
        for (const column of columns) {
            const rows = [];
            for (let row = 0; row < ROWS; row++) if (materialOf(world.at(row, column)) === SAND) rows.push(row);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toBeGreaterThan(6);
            expect(rows[0]).toBeLessThan(ROWS - 3);
        }
    });

    it('honours the gravity grades: frozen, falling, sliding, flowing', () => {
        const shapes = [0, 1, 2, 3].map((gravity) => {
            const world = vessel({gravity, reactions: 'transport'});
            world.fill(20, 30, 28, 32, WATER);
            world.run(900);
            return occupied(world, WATER).length;
        });
        expect(shapes[0]).toBe(4);
        expect(shapes[1]).toBe(4);
        expect(shapes[2]).toBeGreaterThan(shapes[1]);
        expect(shapes[3]).toBeGreaterThan(shapes[2]);
    });

    it('quiets down once the pool has levelled', () => {
        const world = vessel();
        world.fill(10, 30, 26, 34, WATER);
        world.run(2500);
        // A partial top layer can still shuffle a few cells; a churning foam could not.
        expect(changedCells(world, 120)).toBeLessThan(40);
    });
});

describe('hex matter chemistry', () => {
    it('runs a fire front through oil and stops when the fuel is gone', () => {
        const world = vessel(FULL);
        world.fill(ROWS - 8, ROWS - 2, 4, 40, OIL);
        world.put(ROWS - 8, 6, EMBER);
        world.run(600);
        const counts = tally(world);
        // The front eats almost all of it and then goes out — partly for want of fuel and partly
        // because its own combustion steam condenses on the cold basin and rains back as water,
        // which is exactly what quenches an oil fire. A little unburnt slick surviving under that
        // is the model being honest, not the fire stalling: nothing is left alight.
        expect(counts[OIL]).toBeLessThan(0.15 * 215);
        expect(counts[EMBER]).toBe(0);
        expect(counts[WATER]).toBeGreaterThan(0);
    });

    it('puts an unfed spark out at once', () => {
        const world = vessel(FULL);
        world.put(30, 30, EMBER);
        world.run(6);
        expect(tally(world)[EMBER]).toBe(0);
    });

    it('quenches fire with water and flashes the water to steam', () => {
        const world = vessel(FULL);
        world.fill(ROWS - 8, ROWS - 2, 4, 40, OIL);
        world.fill(ROWS - 8, ROWS - 2, 20, 40, WATER);
        world.put(ROWS - 8, 6, EMBER);
        world.run(400);
        // The oil under the water never catches: the front meets water and goes out.
        expect(tally(world)[OIL]).toBeGreaterThan(0);
    });

    it('condenses steam back to water on cold stone', () => {
        const world = vessel(FULL);
        world.fill(20, 30, 6, COLUMNS - 6, STEAM);
        world.run(400);
        const counts = tally(world);
        expect(counts[STEAM]).toBe(0);
        expect(counts[WATER]).toBeGreaterThan(0);
    });

    it('grows plants along the waterline and nowhere else', () => {
        const dry = vessel(FULL);
        dry.fill(ROWS - 8, ROWS - 2, 30, 34, PLANT);
        const before = tally(dry)[PLANT];
        dry.run(300);
        expect(tally(dry)[PLANT]).toBe(before);

        const wet = vessel(FULL);
        wet.fill(ROWS - 8, ROWS - 2, 30, 34, PLANT);
        wet.fill(ROWS - 8, ROWS - 2, 6, 30, WATER);
        wet.run(300);
        expect(tally(wet)[PLANT]).toBeGreaterThan(before);
    });

    it('leaves every material alone in transport mode', () => {
        const world = vessel(TRANSPORT);
        world.fill(ROWS - 8, ROWS - 2, 4, 40, OIL);
        world.put(ROWS - 8, 6, EMBER);
        world.fill(20, 26, 6, 20, STEAM);
        const before = tally(world);
        world.run(400);
        expect(tally(world)).toEqual(before);
    });

    it('drops combustion but keeps the rest when chemistry is set to no-fire', () => {
        const world = vessel({gravity: 3, reactions: 'no-fire'});
        world.fill(ROWS - 8, ROWS - 2, 4, 40, OIL);
        world.put(ROWS - 8, 6, EMBER);
        world.run(300);
        // The slick is untouched but for the one cell the ember was dropped into, and the ember
        // itself still goes out — combustion is what `no-fire` removes, not the rest of the model.
        expect(tally(world)[OIL]).toBe(36 * 6 - 1);
        expect(tally(world)[EMBER]).toBe(0);
    });
});

describe('hex matter host contract', () => {
    it('seeds a vessel that already shows every material', () => {
        const noise = (index, salt) => {
            let value = (index ^ salt) >>> 0;
            value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
            value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
            return ((value ^ value >>> 16) >>> 0) / 4294967296;
        };
        const cells = seedMatterVessel(ROWS, COLUMNS, noise);
        expect(cells).toHaveLength(ROWS * COLUMNS);
        const counts = new Array(MATERIALS).fill(0);
        for (const state of cells) counts[materialOf(state)]++;
        // Seven materials are placed; steam is the one the vessel has to make for itself.
        for (const material of [AIR, WATER, OIL, SAND, STONE, EMBER, PLANT]) expect(counts[material]).toBeGreaterThan(0);
        expect(counts[STEAM]).toBe(0);
        // Sealed against both toroidal wraps, and every cell already on its own sublattice.
        for (let column = 0; column < COLUMNS; column++) expect(materialOf(cells[column])).toBe(STONE);
        expect(repairParity(Uint8Array.from(cells), COLUMNS)).toHaveLength(0);
    });

    it('repairs a brush stroke that painted one parity across both columns', () => {
        const cells = new Uint8Array(ROWS * COLUMNS);
        for (let index = 0; index < cells.length; index++) cells[index] = stateFor(AIR, index % COLUMNS);
        for (let column = 20; column < 30; column++) cells[24 * COLUMNS + column] = stateFor(WATER, 0);
        const wrong = repairParity(cells, COLUMNS);
        expect(wrong).toHaveLength(5);
        for (let column = 20; column < 30; column++) {
            expect(cells[24 * COLUMNS + column]).toBe(stateFor(WATER, column));
        }
    });

    it('folds the engine census down to the eight materials', () => {
        const census = new Uint32Array(STATES);
        census[stateFor(WATER, 0)] = 7;
        census[stateFor(WATER, 1)] = 5;
        census[stateFor(SAND, 1)] = 3;
        expect(materialCensus(census)[WATER]).toBe(12);
        expect(materialCensus(census)[SAND]).toBe(3);
        expect(materialCensus(census)).toHaveLength(MATERIALS);
    });
});
