// @ts-check

/**
 * Swipe-to-judge vote bank (PLAY-LAYER-PLAN §S1).
 *
 * The game mechanic *is* the data collection: pairwise "which is more interesting?" votes bank
 * locally and later drive the opt-in weight refit (§S3, {@link module:core/analysis/WeightRefit}).
 * This module owns the append-only vote store plus two pure helpers used to run the judging deck:
 *  - {@link extractFeatures} — snapshot a find's per-component score breakdown into the refit features.
 *  - {@link nextPair}        — choose the next versus pair (maximum information per vote).
 *
 * The pure helpers take all inputs as arguments (no DOM / EventBus / globals) so they are unit-testable;
 * the {@link VoteBank} class wraps persistence, with the load/save functions injectable for tests.
 */

import * as PersistenceService from '../../services/PersistenceService.js';
import { WEIGHT_KEYS } from './ScoringPresets.js';

/** FIFO cap on the persisted bank so localStorage stays bounded (§S1: "e.g. 2,000 votes"). */
export const MAX_VOTES = 2000;

/**
 * Stable, order-independent key for an unordered {a, b} ruleset pair. Used to avoid ever re-showing
 * the same pairing (acceptance: "the deck never shows the same unordered pair twice in a session").
 * @param {string} aHex
 * @param {string} bHex
 * @returns {string}
 */
export function pairKey(aHex, bHex) {
    const a = String(aHex);
    const b = String(bHex);
    return a <= b ? `${a}~${b}` : `${b}~${a}`;
}

/**
 * Snapshot a candidate's per-component score breakdown into the numeric feature vector the refit
 * consumes: one value per {@link WEIGHT_KEYS} term, clamped to [0,1]. Missing/non-finite terms → 0.
 * Returns null when the candidate has no breakdown (a library entry with no metrics can still be
 * *shown*, but its vote carries no refit features).
 * @param {Record<string, any>|null|undefined} perComponent
 * @param {readonly string[]} [keys]
 * @returns {Record<string, number>|null}
 */
export function extractFeatures(perComponent, keys = WEIGHT_KEYS) {
    if (!perComponent || typeof perComponent !== 'object') return null;
    /** @type {Record<string, number>} */
    const out = {};
    for (const k of keys) {
        const v = Number(perComponent[k]);
        out[k] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
    }
    return out;
}

/**
 * A judging candidate. Only `hex` is required; the rest sharpen pair selection and enable the refit.
 * @typedef {object} VoteCandidate
 * @property {string} hex
 * @property {number} [score]              Current interestingness score (for the "similar scores" heuristic).
 * @property {string} [cellKey]            Behaviour-archive cell (for the "different cells" heuristic).
 * @property {Record<string, any>} [perComponent] Per-component breakdown (⇒ refit features).
 * @property {string} [thumb]              Data-URL preview (cards without one are skipped by the deck).
 */

/**
 * Choose the next versus pair to show (§S1: "prefer pairs with similar current scores but different
 * archive cells — maximum information per vote — avoid repeats"). Pure; deterministic given `rng`.
 *
 * Scoring: a pair earns a cross-cell bonus when the two finds occupy different behaviour cells, plus a
 * closeness reward that peaks when their current scores are equal (a decisive gap teaches the model
 * little). The best-scoring unseen pairs are pooled and one is drawn with `rng` for variety.
 *
 * @param {VoteCandidate[]} candidates      Pool to pair from (e.g. gallery finds with thumbnails).
 * @param {Set<string>|Iterable<string>} [votedPairs] pairKey()s already voted/shown — excluded.
 * @param {() => number} [rng]              [0,1) source (default Math.random); injected in tests.
 * @param {{crossCellBonus?: number, poolSize?: number, maxCandidates?: number}} [opts]
 * @returns {{a: VoteCandidate, b: VoteCandidate}|null} Null when fewer than two pairable, unseen finds remain.
 */
export function nextPair(candidates, votedPairs = new Set(), rng = Math.random, opts = {}) {
    const crossCellBonus = opts.crossCellBonus ?? 0.5;
    const poolSize = opts.poolSize ?? 4;
    const maxCandidates = opts.maxCandidates ?? 60;

    const seen = votedPairs instanceof Set ? votedPairs : new Set(votedPairs);
    // Candidates arrive best-first; cap the O(n²) enumeration by considering the strongest slice.
    const pool = (Array.isArray(candidates) ? candidates : [])
        .filter((c) => c && typeof c.hex === 'string' && c.hex)
        .slice(0, maxCandidates);
    if (pool.length < 2) return null;

    /** @type {Array<{a: VoteCandidate, b: VoteCandidate, weight: number}>} */
    const scored = [];
    for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
            const a = pool[i];
            const b = pool[j];
            if (a.hex === b.hex) continue;
            if (seen.has(pairKey(a.hex, b.hex))) continue;
            const scoreA = Number.isFinite(a.score) ? /** @type {number} */ (a.score) : 0;
            const scoreB = Number.isFinite(b.score) ? /** @type {number} */ (b.score) : 0;
            const closeness = 1 - Math.min(1, Math.abs(scoreA - scoreB));
            const crossCell = (a.cellKey && b.cellKey && a.cellKey !== b.cellKey) ? crossCellBonus : 0;
            scored.push({ a, b, weight: closeness + crossCell });
        }
    }
    if (scored.length === 0) return null;

    scored.sort((p, q) => q.weight - p.weight);
    const pick = scored[Math.floor(rng() * Math.min(poolSize, scored.length))] || scored[0];
    return { a: pick.a, b: pick.b };
}

/**
 * A single banked vote (§S1 record shape). `aMetrics`/`bMetrics` are the per-component feature
 * snapshots (see {@link extractFeatures}) — the refit reads them, not the raw metrics.
 * @typedef {object} VoteRecord
 * @property {number} ts
 * @property {string} aHex
 * @property {string} bHex
 * @property {'a'|'b'|'skip'} winner
 * @property {Record<string, number>|null} aMetrics
 * @property {Record<string, number>|null} bMetrics
 * @property {number|null} aScore
 * @property {number|null} bScore
 * @property {string} source
 */

/**
 * Coerce a persisted blob into a clean vote array (drops non-objects / bad winners).
 * @param {any} raw
 * @returns {VoteRecord[]}
 */
function sanitizeVotes(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter((v) => v && typeof v === 'object'
        && typeof v.aHex === 'string' && typeof v.bHex === 'string'
        && (v.winner === 'a' || v.winner === 'b' || v.winner === 'skip'));
}

/**
 * Append-only, FIFO-bounded store of pairwise interestingness votes, persisted via PersistenceService.
 * The load/save functions are injectable so unit tests can back it with an in-memory array instead of
 * localStorage (the test environment is `node`, no DOM).
 */
export class VoteBank {
    /**
     * @param {{load?: () => any[], save?: (v: VoteRecord[]) => void, max?: number}} [opts]
     */
    constructor({ load, save, max } = {}) {
        this._load = load || PersistenceService.loadInterestingnessVotes;
        this._save = save || PersistenceService.saveInterestingnessVotes;
        this.max = Number.isFinite(max) ? /** @type {number} */ (max) : MAX_VOTES;
        /** @type {VoteRecord[]} */
        this.votes = sanitizeVotes(this._load());
    }

    /** @returns {VoteRecord[]} A defensive copy of the banked votes (oldest → newest). */
    getVotes() {
        return this.votes.slice();
    }

    /** @returns {number} Total banked votes (includes skips — they are recorded but not refit-used). */
    getCount() {
        return this.votes.length;
    }

    /** @returns {number} Non-skip votes that carry features on both sides (what the refit can use). */
    getDecisiveCount() {
        return this.votes.filter((v) => v.winner !== 'skip' && v.aMetrics && v.bMetrics).length;
    }

    /** @returns {Set<string>} pairKey()s of every banked pairing — used to avoid repeats. */
    votedPairKeys() {
        const set = new Set();
        for (const v of this.votes) set.add(pairKey(v.aHex, v.bHex));
        return set;
    }

    /**
     * Record a vote and persist. Enforces the FIFO cap (oldest dropped first).
     * @param {{aHex: string, bHex: string, winner: 'a'|'b'|'skip', aMetrics?: Record<string, number>|null,
     *   bMetrics?: Record<string, number>|null, aScore?: number|null, bScore?: number|null, source?: string}} vote
     * @param {number} [ts] Timestamp (injected in tests; defaults to now).
     * @returns {VoteRecord}
     */
    record(vote, ts = Date.now()) {
        /** @type {VoteRecord} */
        const rec = {
            ts,
            aHex: vote.aHex,
            bHex: vote.bHex,
            winner: vote.winner,
            aMetrics: vote.aMetrics || null,
            bMetrics: vote.bMetrics || null,
            aScore: Number.isFinite(vote.aScore) ? /** @type {number} */ (vote.aScore) : null,
            bScore: Number.isFinite(vote.bScore) ? /** @type {number} */ (vote.bScore) : null,
            source: vote.source || 'unknown',
        };
        this.votes.push(rec);
        if (this.votes.length > this.max) {
            this.votes.splice(0, this.votes.length - this.max);
        }
        this._save(this.votes);
        return rec;
    }

    /** Wipe the bank (and persist the empty state). */
    clear() {
        this.votes = [];
        this._save(this.votes);
    }
}
