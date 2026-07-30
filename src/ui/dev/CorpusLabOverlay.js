import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as Config from '../../core/config.js';
import { rulesetName } from '../../utils/utils.js';
import { constraintBadge } from '../RulesetDisplayFactory.js';
import { APP_VERSION } from '../../version.js';
import { suggestScenarioFromStats } from '../../core/analysis/tagSuggestions.js';
import { ACCEPTANCE_SCENARIOS } from '../../core/analysis/corpusProtocol.js';
import { buildLineage, pickInitialCondition, pickSeed } from '../../core/analysis/CorpusLineage.js';
import { CorpusCollectionBuffer, DEFAULT_FLUSH_BYTES } from '../../core/analysis/CorpusCollectionBuffer.js';
import { TrajectoryCaptureService } from '../../services/TrajectoryCaptureService.js';

/**
 * OWNER-ONLY Corpus v1 collection tool, mounted with `?corpus=1` (#37 Stage 4B.2).
 *
 * Replaces the in-panel 3×3 review queue. The design goal is throughput: the audit needs 400+ labeled
 * clips across seeds, initial conditions, grid presets, symmetry classes and scenarios, so a judgment
 * has to cost one keystroke and nothing else. Three things make that possible:
 *
 * - **Prefetch.** All nine worlds are seeded and evaluated up front, so the card the owner is looking
 *   at is already simulating and the next eight are too. Advancing never waits on a worker.
 * - **Derived provenance.** Family comes from the lineage generator and scenario from the classifier,
 *   so nothing has to be typed and nothing can drift over a long session.
 * - **Capture at judgment.** Clips are encoded the instant a world is judged, which frees the world
 *   for recycling and lets a session outlive one grid.
 *
 * The overlay brackets the whole session with the auto-explore snapshot/restore pair, so the owner's
 * real worlds come back exactly as they were on close.
 */

const SCENARIO_KEYS = ACCEPTANCE_SCENARIOS.slice(0, 9);

/** Evaluation burst used only to propose a scenario — short, since it runs nine times per round. */
const PROBE_OPTS = { ticks: 160, sampleEvery: 10, warmupTicks: 20, probe: { enabled: false } };

/**
 * Ceiling on one probe. `WorldProxy.runEvaluation` resolves only when the worker posts an
 * EVALUATION_RESULT, and the worker drops the burst silently when its Wasm world is not up yet — so
 * an un-raced probe can hang the whole round forever. A timed-out probe just means the owner picks
 * the scenario by hand.
 */
const PROBE_TIMEOUT_MS = 15000;

/** How long to wait for all nine workers before starting the first round. */
const WORKER_READY_TIMEOUT_MS = 30000;

export class CorpusLabOverlay {
    /** @param {any} appContext */
    constructor(appContext) {
        this.appContext = appContext;
        this.wm = appContext.worldManager;
        this.capture = new TrajectoryCaptureService(this.wm);
        this.buffer = new CorpusCollectionBuffer({
            sessionId: globalThis.crypto?.randomUUID?.() || `corpus-${Date.now().toString(36)}`,
            createdAt: new Date().toISOString(),
            appVersion: APP_VERSION,
        });

        /** @type {import('../../core/analysis/CorpusLineage.js').Lineage|null} */
        this.lineage = null;
        /** @type {Array<{worldIndex: number, member: any, ic: any, seed: number, guess: {scenario: string, confidence: string}}>} */
        this.queue = [];
        this.cursor = 0;
        this.roundIndex = 0;
        this.partIndex = 0;
        this.busy = false;
        this.status = '';
        /** Scenario override for the current card, or null to accept the guess. */
        this.override = null;
        // Round origin alternates so the corpus mixes curated anchors with fresh random ones; the
        // scheduler in a later step replaces this with thinnest-stratum targeting.
        this.nextOrigin = 'library';
        this.settings = { frameCount: 32, tickStride: 1, sliceCount: 4 };

        this.snapshot = this.wm._captureAutoExploreSnapshot();
        this._render();
        void this._startRound();
    }

    // --- lifecycle -------------------------------------------------------------------------------

    _render() {
        this.el = document.createElement('div');
        this.el.className = 'corpus-overlay';
        this.el.innerHTML = `
            <div class="corpus-panel">
                <header class="corpus-head">
                    <h2>Corpus Lab <span class="corpus-session"></span></h2>
                    <button class="corpus-close" title="Close (Esc)">&times;</button>
                </header>
                <div class="corpus-card">
                    <div class="corpus-card-main">
                        <div class="corpus-lineage">
                            <span class="corpus-family"></span>
                            <span class="corpus-origin"></span>
                        </div>
                        <div class="corpus-ruleset">
                            <span class="corpus-rule-name"></span>
                            <span class="corpus-class"></span>
                            <code class="corpus-hex"></code>
                        </div>
                        <div class="corpus-ic"></div>
                    </div>
                    <div class="corpus-guess-row">
                        <span class="corpus-guess-label">Scenario</span>
                        <span class="corpus-guess"></span>
                        <span class="corpus-guess-hint"></span>
                    </div>
                    <div class="corpus-scenario-chips"></div>
                    <div class="corpus-judge">
                        <button class="button corpus-interesting" data-corpus="interesting">Interesting <kbd>I</kbd></button>
                        <button class="button corpus-boring" data-corpus="boring">Boring <kbd>B</kbd></button>
                        <button class="button" data-corpus="skip">Skip <kbd>U</kbd></button>
                        <button class="button" data-corpus="undo">Undo <kbd>&larr;</kbd></button>
                    </div>
                    <div class="corpus-queue"></div>
                </div>
                <div class="corpus-coverage"></div>
                <footer class="corpus-foot">
                    <label>Slices <input type="number" class="corpus-slices" min="1" max="16" step="1" value="4"></label>
                    <label>Frames <input type="number" class="corpus-frames" min="1" max="32" step="1" value="32"></label>
                    <label>Stride <input type="number" class="corpus-stride" min="1" max="32" step="1" value="1"></label>
                    <button class="button" data-corpus="new-round">New round</button>
                    <button class="button action-button" data-corpus="finish">Finish &amp; download</button>
                    <span class="corpus-status info-text"></span>
                </footer>
            </div>
        `;
        document.body.appendChild(this.el);

        this.ui = {
            session: this.el.querySelector('.corpus-session'),
            family: this.el.querySelector('.corpus-family'),
            origin: this.el.querySelector('.corpus-origin'),
            ruleName: this.el.querySelector('.corpus-rule-name'),
            cls: this.el.querySelector('.corpus-class'),
            hex: this.el.querySelector('.corpus-hex'),
            ic: this.el.querySelector('.corpus-ic'),
            guess: this.el.querySelector('.corpus-guess'),
            guessHint: this.el.querySelector('.corpus-guess-hint'),
            chips: this.el.querySelector('.corpus-scenario-chips'),
            queue: this.el.querySelector('.corpus-queue'),
            coverage: this.el.querySelector('.corpus-coverage'),
            status: this.el.querySelector('.corpus-status'),
            slices: this.el.querySelector('.corpus-slices'),
            frames: this.el.querySelector('.corpus-frames'),
            stride: this.el.querySelector('.corpus-stride'),
        };
        this.ui.session.textContent = `session ${this.buffer.sessionId.slice(0, 8)}`;

        this._renderScenarioChips();
        this.el.addEventListener('click', (event) => this._onClick(event));
        this.el.addEventListener('change', () => this._readSettings());
        this._keyHandler = (event) => this._onKey(event);
        window.addEventListener('keydown', this._keyHandler);
    }

    destroy() {
        window.removeEventListener('keydown', this._keyHandler);
        this.el?.remove();
        // Hand the owner's worlds back exactly as they were before the session.
        this.wm._restoreAutoExploreSnapshot(this.snapshot);
        this.appContext._corpusLab = null;
    }

    // --- round generation ------------------------------------------------------------------------

    /**
     * Seed all nine worlds from one lineage, then probe each so a scenario guess is ready before the
     * owner ever looks at the card.
     */
    async _startRound() {
        if (this.busy) return;
        this.busy = true;
        this._setStatus('Building lineage…');
        try {
            // The overlay mounts as soon as its module loads, which can be before the workers finish
            // booting. A RUN_EVALUATION that reaches a worker without a live Wasm world is dropped
            // without a reply, so probing early hangs the round rather than failing it.
            await this._awaitWorldsReady();
            this.wm._setAllWorldsEnabledForExplore(true);
            const origin = this.nextOrigin;
            this.nextOrigin = origin === 'library' ? 'random' : 'library';
            const symmetryClass = origin === 'random' ? this._pickThinnestSymmetryClass() : undefined;
            this.lineage = buildLineage(
                { origin, symmetryClass, memberCount: Math.min(9, this.wm.worlds.length) },
                { rulesetService: this.wm.rulesetService },
            );

            const libraryIc = this.lineage.origin === 'library'
                ? this._libraryInitialStateFor(this.lineage.anchorRuleset)
                : null;

            this.queue = this.lineage.members.map((member, worldIndex) => {
                const ic = pickInitialCondition(Math.random, { ownInitialState: libraryIc });
                const seed = pickSeed(Math.random);
                this.wm._applyExploreRuleset(worldIndex, member.rulesetHex);
                this.wm.worldSettings[worldIndex].initialState = ic.initialState;
                this.wm.worlds[worldIndex].resetWorld(ic.initialState, seed);
                return { worldIndex, member, ic, seed, guess: { scenario: 'unknown', confidence: 'low' } };
            });
            this.cursor = 0;
            this.override = null;
            this.roundIndex++;

            this._setStatus('Probing behaviour…');
            this._update();
            await this._probeQueue();
            this._setStatus('');
        } catch (error) {
            this._setStatus(`Round failed: ${error.message}`);
        } finally {
            this.busy = false;
            this._update();
        }
    }

    /** Resolve once every world's worker has a live Wasm world, or after a bounded wait. */
    _awaitWorldsReady() {
        const ready = () => this.wm.worlds.every((proxy) => proxy?.isInitialized);
        if (ready()) return Promise.resolve();
        this._setStatus('Waiting for simulation workers…');
        return new Promise((resolve) => {
            const started = Date.now();
            const unsubscribe = EventBus.subscribe(EVENTS.WORKER_INITIALIZED, () => {
                if (!ready()) return;
                clearInterval(poll);
                unsubscribe?.();
                resolve();
            });
            // Belt-and-braces poll: the events that fired before this subscription are already gone,
            // so readiness could otherwise be missed entirely.
            const poll = setInterval(() => {
                if (ready() || Date.now() - started > WORKER_READY_TIMEOUT_MS) {
                    clearInterval(poll);
                    unsubscribe?.();
                    resolve();
                }
            }, 200);
        });
    }

    /**
     * Run one evaluation burst per world and convert the metrics into a proposed scenario. The bursts
     * run concurrently across the nine workers, which is why prefetch costs one round of latency
     * rather than nine.
     */
    async _probeQueue() {
        const initialRatios = this.queue.map((item) => this._initialRatioFor(item.ic));
        await Promise.all(this.queue.map(async (item, index) => {
            try {
                const metrics = await this._probeWorld(item.worldIndex);
                item.metrics = metrics;
                item.guess = suggestScenarioFromStats({ ...metrics, initialRatio: initialRatios[index] });
            } catch {
                // A failed probe is not a failed judgment: the owner picks the scenario by hand.
                item.guess = { scenario: 'unknown', confidence: 'low' };
            }
            this._update();
        }));
    }

    /** @param {number} worldIndex */
    _probeWorld(worldIndex) {
        return Promise.race([
            this.wm.worlds[worldIndex].runEvaluation(PROBE_OPTS),
            new Promise((_, reject) => setTimeout(() => reject(new Error('probe timed out')), PROBE_TIMEOUT_MS)),
        ]);
    }

    /** The starting coverage a generative initial condition implies, for the growth heuristic. */
    _initialRatioFor(ic) {
        const density = Number(ic?.initialState?.params?.density);
        if (!Number.isFinite(density)) return undefined;
        // Cluster mode fills only inside the blobs, so its density is not a whole-grid ratio.
        return ic.initialState.mode === 'density' ? density : undefined;
    }

    /** @param {string} anchorHex */
    _libraryInitialStateFor(anchorHex) {
        const entry = (this.appContext.libraryController?.getLibraryData()?.rulesets || [])
            .find((r) => String(r?.hex || '').toUpperCase() === anchorHex.toUpperCase());
        return entry?.initialState || null;
    }

    /**
     * The symmetry class with the fewest collected clips — a first step toward the full
     * coverage-driven scheduler. Random rounds aim here, so the thin strata fill on their own.
     */
    _pickThinnestSymmetryClass() {
        const counts = this.buffer.coverage().symmetryClasses;
        const candidates = ['free', 'r_sym', 'd_sym', 'n_count', 'totalistic'];
        return candidates.reduce(
            (thinnest, cls) => ((counts[cls] || 0) < (counts[thinnest] || 0) ? cls : thinnest),
            candidates[0],
        );
    }

    // --- judging ---------------------------------------------------------------------------------

    get current() {
        return this.queue[this.cursor] || null;
    }

    /** @param {'interesting'|'boring'} label */
    async _judge(label) {
        const item = this.current;
        if (!item || this.busy) return;
        const scenario = this.override || item.guess.scenario;
        if (scenario === 'unknown') {
            this._setStatus('Pick a scenario (1–9) before labeling — unknown clips fail the audit.');
            return;
        }
        this.busy = true;
        try {
            const { clips } = await this.capture.captureJudgedWorld(item.worldIndex, {
                label,
                scenario,
                family: this.lineage.familyId,
                sessionId: this.buffer.sessionId,
                ...this.settings,
            });
            this.buffer.add(clips, {
                familyId: this.lineage.familyId,
                anchorRuleset: this.lineage.anchorRuleset,
                relationship: this.lineage.relationship,
            });
            this._setStatus(`${label} · ${clips.length} clips`);
            await this._advance();
        } catch (error) {
            this._setStatus(`Capture failed: ${error.message}`);
        } finally {
            this.busy = false;
            this._update();
        }
    }

    async _advance() {
        this.override = null;
        this.cursor++;
        if (this.buffer.shouldFlush(DEFAULT_FLUSH_BYTES)) this._flush(false);
        if (this.cursor >= this.queue.length) {
            this.busy = false;
            await this._startRound();
            return;
        }
        this._selectCurrentWorld();
    }

    _skip() {
        if (this.busy) return;
        this.override = null;
        this.cursor++;
        if (this.cursor >= this.queue.length) void this._startRound();
        else { this._selectCurrentWorld(); this._update(); }
    }

    _undo() {
        const removed = this.buffer.undoLast();
        if (!removed) {
            this._setStatus('Nothing to undo — earlier clips are already written out.');
            this._update();
            return;
        }
        // Step back onto the world that was just un-judged so it can be re-judged in place.
        if (this.cursor > 0) this.cursor--;
        this.override = null;
        this._selectCurrentWorld();
        this._setStatus(`Undid ${removed} clip${removed === 1 ? '' : 's'}`);
        this._update();
    }

    _selectCurrentWorld() {
        const item = this.current;
        if (item) EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, item.worldIndex);
    }

    // --- output ----------------------------------------------------------------------------------

    /** @param {boolean} final */
    _flush(final) {
        if (!this.buffer.clipCount) {
            this._setStatus('Nothing collected yet.');
            return;
        }
        try {
            const { filename } = this.capture.downloadCorpusBuffer(this.buffer, {
                partIndex: this.partIndex,
                final,
            });
            this.buffer.markFlushed();
            this.partIndex++;
            this._setStatus(`Wrote ${filename}`);
        } catch (error) {
            this._setStatus(`Download failed: ${error.message}`);
        }
        this._update();
    }

    _readSettings() {
        const clamp = (value, min, max, fallback) => {
            const parsed = Math.trunc(Number(value));
            return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
        };
        this.settings = {
            sliceCount: clamp(this.ui.slices.value, 1, 16, 4),
            frameCount: clamp(this.ui.frames.value, 1, 32, 32),
            tickStride: clamp(this.ui.stride.value, 1, 32, 1),
        };
        this._update();
    }

    // --- input -----------------------------------------------------------------------------------

    /** @param {MouseEvent} event */
    _onClick(event) {
        const target = event.target;
        if (target.closest('.corpus-close')) { this.destroy(); return; }
        const chip = target.closest('[data-scenario]');
        if (chip) {
            this.override = chip.dataset.scenario;
            this._update();
            return;
        }
        const button = target.closest('[data-corpus]');
        if (!button) return;
        switch (button.dataset.corpus) {
            case 'interesting': void this._judge('interesting'); break;
            case 'boring': void this._judge('boring'); break;
            case 'skip': this._skip(); break;
            case 'undo': this._undo(); break;
            case 'new-round': void this._startRound(); break;
            case 'finish': this._flush(true); break;
            default: break;
        }
    }

    /** @param {KeyboardEvent} event */
    _onKey(event) {
        // Never steal keys from the numeric settings inputs.
        if (event.target?.tagName === 'INPUT') return;
        const key = event.key.toLowerCase();
        if (key === 'escape') { this.destroy(); return; }
        if (key === 'i') { void this._judge('interesting'); }
        else if (key === 'b') { void this._judge('boring'); }
        else if (key === 'u') { this._skip(); }
        else if (event.key === 'ArrowLeft') { this._undo(); }
        else if (/^[1-9]$/.test(event.key)) {
            this.override = SCENARIO_KEYS[Number(event.key) - 1];
            this._update();
        } else return;
        event.preventDefault();
    }

    // --- rendering -------------------------------------------------------------------------------

    _renderScenarioChips() {
        this.ui.chips.innerHTML = SCENARIO_KEYS.map((scenario, index) => `
            <button type="button" class="corpus-chip" data-scenario="${scenario}">
                <kbd>${index + 1}</kbd>${scenario.replaceAll('_', ' ')}
            </button>
        `).join('');
    }

    /** @param {string} message */
    _setStatus(message) {
        this.status = message;
        if (this.ui?.status) this.ui.status.textContent = message;
    }

    _update() {
        if (!this.ui) return;
        const item = this.current;
        const lineage = this.lineage;

        this.ui.family.textContent = lineage ? lineage.familyId : '—';
        this.ui.origin.textContent = lineage
            ? `${lineage.origin === 'library' ? lineage.libraryName || 'library' : 'random'} · round ${this.roundIndex}`
            : '';

        if (item) {
            this.ui.ruleName.textContent = rulesetName(item.member.rulesetHex);
            this.ui.hex.textContent = item.member.rulesetHex;
            const badge = constraintBadge(item.member.rulesetHex);
            this.ui.cls.className = badge ? `corpus-class constraint-badge constraint-${badge.cls}` : 'corpus-class';
            this.ui.cls.textContent = badge ? badge.label : '';
            const distance = item.member.isAnchor ? 'anchor' : `mutant @ ${item.member.mutationRate}`;
            this.ui.ic.textContent = `${item.ic.presetName} · seed ${item.seed} · ${distance} · world ${item.worldIndex + 1}`;

            const scenario = this.override || item.guess.scenario;
            this.ui.guess.textContent = scenario.replaceAll('_', ' ');
            this.ui.guess.dataset.confidence = this.override ? 'owner' : item.guess.confidence;
            this.ui.guessHint.textContent = this.override
                ? 'your pick'
                : item.guess.confidence === 'high' ? 'proposed — I/B accepts' : 'low confidence — check it';
            this.ui.chips.querySelectorAll('[data-scenario]').forEach((chip) => {
                chip.classList.toggle('active', chip.dataset.scenario === scenario);
            });
        } else {
            this.ui.ruleName.textContent = '—';
            this.ui.hex.textContent = '';
            this.ui.cls.textContent = '';
            this.ui.ic.textContent = '';
            this.ui.guess.textContent = '—';
            this.ui.guessHint.textContent = '';
        }

        this.ui.queue.innerHTML = this.queue.map((entry, index) => `
            <span class="corpus-queue-dot${index === this.cursor ? ' current' : ''}${index < this.cursor ? ' done' : ''}"
                  title="World ${entry.worldIndex + 1}: ${entry.guess.scenario}"></span>
        `).join('');

        const coverage = this.buffer.coverage();
        const clipsPerJudgment = this.settings.sliceCount;
        this.ui.coverage.innerHTML = `
            <div class="corpus-coverage-row">
                <strong>${this.buffer.lifetimeClipCount}</strong> clips
                <span>/ 400 minimum</span>
                <strong>${coverage.families}</strong> families
                <span>(need 6 train / 2 val / 2 test)</span>
                <strong>${Math.round(this.buffer.totalBytes / 1024 / 1024)} MB</strong> buffered
                <span>· ${clipsPerJudgment} clips per judgment</span>
            </div>
            <div class="corpus-coverage-row">
                <span>labels ${JSON.stringify(coverage.labels)}</span>
                <span>coverage-eligible ${coverage.coverageEligibleClips}</span>
            </div>
            <div class="corpus-coverage-row">
                ${['free', 'r_sym', 'd_sym', 'n_count', 'totalistic'].map((cls) =>
                    `<span class="corpus-tally">${cls} <b>${coverage.symmetryClasses[cls] || 0}</b></span>`).join('')}
            </div>
            <div class="corpus-coverage-row">
                ${SCENARIO_KEYS.map((scenario) =>
                    `<span class="corpus-tally${coverage.scenarios[scenario] ? '' : ' empty'}">${scenario.replaceAll('_', ' ')} <b>${coverage.scenarios[scenario] || 0}</b></span>`).join('')}
            </div>
            <div class="corpus-coverage-row">
                ${Object.keys(Config.GRID_SIZE_PRESETS).map((preset) =>
                    `<span class="corpus-tally${(coverage.gridPresets[preset] || 0) >= 32 ? ' ok' : ''}">${preset} <b>${coverage.gridPresets[preset] || 0}</b>/32</span>`).join('')}
            </div>
            <div class="corpus-coverage-row">
                <span>${coverage.rulesetsWithThreeSeeds}/${coverage.distinctRulesets} rulesets with 3+ seeds</span>
                <span>${coverage.rulesetsWithTwoInitialConditions}/${coverage.distinctRulesets} with 2+ initial conditions</span>
            </div>
        `;
    }
}
