// @ts-check

/**
 * Phase 4 of the auto-explore roadmap: a MAP-Elites-lite behavior archive that doubles as the
 * session gallery. Candidates are placed into a coarse grid of behavior *cells* keyed by a
 * quantized descriptor of the (winning-IC) behavior — `(finalRatio, blockEntropy, σ)`. Each cell
 * keeps only its single best-scoring ruleset, so the archive stays diverse: a new candidate that
 * lands in an empty cell is always kept, one that lands in an occupied cell only replaces the
 * incumbent if it scores higher.
 *
 * The archive also supplies the **novelty pressure** the explore loop uses when choosing the next
 * champion: a candidate whose behavior cell is already occupied gets a multiplicative penalty
 * (`noveltyMultiplier`), nudging the search away from re-finding the same family and toward
 * unexplored behavior. This is what prevents the population from collapsing onto one attractor.
 *
 * This module is PURE: no worlds, proxies, EventBus, persistence, or globals. All quantization
 * thresholds and the novelty penalty live in the exported {@link ARCHIVE_CONFIG} so tuning is
 * config churn, not code churn. Persistence (localStorage) is the caller's concern; `getEntries`
 * / `loadEntries` round-trip plain JSON.
 */

/**
 * The behavior-descriptor subset the archive reads from a candidate's WINNING-IC metrics.
 * @typedef {object} BehaviorMetrics
 * @property {number} [finalRatio]       Final active-cell ratio in [0,1].
 * @property {{mean: number}} [blockEntropy] Mean normalized block entropy in [0,1].
 * @property {number|null} [sigma]       Damage-spreading σ (1≈critical; null if no probe ran).
 */

/**
 * A stored gallery entry. `metrics`/`perComponent` explain the score; `seed`+`icLabel`+`initialState`
 * let a find reproduce the exact interesting behavior (per roadmap design principle 1).
 * @typedef {object} ArchiveEntry
 * @property {string} hex                 32-char ruleset hex.
 * @property {string} [mnemonic]          Human-friendly ruleset name (rulesetName(hex)).
 * @property {number} score               Aggregated interestingness ([0,1]).
 * @property {object} [perComponent]      Winning-IC component breakdown (criticality/entropyBand/…).
 * @property {number} [winningIC]         Index of the winning IC in the suite.
 * @property {string} [icLabel]           Label of the winning IC (e.g. 'chaos'|'sparse'|'seed').
 * @property {object} [initialState]      The winning IC's initial-state config (for apply-find reset).
 * @property {number} [seed]              The winning IC's reset seed (for apply-find reset).
 * @property {number} [generation]        Generation the entry was found in.
 * @property {BehaviorMetrics} [metrics]  Winning-IC behavior metrics (drives the descriptor).
 * @property {string} [cellKey]           The descriptor cell this entry occupies (filled by tryInsert).
 */

/**
 * All tunable thresholds. Nothing else in this module hard-codes a magic number.
 */
export const ARCHIVE_CONFIG = {
    /** finalRatio bin width — 0.1 → 10 ratio bins across [0,1]. */
    ratioBinWidth: 0.1,
    /** blockEntropy bin width — 0.1 → 10 entropy bins across [0,1]. */
    entropyBinWidth: 0.1,
    /**
     * σ band edges (exclusive upper bounds). σ is bucketed on a log-ish scale around the
     * critical point 1: dead(0) and null get their own bands so they never collide with a
     * live near-critical find. Bands: '0' (σ=0, healed), then the numbered edges, then 'hi'
     * (≥ last edge or ∞), and 'n' (no probe / null σ).
     */
    sigmaBands: [0.5, 0.8, 1.25, 2.0],
    /**
     * Multiplier applied to a candidate's score when its behavior cell is ALREADY occupied
     * by an equal-or-better incumbent, for champion-selection purposes only (the stored score
     * is never penalized). < 1 penalizes re-finding; 1 would disable novelty pressure.
     */
    occupiedNoveltyMultiplier: 0.6,
};

/**
 * Quantize a finalRatio/blockEntropy value into an integer bin index.
 * @param {number} value
 * @param {number} binWidth
 * @returns {number}
 */
function binIndex(value, binWidth) {
    const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    // Float division of decimal multiples is treacherous (0.3 / 0.1 === 2.9999…), so nudge by a
    // tiny epsilon before flooring to keep values on their intended bin boundary.
    const idx = Math.floor(v / binWidth + 1e-9);
    // A value of exactly 1 would land one past the last bin; clamp it back in.
    const maxIdx = Math.max(0, Math.ceil(1 / binWidth) - 1);
    return Math.min(maxIdx, idx);
}

/**
 * Quantize σ into a discrete band label. null/absent → 'n'; 0 → '0'; Infinity → 'hi'.
 * @param {number|null|undefined} sigma
 * @param {number[]} edges
 * @returns {string}
 */
function sigmaBand(sigma, edges) {
    if (sigma == null) return 'n';
    if (!Number.isFinite(sigma)) return 'hi';
    if (sigma <= 0) return '0';
    for (let i = 0; i < edges.length; i++) {
        if (sigma < edges[i]) return `b${i}`;
    }
    return 'hi';
}

/**
 * Compute the quantized behavior descriptor (and its cell key) for a set of metrics.
 * @param {BehaviorMetrics} metrics
 * @param {typeof ARCHIVE_CONFIG} [config]
 * @returns {{ratioBin: number, entropyBin: number, sigmaBand: string, cellKey: string}}
 */
export function descriptorFor(metrics, config = ARCHIVE_CONFIG) {
    const cfg = config;
    const ratioBin = binIndex(metrics?.finalRatio ?? 0, cfg.ratioBinWidth);
    const entropyBin = binIndex(metrics?.blockEntropy?.mean ?? 0, cfg.entropyBinWidth);
    const band = sigmaBand(metrics?.sigma, cfg.sigmaBands);
    return { ratioBin, entropyBin, sigmaBand: band, cellKey: `${ratioBin}|${entropyBin}|${band}` };
}

/**
 * MAP-Elites-lite archive: one best entry per behavior cell, plus novelty queries.
 */
export class BehaviorArchive {
    /**
     * @param {typeof ARCHIVE_CONFIG} [config]
     */
    constructor(config = ARCHIVE_CONFIG) {
        this.config = config;
        /** @type {Map<string, ArchiveEntry>} */
        this.cells = new Map();
    }

    /**
     * Attempt to insert an entry. Keeps the best per cell.
     * @param {ArchiveEntry} entry - Must carry `score` and (winning-IC) `metrics`.
     * @returns {{added: boolean, improved: boolean, cellKey: string, displaced: ArchiveEntry|null}}
     *   `added` true when a new cell was filled; `improved` true when an occupied cell's incumbent
     *   was beaten and replaced; both false when the entry was rejected (occupied, not better).
     */
    tryInsert(entry) {
        const { cellKey } = descriptorFor(entry.metrics || {}, this.config);
        const stored = { ...entry, cellKey };
        const existing = this.cells.get(cellKey);
        if (!existing) {
            this.cells.set(cellKey, stored);
            return { added: true, improved: false, cellKey, displaced: null };
        }
        if (entry.score > existing.score) {
            this.cells.set(cellKey, stored);
            return { added: false, improved: true, cellKey, displaced: existing };
        }
        return { added: false, improved: false, cellKey, displaced: null };
    }

    /**
     * Whether the behavior cell for these metrics is already occupied by an equal-or-better entry.
     * @param {BehaviorMetrics} metrics
     * @param {number} score
     * @returns {boolean}
     */
    isOccupiedBetter(metrics, score) {
        const { cellKey } = descriptorFor(metrics, this.config);
        const existing = this.cells.get(cellKey);
        return !!existing && existing.score >= score;
    }

    /**
     * Novelty multiplier for champion selection: 1 for a candidate that would fill or improve its
     * cell, {@link ARCHIVE_CONFIG.occupiedNoveltyMultiplier} for one already covered by a better
     * incumbent. Multiply a candidate's raw score by this to get its selection score.
     * @param {BehaviorMetrics} metrics
     * @param {number} score
     * @returns {number}
     */
    noveltyMultiplier(metrics, score) {
        return this.isOccupiedBetter(metrics, score) ? this.config.occupiedNoveltyMultiplier : 1;
    }

    /** @returns {number} Number of occupied behavior cells. */
    get size() {
        return this.cells.size;
    }

    /**
     * All stored entries, best score first.
     * @returns {ArchiveEntry[]}
     */
    getEntries() {
        return [...this.cells.values()].sort((a, b) => b.score - a.score);
    }

    /** Drop every entry. */
    clear() {
        this.cells.clear();
    }

    /**
     * Replace the archive contents from a previously persisted entry list (re-derives cell keys,
     * keeping the best per cell so a stale/duplicated dump self-heals).
     * @param {ArchiveEntry[]} entries
     */
    loadEntries(entries) {
        this.cells.clear();
        if (!Array.isArray(entries)) return;
        for (const e of entries) {
            if (e && typeof e.hex === 'string' && typeof e.score === 'number') this.tryInsert(e);
        }
    }
}
