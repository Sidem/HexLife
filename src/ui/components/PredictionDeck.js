import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { ICONS } from '../icons.js';
import { rulesetName } from '../../utils/utils.js';
import { PREDICTION_OUTCOMES, classifyOutcome, outcomeMeta } from '../../core/analysis/outcomeClass.js';
import { makePredictionRound, randomRoundSeed } from '../../core/analysis/predictionRounds.js';

/**
 * Prediction mode — "call it before it runs" (PLAY-LAYER-PLAN §P1, roadmap #19).
 *
 * One card at a time: the still first frame of a real world, four buttons, then the reveal. It is the
 * newcomer-tier entry point on Discover, so by the #29 rule it mounts *above* `#explore-advanced`,
 * never inside it — a first-time visitor should meet a question they can answer, not the nine-term
 * objective. Its whole surface is three resting controls (the card, the four choices, "Next").
 *
 * **Why it exists beyond being fun.** Every graded round is a human labelling a real ruleset with what
 * it does, which is the one kind of data the statistical objective cannot generate for itself; the
 * records bank to `PREDICTION_RESULTS` with their round seed and hex so a later stage can replay the
 * exact world behind a label (#37 Stage 4 wants judgements in this shape). The streak readout is
 * display-only and gates nothing — the play-layer constraint against fake scarcity.
 *
 * Simulation is borrowed, not owned: {@link ThumbnailBakeService.bakePredictionRound} runs the round
 * on a scratch (non-selected) world and restores it afterwards, so the deck never disturbs what the
 * user is looking at, and the answer comes from the same evaluation burst the rest of the app scores.
 *
 * **Currently switched off — see {@link PREDICTION_MODE_ENABLED}.**
 */

/**
 * Master switch for the Prediction deck (#19). **Off since 2026-07-22**: the feature works
 * mechanically — rounds deal, grade and bank correctly — but the *game* doesn't yet. Owner verdict
 * after playing it: not good enough to put in front of a newcomer.
 *
 * It is a flag rather than a revert because nothing here is wrong, only unfinished, and the parts
 * downstream work already depends on are all still live and tested: `classifyOutcome()` (the app's
 * outcome vocabulary, wanted by #17's result grid and #23), `makePredictionRound()` (seed-minted
 * worlds, which is most of #20) and `ThumbnailBakeService.bakePredictionRound()` (the before/after
 * capture). Deleting the deck would take the only caller of all three with it.
 *
 * Flipping this back to `true` restores the surface exactly as it shipped; the placement contract it
 * has to satisfy is still pinned by `tests/exploreDisclosure.test.js`. What to fix first is recorded
 * in `docs/PLAY-LAYER-PLAN.md` §P1.
 */
export const PREDICTION_MODE_ENABLED = false;

/** Round states, in the order one round passes through them. */
const PHASE = { LOADING: 'loading', ASKING: 'asking', REVEALED: 'revealed', UNAVAILABLE: 'unavailable' };

export class PredictionDeck {
    /**
     * @param {HTMLElement} mount
     * @param {{worldManager: object}} opts
     */
    constructor(mount, { worldManager }) {
        this.mount = mount;
        this.wm = worldManager;
        this.phase = PHASE.LOADING;
        /** @type {import('../../core/analysis/predictionRounds.js').PredictionRound|null} */
        this.round = null;
        /** @type {{before: string|null, after: string|null, actual: string}|null} */
        this.result = null;
        this.predicted = null;
        // Rounds are prepared asynchronously on a borrowed world; a token invalidates the in-flight
        // one when the user asks for the next card (or the deck is destroyed) mid-bake.
        this._token = 0;
        this.results = PersistenceService.loadPredictionResults();
        this._onClick = (e) => this._handleClick(e);
        this.mount.addEventListener('click', this._onClick);
        this._render();
        this.newRound();
    }

    destroy() {
        this._token++;
        this.mount.removeEventListener('click', this._onClick);
        this.mount.innerHTML = '';
    }

    /**
     * Deal a fresh card: mint a round seed, build the recipe, and run it on the scratch world. The
     * "before" frame is what the player judges; the "after" frame and the burst metrics are held back
     * until they answer.
     */
    async newRound() {
        const token = ++this._token;
        this.phase = PHASE.LOADING;
        this.predicted = null;
        this.result = null;
        this.round = null;
        this._render();

        const rulesetService = this.wm?.rulesetService;
        const bakeService = this.wm?.thumbnailBakeService;
        if (!rulesetService || !bakeService) { this._fail(token); return; }

        const round = makePredictionRound(randomRoundSeed(), rulesetService);
        const baked = await bakeService.bakePredictionRound({
            hex: round.hex,
            initialState: round.initialState,
            seed: round.seed,
        });
        if (token !== this._token) return;
        // No scratch world (Auto-Explore is running, or every other world is disabled) or no capture:
        // say so plainly rather than showing a card with a hole in it.
        if (!baked || !baked.before) { this._fail(token); return; }

        this.round = round;
        this.result = { before: baked.before, after: baked.after, actual: classifyOutcome(baked.metrics) };
        this.phase = PHASE.ASKING;
        this._render();
    }

    _fail(token) {
        if (token !== this._token) return;
        this.phase = PHASE.UNAVAILABLE;
        this._render();
    }

    /** Grade the player's call, bank the label, and flip the card to the reveal. */
    _answer(key) {
        if (this.phase !== PHASE.ASKING || !this.round || !this.result) return;
        this.predicted = key;
        this.phase = PHASE.REVEALED;
        const correct = key === this.result.actual;
        this.results.push({
            roundSeed: this.round.roundSeed,
            hex: this.round.hex,
            mode: this.round.mode,
            seed: this.round.seed,
            icLabel: this.round.icLabel,
            predicted: key,
            actual: this.result.actual,
            correct,
            at: Date.now(),
        });
        PersistenceService.savePredictionResults(this.results);
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
            message: correct ? 'Called it.' : `Not quite — it ${outcomeMeta(this.result.actual)?.verb}.`,
            type: correct ? 'success' : 'info',
        });
        this._render();
    }

    /**
     * Put the revealed round into the selected world so the player can actually play with it. Reset
     * is on: the round's whole identity is `ruleset × IC × seed`, and applying the hex to whatever
     * cells happen to be on screen would show a different world than the one just graded.
     */
    _adopt() {
        if (!this.round) return;
        EventBus.dispatch(EVENTS.COMMAND_SET_RULESET, {
            hexString: this.round.hex,
            scope: 'selected',
            resetOnNewRule: true,
        });
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
            message: `Loaded ${rulesetName(this.round.hex)} into the selected world.`,
            type: 'success',
        });
    }

    _handleClick(e) {
        const btn = e.target.closest('[data-prediction-action]');
        if (!btn) return;
        const action = btn.dataset.predictionAction;
        if (action === 'answer') this._answer(btn.dataset.outcome);
        else if (action === 'next') this.newRound();
        else if (action === 'adopt') this._adopt();
        else if (action === 'retry') this.newRound();
    }

    // --- Rendering ------------------------------------------------------------------------------

    /** Rounds graded this browser, and the current run of correct calls (display-only). */
    _tally() {
        const graded = this.results.length;
        const right = this.results.filter((r) => r.correct).length;
        let streak = 0;
        for (let i = this.results.length - 1; i >= 0 && this.results[i].correct; i--) streak++;
        return { graded, right, streak };
    }

    _render() {
        const { graded, right, streak } = this._tally();
        const tally = graded > 0
            ? `${right}/${graded} called${streak >= 2 ? ` · ${streak} in a row` : ''}`
            : '';
        this.mount.innerHTML = `
            <div class="tool-group prediction-deck" id="prediction-deck">
                <div class="prediction-head">
                    <h5>${ICONS.target} Call it before it runs</h5>
                    <span class="prediction-tally" data-field="tally">${this._escape(tally)}</span>
                </div>
                ${this._renderBody()}
            </div>
        `;
    }

    _renderBody() {
        if (this.phase === PHASE.UNAVAILABLE) {
            return `
                <p class="prediction-blurb">Prediction mode needs a spare world to run the round on — it can't deal a card while Auto-Explore is running or when every other world is disabled.</p>
                <div class="prediction-actions">
                    <button class="button" data-prediction-action="retry">Try again</button>
                </div>`;
        }
        if (this.phase === PHASE.LOADING) {
            return `
                <p class="prediction-blurb">Dealing a world…</p>
                <div class="prediction-card prediction-card-loading" aria-busy="true"></div>`;
        }
        if (this.phase === PHASE.ASKING) {
            return `
                <p class="prediction-blurb">This is a real world's <strong>first frame</strong>. What happens when it runs?</p>
                <div class="prediction-card">
                    <img class="prediction-frame" src="${this._escape(this.result.before)}" alt="The world's initial state" />
                    <span class="prediction-frame-caption">start · ${this._escape(this.round.icLabel)}</span>
                </div>
                <div class="prediction-choices">
                    ${PREDICTION_OUTCOMES.map((o) => `
                        <button class="button prediction-choice" data-prediction-action="answer" data-outcome="${o.key}" title="${this._escape(o.hint)}">
                            <span class="prediction-choice-label">${this._escape(o.label)}</span>
                            <span class="prediction-choice-hint">${this._escape(o.hint)}</span>
                        </button>`).join('')}
                </div>`;
        }
        // Revealed.
        const actual = outcomeMeta(this.result.actual);
        const guessed = outcomeMeta(this.predicted);
        const correct = this.predicted === this.result.actual;
        return `
            <div class="prediction-card prediction-card-pair">
                <figure class="prediction-frame-wrap">
                    <img class="prediction-frame" src="${this._escape(this.result.before)}" alt="The world's initial state" />
                    <figcaption>start</figcaption>
                </figure>
                <figure class="prediction-frame-wrap">
                    ${this.result.after
                        ? `<img class="prediction-frame" src="${this._escape(this.result.after)}" alt="The world after running" />`
                        : '<div class="prediction-frame prediction-frame-missing"></div>'}
                    <figcaption>after</figcaption>
                </figure>
            </div>
            <p class="prediction-verdict ${correct ? 'is-correct' : 'is-wrong'}">
                ${correct ? `${ICONS.check} Called it — it ${this._escape(actual?.verb || '')}.`
                          : `It ${this._escape(actual?.verb || '')}; you said <em>${this._escape(guessed?.label || '')}</em>.`}
            </p>
            <p class="prediction-blurb prediction-recipe">${this._escape(rulesetName(this.round.hex))} · ${this._escape(this.round.mode)} · ${this._escape(this.round.icLabel)}</p>
            <div class="prediction-actions">
                <button class="button prediction-next" data-prediction-action="next">Next world</button>
                <button class="button" data-prediction-action="adopt" title="Load this ruleset into the selected world">Keep this one</button>
            </div>`;
    }

    _escape(str) {
        return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
}
