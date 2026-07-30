// @ts-check

/**
 * Canonical tag vocabulary (roadmap #13, PLAY-LAYER-PLAN §T1).
 *
 * A small curated set of behaviour tags shared by the save flow, the library filter chips and the
 * suggestion engine. Free-form tags remain allowed everywhere (the library `tags` field stays
 * `string[]`); canonical ids exist so common concepts don't fragment (`glider`/`gliders`/`ship`)
 * and so imported community packs merge into the SAME filter chips instead of forking the vocabulary.
 *
 * This module is PURE: no DOM, EventBus, persistence or globals — just data + tiny lookups, so it is
 * safe to import from workers, the score modules and the UI alike.
 *
 * **Append-only, like the mnemonic word arrays** (utils.js): never rename or remove an existing `id`
 * — saved entries reference ids by string, so a rename orphans them. Add new tags to the end.
 *
 * Each entry:
 *  - `id`          the stable string stored in a ruleset's `tags` array (kebab-case).
 *  - `label`       the human-facing chip text.
 *  - `description` a short tooltip / a11y hint.
 */

/**
 * @typedef {object} CanonicalTag
 * @property {string} id
 * @property {string} label
 * @property {string} description
 */

/** @type {CanonicalTag[]} */
export const CANONICAL_TAGS = [
    { id: 'gliders', label: 'Gliders', description: 'Small self-propelled patterns that travel across the grid.' },
    { id: 'ships', label: 'Ships', description: 'Larger coherent structures that translate steadily.' },
    { id: 'spirals', label: 'Spirals', description: 'Rotating spiral waves and scroll patterns.' },
    { id: 'oscillators', label: 'Oscillators', description: 'Patterns that repeat on a fixed period.' },
    { id: 'still-life', label: 'Still life', description: 'Stable structures that never change.' },
    { id: 'growth', label: 'Growth', description: 'Coverage that expands to fill the grid.' },
    { id: 'decay', label: 'Decay', description: 'Activity that dwindles toward extinction.' },
    { id: 'chaos', label: 'Chaos', description: 'High-entropy churning with no lasting structure.' },
    { id: 'waves', label: 'Waves', description: 'Travelling fronts and ripple patterns.' },
    { id: 'maze', label: 'Maze', description: 'Static labyrinthine corridors.' },
    { id: 'mosaic', label: 'Mosaic', description: 'Regular tiled or crystalline texture.' },
    { id: 'blobs', label: 'Blobs', description: 'Rounded amorphous clumps.' },
    { id: 'dots', label: 'Dots', description: 'Sparse scattered isolated cells.' },
    { id: 'symmetric', label: 'Symmetric', description: 'Patterns with strong rotational or mirror symmetry.' },
    { id: 'flicker', label: 'Flicker', description: 'Fast, uncorrelated twinkling activity.' },
    { id: 'puffers', label: 'Puffers', description: 'Moving structures that leave a trail of debris.' },
    { id: 'replicators', label: 'Replicators', description: 'Patterns that copy themselves.' },
    { id: 'edge-of-chaos', label: 'Edge of chaos', description: 'Near-critical dynamics balanced between order and noise.' },
];

/** @type {Map<string, CanonicalTag>} */
const BY_ID = new Map(CANONICAL_TAGS.map((t) => [t.id, t]));

/** All canonical tag ids, in curated order. @type {string[]} */
export const CANONICAL_TAG_IDS = CANONICAL_TAGS.map((t) => t.id);

/**
 * Look up a canonical tag by id.
 * @param {string} id
 * @returns {CanonicalTag|undefined}
 */
export function getTag(id) {
    return BY_ID.get(id);
}

/**
 * Whether `id` is one of the canonical tags (vs a free-form custom tag).
 * @param {string} id
 * @returns {boolean}
 */
export function isCanonicalTag(id) {
    return BY_ID.has(id);
}

/**
 * Human-facing label for a tag id: the canonical label if known, else the raw id (custom tags render
 * as-is). Pure; safe for chip rendering.
 * @param {string} id
 * @returns {string}
 */
export function tagLabel(id) {
    return BY_ID.get(id)?.label ?? id;
}

/**
 * Normalize a free-text tag into the stored form: trimmed, lower-cased, inner whitespace collapsed to
 * single hyphens. Returns '' for empty/invalid input. Keeps custom tags from fragmenting on casing and
 * lets a typed "Still Life" collapse onto the canonical `still-life` id.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeTag(raw) {
    if (typeof raw !== 'string') return '';
    return raw.trim().toLowerCase().replace(/\s+/g, '-');
}
