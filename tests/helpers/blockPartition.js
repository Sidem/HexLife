/**
 * A faithful JavaScript port of `WorldK::tick_block` (`hexlife-wasm/src/worldk.rs`), including the
 * alternating handedness `set_block_alternates(true)` turns on.
 *
 * It exists so a block-partition *model* can be run and measured in Node — settling, conservation,
 * the shape a material ends up in — without the Wasm engine. The engine's own tests already pin the
 * partition against `neighbor_indices`; this pins the model against the partition.
 *
 * The scan is the engine's, line for line: bases are the cells where `(col mod 2) - row ≡ phase
 * (mod 3)`, the block is `{base, SE(base) | SW(base), S(base)}`, and the rewrite is in place because
 * the blocks of one phase are disjoint.
 */
import canonicalNeighborDirs from '../../src/core/neighbor-dirs.json';

const BLOCK_MATE_Q = 4;
const BLOCK_MATE_Q_MIRRORED = 0;
const BLOCK_MATE_R = 5;
const BLOCK_PHASES = 3;

export function neighborTable(rows, columns) {
    const table = new Int32Array(rows * columns * 6);
    for (let index = 0; index < rows * columns; index++) {
        const column = index % columns;
        const row = (index - column) / columns;
        const dirs = column % 2 !== 0 ? canonicalNeighborDirs.odd_r : canonicalNeighborDirs.even_r;
        for (let direction = 0; direction < 6; direction++) {
            const [deltaColumn, deltaRow] = dirs[direction];
            const nextColumn = (column + deltaColumn + columns) % columns;
            const nextRow = (row + deltaRow + rows) % rows;
            table[index * 6 + direction] = nextRow * columns + nextColumn;
        }
    }
    return table;
}

/**
 * @param {number} rows Must be a multiple of 3, exactly as `WorldK` requires.
 * @param {number} columns Must be even.
 * @param {(block: number[]) => ArrayLike<number>} transition
 * @param {{alternates?: boolean}} [options]
 */
export function createBlockWorld(rows, columns, transition, {alternates = false} = {}) {
    if (rows % BLOCK_PHASES !== 0) throw new RangeError('block mode needs rows divisible by 3.');
    if (columns % 2 !== 0) throw new RangeError('block mode needs an even column count.');
    const neighbors = neighborTable(rows, columns);
    const state = new Uint8Array(rows * columns);
    let tick = 0;

    function step() {
        const phase = tick % BLOCK_PHASES;
        const mateQ = alternates && tick % 2 === 1 ? BLOCK_MATE_Q_MIRRORED : BLOCK_MATE_Q;
        for (let row = 0; row < rows; row++) {
            const residue = row % 3;
            let parity;
            if (residue === (3 - phase) % 3) parity = 0;
            else if (residue === (4 - phase) % 3) parity = 1;
            else continue;
            for (let column = parity; column < columns; column += 2) {
                const base = row * columns + column;
                const q = neighbors[base * 6 + mateQ];
                const r = neighbors[base * 6 + BLOCK_MATE_R];
                const out = transition([state[base], state[q], state[r]]);
                state[base] = out[0];
                state[q] = out[1];
                state[r] = out[2];
            }
        }
        tick++;
    }

    return {
        state,
        rows,
        columns,
        step,
        get tick() { return tick; },
        run(count) { for (let i = 0; i < count; i++) step(); },
        at(row, column) { return state[row * columns + column]; },
    };
}
