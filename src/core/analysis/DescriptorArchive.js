// @ts-check

import { mulberry32 } from '../rng.js';

/**
 * Native 32-D descriptor archive. It uses a deterministic random-projection sign hash so learned
 * behavior neighborhoods have compact, stable cell keys without persisting raw model vectors.
 */
export const DESCRIPTOR_ARCHIVE_CONFIG = Object.freeze({
    numBits: 8,
    projectionSeed: 0x9e3779b9,
    occupiedNoveltyMultiplier: 0.7,
});

/**
 * @param {number} dim
 * @param {number} numBits
 * @param {number} seed
 * @returns {Float32Array[]}
 */
export function buildProjection(dim, numBits, seed) {
    const rng = mulberry32(seed);
    return Array.from({ length: numBits }, () => {
        const plane = new Float32Array(dim);
        for (let i = 0; i < dim; i++) plane[i] = rng() * 2 - 1;
        return plane;
    });
}

/**
 * @param {Float32Array|number[]} vector
 * @param {Float32Array[]} planes
 */
export function hashDescriptor(vector, planes) {
    let key = '';
    for (const plane of planes) {
        let sum = 0;
        const length = Math.min(vector.length, plane.length);
        for (let i = 0; i < length; i++) sum += vector[i] * plane[i];
        key += sum >= 0 ? '1' : '0';
    }
    return key;
}

export class DescriptorArchive {
    /** @param {typeof DESCRIPTOR_ARCHIVE_CONFIG} [config] */
    constructor(config = DESCRIPTOR_ARCHIVE_CONFIG) {
        this.config = config;
        /** @type {Map<string, Record<string, any>>} */
        this.cells = new Map();
        /** @type {Float32Array[]|null} */
        this._planes = null;
        this._dim = 0;
    }

    /** @param {Float32Array|number[]|null|undefined} vector */
    cellKeyFor(vector) {
        if (!vector?.length) return null;
        if (!this._planes || this._dim !== vector.length) {
            this._dim = vector.length;
            this._planes = buildProjection(this._dim, this.config.numBits, this.config.projectionSeed);
        }
        return hashDescriptor(vector, this._planes);
    }

    /** @param {Record<string, any> & {vector?: Float32Array|number[]|null}} entry */
    tryInsert(entry) {
        const cellKey = this.cellKeyFor(entry?.vector);
        if (!cellKey) return { added: false, improved: false, skipped: true, cellKey: null };
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
     * @param {Float32Array|number[]|null|undefined} vector
     * @param {number} score
     * @param {string} [hex]
     */
    isOccupiedBetter(vector, score, hex) {
        const cellKey = this.cellKeyFor(vector);
        if (!cellKey) return false;
        const existing = this.cells.get(cellKey);
        if (!existing || existing.score < score) return false;
        return hex == null || existing.hex !== hex;
    }

    /**
     * @param {Float32Array|number[]|null|undefined} vector
     * @param {number} score
     * @param {string} [hex]
     */
    noveltyMultiplier(vector, score, hex) {
        return this.isOccupiedBetter(vector, score, hex) ? this.config.occupiedNoveltyMultiplier : 1;
    }

    get size() {
        return this.cells.size;
    }

    getEntries() {
        return [...this.cells.values()].sort((a, b) => b.score - a.score);
    }

    clear() {
        this.cells.clear();
    }

    /** @param {Record<string, any>[]} entries */
    loadEntries(entries) {
        this.cells.clear();
        if (!Array.isArray(entries)) return;
        for (const entry of entries) {
            if (!entry || typeof entry.hex !== 'string' || !Number.isFinite(entry.score)
                || typeof entry.cellKey !== 'string') continue;
            const existing = this.cells.get(entry.cellKey);
            if (!existing || entry.score > existing.score) this.cells.set(entry.cellKey, { ...entry });
        }
    }
}
