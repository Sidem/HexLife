// @ts-check

/**
 * Corpus v1 protocol vocabulary (#37 Stage 4B).
 *
 * The machine-readable source of truth is `protocol/corpus-v1.json` in the sibling
 * `HexLifeInterestModel` project; this module mirrors only the identifiers Explorer needs to write
 * conforming HXLT1 headers. Keep the two in sync by hand — the protocol is frozen, so drift here is
 * a bug, not a feature. Changing any value requires a new protocol version on both sides.
 *
 * Deliberately dependency-free (no Config, no DOM, no download helpers) so the pure analysis layer
 * and the owner-facing collection overlay can both import it without dragging in the capture
 * service. `TrajectoryCaptureService` re-exports the names it used to own.
 */

/** Protocol id stamped into every acceptance clip's `corpusProtocol` header field. */
export const CORPUS_PROTOCOL = 'corpus-v1';

/**
 * The nine behaviour classes the protocol counts toward acceptance coverage. Mirrors
 * `corpus-v1.json` → `scenarios` exactly, in the same order.
 */
export const ACCEPTANCE_SCENARIOS = [
    'glider',
    'localized_change',
    'distributed_churn',
    'still_life',
    'oscillator',
    'slow_boiling',
    'extinction',
    'saturation',
    'structured_growth',
    'other',
];

/**
 * Scenario vocabulary for UI and header validation: the acceptance classes plus the `unknown`
 * sentinel. `unknown` is a legal header value — such clips stay usable as training/smoke data — but
 * the strict audit excludes them from coverage, so collection tools should avoid emitting it.
 */
export const CORPUS_SCENARIOS = ['unknown', ...ACCEPTANCE_SCENARIOS];

/** Symmetry classes the audit requires both labels in. Matches `classifyRulesetConstraint` outputs. */
export const CORPUS_SYMMETRY_CLASSES = ['free', 'r_sym', 'd_sym', 'n_count', 'totalistic'];

/** Family ids are 3–100 chars of lowercase alphanumerics and hyphens (`familyTaxonomy.idPattern`). */
export const CORPUS_FAMILY_PATTERN = /^[a-z0-9][a-z0-9-]{2,99}$/;

/**
 * Grid-preset keys the audit requires clips for, in size order. Mirrors `corpus-v1.json` →
 * `gridPresets`. Kept as bare keys rather than importing `Config.GRID_SIZE_PRESETS` so this module
 * stays dependency-free; the two agree because both derive from `gridMath.js`.
 */
export const CORPUS_GRID_PRESETS = ['small', 'medium', 'large', 'huge'];

/**
 * The `coverage` gate block, mirrored field-for-field from `corpus-v1.json`.
 *
 * Read `minimumSeedsPerRuleset` / `minimumInitialConditionsPerRuleset` carefully: the auditor applies
 * them to **every** ruleset it finds, not to a quota of rulesets. One world judged once and never
 * revisited is therefore a permanent audit failure, which is why collection has to schedule revisits
 * rather than only drawing fresh lineages.
 */
export const CORPUS_COVERAGE = {
    minimumLabeledClips: 400,
    minimumSeedsPerRuleset: 3,
    minimumInitialConditionsPerRuleset: 2,
    minimumClipsPerGridPreset: 32,
    requireBothLabelsPerSymmetryClass: true,
    requireEveryScenario: true,
};

/** `splitPolicy.minimumFamilies` — ten families in total, which the proposed split cycle fills. */
export const CORPUS_MINIMUM_FAMILIES = { train: 6, validation: 2, test: 2 };

/** Lineage relationships a registered family may declare. */
export const CORPUS_FAMILY_RELATIONSHIPS = ['mutation-lineage', 'exact-ruleset'];

/** Clip labels the protocol accepts, plus the pre-judgment sentinel used by collection UIs. */
export const CORPUS_LABELS = ['interesting', 'boring'];

const SCENARIO_SET = new Set(CORPUS_SCENARIOS);
const ACCEPTANCE_SET = new Set(ACCEPTANCE_SCENARIOS);

/** @param {unknown} value @returns {boolean} True for any legal header scenario, `unknown` included. */
export function isCorpusScenario(value) {
    return SCENARIO_SET.has(String(value));
}

/** @param {unknown} value @returns {boolean} True only for scenarios that count toward coverage. */
export function countsTowardCoverage(value) {
    return ACCEPTANCE_SET.has(String(value));
}

/**
 * Normalize an arbitrary value to a legal scenario id, falling back to `unknown`.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeScenario(value) {
    const scenario = String(value);
    return SCENARIO_SET.has(scenario) ? scenario : 'unknown';
}

/** @param {unknown} value @returns {boolean} */
export function isCorpusFamilyId(value) {
    return typeof value === 'string' && CORPUS_FAMILY_PATTERN.test(value);
}

/** @param {unknown} value @returns {string} Key-sorted JSON, so equal states hash equal. */
function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        const object = /** @type {Record<string, unknown>} */ (value);
        return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

/** @param {string} value */
function fnv1a(value) {
    let hash = 0x811C9DC5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The `initialConditionId` header value for an initial state.
 *
 * Single-sourced here because two callers must agree exactly: the capture service *writes* the id
 * into every clip header, and the collection scheduler *reads* it to decide whether a ruleset still
 * needs a second distinct initial condition. A private copy in either place would let the scheduler
 * believe it had achieved diversity it had not.
 *
 * @param {object|undefined|null} initialState
 * @returns {string}
 */
export function initialConditionId(initialState) {
    return `ic-${fnv1a(canonicalJson(initialState || { mode: 'unknown' }))}`;
}
