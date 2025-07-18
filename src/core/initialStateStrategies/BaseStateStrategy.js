export class BaseStateStrategy {
    generate(stateArray, params, rng, config) {
        throw new Error("Strategy must implement a 'generate' method.");
    }
} 