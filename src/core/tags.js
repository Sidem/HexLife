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
 *  - `promptText`  a CLIP-friendly natural-language phrase, embedded once by the embedding
 *                  suggestion path (§T3) to rank a find's frame against the tag bank.
 */

/**
 * @typedef {object} CanonicalTag
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {string} promptText
 */

/** @type {CanonicalTag[]} */
export const CANONICAL_TAGS = [
    { id: 'gliders', label: 'Gliders', description: 'Small self-propelled patterns that travel across the grid.', promptText: 'a pattern of small moving spaceship shapes gliding across a grid' },
    { id: 'ships', label: 'Ships', description: 'Larger coherent structures that translate steadily.', promptText: 'large coherent structures steadily travelling across the field' },
    { id: 'spirals', label: 'Spirals', description: 'Rotating spiral waves and scroll patterns.', promptText: 'rotating spiral waves swirling outward' },
    { id: 'oscillators', label: 'Oscillators', description: 'Patterns that repeat on a fixed period.', promptText: 'blinking oscillating patterns that repeat in place' },
    { id: 'still-life', label: 'Still life', description: 'Stable structures that never change.', promptText: 'a static still life of unchanging stable shapes' },
    { id: 'growth', label: 'Growth', description: 'Coverage that expands to fill the grid.', promptText: 'an expanding pattern of growth filling the whole grid' },
    { id: 'decay', label: 'Decay', description: 'Activity that dwindles toward extinction.', promptText: 'a fading pattern decaying toward emptiness' },
    { id: 'chaos', label: 'Chaos', description: 'High-entropy churning with no lasting structure.', promptText: 'chaotic random noise churning with no structure' },
    { id: 'waves', label: 'Waves', description: 'Travelling fronts and ripple patterns.', promptText: 'travelling waves and rippling fronts moving across the surface' },
    { id: 'maze', label: 'Maze', description: 'Static labyrinthine corridors.', promptText: 'a static maze of winding labyrinth corridors' },
    { id: 'mosaic', label: 'Mosaic', description: 'Regular tiled or crystalline texture.', promptText: 'a regular crystalline mosaic of tiled cells' },
    { id: 'blobs', label: 'Blobs', description: 'Rounded amorphous clumps.', promptText: 'rounded amorphous blobs and droplets' },
    { id: 'dots', label: 'Dots', description: 'Sparse scattered isolated cells.', promptText: 'sparse scattered isolated dots on an empty field' },
    { id: 'symmetric', label: 'Symmetric', description: 'Patterns with strong rotational or mirror symmetry.', promptText: 'a symmetric pattern with strong mirror and rotational symmetry' },
    { id: 'flicker', label: 'Flicker', description: 'Fast, uncorrelated twinkling activity.', promptText: 'fast flickering twinkling cells switching on and off' },
    { id: 'puffers', label: 'Puffers', description: 'Moving structures that leave a trail of debris.', promptText: 'a moving puffer trailing a wake of debris behind it' },
    { id: 'replicators', label: 'Replicators', description: 'Patterns that copy themselves.', promptText: 'a self-replicating pattern copying itself repeatedly' },
    { id: 'edge-of-chaos', label: 'Edge of chaos', description: 'Near-critical dynamics balanced between order and noise.', promptText: 'complex near-critical dynamics at the edge of chaos' },
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
