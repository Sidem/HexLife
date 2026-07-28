import { describe, it, expect } from 'vitest';
import * as Config from '../src/core/config.js';
import { createInitialCameraStates } from '../src/core/cameraState.js';

describe('initial world cameras', () => {
    it('fits every world to the whole grid on a normal opening', () => {
        const gridCenter = { x: 120, y: 240 };

        const cameras = createInitialCameraStates(
            Config.NUM_WORLDS,
            gridCenter,
            Config.DEFAULT_SELECTED_WORLD_INDEX,
        );

        expect(cameras).toHaveLength(Config.NUM_WORLDS);
        expect(cameras.every((camera) => camera.zoom === 1.0)).toBe(true);
        expect(cameras.every((camera) => camera.x === gridCenter.x && camera.y === gridCenter.y)).toBe(true);
    });

    it('preserves an explicit shared camera only for the selected world', () => {
        const sharedCamera = { x: 100.5, y: 200.5, zoom: 1.75 };

        const cameras = createInitialCameraStates(
            Config.NUM_WORLDS,
            { x: 120, y: 240 },
            2,
            sharedCamera,
        );

        expect(cameras[2]).toBe(sharedCamera);
        expect(cameras.filter((_, index) => index !== 2).every((camera) => camera.zoom === 1.0)).toBe(true);
    });
});
