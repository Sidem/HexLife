import { BaseStateStrategy } from './BaseStateStrategy.js';

export class DensityStrategy extends BaseStateStrategy {
    generate(stateArray, params, rng, config) {
        const { density } = params;
        
        // Special case: if density is exactly 0 or 1, place a single opposite cell in the center
        if (density === 0 || density === 1.0) {
            const baseState = density === 0 ? 0 : 1;
            const centerState = 1 - baseState;
            
            // Fill array with base state
            stateArray.fill(baseState);
            
            // Place opposite state in center cell
            if (config && config.GRID_COLS && config.GRID_ROWS) {
                const centerCol = Math.floor(config.GRID_COLS / 2);
                const centerRow = Math.floor(config.GRID_ROWS / 2);
                const centerIndex = centerRow * config.GRID_COLS + centerCol;
                
                if (centerIndex >= 0 && centerIndex < stateArray.length) {
                    stateArray[centerIndex] = centerState;
                }
            }
        } else {
            // Normal case: random distribution based on density
            for (let i = 0; i < stateArray.length; i++) {
                stateArray[i] = rng() < density ? 1 : 0;
            }
        }
    }
} 