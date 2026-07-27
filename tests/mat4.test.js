import { describe, expect, it } from 'vitest';
import { identity, lookAt, multiply, perspective } from '../src/rendering/mat4.js';

describe('mat4 helpers', () => {
    it('preserves either operand through identity multiplication', () => {
        const p = perspective(Math.PI / 3, 16 / 9, 0.1, 100);
        expect(Array.from(multiply(identity(), p))).toEqual(Array.from(p));
        expect(Array.from(multiply(p, identity()))).toEqual(Array.from(p));
    });

    it('places the camera origin at zero in view space', () => {
        const eye = [2, 3, 7];
        const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
        const transformed = [
            view[0] * eye[0] + view[4] * eye[1] + view[8] * eye[2] + view[12],
            view[1] * eye[0] + view[5] * eye[1] + view[9] * eye[2] + view[13],
            view[2] * eye[0] + view[6] * eye[1] + view[10] * eye[2] + view[14],
        ];
        transformed.forEach(value => expect(value).toBeCloseTo(0, 6));
    });
});
