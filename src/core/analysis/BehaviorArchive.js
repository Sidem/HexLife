// @ts-check

import { hammingDistanceHex } from '../../utils/utils.js';

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
 * @property {{mean: number, variance?: number}} [blockEntropy] Mean normalized block entropy in
 *   [0,1] (the entropy bin); optional temporal variance (v2.8 Wuensche term, persisted for re-score
 *   stability but not part of the descriptor).
 * @property {{meanSpeed: number}} [transport] Centroid-drift speed (v2.9 transport term, persisted
 *   for re-score stability but not part of the descriptor).
 * @property {number|null} [sigma]       Damage-spreading σ (1≈critical; null if no probe ran).
 */

/**
 * A stored gallery entry. `metrics`/`perComponent` explain the score; `seed`+`icLabel`+`initialState`
 * let a find reproduce the exact interesting behavior (per roadmap design principle 1).
 * @typedef {object} ArchiveEntry
 * @property {string} hex                 32-char ruleset hex.
 * @property {string} [mnemonic]          Human-friendly ruleset name (rulesetName(hex)).
 * @property {number} score               Aggregated interestingness ([0,1]) — the confirmed score in v2.
 * @property {number} [screenScore]       The cheap screening score before confirmation (v2.4).
 * @property {number|null} [cyclic]       Detected cycle period if this is a (penalized) cycler (v2.4).
 * @property {string|null} [thumb]        Data-URL thumbnail of the find's final frame (v2.6).
 * @property {object} [perComponent]      Winning-IC component breakdown (criticality/entropyBand/…).
 * @property {number} [winningIC]         Index of the winning IC in the suite.
 * @property {string} [icLabel]           Label of the winning IC (e.g. 'chaos'|'sparse'|'seed').
 * @property {object} [initialState]      The winning IC's initial-state config (for apply-find reset).
 * @property {number} [seed]              The winning IC's reset seed (for apply-find reset).
 * @property {number} [generation]        Generation the entry was found in.
 * @property {BehaviorMetrics} [metrics]  Winning-IC behavior metrics (drives the descriptor).
 * @property {string} [cellKey]           The descriptor cell this entry occupies (filled by tryInsert).
 * @property {'stats'|'embedding'} [descriptorKind] Which descriptor keyed this entry (v3.2): 'embedding'
 *   when a perceptual SimHash cell override was supplied (the `cellKey` is then opaque and NOT
 *   recomputable — no raw vector is stored), 'stats' (or absent, for legacy entries) for the
 *   statistical `ratio|entropy|σ` descriptor.
 * @property {number} [targetSimilarity] Mean cosine similarity of the find's trajectory to the run's
 *   target prompt embedding (v3.2 supervised target search); present only for target-mode finds.
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
    /**
     * Family-dedupe radius (F5): two rulesets within this bit-Hamming distance are considered the
     * same family. On insert, a candidate within this distance of an existing entry must out-score
     * it to be kept (and then it *replaces* that sibling); otherwise it's rejected. Stops near-
     * identical hex siblings filling adjacent behavior cells.
     */
    familyMinHamming: 6,
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
     * Find the best-scoring existing entry within `familyMinHamming` bits of `hex` (its "family"),
     * or null. O(entries) scan — fine at ≤200 entries.
     * @param {string} hex
     * @returns {{key: string, entry: ArchiveEntry}|null}
     */
    _bestFamilyMember(hex) {
        const radius = this.config.familyMinHamming;
        if (!(radius > 0) || typeof hex !== 'string') return null;
        let best = null;
        for (const [key, entry] of this.cells) {
            if (hammingDistanceHex(hex, entry.hex) < radius && (!best || entry.score > best.entry.score)) {
                best = { key, entry };
            }
        }
        return best;
    }

    /**
     * Attempt to insert an entry. Keeps the best per cell, and (F5) at most one entry per *family*
     * of near-identical hex siblings.
     * @param {ArchiveEntry} entry - Must carry `score`, `hex`, and (winning-IC) `metrics`.
     * @param {{cellKeyOverride?: string|null}} [opts] - When `cellKeyOverride` is a non-empty string,
     *   the entry occupies THAT cell verbatim instead of the statistical `descriptorFor(metrics)` cell
     *   (v3.2 embedding-first descriptor: the perceptual SimHash cell, prefixed `e:` by the caller so it
     *   can never collide with a statistical `r|e|σ` key). Family-Hamming dedupe is unchanged.
     * @returns {{added: boolean, improved: boolean, cellKey: string, displaced: ArchiveEntry|null, rejectedBy?: string}}
     *   `added` true when a new cell was filled; `improved` true when an occupied cell's incumbent
     *   was beaten and replaced; both false when the entry was rejected (occupied/family, not better).
     *   `rejectedBy: 'family'` marks a family-dedupe rejection.
     */
    tryInsert(entry, { cellKeyOverride = null } = {}) {
        const cellKey = cellKeyOverride || descriptorFor(entry.metrics || {}, this.config).cellKey;
        const stored = { ...entry, cellKey };

        // Family dedupe runs BEFORE the cell logic: a near-identical sibling must out-score the best
        // existing family member to be kept; if it does, that sibling's cell is vacated first so the
        // family never occupies two cells at once.
        const family = this._bestFamilyMember(entry.hex);
        if (family) {
            if (entry.score <= family.entry.score) {
                return { added: false, improved: false, cellKey, displaced: null, rejectedBy: 'family' };
            }
            this.cells.delete(family.key);
        }

        const existing = this.cells.get(cellKey);
        if (!existing) {
            this.cells.set(cellKey, stored);
            return { added: true, improved: false, cellKey, displaced: family ? family.entry : null };
        }
        if (entry.score > existing.score) {
            this.cells.set(cellKey, stored);
            return { added: false, improved: true, cellKey, displaced: existing };
        }
        return { added: false, improved: false, cellKey, displaced: null };
    }

    /**
     * Whether the behavior cell for these metrics is already occupied by an equal-or-better entry.
     * Self-exemption (F3): if the incumbent IS this candidate (same `hex`), it does not count as
     * occupying the cell — a champion is never penalized against its own archived entry (else the
     * incumbent eats the novelty penalty its noisy re-score can't beat, causing champion churn).
     * @param {BehaviorMetrics} metrics
     * @param {number} score
     * @param {string} [hex] - The candidate's hex; an incumbent with this same hex is exempt.
     * @param {string|null} [cellKeyOverride] - Perceptual SimHash cell (v3.2); overrides the statistical
     *   descriptor cell so novelty pressure matches the embedding-first gallery descriptor.
     * @returns {boolean}
     */
    isOccupiedBetter(metrics, score, hex, cellKeyOverride = null) {
        const cellKey = cellKeyOverride || descriptorFor(metrics, this.config).cellKey;
        const existing = this.cells.get(cellKey);
        if (!existing || existing.score < score) return false;
        if (hex != null && existing.hex === hex) return false; // the incumbent is this candidate itself
        return true;
    }

    /**
     * Novelty multiplier for champion selection: 1 for a candidate that would fill or improve its
     * cell (or is the cell's own incumbent), {@link ARCHIVE_CONFIG.occupiedNoveltyMultiplier} for
     * one already covered by a *different* better incumbent. Multiply a candidate's raw score by
     * this to get its selection score.
     * @param {BehaviorMetrics} metrics
     * @param {number} score
     * @param {string} [hex] - The candidate's hex (for self-exemption, F3).
     * @param {string|null} [cellKeyOverride] - Perceptual SimHash cell (v3.2); see {@link isOccupiedBetter}.
     * @returns {number}
     */
    noveltyMultiplier(metrics, score, hex, cellKeyOverride = null) {
        return this.isOccupiedBetter(metrics, score, hex, cellKeyOverride) ? this.config.occupiedNoveltyMultiplier : 1;
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

    /**
     * Patch an existing entry (matched by hex) in place — used by the re-test action (v2.7) to
     * refresh a find's score/components/cyclic tag after a fresh confirmation burst. The behavior
     * cell is left unchanged (getEntries re-sorts by the new score).
     * @param {string} hex
     * @param {Partial<ArchiveEntry>} patch
     * @returns {boolean} true if an entry was found and patched.
     */
    updateEntry(hex, patch) {
        for (const entry of this.cells.values()) {
            if (entry.hex === hex) {
                Object.assign(entry, patch);
                return true;
            }
        }
        return false;
    }

    /** Drop every entry. */
    clear() {
        this.cells.clear();
    }

    /**
     * Replace the archive contents from a previously persisted entry list.
     *
     * Statistical entries re-derive their cell key from `metrics` via {@link tryInsert} (self-healing:
     * best per cell). Embedding-first entries (v3.2, `descriptorKind === 'embedding'`) carry an OPAQUE
     * SimHash `cellKey` that cannot be recomputed — the raw vector is not persisted — so their stored key
     * is preserved verbatim and placed directly (still best-per-cell). Legacy entries have no
     * `descriptorKind` ⇒ the statistical path, byte-identical to the pre-v3.2 behaviour.
     * @param {ArchiveEntry[]} entries
     */
    loadEntries(entries) {
        this.cells.clear();
        if (!Array.isArray(entries)) return;
        for (const e of entries) {
            if (!(e && typeof e.hex === 'string' && typeof e.score === 'number')) continue;
            if (e.descriptorKind === 'embedding' && typeof e.cellKey === 'string' && e.cellKey) {
                const existing = this.cells.get(e.cellKey);
                if (!existing || e.score > existing.score) this.cells.set(e.cellKey, { ...e });
            } else {
                this.tryInsert(e);
            }
        }
    }
}
