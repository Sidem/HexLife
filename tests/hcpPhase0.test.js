import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';
import neighborDirs from '../src/core/neighbor-dirs.json';
import hcpDirs from '../src/core/hcp-dirs.json';
import {
    inPlaneOffsets,
    inPlaneSource,
    interlayerOffsets,
    latticeSpacing,
    siteDistance,
    sitePosition,
    slotOrder,
} from '../src/embed/hcpCoords.js';
import artifactBaseline from './fixtures/performance/hcp-artifact-baseline.json';
import optimizationRecord from './fixtures/performance/embed-optimization-artifact-record.json';

describe('hcp Phase-0 lattice freeze', () => {
    it('imports the in-plane identity from neighbor-dirs.json rather than a second table', () => {
        expect(inPlaneSource()).toBe('neighbor-dirs.json');
        expect(hcpDirs.in_plane_source).toBe('neighbor-dirs.json');
        expect(inPlaneOffsets(0)).toEqual(neighborDirs.even_r);
        expect(inPlaneOffsets(1)).toEqual(neighborDirs.odd_r);
        expect(slotOrder()).toEqual({
            in_plane: [0, 1, 2, 3, 4, 5],
            down: [6, 7, 8],
            up: [9, 10, 11],
        });
    });

    it('records HCP interlayer offsets with up === down', () => {
        for (const layer of [0, 1]) {
            for (const col of [0, 1]) {
                const down = interlayerOffsets(layer, col, 'down');
                const up = interlayerOffsets(layer, col, 'up');
                expect(down, `layer ${layer} col ${col} down`).toHaveLength(3);
                expect(up).toEqual(down);
            }
        }
        // The even-layer hollow is the opposite axial triangle from the odd-layer hollow.
        expect(interlayerOffsets(0, 0, 'down')).not.toEqual(interlayerOffsets(1, 0, 'down'));
    });

    it('places every interior site at equal distance from all twelve neighbours', () => {
        const hexSize = 1;
        const a = latticeSpacing(hexSize);
        const layer = 4;
        const row = 5;
        const col = 6;
        const origin = sitePosition(col, row, layer, hexSize);
        const neighbors = [];

        for (const [dc, dr] of inPlaneOffsets(col)) {
            neighbors.push(sitePosition(col + dc, row + dr, layer, hexSize));
        }
        for (const toward of ['down', 'up']) {
            const dz = toward === 'down' ? 1 : -1;
            for (const [dc, dr] of interlayerOffsets(layer, col, toward)) {
                neighbors.push(sitePosition(col + dc, row + dr, layer + dz, hexSize));
            }
        }

        expect(neighbors).toHaveLength(12);
        for (const neighbor of neighbors) {
            const relative = Math.abs(siteDistance(origin, neighbor) - a) / a;
            expect(relative).toBeLessThan(1e-9);
        }
    });

    it('translates odd layers onto the even-layer up-triangle centroid', () => {
        const hexSize = 2;
        const even = [
            sitePosition(4, 3, 0, hexSize),
            sitePosition(5, 3, 0, hexSize),
            sitePosition(4, 4, 0, hexSize),
        ];
        const centroid = {
            x: (even[0].x + even[1].x + even[2].x) / 3,
            y: (even[0].y + even[1].y + even[2].y) / 3,
        };
        const odd = sitePosition(4, 3, 1, hexSize);
        expect(Math.abs(odd.x - centroid.x)).toBeLessThan(1e-12);
        expect(Math.abs(odd.y - centroid.y)).toBeLessThan(1e-12);
    });
});

describe('hcp Phase-0 existing-artifact digest pins', () => {
    it('leaves the default, stochastic, and solid artifacts byte-identical to their recorded digests', async () => {
        for (const [file, expected] of Object.entries(artifactBaseline.artifacts)) {
            const accepted = optimizationRecord.files[file] ?? expected;
            const bytes = await readFile(new URL(`../${file}`, import.meta.url));
            expect(bytes.byteLength, `${file} size`).toBe(accepted.bytes);
            expect(createHash('sha256').update(bytes).digest('hex'), `${file} sha256`).toBe(accepted.sha256);
        }
    });

    it('pins the optimized HCP artifact at its owner-approved digest', async () => {
        for (const [file, expected] of Object.entries(optimizationRecord.files)) {
            if (!file.includes('/hcp-wasm/')) continue;
            const bytes = await readFile(new URL(`../${file}`, import.meta.url));
            expect(bytes.byteLength, `${file} size`).toBe(expected.bytes);
            expect(createHash('sha256').update(bytes).digest('hex'), `${file} sha256`).toBe(expected.sha256);
        }
    });
});
