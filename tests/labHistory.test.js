import {describe, expect, it} from 'vitest';
import {RunHistory, bestRunIndex, pushRunEntry, toCsv} from '../public/lab-history.js';

const history = (overrides = {}) => new RunHistory({channels: ['a', 'b'], capacity: 8, ...overrides});

describe('RunHistory', () => {
    it('keeps every sample until capacity, at stride one', () => {
        const run = history();
        for (let generation = 1; generation <= 8; generation++) run.push(generation, [generation, 0]);
        expect(run.length).toBe(8);
        expect(run.stride).toBe(1);
        expect(run.channel('a')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('thins instead of scrolling, so the record still starts at the first sample', () => {
        const run = history();
        for (let generation = 1; generation <= 400; generation++) run.push(generation, [generation, 0]);
        expect(run.length).toBeLessThanOrEqual(8);
        expect(run.generations[0]).toBe(1);
        // A rolling window would have dropped the start of the run; this is the whole point.
        expect(run.generations.at(-1)).toBeGreaterThan(380);
        expect(run.stride).toBeGreaterThan(1);
        expect(run.lastGeneration).toBe(400);
    });

    it('measures peaks over every sample, including the ones thinning drops', () => {
        const run = history();
        for (let generation = 1; generation <= 200; generation++) {
            // A one-generation spike, deliberately placed off any plausible retained sample.
            run.push(generation, [generation === 137 ? 9999 : 1, 0]);
        }
        expect(run.channel('a')).not.toContain(9999);
        expect(run.peak('a')).toEqual({value: 9999, generation: 137});
        expect(run.peak('b')).toEqual({value: 0, generation: 0});
    });

    it('ignores repeated and out-of-order generations', () => {
        const run = history();
        expect(run.push(5, [1, 1])).toBe(true);
        expect(run.push(5, [2, 2])).toBe(false);
        expect(run.push(4, [3, 3])).toBe(false);
        expect(run.channel('a')).toEqual([1]);
    });

    it('rejects a sample that does not match the declared channels', () => {
        expect(() => history().push(1, [1])).toThrow(/expects 2 values/);
        expect(() => history().channel('missing')).toThrow(/Unknown channel/);
    });

    it('caps the marks and clears everything with the run', () => {
        const run = history({markLimit: 3});
        for (let index = 0; index < 5; index++) run.mark(index, `event ${index}`);
        expect(run.marks.map((mark) => mark.label)).toEqual(['event 2', 'event 3', 'event 4']);
        run.push(1, [4, 5]);
        run.clear();
        expect(run.length).toBe(0);
        expect(run.marks).toEqual([]);
        expect(run.stride).toBe(1);
        expect(run.peak('a')).toEqual({value: 0, generation: 0});
        expect(run.push(1, [1, 1])).toBe(true);
    });

    it('exports the held samples as rows keyed by channel', () => {
        const run = history();
        run.push(3, [10, 20]);
        run.push(6, [11, 21]);
        expect(run.records()).toEqual([
            {generation: 3, a: 10, b: 20},
            {generation: 6, a: 11, b: 21},
        ]);
        expect(run.ceiling(['a'])).toBe(11);
    });
});

describe('run logs', () => {
    it('keeps the newest entries first and drops the oldest past the limit', () => {
        const runs = [];
        for (let index = 1; index <= 5; index++) pushRunEntry(runs, {run: index}, {limit: 3});
        expect(runs.map((entry) => entry.run)).toEqual([5, 4, 3]);
    });

    it('awards a tie to the older run so the marker stops moving', () => {
        const runs = [{run: 3, yield: 0.4}, {run: 2, yield: 0.4}, {run: 1, yield: 0.2}];
        expect(bestRunIndex(runs, 'yield')).toBe(1);
        expect(bestRunIndex(runs, 'strength')).toBe(-1);
        expect(bestRunIndex([], 'yield')).toBe(-1);
    });

    it('writes CSV that a spreadsheet can read back', () => {
        const csv = toCsv(
            [{key: 'run'}, {key: 'pour', label: 'pour pattern'}, {key: 'note'}],
            [{run: 1, pour: 'shower', note: 'held, "cleanly"'}, {run: 2, pour: 'dump'}],
        );
        expect(csv.split('\n')).toEqual([
            'run,pour pattern,note',
            '1,shower,"held, ""cleanly"""',
            '2,dump,',
        ]);
    });
});
