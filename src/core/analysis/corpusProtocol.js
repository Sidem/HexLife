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
