import { describe, expect, it } from 'vitest';
import {
    cellFromTorusAngles,
    getTorusPeriods,
    TAU,
    torusAnglesForCell,
    torusOrbitCamera,
    torusPoint,
} from '../src/rendering/torusMath.js';

describe('torus geometry', () => {
    it('keeps the rounded grid periods within a visually square tolerance', () => {
        const { x, y } = getTorusPeriods(222, 192, 1);
        expect(Math.abs(x - y) / y).toBeLessThan(0.002);
    });

    it('round-trips cells at all four seams', () => {
        const cols = 222;
        const rows = 192;
        const corners = [[0, 0], [cols - 1, 0], [0, rows - 1], [cols - 1, rows - 1]];
        for (const [col, row] of corners) {
            const { u, v } = torusAnglesForCell(col, row, cols, rows);
            expect(cellFromTorusAngles(u + TAU, v - TAU, cols, rows)).toEqual({ col, row });
        }
    });

    it('joins both parametric seams without a positional jump', () => {
        const a = torusPoint(0.37, 1.21);
        const majorWrapped = torusPoint(0.37 + TAU, 1.21);
        const minorWrapped = torusPoint(0.37, 1.21 + TAU);
        majorWrapped.forEach((value, i) => expect(value).toBeCloseTo(a[i], 10));
        minorWrapped.forEach((value, i) => expect(value).toBeCloseTo(a[i], 10));
    });

    it('keeps a valid continuous camera frame through both orbit poles', () => {
        const yaw = 0.73;
        const epsilon = 1e-7;
        const pitches = [
            Math.PI / 2 - epsilon,
            Math.PI / 2,
            Math.PI / 2 + epsilon,
            Math.PI * 3 / 2 - epsilon,
            Math.PI * 3 / 2,
            Math.PI * 3 / 2 + epsilon,
        ];

        for (const pitch of pitches) {
            const { position, up } = torusOrbitCamera(yaw, pitch, 6.5);
            const dot = position.reduce((sum, value, index) => sum + value * up[index], 0);
            expect(Math.hypot(...position)).toBeCloseTo(6.5, 10);
            expect(Math.hypot(...up)).toBeCloseTo(1, 10);
            expect(dot).toBeCloseTo(0, 10);
        }
    });

    it('wraps vertical orbit seamlessly across any number of full turns', () => {
        const base = torusOrbitCamera(0.44, -0.8, 5);
        const afterTurns = torusOrbitCamera(0.44, -0.8 + TAU * 12, 5);

        afterTurns.position.forEach((value, i) => expect(value).toBeCloseTo(base.position[i], 10));
        afterTurns.up.forEach((value, i) => expect(value).toBeCloseTo(base.up[i], 10));
    });
});
