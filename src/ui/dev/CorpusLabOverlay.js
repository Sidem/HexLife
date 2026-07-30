import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as Config from '../../core/config.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { rulesetName } from '../../utils/utils.js';
import { constraintBadge } from '../RulesetDisplayFactory.js';
import { APP_VERSION } from '../../version.js';
import { suggestScenarioFromStats } from '../../core/analysis/tagSuggestions.js';
import {
    ACCEPTANCE_SCENARIOS,
    CORPUS_COVERAGE,
    CORPUS_GRID_PRESETS,
    CORPUS_LABELS,
    CORPUS_MINIMUM_FAMILIES,
    CORPUS_SYMMETRY_CLASSES,
} from '../../core/analysis/corpusProtocol.js';
import { auditStatus, planRound } from '../../core/analysis/CorpusScheduler.js';
import { CorpusCollectionBuffer, DEFAULT_FLUSH_BYTES } from '../../core/analysis/CorpusCollectionBuffer.js';
import { TrajectoryCaptureService, currentGridPreset } from '../../services/TrajectoryCaptureService.js';

/**
 * OWNER-ONLY Corpus v1 collection tool, mounted with `?corpus=1` (#37 Stage 4B.2).
 *
 * Replaces the in-panel 3×3 review queue. The design goal is throughput: the audit needs 400+ labeled
 * clips across seeds, initial conditions, grid presets, symmetry classes and scenarios, so a judgment
 * has to cost one keystroke and nothing else. Four things make that possible:
 *
 * - **Prefetch.** All nine worlds are seeded and evaluated up front, so the card the owner is looking
 *   at is already simulating and the next eight are too. Advancing never waits on a worker.
 * - **Derived provenance.** Family comes from the lineage generator and scenario from the classifier,
 *   so nothing has to be typed and nothing can drift over a long session.
 * - **Capture at judgment.** Clips are encoded the instant a world is judged, which frees the world
 *   for recycling and lets a session outlive one grid.
 * - **Scheduled rounds.** `CorpusScheduler` decides what each round contains from live coverage, so
 *   the session converges on a passing strict audit instead of accumulating unpayable per-ruleset debt.
 *
 * The overlay brackets the whole session with the auto-explore snapshot/restore pair, so the owner's
 * real worlds come back exactly as they were on close.
 */

/** All ten acceptance scenarios. `other` is required by the audit too, so it gets a key: `0`. */
const SCENARIO_KEYS = ACCEPTANCE_SCENARIOS;

/** Total families the proposed split cycle needs for the protocol's 6/2/2 minimums. */
const FAMILY_TARGET = Object.values(CORPUS_MINIMUM_FAMILIES).reduce((sum, n) => sum + n, 0);

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

/**
 * Grace period between writing the partial ZIP for a grid-block switch and reloading the page.
 * Reloading in the same task as the download click cancels the download in Chromium.
 */
const GRID_SWITCH_RELOAD_DELAY_MS = 1500;

/**
 * UI-settings key holding a one-shot session handoff across the page reload a grid-preset change
 * requires. Consumed (and cleared) on mount, so a session abandoned mid-switch cannot resurrect days
 * later and contaminate a fresh corpus with stale coverage.
 */
const HANDOFF_KEY = 'corpusLabHandoff';

export class CorpusLabOverlay {
    /** @param {any} appContext */
    constructor(appContext) {
        this.appContext = appContext;
        this.wm = appContext.worldManager;
        this.capture = new TrajectoryCaptureService(this.wm);

        const handoff = this._consumeHandoff();
        this.buffer = new CorpusCollectionBuffer({
            sessionId: handoff?.sessionId
                || globalThis.crypto?.randomUUID?.()
                || `corpus-${Date.now().toString(36)}`,
            createdAt: handoff?.createdAt || new Date().toISOString(),
            appVersion: APP_VERSION,
            priorCoverage: handoff?.coverage || null,
        });

        /** @type {import('../../core/analysis/CorpusScheduler.js').RoundPlan|null} */
        this.plan = null;
        /** @type {Array<import('../../core/analysis/CorpusScheduler.js').RoundSlot & {guess: {scenario: string, confidence: string}, metrics?: any}>} */
        this.queue = [];
        this.cursor = 0;
        this.roundIndex = 0;
        this.partIndex = Math.max(0, Math.trunc(Number(handoff?.partIndex) || 0));
        this.busy = false;
        this.status = '';
        /** Whether this page load is the far side of a grid-block switch. */
        this.resumed = !!handoff;
        /** Scenario override for the current card, or null to accept the guess. */
        this.override = null;
        this.settings = handoff?.settings || { frameCount: 32, tickStride: 1, sliceCount: 4 };

        this.snapshot = this.wm._captureAutoExploreSnapshot();
        this._render();
        void this._startRound();
    }

    // --- lifecycle -------------------------------------------------------------------------------

    /** Read and clear the one-shot reload handoff, if this page load is the far side of one. */
    _consumeHandoff() {
        const handoff = PersistenceService.loadUISetting(HANDOFF_KEY, null);
        if (!handoff?.sessionId) return null;
        PersistenceService.saveUISetting(HANDOFF_KEY, null);
        return handoff;
    }

    /**
     * Persist enough to continue this session on the other side of a reload: identity, part counter,
     * capture settings, and the coverage tallies. Payload bytes deliberately stay out — they must be
     * flushed to a ZIP first, because nothing can carry 48 MB of clips through a navigation.
     */
    _persistHandoff() {
        PersistenceService.saveUISetting(HANDOFF_KEY, {
            sessionId: this.buffer.sessionId,
            createdAt: this.buffer.createdAt,
            partIndex: this.partIndex,
            settings: this.settings,
            coverage: this.buffer.coverageSnapshot(),
        });
    }

    _render() {
        this.el = document.createElement('div');
        this.el.className = 'corpus-overlay';
        this.el.innerHTML = `
            <div class="corpus-panel">
                <header class="corpus-head">
                    <h2>Corpus Lab <span class="corpus-session"></span></h2>
                    <button class="corpus-close" title="Close (Esc)">&times;</button>
                </header>
                <div class="corpus-plan">
                    <span class="corpus-plan-kind"></span>
                    <span class="corpus-plan-reason"></span>
                </div>
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
                <details class="corpus-deficits">
                    <summary>Strict audit deficits <span class="corpus-deficit-count"></span></summary>
                    <ol class="corpus-deficit-list"></ol>
                </details>
                <footer class="corpus-foot">
                    <label>Slices <input type="number" class="corpus-slices" min="1" max="16" step="1" value="4"></label>
                    <label>Frames <input type="number" class="corpus-frames" min="1" max="32" step="1" value="32"></label>
                    <label>Stride <input type="number" class="corpus-stride" min="1" max="32" step="1" value="1"></label>
                    <button class="button" data-corpus="new-round">New round</button>
                    <button class="button corpus-grid-switch" data-corpus="grid-switch" hidden></button>
                    <button class="button action-button" data-corpus="finish">Finish &amp; download</button>
                    <span class="corpus-status info-text"></span>
                </footer>
            </div>
        `;
        document.body.appendChild(this.el);

        this.ui = {
            session: this.el.querySelector('.corpus-session'),
            planKind: this.el.querySelector('.corpus-plan-kind'),
            planReason: this.el.querySelector('.corpus-plan-reason'),
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
            deficitCount: this.el.querySelector('.corpus-deficit-count'),
            deficitList: this.el.querySelector('.corpus-deficit-list'),
            gridSwitch: this.el.querySelector('.corpus-grid-switch'),
            status: this.el.querySelector('.corpus-status'),
            slices: this.el.querySelector('.corpus-slices'),
            frames: this.el.querySelector('.corpus-frames'),
            stride: this.el.querySelector('.corpus-stride'),
        };
        // The block and resume markers live here rather than in the status line, which the first round
        // immediately overwrites — the owner needs to know a session was continued, not just told once.
        this.ui.session.textContent = `session ${this.buffer.sessionId.slice(0, 8)} · ${currentGridPreset()} block`
            + (this.resumed ? ' · resumed' : '');
        this.ui.slices.value = String(this.settings.sliceCount);
        this.ui.frames.value = String(this.settings.frameCount);
        this.ui.stride.value = String(this.settings.tickStride);

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
     * Ask the scheduler for the next round, seed the worlds it names, then probe each so a scenario
     * guess is ready before the owner ever looks at the card.
     */
    async _startRound() {
        if (this.busy) return;
        this.busy = true;
        this._setStatus('Planning round…');
        try {
            // The overlay mounts as soon as its module loads, which can be before the workers finish
            // booting. A RUN_EVALUATION that reaches a worker without a live Wasm world is dropped
            // without a reply, so probing early hangs the round rather than failing it.
            await this._awaitWorldsReady();
            this.wm._setAllWorldsEnabledForExplore(true);

            this.plan = planRound({
                coverage: this.buffer.coverage(),
                familyRegistry: this.buffer.familyRegistry(),
                worldCount: Math.min(9, this.wm.worlds.length),
                activeGridPreset: currentGridPreset(),
            }, {
                rulesetService: this.wm.rulesetService,
                libraryInitialStateFor: (hex) => this._libraryInitialStateFor(hex),
            });

            this.queue = this.plan.slots.map((slot) => {
                this.wm._applyExploreRuleset(slot.worldIndex, slot.rulesetHex);
                this.wm.worldSettings[slot.worldIndex].initialState = slot.ic.initialState;
                this.wm.worlds[slot.worldIndex].resetWorld(slot.ic.initialState, slot.seed);
                return { ...slot, guess: { scenario: 'unknown', confidence: 'low' } };
            });
            this.cursor = 0;
            this.override = null;
            this.roundIndex++;
            this._selectCurrentWorld();

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
            .find((r) => String(r?.hex || '').toUpperCase() === String(anchorHex).toUpperCase());
        return entry?.initialState || null;
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
            this._setStatus('Pick a scenario (1–9, 0 = other) before labeling — unknown clips fail the audit.');
            return;
        }
        this.busy = true;
        try {
            const { clips } = await this.capture.captureJudgedWorld(item.worldIndex, {
                label,
                scenario,
                family: item.family.familyId,
                sessionId: this.buffer.sessionId,
                ...this.settings,
            });
            this.buffer.add(clips, {
                familyId: item.family.familyId,
                anchorRuleset: item.family.anchorRuleset,
                relationship: item.family.relationship,
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
            return false;
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
            this._update();
            return false;
        }
        // A finished session must not leave a handoff behind for the next `?corpus=1` visit to adopt.
        if (final) PersistenceService.saveUISetting(HANDOFF_KEY, null);
        this._update();
        return true;
    }

    /**
     * Move the session to the next under-filled grid-preset block.
     *
     * Grid size is only changeable through a page reload — it rebuilds the renderer buffers and all
     * nine workers — so a block change is unavoidably: write what is buffered, persist the coverage
     * tallies, then reload into the new size. The clips already downloaded stay valid; the auditor
     * concatenates the parts.
     */
    _switchGridBlock() {
        const target = this.plan?.gridSwitch;
        if (!target) return;
        const rows = Config.GRID_SIZE_PRESETS[target.preset];
        if (!rows) {
            this._setStatus(`Unknown grid preset "${target.preset}".`);
            return;
        }
        if (this.buffer.clipCount && !this._flush(false)) {
            this._setStatus('Not switching blocks — the partial ZIP failed to write.');
            return;
        }
        this.busy = true;
        this._persistHandoff();
        PersistenceService.saveUISetting('gridRows', rows);
        this._setStatus(`Switching to the ${target.preset} block — reloading…`);
        this._update();
        setTimeout(() => window.location.reload(), GRID_SWITCH_RELOAD_DELAY_MS);
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
            case 'grid-switch': this._switchGridBlock(); break;
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
        else if (/^[0-9]$/.test(event.key)) {
            // 1–9 are the nine behaviour classes in protocol order; 0 is `other`, which the audit's
            // requireEveryScenario check demands a clip of just like the rest.
            const index = event.key === '0' ? SCENARIO_KEYS.length - 1 : Number(event.key) - 1;
            const scenario = SCENARIO_KEYS[index];
            if (!scenario) return;
            this.override = scenario;
            this._update();
        } else return;
        event.preventDefault();
    }

    // --- rendering -------------------------------------------------------------------------------

    _renderScenarioChips() {
        this.ui.chips.innerHTML = SCENARIO_KEYS.map((scenario, index) => `
            <button type="button" class="corpus-chip" data-scenario="${scenario}">
                <kbd>${index === SCENARIO_KEYS.length - 1 ? 0 : index + 1}</kbd>${scenario.replaceAll('_', ' ')}
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

        this.ui.planKind.textContent = this.plan ? this.plan.kind : 'planning';
        this.ui.planKind.dataset.kind = this.plan?.kind || '';
        this.ui.planReason.textContent = this.plan?.reason || '';

        this.ui.family.textContent = item ? item.family.familyId : '—';
        this.ui.origin.textContent = item
            ? `${item.revisit ? 'revisit' : (item.libraryName || item.origin)} · round ${this.roundIndex}`
            : '';

        if (item) {
            this.ui.ruleName.textContent = rulesetName(item.rulesetHex);
            this.ui.hex.textContent = item.rulesetHex;
            const badge = constraintBadge(item.rulesetHex);
            this.ui.cls.className = badge ? `corpus-class constraint-badge constraint-${badge.cls}` : 'corpus-class';
            this.ui.cls.textContent = badge ? badge.label : '';
            const distance = item.revisit
                ? 'revisit'
                : item.member.isAnchor ? 'anchor' : `mutant @ ${item.member.mutationRate}`;
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

        const gridSwitch = this.plan?.gridSwitch;
        this.ui.gridSwitch.hidden = !gridSwitch;
        if (gridSwitch) {
            this.ui.gridSwitch.textContent =
                `Start ${gridSwitch.preset} block (${gridSwitch.have}/${gridSwitch.need}) — writes a part, reloads`;
        }

        this._renderCoverage();
    }

    /**
     * The live distance to a passing `hexlife-corpus-audit --strict`.
     *
     * Rendered as the auditor's own per-cell checks rather than friendlier totals: a per-class
     * symmetry tally hides a missing label, and a per-ruleset quota hides that the minimum applies to
     * every ruleset. The point of the readout is to be un-fool-able.
     *
     * Re-audited on every judgment rather than reusing `plan.status`: the plan's copy was taken before
     * the round started, so mid-round it reports the debt the *previous* round left — which reads as
     * the tool making no progress. `auditStatus` is pure over the tallies, so this is cheap.
     */
    _renderCoverage() {
        const coverage = this.buffer.coverage();
        const status = auditStatus(coverage, this.buffer.familyRegistry());
        const labeled = CORPUS_LABELS.reduce((sum, label) => sum + (coverage.labels[label] || 0), 0);
        const activePreset = currentGridPreset();
        const debtRulesets = status.rulesetGaps.length;

        const tally = (label, value, ok) =>
            `<span class="corpus-tally${ok ? ' ok' : ' empty'}">${label} <b>${value}</b></span>`;

        this.ui.coverage.innerHTML = `
            <div class="corpus-coverage-row">
                <strong>${labeled}</strong>
                <span>/ ${CORPUS_COVERAGE.minimumLabeledClips} clips</span>
                <strong>${coverage.families}</strong>
                <span>/ ${FAMILY_TARGET} families</span>
                <strong>${(this.buffer.totalBytes / 1024 / 1024).toFixed(1)} MB</strong>
                <span>buffered · ${this.settings.sliceCount} clips per judgment</span>
            </div>
            <div class="corpus-coverage-row">
                <span>labels ${JSON.stringify(coverage.labels)}</span>
                <span>coverage-eligible ${coverage.coverageEligibleClips}</span>
            </div>
            <div class="corpus-coverage-row">
                ${CORPUS_SYMMETRY_CLASSES.map((cls) => {
                    const cells = coverage.symmetryLabelCells[cls] || {};
                    const interesting = cells.interesting || 0;
                    const boring = cells.boring || 0;
                    return tally(cls, `${interesting}i/${boring}b`, interesting > 0 && boring > 0);
                }).join('')}
            </div>
            <div class="corpus-coverage-row">
                ${SCENARIO_KEYS.map((scenario) =>
                    tally(scenario.replaceAll('_', ' '), coverage.scenarios[scenario] || 0,
                        (coverage.scenarios[scenario] || 0) > 0)).join('')}
            </div>
            <div class="corpus-coverage-row">
                ${CORPUS_GRID_PRESETS.map((preset) => {
                    const have = coverage.gridPresets[preset] || 0;
                    const active = preset === activePreset ? '<em> live</em>' : '';
                    return `<span class="corpus-tally${have >= CORPUS_COVERAGE.minimumClipsPerGridPreset ? ' ok' : ' empty'}">`
                        + `${preset} <b>${have}</b>/${CORPUS_COVERAGE.minimumClipsPerGridPreset}${active}</span>`;
                }).join('')}
            </div>
            <div class="corpus-coverage-row">
                ${tally('rulesets owing seeds/ICs', debtRulesets, debtRulesets === 0)}
                <span>${coverage.rulesetsWithThreeSeeds}/${coverage.distinctRulesets} at ${CORPUS_COVERAGE.minimumSeedsPerRuleset}+ seeds</span>
                <span>${coverage.rulesetsWithTwoInitialConditions}/${coverage.distinctRulesets} at ${CORPUS_COVERAGE.minimumInitialConditionsPerRuleset}+ ICs</span>
            </div>
        `;

        const deficits = status.deficits;
        this.ui.deficitCount.textContent = status.passing
            ? '— none, coverage passes'
            : `— ${deficits.length}`;
        // Per-ruleset lines dominate the list early on; showing the head plus a count keeps the panel
        // readable without hiding the fact that hundreds remain.
        const shown = deficits.slice(0, 40);
        this.ui.deficitList.innerHTML = shown.map((line) => `<li>${line}</li>`).join('')
            + (deficits.length > shown.length ? `<li>… ${deficits.length - shown.length} more</li>` : '');
    }
}
