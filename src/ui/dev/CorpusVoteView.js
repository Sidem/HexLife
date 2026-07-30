/**
 * Owner hard-pair vote surface for Corpus Lab (#37 Stage 4B.2 step 6).
 *
 * Structurally the head-to-head deck from `ExploreRaterView`, retargeted from gallery finds to
 * already-judged corpus candidates. The interaction is deliberately identical — two cards, ← / → to
 * pick, ↓ to skip — because the owner casting 48 of these should not have to learn a second gesture.
 *
 * What differs is what a vote *means*. The Explore rater banks a preference to refit scoring weights,
 * and any two finds may be compared. Here the pairing is constrained by the protocol: the two sides
 * must come from a stratum's `sideA`/`sideB`, and must have started within the stratum's density
 * tolerance of each other. {@link module:core/analysis/CorpusVoteBank} owns those rules; this view
 * only renders whatever pair it is handed and reports the choice back.
 *
 * The cards show the stratum, both scenarios, and the density delta, because the owner needs to be
 * able to reject a badly-matched pairing rather than dutifully voting on it.
 */
export class CorpusVoteView {
    /**
     * @param {HTMLElement} mount
     * @param {{bank: import('../../core/analysis/CorpusVoteBank.js').CorpusVoteBank,
     *   onVote: () => void, onExit: () => void}} opts
     */
    constructor(mount, { bank, onVote, onExit }) {
        this.mount = mount;
        this.bank = bank;
        this.onVote = onVote;
        this.onExit = onExit;
        /** @type {ReturnType<import('../../core/analysis/CorpusVoteBank.js').CorpusVoteBank['nextPair']>} */
        this.current = null;
        this._onClick = (event) => this._handleClick(event);
        this.mount.addEventListener('click', this._onClick);
        this.next();
    }

    destroy() {
        this.mount.removeEventListener('click', this._onClick);
        this.mount.innerHTML = '';
    }

    next() {
        this.current = this.bank.nextPair();
        this.render();
    }

    render() {
        const status = this.bank.voteStatus();
        this.mount.innerHTML = `
            <div class="corpus-vote-head">
                <span class="corpus-vote-title">Which is more interesting?</span>
                <span class="corpus-vote-count">${status.totalVotes}/${status.totalNeeded} owner votes</span>
            </div>
            <div class="corpus-vote-strata">
                ${status.strata.map((stratum) => `
                    <span class="corpus-tally${stratum.satisfied ? ' ok' : ' empty'}"
                          title="${this._escape(stratum.blockedBy.length
                              ? `blocked — no clips yet for ${stratum.blockedBy.join(', ')}`
                              : stratum.exhausted ? 'every matched pairing already offered' : '')}">
                        ${stratum.strictRegression ? '★ ' : ''}${this._escape(stratum.id)}
                        <b>${stratum.have}</b>/${stratum.need}
                    </span>
                `).join('')}
            </div>
            <div class="corpus-vote-body">${this._renderBody()}</div>
            <div class="corpus-vote-foot">
                <button class="button" data-vote="skip">Skip <kbd>&darr;</kbd></button>
                <button class="button" data-vote="exit">Back to judging <kbd>V</kbd></button>
                <span class="corpus-vote-hint">Click a card, or &larr; / &rarr; to pick</span>
            </div>
        `;
    }

    _renderBody() {
        if (!this.current) {
            const status = this.bank.voteStatus();
            const why = status.passing
                ? 'Every stratum has its 12 owner votes. Finish &amp; download to write comparisons.jsonl.'
                : `Nothing servable right now.<ul>${status.deficits
                    .map((line) => `<li>${this._escape(line)}</li>`).join('')}</ul>`;
            return `<div class="corpus-vote-empty"><p>${why}</p></div>`;
        }
        const { hardPair, a, b, delta } = this.current;
        return `
            <div class="corpus-vote-stratum">
                ${this._escape(hardPair.id)}
                <span class="corpus-vote-delta">&Delta;density ${delta.toFixed(3)}
                    (limit ${hardPair.maximumInitialDensityDelta})</span>
            </div>
            <div class="corpus-vote-cards">
                ${this._renderCard(a, 'a')}
                <div class="corpus-vote-vs">vs</div>
                ${this._renderCard(b, 'b')}
            </div>
        `;
    }

    /** @param {import('../../core/analysis/CorpusVoteBank.js').VoteCandidate} candidate @param {'a'|'b'} side */
    _renderCard(candidate, side) {
        const density = candidate.initialDensity == null ? '—' : candidate.initialDensity.toFixed(3);
        return `
            <button class="corpus-vote-card" data-vote="${side}" title="Pick this one (${side === 'a' ? '←' : '→'})">
                ${candidate.thumb
                    ? `<img class="corpus-vote-thumb" src="${this._escape(candidate.thumb)}" alt="" />`
                    : '<div class="corpus-vote-thumb is-missing"></div>'}
                <span class="corpus-vote-card-scenario">${this._escape(candidate.scenario.replaceAll('_', ' '))}</span>
                <span class="corpus-vote-card-meta">
                    ${this._escape(candidate.family)} · density ${density} · judged ${this._escape(candidate.label)}
                </span>
            </button>
        `;
    }

    /** @param {MouseEvent} event */
    _handleClick(event) {
        const button = /** @type {HTMLElement} */ (event.target).closest('[data-vote]');
        if (!button) return;
        this.vote(/** @type {string} */ (button.dataset.vote));
    }

    /** @param {string} winner 'a', 'b', 'skip', or 'exit'. */
    vote(winner) {
        if (winner === 'exit') { this.onExit?.(); return; }
        if (!this.current) return;
        const { a, b } = this.current;
        this.bank.record({ a, b, winner: /** @type {'a'|'b'|'skip'} */ (winner) });
        this.onVote?.();
        this.next();
    }

    /** @param {KeyboardEvent} event @returns {boolean} Whether the key was consumed. */
    handleKey(event) {
        if (event.key === 'ArrowLeft') { this.vote('a'); return true; }
        if (event.key === 'ArrowRight') { this.vote('b'); return true; }
        if (event.key === 'ArrowDown' || event.key === ' ') { this.vote('skip'); return true; }
        return false;
    }

    _escape(value) {
        return String(value ?? '').replace(/[&<>"']/g, (character) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[character]));
    }
}
