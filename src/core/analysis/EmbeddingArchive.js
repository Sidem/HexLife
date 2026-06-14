// @ts-check

import { dot } from './EmbeddingNovelty.js';

/**
 * Perceptual **illumination archive** (ASAL-style), running alongside the hand-designed
 * {@link module:core/analysis/BehaviorArchive}. Where BehaviorArchive bins candidates by a
 * hand-crafted descriptor (ratio / entropy / σ), this one bins them by their *foundation-model image
 * embedding*, so the search is also pushed toward regions that look perceptually distinct to a vision
 * model — exactly the illumination axis Kumar et al. (2024) use.
 *
 * The embedding lives in a high-dimensional space (≈512-D for CLIP), far too large to grid directly,
 * so cells are keyed by a **random-projection sign hash** (SimHash / locality-sensitive hashing):
 * `numBits` fixed random hyperplanes partition the space, and the sign of the embedding's dot product
 * with each gives one bit. Nearby embeddings collide into the same cell with high probability, so each
 * cell holds one perceptual neighborhood. The projection is generated **deterministically** from a
 * fixed seed + the embedding dimension (a seeded PRNG), so the same embedding always hashes to the
 * same cell across sessions — which lets a persisted cell key be compared against a freshly-hashed
 * candidate without storing the (large) raw vector.
 *
 * This module is PURE: no workers, model, EventBus, persistence, or globals. Persistence is the
 * caller's concern; entries round-trip as compact plain JSON (hex + score + cellKey, NO raw vector).
 * With embeddings off, this archive is simply never constructed/used and the statistical search is
 * byte-for-byte unchanged.
 */

/** All tunable knobs for the perceptual archive. */
export const EMBEDDING_ARCHIVE_CONFIG = {
    /** Number of random hyperplanes ⇒ 2^numBits perceptual cells (8 → 256 cells). */
    numBits: 8,
    /** Fixed PRNG seed for the projection (determinism across sessions — never change casually). */
    projectionSeed: 0x9e3779b9,
    /**
     * Champion-selection novelty multiplier when a candidate's perceptual cell is already occupied by
     * an equal-or-better incumbent (the stored score is never penalized). < 1 penalizes re-finding the
     * same look; 1 disables perceptual novelty pressure.
     */
    occupiedNoveltyMultiplier: 0.7,
};

/**
 * A stored perceptual-archive entry (compact — no raw vector; the cell key is the durable identity).
 * @typedef {object} EmbeddingEntry
 * @property {string} hex            32-char ruleset hex.
 * @property {string} [mnemonic]     Human-friendly ruleset name.
 * @property {number} score          Confirmed interestingness ([0,1]).
 * @property {string} cellKey        Random-projection sign-hash cell key (filled by tryInsert).
 * @property {number} [openEndedness] The find's raw trajectory novelty (for inspection).
 * @property {number} [generation]   Generation the entry was found in.
 */

/**
 * Mulberry32 — a tiny, fast, deterministic 32-bit PRNG. Same seed ⇒ same stream, in any JS engine, so
 * the random projection is reproducible across sessions and machines.
 * @param {number} seed
 * @returns {() => number} next() → float in [0,1)
 */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Build `numBits` deterministic random hyperplane normals of dimension `dim`. Entries are drawn
 * uniformly in [-1, 1] from a seeded PRNG — fine for sign hashing (only the dot-product sign matters).
 * @param {number} dim
 * @param {number} numBits
 * @param {number} seed
 * @returns {Float32Array[]}
 */
export function buildProjection(dim, numBits, seed) {
    const rng = mulberry32(seed);
    const planes = [];
    for (let b = 0; b < numBits; b++) {
        const plane = new Float32Array(dim);
        for (let i = 0; i < dim; i++) plane[i] = rng() * 2 - 1;
        planes.push(plane);
    }
    return planes;
}

/**
 * Hash an embedding to a sign-bit cell key against a prebuilt projection.
 * @param {Float32Array|number[]} vector
 * @param {Float32Array[]} planes
 * @returns {string} e.g. "10110010"
 */
export function hashEmbedding(vector, planes) {
    let key = '';
    for (let b = 0; b < planes.length; b++) {
        key += dot(vector, planes[b]) >= 0 ? '1' : '0';
    }
    return key;
}

/**
 * MAP-Elites-lite archive keyed by a perceptual (embedding) sign hash: one best entry per cell, plus
 * a novelty query for champion selection. The projection is built lazily on the first hashed vector
 * (once the embedding dimension is known) and reused thereafter.
 */
export class EmbeddingArchive {
    /**
     * @param {typeof EMBEDDING_ARCHIVE_CONFIG} [config]
     */
    constructor(config = EMBEDDING_ARCHIVE_CONFIG) {
        this.config = config;
        /** @type {Map<string, EmbeddingEntry>} */
        this.cells = new Map();
        /** @type {Float32Array[]|null} Lazily built once the embedding dimension is known. */
        this._planes = null;
        /** @type {number} Dimension the projection was built for (0 = not built yet). */
        this._dim = 0;
    }

    /**
     * Compute (building if necessary) the cell key for an embedding vector. Returns null for an
     * empty/absent vector (the caller then skips perceptual insertion/novelty for that find).
     * @param {Float32Array|number[]|null|undefined} vector
     * @returns {string|null}
     */
    cellKeyFor(vector) {
        if (!vector || vector.length === 0) return null;
        if (!this._planes || this._dim !== vector.length) {
            this._dim = vector.length;
            this._planes = buildProjection(this._dim, this.config.numBits, this.config.projectionSeed);
        }
        return hashEmbedding(vector, this._planes);
    }

    /**
     * Attempt to insert a find by its embedding. Keeps the single best-scoring entry per perceptual
     * cell. A find with no usable embedding (`vector` null/empty) is a no-op (returns `skipped`).
     * @param {EmbeddingEntry & {vector?: Float32Array|number[]|null}} entry
     * @returns {{added: boolean, improved: boolean, skipped?: boolean, cellKey: string|null}}
     */
    tryInsert(entry) {
        const cellKey = this.cellKeyFor(entry && entry.vector);
        if (!cellKey) return { added: false, improved: false, skipped: true, cellKey: null };
        // Strip the (large) raw vector before storing — the cell key is the durable identity.
        const { vector: _vector, ...rest } = entry;
        const stored = { ...rest, cellKey };
        const existing = this.cells.get(cellKey);
        if (!existing) {
            this.cells.set(cellKey, stored);
            return { added: true, improved: false, cellKey };
        }
        if (entry.score > existing.score) {
            this.cells.set(cellKey, stored);
            return { added: false, improved: true, cellKey };
        }
        return { added: false, improved: false, cellKey };
    }

    /**
     * Whether the perceptual cell for `vector` is already occupied by an equal-or-better entry.
     * Self-exemption: an incumbent with the same `hex` does not count as occupying the cell (mirrors
     * BehaviorArchive.isOccupiedBetter — a champion is never penalized against its own entry).
     * @param {Float32Array|number[]|null|undefined} vector
     * @param {number} score
     * @param {string} [hex]
     * @returns {boolean}
     */
    isOccupiedBetter(vector, score, hex) {
        const cellKey = this.cellKeyFor(vector);
        if (!cellKey) return false;
        const existing = this.cells.get(cellKey);
        if (!existing || existing.score < score) return false;
        if (hex != null && existing.hex === hex) return false;
        return true;
    }

    /**
     * Perceptual-novelty multiplier for champion selection: 1 for a candidate that would fill/improve
     * its perceptual cell (or has no usable embedding — never penalized), the configured multiplier
     * for one already covered by a *different* better incumbent.
     * @param {Float32Array|number[]|null|undefined} vector
     * @param {number} score
     * @param {string} [hex]
     * @returns {number}
     */
    noveltyMultiplier(vector, score, hex) {
        return this.isOccupiedBetter(vector, score, hex) ? this.config.occupiedNoveltyMultiplier : 1;
    }

    /** @returns {number} Number of occupied perceptual cells. */
    get size() {
        return this.cells.size;
    }

    /**
     * All stored entries, best score first.
     * @returns {EmbeddingEntry[]}
     */
    getEntries() {
        return [...this.cells.values()].sort((a, b) => b.score - a.score);
    }

    /** Drop every entry (keeps the lazily-built projection so keys stay comparable within a session). */
    clear() {
        this.cells.clear();
    }

    /**
     * Re-seed occupancy from a persisted entry list. Each entry already carries its durable `cellKey`
     * (the projection is deterministic, so a persisted key is comparable to a freshly-hashed one with
     * no raw vector stored), so this populates the cell map directly, keeping the best per cell.
     * @param {EmbeddingEntry[]} entries
     */
    loadEntries(entries) {
        this.cells.clear();
        if (!Array.isArray(entries)) return;
        for (const e of entries) {
            if (!e || typeof e.hex !== 'string' || typeof e.score !== 'number' || typeof e.cellKey !== 'string') continue;
            const existing = this.cells.get(e.cellKey);
            if (!existing || e.score > existing.score) this.cells.set(e.cellKey, { ...e });
        }
    }
}
