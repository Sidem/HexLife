import {describe, expect, it} from 'vitest';
import canonicalNeighborDirs from '../src/core/neighbor-dirs.json';
import {SPARSE_STRUCTURES, createSparseStructureState} from '../src/core/sparseStructures.js';
import {createSparseState} from '../src/embed/sim.js';

const liveIndices = (cells) => [...cells.keys()].filter((index) => cells[index] === 1);
const liveCount = (cells) => cells.reduce((total, cell) => total + cell, 0);

/**
 * Neighbours of a cell, computed independently from the canonical JSON rather than from the
 * module under test. This is the oracle for the geometry assertions below.
 */
function neighborsOf(index, rows, columns) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const dirs = column % 2 !== 0 ? canonicalNeighborDirs.odd_r : canonicalNeighborDirs.even_r;
    return dirs.map(([deltaColumn, deltaRow]) => {
        const nextColumn = (column + deltaColumn + columns) % columns;
        const nextRow = (row + deltaRow + rows) % rows;
        return nextRow * columns + nextColumn;
    });
}

/** Connected components of the live set, under toroidal hex adjacency. */
function liveClusters(cells, rows, columns) {
    const remaining = new Set(liveIndices(cells));
    const clusters = [];
    while (remaining.size > 0) {
        const [start] = remaining;
        const cluster = new Set([start]);
        const queue = [start];
        remaining.delete(start);
        while (queue.length > 0) {
            for (const neighbor of neighborsOf(queue.pop(), rows, columns)) {
                if (!remaining.has(neighbor)) continue;
                remaining.delete(neighbor);
                cluster.add(neighbor);
                queue.push(neighbor);
            }
        }
        clusters.push(cluster);
    }
    return clusters;
}

describe('sparse structured initial states', () => {
    it('keeps its neighbour tables in step with the canonical JSON', () => {
        // The module carries its own copy because `config.js` imports this JSON extensionless and
        // Node hosts import the module directly. Drift would place structures with a geometry the
        // engine does not share, which is exactly the kind of bug that surfaces as a seam artifact.
        expect(canonicalNeighborDirs.odd_r).toEqual([[-1, 1], [-1, 0], [0, -1], [1, 0], [1, 1], [0, 1]]);
        expect(canonicalNeighborDirs.even_r).toEqual([[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [0, 1]]);
    });

    it('lists structures in ascending size, starting with a single cell', () => {
        // `createSparseStructureState` picks from a size-sorted prefix instead of filtering, and
        // relies on the single-cell structure always being eligible to make the count exact.
        const sizes = SPARSE_STRUCTURES.map((structure) => structure.paths.length);
        expect(sizes[0]).toBe(1);
        expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
        for (const structure of SPARSE_STRUCTURES) {
            expect(structure.paths.every((path) => path.every((step) => step >= 0 && step < 6))).toBe(true);
        }
    });

    it('reproduces the same state from the same manifest values', () => {
        const options = {rows: 64, columns: 74, seed: 20260807, occupancy: 0.004};
        const first = createSparseStructureState(options);
        const second = createSparseStructureState({...options});
        expect(second).toEqual(first);
        // The package entry is the same function, not a reimplementation with its own drift.
        expect(createSparseState(options)).toEqual(first);
        // Seed 0 is a real seed here, exactly as it is for `createDensityState`.
        expect(liveCount(createSparseStructureState({rows: 64, columns: 74, seed: 0, occupancy: 0.004}))).toBe(19);
        expect(createSparseStructureState({rows: 64, columns: 74, seed: 1, occupancy: 0.004})).not.toEqual(first);
    });

    it('hits the requested occupancy exactly, at every scale it is asked for', () => {
        for (const [rows, columns, occupancy] of [
            [64, 74, 0.001], [64, 74, 0.01], [128, 148, 0.002], [1152, 1332, 0.001], [16, 18, 0.05],
        ]) {
            const cells = createSparseStructureState({rows, columns, seed: 7, occupancy});
            expect(cells).toHaveLength(rows * columns);
            expect(liveCount(cells)).toBe(Math.round(occupancy * rows * columns));
        }
        // The degenerate ends stay total rather than special: no cells, and every cell.
        expect(liveCount(createSparseStructureState({rows: 8, columns: 10, seed: 3, occupancy: 0}))).toBe(0);
        expect(liveCount(createSparseStructureState({rows: 8, columns: 10, seed: 3, occupancy: 1}))).toBe(80);
        // A grid too crowded for structures still terminates and still lands on the exact count.
        expect(liveCount(createSparseStructureState({rows: 4, columns: 4, seed: 3, occupancy: 0.9}))).toBe(14);
    });

    it('defaults to a sparse occupancy rather than a fill', () => {
        const cells = createSparseStructureState({rows: 100, columns: 100, seed: 11});
        expect(liveCount(cells)).toBe(20);
    });

    it('places connected structures, and wraps them across the toroidal seam', () => {
        const rows = 64;
        const columns = 74;
        const cells = createSparseStructureState({rows, columns, seed: 20260807, occupancy: 0.002});
        const clusters = liveClusters(cells, rows, columns);
        const structureSizes = new Set(SPARSE_STRUCTURES.map((structure) => structure.paths.length));

        // At this occupancy, placements essentially never collide, so every connected component
        // should be exactly one placed structure. A clamped or dropped walk would show up here as a
        // component smaller than any structure that could have produced it.
        for (const cluster of clusters) {
            expect(structureSizes.has(cluster.size)).toBe(true);
        }

        // …and every index it produced is a real cell.
        expect(liveIndices(cells).every((index) => index >= 0 && index < rows * columns)).toBe(true);
    });

    it('wraps structures across both toroidal seams', () => {
        const rows = 64;
        const columns = 74;
        // A single seed places ~19 structures, so a seam crossing is likely but not certain. Sweep
        // seeds instead of picking a lucky one: the claim is that the wrap happens, not that it
        // happens at seed N. A non-toroidal implementation produces zero of both, because opposite
        // edges are adjacent only through the wrap.
        let rowSeamCrossings = 0;
        let columnSeamCrossings = 0;
        for (let seed = 0; seed < 100; seed++) {
            for (const cluster of liveClusters(createSparseStructureState({rows, columns, seed, occupancy: 0.004}), rows, columns)) {
                const clusterRows = [...cluster].map((index) => Math.floor(index / columns));
                const clusterColumns = [...cluster].map((index) => index % columns);
                if (clusterRows.includes(0) && clusterRows.includes(rows - 1)) rowSeamCrossings++;
                if (clusterColumns.includes(0) && clusterColumns.includes(columns - 1)) columnSeamCrossings++;
            }
        }
        expect(rowSeamCrossings).toBeGreaterThan(0);
        expect(columnSeamCrossings).toBeGreaterThan(0);
    });

    it('validates dimensions, seed, and occupancy', () => {
        expect(() => createSparseStructureState({rows: 0, columns: 4, seed: 1})).toThrow(/rows and columns/);
        expect(() => createSparseStructureState({rows: 2, columns: -4, seed: 1})).toThrow(/rows and columns/);
        expect(() => createSparseStructureState({rows: 2, columns: 4, seed: 1.5})).toThrow(/seed/);
        expect(() => createSparseStructureState({rows: 2, columns: 4, seed: 1, occupancy: 2})).toThrow(/occupancy/);
        expect(() => createSparseStructureState({rows: 2, columns: 4, seed: 1, occupancy: -0.1})).toThrow(/occupancy/);
        expect(() => createSparseStructureState({rows: 2, columns: 4, seed: 1, occupancy: Number.NaN})).toThrow(/occupancy/);
    });
});
