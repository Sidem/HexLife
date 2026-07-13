import { EventBus, EVENTS } from '../../services/EventBus.js';
import { ICONS } from '../icons.js';
import { extractFeatures, nextPair, pairKey } from '../../core/analysis/VoteBank.js';

/**
 * Desktop swipe-to-judge rater (PLAY-LAYER-PLAN §S2, desktop surface).
 *
 * A "Rate finds" mode inside the Explore gallery: two finds are shown as a versus card and the user
 * picks the more interesting one (click a card, or keyboard ←/→) or skips (↓ / space). Each choice
 * banks a pairwise vote into the shared {@link VoteBank}; the accumulated votes drive the opt-in
 * weight refit in the Scoring panel (§S3). One decision per screen, ~15-second sessions.
 *
 * Candidate pool = gallery finds that have both a thumbnail AND a per-component score breakdown (so a
 * vote carries usable refit features). Cards are paired for maximum information (similar scores,
 * different behaviour cells) and no unordered pair is ever shown twice — across sessions, since the
 * bank persists.
 */
export class ExploreRaterView {
    /**
     * @param {HTMLElement} mount
     * @param {{voteBank: import('../../core/analysis/VoteBank.js').VoteBank,
     *   getCandidates: () => Array<object>, onExit: () => void}} opts
     */
    constructor(mount, { voteBank, getCandidates, onExit }) {
        this.mount = mount;
        this.voteBank = voteBank;
        this.getCandidates = getCandidates;
        this.onExit = onExit;
        /** @type {{a: object, b: object}|null} */
        this.current = null;
        /** pairKey()s shown this session (belt-and-braces on top of the persisted bank). */
        this._sessionSeen = new Set();
        this._boundKey = (e) => this._onKey(e);
        this._render();
        this.mount.addEventListener('keydown', this._boundKey);
        this._next();
    }

    destroy() {
        this.mount.removeEventListener('keydown', this._boundKey);
        this.mount.innerHTML = '';
    }

    /** Gallery finds usable as versus cards: a preview to show + a breakdown to bank as features. */
    _candidatePool() {
        return (this.getCandidates() || []).filter((c) => c && c.hex && c.thumb && c.perComponent);
    }

    _render() {
        this.mount.tabIndex = 0;
        this.mount.innerHTML = `
            <div class="explore-rater-head">
                <span class="explore-rater-title">${ICONS.scale} Which is more interesting?</span>
                <span class="explore-rater-count" data-field="count"></span>
                <button class="button explore-rater-exit" data-action="exit">Done</button>
            </div>
            <div class="explore-rater-body" data-field="body"></div>
            <div class="explore-rater-foot">
                <button class="button explore-rater-skip" data-action="skip" title="Skip this pair (↓ or Space)">Skip</button>
                <span class="explore-rater-hint">Click a card, or use ← / → to pick · ↓ to skip</span>
            </div>
        `;
        this.bodyEl = this.mount.querySelector('[data-field="body"]');
        this.mount.addEventListener('click', (e) => this._onClick(e));
        this._updateCounter();
    }

    _updateCounter() {
        const el = this.mount.querySelector('[data-field="count"]');
        if (el) el.textContent = `${this.voteBank.getCount()} votes banked`;
    }

    _next() {
        const seen = new Set([...this.voteBank.votedPairKeys(), ...this._sessionSeen]);
        const pool = this._candidatePool();
        const pair = nextPair(pool, seen);
        this.current = pair;
        if (pair) this._sessionSeen.add(pairKey(pair.a.hex, pair.b.hex));
        this._renderCards(pool.length);
        // Keep keyboard control after a vote re-renders the body.
        this.mount.focus({ preventScroll: true });
    }

    _renderCards(poolSize) {
        if (poolSize < 2) {
            this.bodyEl.innerHTML = `
                <div class="explore-rater-empty">
                    <div class="explore-rater-empty-icon">${ICONS.scale}</div>
                    <p class="explore-rater-empty-title">Not enough finds to rate yet</p>
                    <p class="explore-rater-empty-desc">Rating needs at least two gallery finds that have previews. Run a search to fill the gallery, then come back.</p>
                </div>`;
            return;
        }
        if (!this.current) {
            this.bodyEl.innerHTML = `
                <div class="explore-rater-empty">
                    <div class="explore-rater-empty-icon">${ICONS.check}</div>
                    <p class="explore-rater-empty-title">All pairs rated</p>
                    <p class="explore-rater-empty-desc">You've judged every available pairing. Discover more finds (or import a pack) for fresh match-ups — your ${this.voteBank.getCount()} votes are banked and ready to refit the objective.</p>
                </div>`;
            return;
        }
        this.bodyEl.innerHTML = `
            ${this._renderCard(this.current.a, 'a')}
            <div class="explore-rater-vs">vs</div>
            ${this._renderCard(this.current.b, 'b')}
        `;
    }

    _renderCard(find, side) {
        const name = this._escape(find.mnemonic || find.hex);
        const ic = this._escape(find.icLabel || '');
        const score = typeof find.score === 'number' ? find.score.toFixed(2) : '–';
        return `
            <button class="explore-rater-card" data-side="${side}" title="Pick this one (${side === 'a' ? '←' : '→'})">
                <img class="explore-rater-thumb" src="${this._escape(find.thumb)}" alt="" loading="lazy" />
                <span class="explore-rater-card-name">${name}</span>
                <span class="explore-rater-card-meta"><span class="explore-rater-card-score">${score}</span>${ic ? ` · ${ic}` : ''}</span>
            </button>
        `;
    }

    _onClick(e) {
        const card = e.target.closest('.explore-rater-card');
        const actionBtn = e.target.closest('[data-action]');
        if (card) { this._vote(card.dataset.side); return; }
        if (actionBtn) {
            const action = actionBtn.dataset.action;
            if (action === 'skip') this._vote('skip');
            else if (action === 'exit') this.onExit?.();
        }
    }

    _onKey(e) {
        if (!this.current) {
            if (e.key === 'Escape') { e.preventDefault(); this.onExit?.(); }
            return;
        }
        if (e.key === 'ArrowLeft') { e.preventDefault(); this._vote('a'); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); this._vote('b'); }
        else if (e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); this._vote('skip'); }
        else if (e.key === 'Escape') { e.preventDefault(); this.onExit?.(); }
    }

    _vote(winner) {
        if (!this.current) return;
        const { a, b } = this.current;
        this.voteBank.record({
            aHex: a.hex,
            bHex: b.hex,
            winner,
            aMetrics: extractFeatures(a.perComponent),
            bMetrics: extractFeatures(b.perComponent),
            aScore: typeof a.score === 'number' ? a.score : null,
            bScore: typeof b.score === 'number' ? b.score : null,
            source: 'desktop',
        });
        EventBus.dispatch(EVENTS.VOTE_RECORDED, { count: this.voteBank.getCount(), winner });
        this._updateCounter();
        this._next();
    }

    _escape(str) {
        return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
}
