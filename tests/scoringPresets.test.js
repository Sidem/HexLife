import { describe, it, expect } from 'vitest';
import {
    WEIGHT_KEYS,
    DEFAULT_WEIGHTS_PCT,
    DEFAULT_UNIFORM_PENALTY_PCT,
    DEFAULT_FIND_THRESHOLD,
    FIND_THRESHOLD_MIN,
    FIND_THRESHOLD_MAX,
    SCORING_PRESETS,
    sanitizeScoring,
    buildScoreConfig,
    detectPreset,
    isDefaultScoring,
} from '../src/core/analysis/ScoringPresets.js';
import { SCORE_CONFIG, scoreSingleIC } from '../src/core/analysis/InterestingnessScore.js';
import { EXPLORE_CONFIG } from '../src/core/AutoExploreService.js';

describe('ScoringPresets — drift guards', () => {
    it('WEIGHT_KEYS exactly covers SCORE_CONFIG.weights', () => {
        expect([...WEIGHT_KEYS].sort()).toEqual(Object.keys(SCORE_CONFIG.weights).sort());
    });

    it('DEFAULT_WEIGHTS_PCT mirrors SCORE_CONFIG.weights (×100, rounded)', () => {
        for (const k of WEIGHT_KEYS) {
            expect(DEFAULT_WEIGHTS_PCT[k]).toBe(Math.round(SCORE_CONFIG.weights[k] * 100));
        }
    });

    it('DEFAULT_UNIFORM_PENALTY_PCT mirrors SCORE_CONFIG.uniformPenaltyStrength', () => {
        expect(DEFAULT_UNIFORM_PENALTY_PCT).toBe(Math.round(SCORE_CONFIG.uniformPenaltyStrength * 100));
    });

    it('DEFAULT_FIND_THRESHOLD mirrors EXPLORE_CONFIG.findThreshold (pure-module copy)', () => {
        expect(DEFAULT_FIND_THRESHOLD).toBe(EXPLORE_CONFIG.findThreshold);
    });

    it('the default preset is byte-equal to the derived defaults', () => {
        expect(SCORING_PRESETS.default.weights).toEqual(DEFAULT_WEIGHTS_PCT);
        expect(SCORING_PRESETS.default.uniformPenaltyPct).toBe(DEFAULT_UNIFORM_PENALTY_PCT);
    });

    it('every preset defines every weight key and stays in slider range', () => {
        for (const preset of Object.values(SCORING_PRESETS)) {
            for (const k of WEIGHT_KEYS) {
                expect(preset.weights[k]).toBeGreaterThanOrEqual(0);
                expect(preset.weights[k]).toBeLessThanOrEqual(100);
                expect(Number.isInteger(preset.weights[k])).toBe(true);
            }
            expect(preset.uniformPenaltyPct).toBeGreaterThanOrEqual(0);
            expect(preset.uniformPenaltyPct).toBeLessThanOrEqual(100);
        }
    });
});

describe('sanitizeScoring', () => {
    it('null/garbage input yields complete defaults', () => {
        for (const input of [null, undefined, 42, 'x', [], {}]) {
            const s = sanitizeScoring(input);
            expect(s.weights).toEqual(DEFAULT_WEIGHTS_PCT);
            expect(s.uniformPenaltyPct).toBe(DEFAULT_UNIFORM_PENALTY_PCT);
            expect(s.findThreshold).toBe(DEFAULT_FIND_THRESHOLD);
        }
    });

    it('clamps out-of-range values and fills missing weights', () => {
        const s = sanitizeScoring({
            weights: { criticality: 250, entropyBand: -10, fluctuation: 33.7 },
            uniformPenaltyPct: 999,
            findThreshold: 5,
        });
        expect(s.weights.criticality).toBe(100);
        expect(s.weights.entropyBand).toBe(0);
        expect(s.weights.fluctuation).toBe(34);
        expect(s.weights.spatialStructure).toBe(DEFAULT_WEIGHTS_PCT.spatialStructure); // filled
        expect(s.uniformPenaltyPct).toBe(100);
        expect(s.findThreshold).toBe(FIND_THRESHOLD_MAX);
        expect(sanitizeScoring({ findThreshold: 0 }).findThreshold).toBe(FIND_THRESHOLD_MIN);
    });

    it('rejects an all-zero weight set (would bank nothing) by restoring defaults', () => {
        const zero = Object.fromEntries(WEIGHT_KEYS.map((k) => [k, 0]));
        expect(sanitizeScoring({ weights: zero }).weights).toEqual(DEFAULT_WEIGHTS_PCT);
    });

    it('drops unknown weight keys', () => {
        const s = sanitizeScoring({ weights: { bogus: 50, criticality: 10 } });
        expect(s.weights.bogus).toBeUndefined();
        expect(s.weights.criticality).toBe(10);
    });
});

describe('buildScoreConfig', () => {
    it('translates percent sliders into a working score config', () => {
        const s = sanitizeScoring({ weights: { ...DEFAULT_WEIGHTS_PCT, spatialStructure: 90 }, uniformPenaltyPct: 25 });
        const cfg = buildScoreConfig(s);
        expect(cfg.weights.spatialStructure).toBeCloseTo(0.9, 10);
        expect(cfg.uniformPenaltyStrength).toBeCloseTo(0.25, 10);
        // Untouched knobs pass through from SCORE_CONFIG.
        expect(cfg.entropyTarget).toBe(SCORE_CONFIG.entropyTarget);
        expect(cfg.confirmCyclePenalty).toBe(SCORE_CONFIG.confirmCyclePenalty);
    });

    it('default settings reproduce the stock score exactly', () => {
        const metrics = {
            finalRatio: 0.3,
            finalActiveCount: 4915,
            numCells: 16384,
            changed: { mean: 1500, variance: 2250000, fano: 1500, cv: 1.0 },
            blockEntropy: { mean: 0.4, variance: 0.01, spatialVariance: 0.05 },
            spatialOrder: { mean: 0.5, last: 0.5 },
            sigma: 1.0,
            extinct: false, saturated: false,
            cycle: { detected: false, period: 0 },
        };
        const stock = scoreSingleIC(metrics).score;
        const viaBuild = scoreSingleIC(metrics, buildScoreConfig(sanitizeScoring(null))).score;
        expect(viaBuild).toBeCloseTo(stock, 12);
    });
});

describe('detectPreset / isDefaultScoring', () => {
    it('round-trips every preset', () => {
        for (const [key, preset] of Object.entries(SCORING_PRESETS)) {
            const s = sanitizeScoring({ weights: preset.weights, uniformPenaltyPct: preset.uniformPenaltyPct });
            expect(detectPreset(s)).toBe(key);
        }
    });

    it('any perturbation reads as custom', () => {
        const s = sanitizeScoring(null);
        s.weights.criticality += 1;
        expect(detectPreset(s)).toBe('custom');
        const p = sanitizeScoring(null);
        p.uniformPenaltyPct = 51;
        expect(detectPreset(p)).toBe('custom');
    });

    it('isDefaultScoring requires the default threshold too', () => {
        expect(isDefaultScoring(sanitizeScoring(null))).toBe(true);
        expect(isDefaultScoring(sanitizeScoring({ findThreshold: 0.6 }))).toBe(false);
        expect(isDefaultScoring(sanitizeScoring({ weights: SCORING_PRESETS.gliders.weights, uniformPenaltyPct: SCORING_PRESETS.gliders.uniformPenaltyPct }))).toBe(false);
    });
});
