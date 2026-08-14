import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import canonicalNeighborDirs from '../src/core/neighbor-dirs.json';
import {
    PULSE_BLOOM_TICKS,
    PULSE_REST_TICKS,
    buildHexMirror,
    injectionColumns,
    quietTickLimit,
} from '../public/coffee-percolation-physics.js';

function neighbor(index, direction, rows, columns) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const dirs = column % 2 !== 0 ? canonicalNeighborDirs.odd_r : canonicalNeighborDirs.even_r;
    const [deltaColumn, deltaRow] = dirs[direction];
    const nextColumn = (column + deltaColumn + columns) % columns;
    const nextRow = (row + deltaRow + rows) % rows;
    return nextRow * columns + nextColumn;
}

describe('coffee lab hex reflection', () => {
    const presets = [[66, 76], [150, 174], [300, 346], [450, 520]];
    const reflectedDirection = [4, 3, 2, 1, 0, 5];

    it.each(presets)('is a row-preserving involution on %i x %i', (rows, columns) => {
        const mirror = buildHexMirror(rows, columns);
        let wrongRow = -1;
        let wrongInverse = -1;
        for (let index = 0; index < mirror.length; index++) {
            if (wrongRow === -1 && Math.floor(mirror[index] / columns) !== Math.floor(index / columns)) {
                wrongRow = index;
            }
            if (wrongInverse === -1 && mirror[mirror[index]] !== index) wrongInverse = index;
        }
        expect(wrongRow).toBe(-1);
        expect(wrongInverse).toBe(-1);
    });

    it.each(presets)('swaps the hexagonal NE/NW and SE/SW bonds on %i x %i', (rows, columns) => {
        const mirror = buildHexMirror(rows, columns);
        const samples = [
            0,
            columns - 1,
            Math.floor(rows / 2) * columns + Math.floor(columns / 2),
            (rows - 1) * columns,
            rows * columns - 1,
        ];
        for (const index of samples) {
            for (let direction = 0; direction < 6; direction++) {
                expect(mirror[neighbor(index, direction, rows, columns)]).toBe(
                    neighbor(mirror[index], reflectedDirection[direction], rows, columns),
                );
            }
        }
    });

    it('rejects an odd column wrap, which cannot preserve odd-q parity', () => {
        expect(() => buildHexMirror(66, 75)).toThrow(/even integer/);
    });
});

describe('coffee lab inlet scheduling', () => {
    const schedule = (overrides = {}) => injectionColumns({
        columns: 174,
        flow: 6,
        mode: 'shower',
        tick: 0,
        remaining: 1000,
        ...overrides,
    });

    it('never emits a duplicate inlet cell', () => {
        for (const mode of ['shower', 'pulse', 'centre', 'dump']) {
            const columns = schedule({mode, flow: 40, remaining: 137, tick: 12});
            expect(new Set(columns).size).toBe(columns.length);
        }
    });

    it('uses the whole centre-stream aperture instead of visiting only one parity', () => {
        const columns = schedule({mode: 'centre', flow: 40});
        expect(columns).toHaveLength(12);
        expect(Math.min(...columns)).toBe(81);
        expect(Math.max(...columns)).toBe(92);
    });

    it('spreads a partial dump across the bed instead of biasing the left edge', () => {
        const columns = schedule({columns: 76, mode: 'dump', remaining: 7});
        expect(columns).toHaveLength(7);
        expect(Math.min(...columns)).toBeGreaterThan(0);
        expect(Math.max(...columns)).toBeGreaterThan(65);
    });

    it('keeps the bloom/rest/full-pour cadence', () => {
        expect(schedule({mode: 'pulse', flow: 10, tick: 0})).toHaveLength(4);
        expect(schedule({mode: 'pulse', flow: 10, tick: PULSE_BLOOM_TICKS})).toEqual([]);
        expect(schedule({
            mode: 'pulse',
            flow: 10,
            tick: PULSE_BLOOM_TICKS + PULSE_REST_TICKS,
        })).toHaveLength(10);
    });
});

describe('coffee lab finish allowance', () => {
    it('covers a full six-map transit period per row on larger grids', () => {
        expect(quietTickLimit(66)).toBe(396);
        expect(quietTickLimit(150)).toBe(900);
        expect(quietTickLimit(300)).toBe(1800);
    });
});

describe('coffee lab brew history', () => {
    const page = readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'coffee-percolation.html'),
        'utf8',
    );

    it('writes a row only where a brew actually ends', () => {
        // Both labs log from their terminal branch and nowhere else: a brew abandoned mid-pour by a
        // slider move is not a result, and logging one would fill the table with noise.
        expect(page).toContain('if (!brew.finished) { brew.finished = true; renderLab(); recordSixRun(); }');
        expect(page).toContain('renderDual();       // once more, so the phase label and the footer switch over\n        recordDualRun();');
        expect(page.match(/recordSixRun\(\)/g)).toHaveLength(2);   // the call and its definition
        expect(page.match(/recordDualRun\(\)/g)).toHaveLength(2);
    });

    it('hosts the 3D puck as a tab with the same yield dashboard', () => {
        expect(page).toContain('id="tab-puck"');
        expect(page).toContain('id="panel-puck"');
        expect(page).toContain('id="p-yield"');
        expect(page).toContain('extraction yield');
        expect(page).toContain('<hexlife-hcp');
        expect(page).toContain("from './coffee-puck-lab.js'");
        expect(page).toContain('@hexlife/embed/hcp');
    });

    it('starts every brew on the same partition phase, so two runs are comparable', () => {
        // The engine's tick counter picks the partition phase and the handedness, and it only goes
        // back to zero on a re-boot — so without this a second brew takes a different path from the
        // first at identical settings, and no logged row can be reproduced.
        expect(page).toContain('const PARTITION_PERIOD = 6;');
        expect(page).toContain('alignPartitionPhase(lab);');
        expect(page).toContain('alignPartitionPhase(lab2);');
    });

    it('logs the puck seed, which is what makes a restored row an exact replay', () => {
        expect(page).toContain('seed: brew.seed');
        expect(page).toContain('seed: dBrew.seed');
        expect(page).toContain('brew.seed = entry.seed;');
        expect(page).toContain('dBrew.seed = entry.seed;');
    });
});
