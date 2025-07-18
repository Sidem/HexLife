import { BaseStateStrategy } from './BaseStateStrategy.js';

export class DensityStrategy extends BaseStateStrategy {
    generate(stateArray, params, rng) {
        const { density } = params;
        for (let i = 0; i < stateArray.length; i++) {
            stateArray[i] = rng() < density ? 1 : 0;
        }
    }
} 