// @ts-check

import {
    CORPUS_HARD_PAIRS,
    CORPUS_PROTOCOL,
    HARD_PAIR_SCENARIOS,
    hardPairsForScenarios,
} from './corpusProtocol.js';

/**
 * Owner hard-pair vote accumulator for Corpus v1 (#37 Stage 4B.2 step 6).
 *
 * The coverage tallies in {@link module:core/analysis/CorpusCollectionBuffer} answer "does the corpus
 * contain enough of everything?". They cannot answer "can a model told to rank these actually tell
 * them apart?", because that question is only settled by direct preference between two worlds that a
 * count would treat as equally well covered. This bank owns that second question.
 *
 * Three properties make the votes usable as an acceptance signal rather than as noise:
 *
 * - **Density matching.** A pair is only offered when the two worlds started within
 *   `maximumInitialDensityDelta` of each other. Without it, the owner would reliably be choosing the
 *   busier-looking world, and the stratum would measure coverage rather than behaviour.
 * - **Deficit-first scheduling.** {@link nextPair} always serves the stratum furthest from its
 *   `minimumOwnerVotes`, so 48 hand-cast votes spread across all four strata instead of piling onto
 *   whichever one happens to have the most candidates.
 * - **No repeated pairings.** An unordered candidate pair is offered once. Re-asking the same
 *   comparison would inflate a stratum's count without adding information.
 *
 * Deliberately pure and DOM-free: candidates arrive as plain records, and the output is
 * `comparisons.jsonl` rows. The overlay owns presentation; the capture service owns the ZIP.
 *
 * **This is the one acceptance gate `auditStatus()` cannot see.** Votes live in `comparisons.jsonl`,
 * not in the clip buffer, so the coverage readout is complete only for coverage — {@link voteStatus}
 * exists so the collection UI can show the hard-pair debt alongside it, including *why* a stratum is
 * currently unpayable.
 */

/** @param {string} a @param {string} b @returns {string} Order-independent key for one pairing. */
export function candidatePairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * @typedef {object} VoteCandidate
 * @property {string} id            Stable id (the judged world's collection id).
 * @property {string} scenario      Corpus scenario, as judged.
 * @property {string} ruleset       Ruleset hex.
 * @property {string} family        Family id.
 * @property {string} label         The interesting/boring label the same judgment produced.
 * @property {number|null} initialDensity  Whole-grid starting coverage, or null when unknown.
 * @property {string} gridPreset
 * @property {string} initialConditionId
 * @property {number|null} seed
 * @property {string[]} clipIds     The clips this candidate's judgment produced.
 * @property {string} [thumb]       Data URL preview, for the versus card.
 */

export class CorpusVoteBank {
    /** @param {{sessionId: string}} meta */
    constructor(meta) {
        if (!meta?.sessionId) throw new Error('CorpusVoteBank requires a sessionId.');
        this.sessionId = String(meta.sessionId);
        /** @type {VoteCandidate[]} */
        this.candidates = [];
        /** @type {Array<Record<string, any>>} */
        this.votes = [];
        /** Unordered candidate-pair keys already offered, whether voted or skipped. */
        this._offered = new Set();
        /** Per-stratum vote tallies, keyed by hard-pair id. */
        /** @type {Record<string, number>} */
        this.tallies = Object.fromEntries(CORPUS_HARD_PAIRS.map((pair) => [pair.id, 0]));
    }

    /**
     * Register a judged world as votable.
     *
     * Only scenarios some stratum actually names are kept: the bank exists to pay down hard pairs, and
     * holding a `saturation` candidate that can never be offered would make the readout claim depth it
     * does not have.
     *
     * @param {VoteCandidate} candidate
     * @returns {boolean} Whether it was taken.
     */
    addCandidate(candidate) {
        if (!candidate?.id || !HARD_PAIR_SCENARIOS.includes(String(candidate.scenario))) return false;
        if (this.candidates.some((existing) => existing.id === candidate.id)) return false;
        this.candidates.push({
            ...candidate,
            id: String(candidate.id),
            scenario: String(candidate.scenario),
            initialDensity: Number.isFinite(candidate.initialDensity) ? Number(candidate.initialDensity) : null,
        });
        return true;
    }

    /**
     * Drop a candidate whose judgment was undone.
     *
     * Any vote already cast on it is withdrawn too, tallies included. A comparison row naming clips
     * that never reach the ZIP would be unresolvable for the auditor, so a retracted judgment has to
     * retract the preferences that depended on it — even though the owner really did express them.
     * The pairings stay marked as offered, so an undo-and-rejudge cannot re-serve the same comparison.
     *
     * @param {string} id
     * @returns {boolean} Whether a candidate was removed.
     */
    removeCandidate(id) {
        const target = String(id);
        const index = this.candidates.findIndex((candidate) => candidate.id === target);
        if (index < 0) return false;
        this.candidates.splice(index, 1);
        this.votes = this.votes.filter((vote) => {
            if (vote.a?.id !== target && vote.b?.id !== target) return true;
            for (const stratumId of vote.hardPairs || [vote.hardPair]) {
                if (stratumId in this.tallies) this.tallies[stratumId] = Math.max(0, this.tallies[stratumId] - 1);
            }
            return false;
        });
        return true;
    }

    get voteCount() {
        return this.votes.length;
    }

    /**
     * Per-stratum progress toward `minimumOwnerVotes`, plus the reason a stratum cannot currently be
     * served. `blockedBy` lists the stratum's scenarios that have no candidate yet — the roadmap's
     * observation that three of the eight scenarios are empty in a fresh session shows up here as
     * concrete missing names rather than as a stalled counter.
     */
    voteStatus() {
        const strata = CORPUS_HARD_PAIRS.map((pair) => {
            const have = this.tallies[pair.id] || 0;
            const blockedBy = [...new Set([...pair.sideA, ...pair.sideB])]
                .filter((scenario) => !this.candidates.some((c) => c.scenario === scenario));
            return {
                id: pair.id,
                have,
                need: pair.minimumOwnerVotes,
                strictRegression: pair.strictRegression,
                satisfied: have >= pair.minimumOwnerVotes,
                blockedBy,
                exhausted: !blockedBy.length && have < pair.minimumOwnerVotes && !this._hasUnofferedPair(pair),
            };
        });
        return {
            strata,
            totalVotes: this.votes.length,
            totalNeeded: CORPUS_HARD_PAIRS.reduce((sum, pair) => sum + pair.minimumOwnerVotes, 0),
            passing: strata.every((stratum) => stratum.satisfied),
            deficits: strata.filter((s) => !s.satisfied).map((s) => {
                const missing = s.blockedBy.length ? ` — no clips yet for ${s.blockedBy.join(', ')}` : '';
                const dry = s.exhausted ? ' — every matched pairing already offered; collect more clips' : '';
                return `${s.id}: ${s.have}/${s.need} owner votes${missing}${dry}`;
            }),
        };
    }

    /** @param {typeof CORPUS_HARD_PAIRS[number]} pair */
    _hasUnofferedPair(pair) {
        return this._pairingsFor(pair).length > 0;
    }

    /**
     * Every still-unoffered, density-matched ordered pairing this stratum admits.
     * @param {typeof CORPUS_HARD_PAIRS[number]} pair
     * @returns {Array<{a: VoteCandidate, b: VoteCandidate, delta: number}>}
     */
    _pairingsFor(pair) {
        const sideA = this.candidates.filter((c) => pair.sideA.includes(c.scenario));
        const sideB = this.candidates.filter((c) => pair.sideB.includes(c.scenario));
        const out = [];
        for (const a of sideA) {
            for (const b of sideB) {
                if (a.id === b.id) continue;
                if (this._offered.has(candidatePairKey(a.id, b.id))) continue;
                // An unknown starting density cannot be shown to be matched, so it is not offered:
                // the stratum's whole point is that the two sides differ in behaviour and nothing else.
                if (a.initialDensity == null || b.initialDensity == null) continue;
                const delta = Math.abs(a.initialDensity - b.initialDensity);
                if (delta > pair.maximumInitialDensityDelta) continue;
                out.push({ a, b, delta });
            }
        }
        return out;
    }

    /**
     * The next comparison to put in front of the owner, or null when nothing is servable.
     *
     * Strata are tried furthest-from-quota first, and within a stratum the tightest density match
     * wins — a pair that differs by 0.005 is a cleaner behavioural comparison than one at the 0.05
     * limit, and spending the scarce well-matched pairings first means a long session degrades
     * gracefully instead of hitting a wall of unmatchable candidates.
     *
     * @returns {{hardPair: typeof CORPUS_HARD_PAIRS[number], a: VoteCandidate, b: VoteCandidate, delta: number}|null}
     */
    nextPair() {
        const ranked = CORPUS_HARD_PAIRS
            .map((pair) => ({ pair, deficit: pair.minimumOwnerVotes - (this.tallies[pair.id] || 0) }))
            .filter((entry) => entry.deficit > 0)
            .sort((x, y) => y.deficit - x.deficit
                || Number(y.pair.strictRegression) - Number(x.pair.strictRegression));

        for (const { pair } of ranked) {
            const pairings = this._pairingsFor(pair);
            if (!pairings.length) continue;
            pairings.sort((x, y) => x.delta - y.delta);
            return { hardPair: pair, ...pairings[0] };
        }
        return null;
    }

    /**
     * Record one owner judgment. `winner` is 'a', 'b', or 'skip'.
     *
     * A skip still marks the pairing offered, so it is not served again, but banks no row and moves no
     * counter — the owner declining to choose is information about the pairing, not about the worlds.
     *
     * The vote is credited to *every* stratum the two scenarios satisfy, which is why a
     * glider-vs-churn choice pays down two of the four strata at once.
     *
     * @param {{a: VoteCandidate, b: VoteCandidate, winner: 'a'|'b'|'skip', notes?: string}} vote
     * @returns {string[]} Ids of the strata credited (empty for a skip).
     */
    record({ a, b, winner, notes }) {
        if (!a?.id || !b?.id) throw new Error('A hard-pair vote needs two candidates.');
        this._offered.add(candidatePairKey(a.id, b.id));
        if (winner === 'skip') return [];
        if (winner !== 'a' && winner !== 'b') throw new Error(`Unknown vote winner "${winner}".`);

        const strata = hardPairsForScenarios(a.scenario, b.scenario);
        if (!strata.length) throw new Error(`${a.scenario} vs ${b.scenario} is not a hard-pair stratum.`);
        for (const stratum of strata) this.tallies[stratum.id] = (this.tallies[stratum.id] || 0) + 1;

        this.votes.push({
            schema: 'HXLCORPUS-COMPARISON-1',
            corpusProtocol: CORPUS_PROTOCOL,
            source: 'owner-vote',
            sessionId: this.sessionId,
            // Every stratum this comparison pays down. `hardPair` is the primary id the auditor keys
            // on; `hardPairs` keeps the multi-credit explicit rather than implied by the scenarios.
            hardPair: strata[0].id,
            hardPairs: strata.map((stratum) => stratum.id),
            winner,
            initialDensityDelta: Math.abs((a.initialDensity ?? 0) - (b.initialDensity ?? 0)),
            a: this._side(a),
            b: this._side(b),
            notes: String(notes || '').slice(0, 500),
        });
        return strata.map((stratum) => stratum.id);
    }

    /** @param {VoteCandidate} candidate */
    _side(candidate) {
        return {
            id: candidate.id,
            ruleset: candidate.ruleset,
            family: candidate.family,
            scenario: candidate.scenario,
            label: candidate.label,
            gridPreset: candidate.gridPreset,
            initialConditionId: candidate.initialConditionId,
            initialDensity: candidate.initialDensity,
            seed: candidate.seed,
            clipIds: candidate.clipIds,
        };
    }

    /**
     * The banked votes as `comparisons.jsonl` text — one JSON object per line, no trailing blank.
     * Empty string when nothing has been voted, so the caller can skip writing the file entirely.
     */
    comparisonsJsonl() {
        if (!this.votes.length) return '';
        return `${this.votes.map((vote) => JSON.stringify(vote)).join('\n')}\n`;
    }

    /** Serializable state for the reload a grid-preset switch requires. Thumbnails are dropped. */
    snapshot() {
        return {
            candidates: this.candidates.map(({ thumb: _thumb, ...rest }) => rest),
            votes: this.votes,
            offered: [...this._offered],
            tallies: { ...this.tallies },
        };
    }

    /** @param {ReturnType<CorpusVoteBank['snapshot']>|null|undefined} snapshot */
    restore(snapshot) {
        if (!snapshot) return;
        for (const candidate of snapshot.candidates || []) this.addCandidate(candidate);
        this.votes = Array.isArray(snapshot.votes) ? [...snapshot.votes] : [];
        this._offered = new Set(snapshot.offered || []);
        for (const [id, count] of Object.entries(snapshot.tallies || {})) {
            if (id in this.tallies) this.tallies[id] = Math.max(0, Math.trunc(Number(count) || 0));
        }
    }
}
