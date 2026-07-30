import { describe, it, expect } from 'vitest';
import fixtures from './fixtures/exploreEvalFixtures.json';
import {
    suggestScenarioFromStats,
    SCENARIO_THRESHOLDS,
} from '../src/core/analysis/tagSuggestions.js';
import {
    ACCEPTANCE_SCENARIOS,
    CORPUS_SCENARIOS,
    countsTowardCoverage,
    isCorpusScenario,
} from '../src/core/analysis/corpusProtocol.js';

const CELLS = 42624; // medium grid preset (192×222), matching the reference fixtures.

/** Minimal metrics for a run that is alive, aperiodic, and static unless overridden. */
function metrics(overrides = {}) {
    return {
        finalRatio: 0.3,
        finalActiveCount: 0.3 * CELLS,
        changed: { mean: 0 },
        blockEntropy: { mean: 0.2 },
        spatialOrder: { mean: 0 },
        changeOrder: { mean: 0 },
        transport: { meanSpeed: 0 },
        extinct: false,
        saturated: false,
        cycle: { detected: false, period: 0 },
        ...overrides,
    };
}

describe('suggestScenarioFromStats — terminal regimes', () => {
    it('extinct flag → extinction', () => {
        expect(suggestScenarioFromStats(metrics({ extinct: true })).scenario).toBe('extinction');
    });

    it('zero final coverage → extinction even without the flag', () => {
        expect(suggestScenarioFromStats(metrics({ finalRatio: 0 })).scenario).toBe('extinction');
    });

    it('saturated flag → saturation', () => {
        expect(suggestScenarioFromStats(metrics({ saturated: true })).scenario).toBe('saturation');
    });

    it('coverage at the saturation threshold → saturation', () => {
        const m = metrics({ finalRatio: SCENARIO_THRESHOLDS.saturatedRatio, changed: { mean: 5000 } });
        expect(suggestScenarioFromStats(m).scenario).toBe('saturation');
    });

    it('terminal regimes outrank an otherwise churny field', () => {
        const churny = { blockEntropy: { mean: 0.9 }, changed: { mean: 9000 }, changeOrder: { mean: 0 } };
        expect(suggestScenarioFromStats(metrics({ extinct: true, ...churny })).scenario).toBe('extinction');
        expect(suggestScenarioFromStats(metrics({ saturated: true, ...churny })).scenario).toBe('saturation');
    });
});

describe('suggestScenarioFromStats — frozen and periodic fields', () => {
    it('no change at all → still_life', () => {
        expect(suggestScenarioFromStats(metrics()).scenario).toBe('still_life');
    });

    it('a lone blinker on a static field reads as oscillator, not still_life', () => {
        // 4 cells of 42624 sits under frozenChangeFraction, so the period is what separates these.
        const m = metrics({ changed: { mean: 4 }, cycle: { detected: true, period: 2 } });
        expect(suggestScenarioFromStats(m).scenario).toBe('oscillator');
    });

    it('a detected period-1 cycle is static ⇒ still_life', () => {
        const m = metrics({ changed: { mean: 0 }, cycle: { detected: true, period: 1 } });
        expect(suggestScenarioFromStats(m).scenario).toBe('still_life');
    });

    it('a long cycle on an active field → oscillator', () => {
        const m = metrics({ changed: { mean: 300 }, cycle: { detected: true, period: 84 } });
        expect(suggestScenarioFromStats(m).scenario).toBe('oscillator');
    });

    it('accepts the gallery-entry cyclic shape', () => {
        expect(suggestScenarioFromStats(metrics({ changed: { mean: 300 }, cyclic: 30 })).scenario)
            .toBe('oscillator');
    });

    it('a cycle outranks coherent transport (an exactly repeating glider loop is periodic)', () => {
        const m = metrics({
            finalRatio: 0.02,
            finalActiveCount: 0.02 * CELLS,
            changed: { mean: 700 },
            transport: { meanSpeed: 0.25 },
            cycle: { detected: true, period: 12 },
        });
        expect(suggestScenarioFromStats(m).scenario).toBe('oscillator');
    });
});

describe('suggestScenarioFromStats — gliders', () => {
    it('coherent translation on a sparse field → glider', () => {
        const m = metrics({
            finalRatio: 0.02,
            finalActiveCount: 0.02 * CELLS,
            changed: { mean: 700 },
            transport: { meanSpeed: 0.25 },
            changeOrder: { mean: 0.45 },
        });
        expect(suggestScenarioFromStats(m).scenario).toBe('glider');
    });

    it('outranks localized_change even though gliders also cluster their change', () => {
        const m = metrics({
            finalRatio: 0.02,
            finalActiveCount: 0.02 * CELLS,
            changed: { mean: 700 },
            transport: { meanSpeed: SCENARIO_THRESHOLDS.gliderTransport },
            changeOrder: { mean: 0.9 },
        });
        expect(suggestScenarioFromStats(m).scenario).toBe('glider');
    });

    it('transport on a near-blanketed field is not a readable glider', () => {
        const m = metrics({
            finalRatio: 0.8,
            finalActiveCount: 0.8 * CELLS,
            changed: { mean: 700 },
            transport: { meanSpeed: 0.25 },
            changeOrder: { mean: 0 },
            blockEntropy: { mean: 0.5 },
        });
        expect(suggestScenarioFromStats(m).scenario).not.toBe('glider');
    });
});

describe('suggestScenarioFromStats — growth, localized change, and churn', () => {
    it('large structured coverage gain → structured_growth', () => {
        const m = metrics({
            initialRatio: 0.05,
            finalRatio: 0.7,
            finalActiveCount: 0.7 * CELLS,
            changed: { mean: 2000 },
            spatialOrder: { mean: 0.4 },
            changeOrder: { mean: 0.4 },
        });
        expect(suggestScenarioFromStats(m).scenario).toBe('structured_growth');
    });

    it('the same coverage gain without spatial structure is not called growth', () => {
        const m = metrics({
            initialRatio: 0.05,
            finalRatio: 0.7,
            finalActiveCount: 0.7 * CELLS,
            changed: { mean: 2000 },
            spatialOrder: { mean: -0.01 },
            changeOrder: { mean: 0 },
            blockEntropy: { mean: 0.5 },
        });
        expect(suggestScenarioFromStats(m).scenario).toBe('distributed_churn');
    });

    it('growth needs a starting coverage; without initialRatio it falls through', () => {
        const m = metrics({
            finalRatio: 0.7,
            finalActiveCount: 0.7 * CELLS,
            changed: { mean: 2000 },
            spatialOrder: { mean: 0.4 },
            changeOrder: { mean: 0.4 },
        });
        expect(suggestScenarioFromStats(m).scenario).toBe('localized_change');
    });

    it('clustered change fronts → localized_change', () => {
        const m = metrics({
            changed: { mean: 2000 },
            changeOrder: { mean: SCENARIO_THRESHOLDS.localizedChangeOrder },
        });
        expect(suggestScenarioFromStats(m).scenario).toBe('localized_change');
    });

    it('localized_change outranks slow_boiling for a slow but clustered front', () => {
        const m = metrics({ changed: { mean: 40 }, changeOrder: { mean: 0.5 } });
        expect(suggestScenarioFromStats(m).scenario).toBe('localized_change');
    });

    it('sparse aperiodic activity on a dense field → slow_boiling', () => {
        const m = metrics({
            finalRatio: 0.9,
            finalActiveCount: 0.9 * CELLS,
            changed: { mean: 170 },
            changeOrder: { mean: 0.14 },
            blockEntropy: { mean: 0.4 },
        });
        expect(suggestScenarioFromStats(m).scenario).toBe('slow_boiling');
    });

    it('high-entropy well-mixed change → distributed_churn', () => {
        const m = metrics({
            finalRatio: 0.5,
            finalActiveCount: 0.5 * CELLS,
            changed: { mean: 8000 },
            changeOrder: { mean: 0.02 },
            blockEntropy: { mean: 0.6 },
        });
        expect(suggestScenarioFromStats(m).scenario).toBe('distributed_churn');
    });

    it('busy but low-entropy and unstructured → other', () => {
        const m = metrics({
            finalRatio: 0.5,
            finalActiveCount: 0.5 * CELLS,
            changed: { mean: 8000 },
            changeOrder: { mean: 0.02 },
            blockEntropy: { mean: 0.05 },
        });
        const result = suggestScenarioFromStats(m);
        expect(result.scenario).toBe('other');
        expect(result.confidence).toBe('low');
    });
});

describe('suggestScenarioFromStats — cell-count handling', () => {
    it('accepts an explicit cellCount instead of deriving one', () => {
        const m = {
            finalRatio: 0.3,
            cellCount: CELLS,
            changed: { mean: 0 },
            cycle: { detected: false, period: 0 },
        };
        expect(suggestScenarioFromStats(m).scenario).toBe('still_life');
    });

    it('explicit cellCount wins over the derived one', () => {
        // 300 changed cells per tick is 0.7% of 42624 cells (a slow simmer) but 6% of 5000 (churn).
        const shared = { changed: { mean: 300 }, blockEntropy: { mean: 0.6 }, changeOrder: { mean: 0 } };
        const derived = metrics({ ...shared, finalRatio: 0.5, finalActiveCount: 0.5 * CELLS });
        expect(suggestScenarioFromStats(derived).scenario).toBe('slow_boiling');
        expect(suggestScenarioFromStats({ ...derived, cellCount: 5000 }).scenario).toBe('distributed_churn');
    });

    it('without any cell count the activity branches are skipped', () => {
        const m = { finalRatio: 0.5, changed: { mean: 8000 }, blockEntropy: { mean: 0.6 } };
        const result = suggestScenarioFromStats(m);
        expect(result.scenario).toBe('distributed_churn');
        expect(result.confidence).toBe('low'); // magnitude unverifiable ⇒ make the owner look
    });
});

describe('suggestScenarioFromStats — contract', () => {
    it('returns unknown for unusable input', () => {
        for (const input of [null, undefined, 'nope', 42]) {
            expect(suggestScenarioFromStats(input)).toEqual({ scenario: 'unknown', confidence: 'low' });
        }
    });

    it('an empty metrics object is still a legal scenario, never a throw', () => {
        expect(isCorpusScenario(suggestScenarioFromStats({}).scenario)).toBe(true);
    });

    it('honours injected thresholds', () => {
        const m = metrics({
            finalRatio: 0.02,
            finalActiveCount: 0.02 * CELLS,
            changed: { mean: 700 },
            transport: { meanSpeed: 0.1 },
            changeOrder: { mean: 0.45 },
        });
        expect(suggestScenarioFromStats(m).scenario).toBe('glider');
        const strict = { ...SCENARIO_THRESHOLDS, gliderTransport: 0.5 };
        expect(suggestScenarioFromStats(m, strict).scenario).toBe('localized_change');
    });
});

describe('suggestScenarioFromStats — reference fixtures', () => {
    it('both glider references classify as gliders', () => {
        expect(suggestScenarioFromStats(fixtures.gliders_chaos_160).scenario).toBe('glider');
        expect(suggestScenarioFromStats(fixtures.gliders_sparse_160).scenario).toBe('glider');
    });

    it('the degenerate seed run is a saturated blanket', () => {
        expect(suggestScenarioFromStats(fixtures.gliders_seed_160).scenario).toBe('saturation');
    });

    it('churn_sparse_160 is a slow simmer: 0.4% of cells change per tick', () => {
        expect(suggestScenarioFromStats(fixtures.churn_sparse_160).scenario).toBe('slow_boiling');
    });

    it('the longer churn_sparse run finds its period-84 cycle → oscillator', () => {
        // Same ruleset as churn_sparse_160; the extra ticks are what surface the cycle. More
        // evidence legitimately changes the answer.
        expect(suggestScenarioFromStats(fixtures.churn_sparse_600).scenario).toBe('oscillator');
    });

    it('every fixture yields a coverage-eligible scenario with high confidence', () => {
        for (const key of Object.keys(fixtures)) {
            if (key === '_meta') continue;
            const { scenario, confidence } = suggestScenarioFromStats(fixtures[key]);
            expect(CORPUS_SCENARIOS).toContain(scenario);
            expect(countsTowardCoverage(scenario), `${key} → ${scenario}`).toBe(true);
            expect(confidence, `${key} → ${confidence}`).toBe('high');
        }
    });
});

describe('corpusProtocol vocabulary', () => {
    it('CORPUS_SCENARIOS is the acceptance list plus the unknown sentinel', () => {
        expect(CORPUS_SCENARIOS).toEqual(['unknown', ...ACCEPTANCE_SCENARIOS]);
    });

    it('unknown is a legal header value but never counts toward coverage', () => {
        expect(isCorpusScenario('unknown')).toBe(true);
        expect(countsTowardCoverage('unknown')).toBe(false);
    });

    it('rejects values outside the vocabulary', () => {
        expect(isCorpusScenario('gliders')).toBe(false); // canonical tag id, not a scenario id
        expect(countsTowardCoverage('')).toBe(false);
    });
});
