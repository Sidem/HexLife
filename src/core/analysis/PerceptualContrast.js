// @ts-check

import { l2normalize, dot } from './EmbeddingNovelty.js';

/**
 * Fixed nuisance concepts for #37 Stage 3. The battery deliberately mixes literal pixel noise
 * ("random black and white pixels"), the familiar visual category ("television static"), and two
 * texture phrasings. CLIP prompt scores vary with wording; taking the maximum per frame makes the
 * detector robust to that wording without averaging a strong noise match away.
 */
export const NOISE_PROMPTS = Object.freeze([
    'a field of random black and white pixels',
    'television static noise',
    'a white noise texture',
    'a random binary noise pattern',
]);

/** @typedef {{simMin: number, simMax: number, strength: number}} PerceptualContrastConfig */

/**
 * Calibrated on the complete 80-entry #37 benchmark with
 * `Xenova/clip-vit-base-patch16::cell-raster-v1` (2026-07-29, 80 entries × six frames). `simMin`
 * is the interesting-entry upper quartile (0.332614) and `simMax` is the boring-control median
 * (0.334169). Strength 0.85 is the smallest sweep value reaching the best pairwise result:
 * embeddings-on confirmation improves 234/511 (0.458) → 318/511 (0.622), with margin
 * -0.051 → +0.108. The minimum factor remains 0.15, so this optional model signal is never a hard kill.
 */
/** @type {Readonly<PerceptualContrastConfig>} */
export const PERCEPTUAL_CONTRAST_CONFIG = Object.freeze({
    simMin: 0.332614,
    simMax: 0.334169,
    strength: 0.85,
});

/**
 * Mean, over frames, of the strongest cosine match to any fixed noise prompt. Invalid/zero vectors
 * are ignored. Returns null when either side has no usable vectors so callers can degrade neutrally.
 *
 * @param {Array<Float32Array|number[]>|null|undefined} frames
 * @param {Array<Float32Array|number[]>|null|undefined} prompts
 * @returns {number|null}
 */
export function noiseSimilarity(frames, prompts) {
    if (!Array.isArray(frames) || !Array.isArray(prompts)) return null;
    const promptUnits = prompts.map((v) => l2normalize(v)).filter((v) => v !== null);
    if (promptUnits.length === 0) return null;

    let sum = 0;
    let count = 0;
    for (const frame of frames) {
        const frameUnit = l2normalize(frame);
        if (!frameUnit) continue;
        let best = -1;
        for (const promptUnit of promptUnits) {
            best = Math.max(best, dot(frameUnit, promptUnit));
        }
        sum += Math.max(-1, Math.min(1, best));
        count++;
    }
    return count > 0 ? sum / count : null;
}

/**
 * Convert raw noise similarity into a clamped multiplicative confirmation factor. Similarities at
 * or below `simMin` are neutral; similarities at or above `simMax` receive the full configured
 * penalty. Missing/invalid input is always neutral.
 *
 * @param {number|null|undefined} similarity
 * @param {PerceptualContrastConfig|Readonly<PerceptualContrastConfig>} [config]
 * @returns {number}
 */
export function noiseFactor(similarity, config = PERCEPTUAL_CONTRAST_CONFIG) {
    if (!Number.isFinite(similarity)) return 1;
    const simMin = Number(config.simMin);
    const simMax = Number(config.simMax);
    if (!Number.isFinite(simMin) || !Number.isFinite(simMax) || simMax <= simMin) return 1;
    const strength = Math.max(0, Math.min(1, Number(config.strength) || 0));
    const ramp = Math.max(0, Math.min(1, (/** @type {number} */ (similarity) - simMin) / (simMax - simMin)));
    return Math.max(0, Math.min(1, 1 - strength * ramp));
}
