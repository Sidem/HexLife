// @ts-check

import libraryRulesets from '../library/rulesets.json';
import { classifyRulesetConstraint } from '../rulesetDescriptor.js';
import { GENERATIVE_PRESETS, initialStateFromPreset } from '../initialStatePresets.js';
import { CORPUS_FAMILY_PATTERN } from './corpusProtocol.js';

/**
 * Ruleset-lineage generation for Corpus v1 collection (#37 Stage 4B.2).
 *
 * Corpus v1 makes the **ruleset family** the immutable owner of the train/validation/test split: an
 * anchor ruleset plus every close descendant belongs to exactly one split, so near mutants can never
 * leak across held-out evaluation. This module is where that lineage is *constructed*, which makes it
 * the only trustworthy witness to family membership — the generator knows that hex B is a two-bit
 * mutant of hex A, whereas an owner typing a family name into a text box halfway through a long
 * session does not.
 *
 * Three consequences are deliberate:
 *
 * 1. **Family ids are derived, never entered.** They embed the anchor hex, so two different anchors
 *    can never collide into one family — the protocol forbids merging families after a split has
 *    been observed.
 * 2. **Mutation preserves the anchor's constraint class.** Mutating an `r_sym` anchor with `single`
 *    mode would yield `free` descendants, so a lineage seeded to fill the `r_sym` coverage stratum
 *    would fill `free` instead. Each class mutates in its own mode, which flips whole orbit groups.
 * 3. **Mutation distance is graduated.** Members ladder from ~1-bit to ~8-bit distance rather than
 *    all sitting at one rate, which yields both the near-identical pairs that make good hard pairs
 *    and enough spread for a family to be informative.
 *
 * Pure apart from the injected `rng` and ruleset service: no DOM, no EventBus, no worker access.
 */

/**
 * Mutation rates walked in order across a lineage's descendants, approximately 1, 2, 4, and 8 flipped
 * entries in `single` mode. Orbit modes have fewer, larger units, so the same rate flips fewer groups.
 */
export const MUTATION_LADDER = [0.008, 0.016, 0.031, 0.063];

/** Attempts to find a descendant hex not already present in the lineage before giving up. */
const DISTINCT_RETRIES = 6;

/** Probability that a library-anchored round reuses the entry's own curated initial condition. */
export const LIBRARY_OWN_IC_PROBABILITY = 1 / 3;

/** Constraint class → the mutation mode that preserves it. `free` has nothing to preserve. */
const MUTATION_MODE_FOR_CLASS = {
    totalistic: 'totalistic',
    n_count: 'n_count',
    d_sym: 'd_sym',
    r_sym: 'r_sym',
    free: 'single',
};

/** Bias used when drawing a fresh random anchor, matching the Explore panel's neutral default. */
export const RANDOM_ANCHOR_BIAS = 0.5;

/**
 * @typedef {object} LineageMember
 * @property {string} rulesetHex      32-char hex.
 * @property {boolean} isAnchor
 * @property {number} mutationRate    0 for the anchor.
 * @property {string} mutationMode    `'none'` for the anchor.
 * @property {string|null} symmetryClass Recomputed per member; a mutant can land in a stricter class.
 */

/**
 * @typedef {object} Lineage
 * @property {string} familyId
 * @property {string} anchorRuleset
 * @property {'mutation-lineage'|'exact-ruleset'} relationship
 * @property {'library'|'random'} origin
 * @property {string|null} libraryName        Entry name for library anchors, else null.
 * @property {string|null} anchorSymmetryClass
 * @property {LineageMember[]} members
 */

/** @param {string} value @param {number} maxLength */
function slug(value, maxLength) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, maxLength)
        .replace(/-+$/g, '');
}

/**
 * Derive the family id for an anchor. Deterministic in its inputs, so re-deriving the same anchor
 * always reproduces the same id — required, because the id is what binds already-collected clips to
 * a registered split.
 *
 * The 12-hex suffix is what guarantees distinct anchors get distinct families: two library entries
 * whose names slug identically, or two random rulesets in the same class, must not merge.
 *
 * @param {{origin: 'library'|'random', hex: string, name?: string|null, symmetryClass?: string|null}} anchor
 * @returns {string} A `CORPUS_FAMILY_PATTERN`-valid id.
 */
export function deriveFamilyId(anchor) {
    const hex = String(anchor?.hex || '').toLowerCase();
    const suffix = slug(hex.slice(0, 12), 12);
    const middle = anchor?.origin === 'library'
        ? slug(anchor.name || '', 40)
        : slug(anchor?.symmetryClass || 'free', 12);
    const prefix = anchor?.origin === 'library' ? 'lib' : 'rand';
    const id = [prefix, middle, suffix].filter(Boolean).join('-');
    // `slug` can empty the middle (a name of only punctuation) and an invalid hex can empty the
    // suffix; the prefix plus either part still satisfies the 3-char minimum.
    return CORPUS_FAMILY_PATTERN.test(id) ? id : `${prefix}-unclassified`;
}

/**
 * Every public-library entry usable as an anchor, with its derived constraint class.
 * @returns {Array<{name: string, hex: string, symmetryClass: string|null, initialState: object|undefined, seed: number|undefined}>}
 */
export function libraryAnchors() {
    return (/** @type {any[]} */ (libraryRulesets))
        .filter((entry) => typeof entry?.hex === 'string' && /^[0-9a-fA-F]{32}$/.test(entry.hex))
        .map((entry) => ({
            name: String(entry.name || ''),
            hex: String(entry.hex),
            symmetryClass: classifyRulesetConstraint(entry.hex),
            initialState: entry.initialState,
            seed: typeof entry.seed === 'number' ? entry.seed : undefined,
        }));
}

/** @param {() => number} rng @param {number} length */
function pickIndex(rng, length) {
    return Math.min(length - 1, Math.max(0, Math.floor(rng() * length)));
}

/**
 * Draw an initial condition for a collection round.
 *
 * Library-anchored rounds reuse the entry's own curated initial condition with probability
 * {@link LIBRARY_OWN_IC_PROBABILITY}: the curated pairing is what lets an interesting rule actually
 * show its interesting behaviour, while the preset draws supply the variety the audit's
 * per-ruleset initial-condition minimum demands. Both are wanted in the corpus.
 *
 * @param {() => number} rng
 * @param {{ownInitialState?: object|null}} [options]
 * @returns {{presetName: string, initialState: object, source: 'preset'|'library-entry'}}
 */
export function pickInitialCondition(rng, options = {}) {
    if (options.ownInitialState && rng() < LIBRARY_OWN_IC_PROBABILITY) {
        return {
            presetName: 'Library entry',
            initialState: structuredClone(options.ownInitialState),
            source: 'library-entry',
        };
    }
    const preset = GENERATIVE_PRESETS[pickIndex(rng, GENERATIVE_PRESETS.length)];
    return {
        presetName: preset.name,
        initialState: initialStateFromPreset(preset),
        source: 'preset',
    };
}

/**
 * Draw a fresh reset seed. Non-zero because `WorldManager._getResetSeed` treats a falsy seed as
 * "let the worker pick", which would lose the provenance the corpus audit requires.
 * @param {() => number} rng
 * @returns {number}
 */
export function pickSeed(rng) {
    return Math.floor(rng() * 0xFFFFFFFE) + 1;
}

/**
 * Build one ruleset lineage: an anchor plus graduated mutants, all sharing a derived family id.
 *
 * @param {object} options
 * @param {'library'|'random'} [options.origin] Anchor source. Defaults to `'library'`.
 * @param {number} [options.memberCount] Total worlds including the anchor. Clamped to 1–9.
 * @param {string} [options.symmetryClass] For random anchors, the generation mode to draw in.
 *        Ignored for library anchors, whose class is whatever their table says.
 * @param {string} [options.anchorHex] Force a specific anchor (replay/testing).
 * @param {object} deps
 * @param {import('../RulesetService.js').RulesetService} deps.rulesetService
 * @param {() => number} [deps.rng]
 * @returns {Lineage}
 */
export function buildLineage(options, deps) {
    const rng = deps?.rng || Math.random;
    const rulesetService = deps?.rulesetService;
    if (!rulesetService) throw new Error('buildLineage requires a rulesetService.');

    const origin = options?.origin === 'random' ? 'random' : 'library';
    const memberCount = Math.max(1, Math.min(9, Math.trunc(Number(options?.memberCount) || 9)));

    /** @type {{hex: string, name: string|null, initialState: object|null, seed: number|undefined}} */
    let anchor;
    if (options?.anchorHex) {
        anchor = { hex: String(options.anchorHex), name: null, initialState: null, seed: undefined };
    } else if (origin === 'library') {
        const anchors = libraryAnchors();
        if (!anchors.length) throw new Error('The public ruleset library has no usable anchors.');
        const entry = anchors[pickIndex(rng, anchors.length)];
        anchor = {
            hex: entry.hex,
            name: entry.name,
            initialState: entry.initialState || null,
            seed: entry.seed,
        };
    } else {
        const mode = options?.symmetryClass && options.symmetryClass !== 'free'
            ? options.symmetryClass
            : 'free';
        anchor = {
            hex: rulesetService.generateRandomRulesetHex(RANDOM_ANCHOR_BIAS, mode, rng),
            name: null,
            initialState: null,
            seed: undefined,
        };
    }

    const anchorHex = anchor.hex.toUpperCase();
    const anchorSymmetryClass = classifyRulesetConstraint(anchorHex);
    const mutationMode = MUTATION_MODE_FOR_CLASS[anchorSymmetryClass || 'free'] || 'single';
    const familyId = deriveFamilyId({
        origin,
        hex: anchorHex,
        name: anchor.name,
        symmetryClass: anchorSymmetryClass,
    });

    /** @type {LineageMember[]} */
    const members = [{
        rulesetHex: anchorHex,
        isAnchor: true,
        mutationRate: 0,
        mutationMode: 'none',
        symmetryClass: anchorSymmetryClass,
    }];
    const seen = new Set([anchorHex]);

    for (let index = 1; index < memberCount; index++) {
        const mutationRate = MUTATION_LADDER[(index - 1) % MUTATION_LADDER.length];
        let hex = anchorHex;
        // A low rate can flip nothing at all; a duplicate would waste a world and emit duplicate
        // clips under the same family. Retry, then accept — never loop forever.
        for (let attempt = 0; attempt <= DISTINCT_RETRIES; attempt++) {
            hex = rulesetService.generateMutatedHex(anchorHex, mutationRate, mutationMode, null, rng)
                .toUpperCase();
            if (!seen.has(hex)) break;
        }
        seen.add(hex);
        members.push({
            rulesetHex: hex,
            isAnchor: false,
            mutationRate,
            mutationMode,
            symmetryClass: classifyRulesetConstraint(hex),
        });
    }

    return {
        familyId,
        anchorRuleset: anchorHex,
        // A single-member lineage has no descendants to hold together, so it is an exact-ruleset
        // family; anything larger is a mutation lineage.
        relationship: members.length > 1 ? 'mutation-lineage' : 'exact-ruleset',
        origin,
        libraryName: anchor.name,
        anchorSymmetryClass,
        members,
    };
}

/**
 * The `families-v1.json` registry entry a lineage proposes. The tool only ever *proposes* a split;
 * the owner registers it, and trajectory headers never choose their own.
 *
 * @param {Lineage} lineage
 * @param {'train'|'validation'|'test'} split
 * @returns {{id: string, split: string, anchorRuleset: string, relationship: string}}
 */
export function familyRegistryEntry(lineage, split) {
    return {
        id: lineage.familyId,
        split,
        anchorRuleset: lineage.anchorRuleset,
        relationship: lineage.relationship,
    };
}
