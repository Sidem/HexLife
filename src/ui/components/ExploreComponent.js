import { BaseComponent } from './BaseComponent.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import * as Config from '../../core/config.js';
import { EXPLORE_CONFIG, IC_SUITE, POPULATION_MIN, POPULATION_MAX } from '../../core/AutoExploreService.js';
import { ShareCodec } from '../../services/ShareCodec.js';
import { downloadFile } from '../../utils/utils.js';
import { decodePack } from '../../services/LibraryPackCodec.js';
import { ICONS } from '../icons.js';
import { constraintBadge } from '../RulesetDisplayFactory.js';
import { COMPONENT_META, UNIFORM_FACTOR_META } from './scoringTermMeta.js';
import { ExploreScoringPanel } from './ExploreScoringPanel.js';
import { ExploreRaterView } from './ExploreRaterView.js';
import { PredictionDeck, PREDICTION_MODE_ENABLED } from './PredictionDeck.js';
import { VoteBank } from '../../core/analysis/VoteBank.js';
import { WEIGHT_KEYS, SCORING_PRESETS, sanitizeScoring } from '../../core/analysis/ScoringPresets.js';

/**
 * Phase 6 UI for the auto-explore feature (the dual-surface "Explore" panel: desktop popout/panel +
 * mobile sheet, same shared-component pattern as Patterns/Ruleset Actions). It owns three things:
 *   1. Run controls — start/stop/adopt, mutation rate + mode, ticks-per-eval, IC-suite toggles.
 *   2. A live status line driven by EXPLORE_PROGRESS (state, generation, current best score).
 *   3. The session gallery / leaderboard — best-first finds with a per-component score breakdown
 *      (the debug surface) and apply / save-to-library / share actions per find.
 *
 * All state mutation goes through COMMAND_* events; the component reads status from the
 * AutoExploreService snapshot ({@link AutoExploreService.getStatus}) so it renders correctly when
 * mounted mid-run.
 */

const SETTING_KEYS = {
    rate: 'exploreMutationRatePct',
    mode: 'exploreMutationMode',
    ticks: 'exploreEvalTicks',
    population: 'explorePopulationSize',
    icLabels: 'exploreICLabels',
    maxGenerations: 'exploreMaxGenerations',
    scoring: 'exploreScoring',
    scoringOpen: 'exploreScoringOpen',
    activeTab: 'exploreActiveTab',
    objective: 'exploreObjective',
    nativeFrames: 'nativeTrajectoryFrames',
    nativeStride: 'nativeTrajectoryStride',
};

const NATIVE_STATUS_TEXT = {
    disabled: 'Native beta is off. Statistical screening remains available.',
    loading: 'Loading the local native trajectory model…',
    ready: 'Native trajectory model ready.',
    error: 'Native beta is unavailable. Runs fall back to confirmed statistics.',
};

const MAX_GALLERY_RENDER = 40;

/** Population presets (multiples of 9 keep the per-worker queues balanced; any int in range is valid). */
const POPULATION_OPTIONS = [9, 18, 27, 36, 54, 72, 108, 144];

export class ExploreComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options);
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.service = this.worldManager.autoExploreService;
        this.sliders = {};
        // Swipe-to-judge vote bank (§S): shared by the desktop rater and the Scoring panel's refit.
        this.voteBank = new VoteBank();
        this._consumeSharedSearch();
        this.element = document.createElement('div');
        this.element.className = 'explore-component-content';
        this.render();
        this.attachEventListeners();
        this._syncFromStatus();
        this._renderGallery();
    }

    getElement() {
        return this.element;
    }

    refresh() {
        // The shared component moves between desktop and mobile, so re-read the active tab on mount.
        this._selectTab(PersistenceService.loadUISetting(SETTING_KEYS.activeTab, 'setup'), false);
        this._mountPredictionDeck();
        this._syncFromStatus();
        this._renderGallery();
    }

    /**
     * Create the Prediction deck (#19) the first time this component is actually mounted on a
     * surface. It is deliberately NOT built in the constructor: the component is constructed eagerly
     * at startup (UIManager's shared-singleton table) and dealing a card borrows a scratch world for
     * a 600-tick burst, which must not happen behind a panel nobody has opened. Once built it lives
     * with the component and travels with it between Discover and the desktop panel.
     *
     * Gated on `PREDICTION_MODE_ENABLED`, which is currently **false** — the deck is switched off
     * rather than reverted (rationale on the flag). Off means never constructed: an empty mount div
     * renders nothing and no round is ever baked.
     */
    _mountPredictionDeck() {
        if (!PREDICTION_MODE_ENABLED || this.predictionDeck) return;
        const mount = this.element.querySelector('#explore-prediction-mount');
        if (!mount) return;
        this.predictionDeck = new PredictionDeck(mount, { worldManager: this.worldManager });
    }

    /**
     * Consume a shared search link (?xs=…&xc=…, parsed into sharedSettings.exploreSearch): prefill
     * the persisted search settings from the link's config so render() picks them up, and stash the
     * base seed so the next Start replays the identical trajectory. One-shot: cleared on Start.
     */
    _consumeSharedSearch() {
        const shared = this.worldManager.sharedSettings?.exploreSearch || null;
        this._pendingBaseSeed = null;
        if (!shared || !Number.isFinite(shared.baseSeed)) return;
        this._pendingBaseSeed = Math.floor(shared.baseSeed);
        const cfg = shared.config || {};
        if (typeof cfg.mutationRate === 'number') PersistenceService.saveUISetting(SETTING_KEYS.rate, Math.round(cfg.mutationRate * 100));
        if (typeof cfg.mutationMode === 'string') PersistenceService.saveUISetting(SETTING_KEYS.mode, cfg.mutationMode);
        if (typeof cfg.evalTicks === 'number') PersistenceService.saveUISetting(SETTING_KEYS.ticks, cfg.evalTicks);
        // Population size shapes the trajectory (Stage 2). Adopt it only when it's a valid integer in
        // range; drop silently otherwise so a malformed link can't wedge the search at a bad size.
        if (Number.isInteger(cfg.populationSize) && cfg.populationSize >= POPULATION_MIN && cfg.populationSize <= POPULATION_MAX) {
            PersistenceService.saveUISetting(SETTING_KEYS.population, cfg.populationSize);
        }
        if (typeof cfg.maxGenerations === 'number') PersistenceService.saveUISetting(SETTING_KEYS.maxGenerations, cfg.maxGenerations);
        if (Array.isArray(cfg.icLabels) && cfg.icLabels.length > 0) PersistenceService.saveUISetting(SETTING_KEYS.icLabels, cfg.icLabels);
        if (cfg.objective === 'statistical' || cfg.objective === 'native-beta') {
            PersistenceService.saveUISetting(SETTING_KEYS.objective, cfg.objective);
        }
        // v3.1: a shared search may carry custom scoring (weights/penalty) and a find threshold —
        // both shape the trajectory, so a faithful replay must adopt them. Sanitized (untrusted URL).
        if (cfg.scoring || Number.isFinite(cfg.findThreshold)) {
            PersistenceService.saveUISetting(SETTING_KEYS.scoring, sanitizeScoring({
                ...(cfg.scoring || {}),
                findThreshold: Number.isFinite(cfg.findThreshold) ? cfg.findThreshold : cfg.scoring?.findThreshold,
            }));
        }
        // Deferred so the toast lands after the UI (incl. ToastManager) has finished booting.
        setTimeout(() => {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                message: 'Shared search loaded — open Auto-Explore and press Start to replay it.',
                type: 'info',
                duration: 6000,
            });
        }, 1200);
    }

    render() {
        const ratePct = PersistenceService.loadUISetting(SETTING_KEYS.rate, Math.round(EXPLORE_CONFIG.mutationRate * 100));
        const mode = PersistenceService.loadUISetting(SETTING_KEYS.mode, EXPLORE_CONFIG.mutationMode);
        const ticks = PersistenceService.loadUISetting(SETTING_KEYS.ticks, EXPLORE_CONFIG.evalTicks);
        const populationSize = this._sanitizePopulation(
            PersistenceService.loadUISetting(SETTING_KEYS.population, EXPLORE_CONFIG.populationSize),
        );
        // Offer the presets, plus the current value if a share link brought a non-preset size in-range.
        const popValues = POPULATION_OPTIONS.includes(populationSize)
            ? POPULATION_OPTIONS
            : [...POPULATION_OPTIONS, populationSize].sort((a, b) => a - b);
        const icLabels = PersistenceService.loadUISetting(SETTING_KEYS.icLabels, IC_SUITE.map(ic => ic.label));
        const maxGenerations = PersistenceService.loadUISetting(SETTING_KEYS.maxGenerations, EXPLORE_CONFIG.maxGenerations);
        const scoringOpen = !!PersistenceService.loadUISetting(SETTING_KEYS.scoringOpen, false);
        const activeTab = PersistenceService.loadUISetting(SETTING_KEYS.activeTab, 'setup');
        const objective = PersistenceService.loadUISetting(SETTING_KEYS.objective, 'native-beta');
        const nativeStatus = this.worldManager.nativeTrajectoryModelService?.getStatus?.() || {
            enabled: false, status: 'disabled', message: null, modelId: null, backend: null, acceptanceStatus: null,
        };
        const nativeFrames = Math.max(1, Math.min(32, Math.trunc(
            Number(PersistenceService.loadUISetting(SETTING_KEYS.nativeFrames, 32)) || 32,
        )));
        const nativeStride = Math.max(1, Math.min(8, Math.trunc(
            Number(PersistenceService.loadUISetting(SETTING_KEYS.nativeStride, EXPLORE_CONFIG.nativeTickStride))
                || EXPLORE_CONFIG.nativeTickStride,
        )));

        this.element.innerHTML = `
            <div class="tool-group explore-intro">
                <p class="explore-blurb">Let the Explorer hunt for you. It runs candidate rulesets across all nine worlds and keeps the ones that look alive — finds collect in the gallery below.</p>
            </div>
            <div class="tool-group">
                ${this._pendingBaseSeed != null ? `
                <div class="explore-shared-banner" id="explore-shared-banner">
                    <span class="inline-icon">${ICONS.share}</span>
                    <span>Shared search loaded (seed ${this._pendingBaseSeed}) — press <strong>Find me something interesting</strong> to replay it exactly.</span>
                </div>` : ''}
                <div class="explore-status" id="explore-status">
                    <span class="explore-status-state" data-field="state">Idle</span>
                    <span class="explore-status-detail" data-field="detail"></span>
                    <button class="button-icon explore-share-search" data-action="copy-search-link" title="Copy a link that replays this search exactly (same seed, same finds)" aria-label="Copy search link">${ICONS.share}</button>
                </div>
                <div class="form-group-buttons explore-run-buttons">
                    <button class="button action-button explore-primary-action" data-action="start" title="Search all nine worlds for interesting rulesets"><span class="inline-icon">${ICONS.compass}</span> <span data-field="start-label">Find me something interesting</span></button>
                    <button class="button explore-run-secondary" data-action="pause" disabled title="Pause/resume the search at the next generation boundary">Pause</button>
                    <button class="button explore-run-secondary" data-action="stop" disabled>Stop</button>
                    <button class="button explore-run-secondary" data-action="adopt" disabled title="Stop and keep the current champion ruleset in the selected world">Stop &amp; Keep</button>
                </div>
            </div>
            <!-- #19 Prediction mode mounts lazily because dealing a card borrows a scratch world.
                 CURRENTLY INERT — PREDICTION_MODE_ENABLED is false.
                 NB no backticks in this comment: it lives inside a template literal, where one
                 would close the string and take the whole render template with it. -->
            <div id="explore-prediction-mount"></div>
            <div class="explore-tabs" role="tablist" aria-label="Auto-Explore sections">
                ${['setup', 'objective', 'finds'].map((tab) => `<button type="button" class="explore-tab" role="tab" id="explore-tab-${tab}" data-tab="${tab}" aria-controls="explore-panel-${tab}" aria-selected="${activeTab === tab}" tabindex="${activeTab === tab ? '0' : '-1'}">${tab[0].toUpperCase()}${tab.slice(1)}</button>`).join('')}
            </div>
            <section class="explore-tab-panel" role="tabpanel" id="explore-panel-setup" aria-labelledby="explore-tab-setup" ${activeTab === 'setup' ? '' : 'hidden'}>
                <p class="explore-blurb">Configure mutation, population, initial conditions, evaluation length, and budget.</p>
            <div class="tool-group explore-settings" id="explore-settings">
                <h5>Setup</h5>
                <div class="form-group" id="explore-mutation-rate-mount"></div>
                <div class="form-group" id="explore-mutation-mode-mount"></div>
                <div class="form-group" id="explore-eval-ticks-mount"></div>
                <div class="form-group explore-population-field">
                    <label class="explore-field-label" for="explore-population">Population <span class="explore-field-hint">candidates / generation</span></label>
                    <select id="explore-population" class="explore-population-select" title="How many candidate rulesets to evaluate each generation. They time-share the 9 worlds (candidate c runs on world c mod 9); larger populations search harder but take longer per generation. 9 matches the classic one-per-world behaviour.">
                        ${popValues.map(v => `<option value="${v}" ${v === populationSize ? 'selected' : ''}>${v}${v === EXPLORE_CONFIG.populationSize ? ' (one per world)' : ''}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group explore-ic-toggles">
                    <label class="explore-field-label">Initial Conditions</label>
                    <div class="explore-ic-checkboxes">
                        ${IC_SUITE.map(ic => `
                            <label class="explore-ic-checkbox">
                                <input type="checkbox" data-ic-label="${ic.label}" ${icLabels.includes(ic.label) ? 'checked' : ''}>
                                <span>${ic.label}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div class="form-group explore-budget-field">
                    <label class="explore-field-label" for="explore-max-generations">Generation Budget <span class="explore-field-hint">(0 = unlimited)</span></label>
                    <input type="number" id="explore-max-generations" class="explore-budget-input" min="0" max="10000" step="1" value="${maxGenerations}">
                </div>
            </div>
            </section>
            <section class="explore-tab-panel" role="tabpanel" id="explore-panel-objective" aria-labelledby="explore-tab-objective" ${activeTab === 'objective' ? '' : 'hidden'}>
                <div class="tool-group explore-objective-choices">
                    <h5>Objective</h5>
                    <label class="explore-objective-choice"><input type="radio" name="explore-objective" value="native-beta" ${objective !== 'statistical' ? 'checked' : ''}> <strong>Native beta</strong> <small>Calibrated learned ranking; falls back safely to statistics.</small></label>
                    <label class="explore-objective-choice"><input type="radio" name="explore-objective" value="statistical" ${objective === 'statistical' ? 'checked' : ''}> <strong>Statistical only</strong> <small>Deterministic model-free baseline.</small></label>
                </div>
                <div class="form-group explore-native-field">
                    <div class="explore-native-heading">
                        <strong>Model status</strong>
                        <span class="explore-field-hint">beta · 32-D trajectory descriptor</span>
                    </div>
                    <div class="explore-native-status" id="explore-native-status" data-status="${nativeStatus.status}">
                        ${this._escape(this._nativeStatusText(nativeStatus))}
                    </div>
                    <details class="explore-model-tools" id="explore-model-tools">
                    <summary>Model Tools</summary>
                    <div class="explore-native-capture-grid">
                        <label>
                            <span>Frames</span>
                            <select id="explore-native-frames">
                                ${[1, 2, 4, 8, 16, 32].map((value) => `<option value="${value}" ${value === nativeFrames ? 'selected' : ''}>${value}</option>`).join('')}
                            </select>
                        </label>
                        <label>
                            <span>Tick stride</span>
                            <input type="number" id="explore-native-stride" min="1" max="8" step="1" value="${nativeStride}">
                        </label>
                    </div>
                    <div class="form-group-buttons explore-native-actions">
                        <button class="button" data-action="export-training-slice" title="Capture exact bit-packed states without advancing the selected world">Export selected</button>
                        <button class="button" data-action="evaluate-native" ${nativeStatus.status === 'ready' ? '' : 'disabled'} title="Evaluate one clip using the selected frame count and tick stride">Evaluate selected</button>
                    </div>
                    <div class="explore-field-hint">Both tools capture exact HXLT1 states and restore the selected world exactly.</div>
                    </details>
                </div>
            <details class="tool-group explore-scoring-group" id="explore-scoring-group" ${scoringOpen ? 'open' : ''}>
                <summary class="explore-scoring-summary">
                    <h5>Scoring <span class="explore-scoring-preset-chip" data-field="preset-chip"></span></h5>
                </summary>
                <div id="explore-scoring-mount"></div>
            </details>
            </section>
            <section class="explore-tab-panel" role="tabpanel" id="explore-panel-finds" aria-labelledby="explore-tab-finds" ${activeTab === 'finds' ? '' : 'hidden'}>
            <div class="tool-group explore-gallery-group">
                <div class="explore-gallery-header">
                    <h5>Gallery / Leaderboard <span class="explore-gallery-count" data-field="count">(0)</span></h5>
                    <div class="explore-gallery-actions">
                        <button class="button-icon" data-action="rate-finds" title="Rate finds head-to-head to teach the objective what you find interesting" aria-label="Rate finds">${ICONS.scale}</button>
                        <button class="button-icon" data-action="export-gallery" title="Export the gallery finds as a shareable pack file" aria-label="Export gallery to a pack file">${ICONS.download}</button>
                        <button class="button-icon" data-action="import-gallery" title="Import gallery finds from a pack file" aria-label="Import gallery finds from a pack file">${ICONS.upload}</button>
                        <button class="button-icon" data-action="clear-gallery" title="Clear the session gallery" aria-label="Clear the session gallery">${ICONS.trash}</button>
                    </div>
                </div>
                <input type="file" class="explore-import-input" accept="application/json,.json" hidden aria-hidden="true" />
                <div id="explore-rater-mount" class="explore-rater" hidden></div>
                <div id="explore-gallery-list" class="explore-gallery-list"></div>
            </div>
            </section>
        `;

        this.statusEl = this.element.querySelector('#explore-status');
        this.settingsEl = this.element.querySelector('#explore-settings');
        this.tabButtons = Array.from(this.element.querySelectorAll('[role="tab"][data-tab]'));
        this.tabPanels = Array.from(this.element.querySelectorAll('[role="tabpanel"]'));
        this.galleryGroup = this.element.querySelector('.explore-gallery-group');
        this.galleryList = this.element.querySelector('#explore-gallery-list');
        this.raterMount = this.element.querySelector('#explore-rater-mount');
        this.runButtons = {
            start: this.element.querySelector('[data-action="start"]'),
            pause: this.element.querySelector('[data-action="pause"]'),
            stop: this.element.querySelector('[data-action="stop"]'),
            adopt: this.element.querySelector('[data-action="adopt"]'),
        };
        this.budgetInput = this.element.querySelector('#explore-max-generations');
        this.populationSelect = this.element.querySelector('#explore-population');
        this.objectiveRadios = Array.from(this.element.querySelectorAll('input[name="explore-objective"]'));
        this.nativeStatusEl = this.element.querySelector('#explore-native-status');
        this.nativeFramesSelect = this.element.querySelector('#explore-native-frames');
        this.nativeStrideInput = this.element.querySelector('#explore-native-stride');
        this.nativeExportButton = this.element.querySelector('[data-action="export-training-slice"]');
        this.nativeEvaluateButton = this.element.querySelector('[data-action="evaluate-native"]');
        this.scoringGroup = this.element.querySelector('#explore-scoring-group');

        // Scoring panel (v3.1): user-customizable objective. The summary chip mirrors the active
        // preset; explainer curve markers follow the current best find's measured raw metrics.
        this.scoringPanel = new ExploreScoringPanel(this.element.querySelector('#explore-scoring-mount'), {
            onChange: (_scoring, presetKey) => this._updatePresetChip(presetKey),
            voteBank: this.voteBank,
        });
        this._updatePresetChip(this.scoringPanel.getPresetKey());

        this.sliders.rate = new SliderComponent(this.element.querySelector('#explore-mutation-rate-mount'), {
            id: 'explore-mutation-rate',
            label: 'Mutation Rate:',
            min: 1, max: 50, step: 1, unit: '%',
            value: ratePct,
            showValue: true,
            onChange: (v) => PersistenceService.saveUISetting(SETTING_KEYS.rate, v),
        });

        new SwitchComponent(this.element.querySelector('#explore-mutation-mode-mount'), {
            type: 'radio',
            name: 'explore-mutation-mode',
            label: 'Mutation Mode:',
            initialValue: mode,
            items: [
                { value: 'single', text: 'Single' },
                { value: 'r_sym', text: 'R-Sym' },
                { value: 'd_sym', text: 'D-Sym' },
                { value: 'n_count', text: 'N-Count' },
                { value: 'totalistic', text: 'Totalistic' },
            ],
            onChange: (v) => PersistenceService.saveUISetting(SETTING_KEYS.mode, v),
        });

        this.sliders.ticks = new SliderComponent(this.element.querySelector('#explore-eval-ticks-mount'), {
            id: 'explore-eval-ticks',
            label: 'Ticks / Evaluation:',
            min: 40, max: 5000, step: 20,
            value: ticks,
            showValue: true,
            onChange: (v) => PersistenceService.saveUISetting(SETTING_KEYS.ticks, v),
        });
    }

    attachEventListeners() {
        this._addDOMListener(this.runButtons.start, 'click', () => this._startExploration());
        this._addDOMListener(this.runButtons.pause, 'click', () => this._togglePause());
        this._addDOMListener(this.runButtons.stop, 'click', () => EventBus.dispatch(EVENTS.COMMAND_STOP_AUTO_EXPLORE, {}));
        this._addDOMListener(this.runButtons.adopt, 'click', () => EventBus.dispatch(EVENTS.COMMAND_STOP_AUTO_EXPLORE, { adopt: true }));

        if (this.budgetInput) {
            this._addDOMListener(this.budgetInput, 'change', () => {
                const v = Math.max(0, Math.floor(Number(this.budgetInput.value) || 0));
                this.budgetInput.value = v;
                PersistenceService.saveUISetting(SETTING_KEYS.maxGenerations, v);
            });
        }

        if (this.populationSelect) {
            this._addDOMListener(this.populationSelect, 'change', () => {
                PersistenceService.saveUISetting(SETTING_KEYS.population, this._sanitizePopulation(this.populationSelect.value));
            });
        }

        this._addDOMListener(this.element.querySelector('[data-action="copy-search-link"]'), 'click', () => this._copySearchLink());

        this._addDOMListener(this.element.querySelector('[data-action="clear-gallery"]'), 'click', () => {
            if (this.service.getGalleryEntries().length === 0) return;
            EventBus.dispatch(EVENTS.COMMAND_SHOW_CONFIRMATION, {
                title: 'Clear Gallery',
                message: 'Permanently clear all saved auto-explore finds?',
                confirmLabel: 'Clear',
                onConfirm: () => EventBus.dispatch(EVENTS.COMMAND_CLEAR_AUTO_EXPLORE_GALLERY),
            });
        });

        this._addDOMListener(this.element.querySelector('[data-action="rate-finds"]'), 'click', () => this._toggleRating());

        this._addDOMListener(this.element.querySelector('[data-action="export-gallery"]'), 'click', () => this._exportGallery());
        this._addDOMListener(this.element.querySelector('[data-action="import-gallery"]'), 'click', () => {
            this.element.querySelector('.explore-import-input')?.click();
        });
        this._addDOMListener(this.element.querySelector('.explore-import-input'), 'change', (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (file) this._handleImportFile(file);
        });

        // Persist IC-suite toggles as they change (read live at start time).
        this._addDOMListener(this.element.querySelector('.explore-ic-checkboxes'), 'change', () => {
            PersistenceService.saveUISetting(SETTING_KEYS.icLabels, this._readICLabels());
        });

        this.tabButtons.forEach((button) => {
            this._addDOMListener(button, 'click', () => this._selectTab(button.dataset.tab));
            this._addDOMListener(button, 'keydown', (event) => this._onTabKeydown(event));
        });
        this.objectiveRadios.forEach((radio) => {
            this._addDOMListener(radio, 'change', () => {
                if (!radio.checked) return;
                PersistenceService.saveUISetting(SETTING_KEYS.objective, radio.value);
                EventBus.dispatch(EVENTS.COMMAND_SET_NATIVE_MODEL_ENABLED, {
                    enabled: radio.value !== 'statistical',
                });
            });
        });
        if (this.nativeFramesSelect) {
            this._addDOMListener(this.nativeFramesSelect, 'change', () => {
                PersistenceService.saveUISetting(SETTING_KEYS.nativeFrames, Number(this.nativeFramesSelect.value));
            });
        }
        if (this.nativeStrideInput) {
            this._addDOMListener(this.nativeStrideInput, 'change', () => {
                const stride = Math.max(1, Math.min(8, Math.trunc(
                    Number(this.nativeStrideInput.value) || EXPLORE_CONFIG.nativeTickStride,
                )));
                this.nativeStrideInput.value = stride;
                PersistenceService.saveUISetting(SETTING_KEYS.nativeStride, stride);
            });
        }
        this._addDOMListener(this.nativeExportButton, 'click', () => {
            const options = this._nativeCaptureOptions();
            if (options) EventBus.dispatch(EVENTS.COMMAND_CAPTURE_TRAINING_SLICE, options);
        });
        this._addDOMListener(this.nativeEvaluateButton, 'click', () => {
            const options = this._nativeCaptureOptions();
            if (options) EventBus.dispatch(EVENTS.COMMAND_EVALUATE_NATIVE_MODEL, options);
        });

        if (this.scoringGroup) {
            this._addDOMListener(this.scoringGroup, 'toggle', () => {
                PersistenceService.saveUISetting(SETTING_KEYS.scoringOpen, this.scoringGroup.open);
            });
        }

        this._addDOMListener(this.galleryList, 'click', (e) => this._onGalleryClick(e));

        this._subscribeToEvent(EVENTS.EXPLORE_PROGRESS, this._onProgress);
        this._subscribeToEvent(EVENTS.EXPLORE_FIND_ADDED, this._onFindAdded);
        this._subscribeToEvent(EVENTS.NATIVE_MODEL_STATUS_CHANGED, this._onNativeModelStatus);
        this._subscribeToEvent(EVENTS.VOTE_RECORDED, this._onVoteRecorded);
    }

    _onVoteRecorded() {
        // Keep the Scoring panel's "Refit from my votes (N)" affordance in step with the bank.
        this.scoringPanel?.refreshRefit();
    }

    /** Enter/exit the head-to-head "Rate finds" deck (§S2 desktop surface). */
    _toggleRating() {
        if (this.rater) { this._exitRating(); return; }
        if (this.service.getGalleryEntries().filter((e) => e && e.thumb && e.perComponent).length < 2) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                message: 'Need at least two finds with previews to rate. Run a search first.',
                type: 'info',
            });
            return;
        }
        this.element.classList.add('is-rating');
        if (this.galleryList) this.galleryList.hidden = true;
        if (this.raterMount) this.raterMount.hidden = false;
        this.element.querySelector('[data-action="rate-finds"]')?.classList.add('is-active');
        this.rater = new ExploreRaterView(this.raterMount, {
            voteBank: this.voteBank,
            getCandidates: () => this.service.getGalleryEntries(),
            onExit: () => this._exitRating(),
        });
    }

    _exitRating() {
        if (this.rater) { this.rater.destroy(); this.rater = null; }
        this.element.classList.remove('is-rating');
        if (this.raterMount) this.raterMount.hidden = true;
        if (this.galleryList) this.galleryList.hidden = false;
        this.element.querySelector('[data-action="rate-finds"]')?.classList.remove('is-active');
        this._renderGallery();
    }

    _nativeStatusText(status) {
        if (status?.status === 'ready') {
            const details = [status.modelId, status.backend, status.acceptanceStatus].filter(Boolean).join(' · ');
            return `${NATIVE_STATUS_TEXT.ready}${details ? ` ${details}` : ''}`;
        }
        return status?.message || NATIVE_STATUS_TEXT[status?.status] || NATIVE_STATUS_TEXT.disabled;
    }

    _onNativeModelStatus(payload) {
        if (!payload) return;
        if (this.nativeStatusEl) {
            this.nativeStatusEl.dataset.status = payload.status || 'disabled';
            this.nativeStatusEl.textContent = this._nativeStatusText(payload);
        }
        if (this.nativeEvaluateButton) this.nativeEvaluateButton.disabled = payload.status !== 'ready';
    }

    _nativeCaptureOptions() {
        const frameCount = Math.max(1, Math.min(32, Math.trunc(Number(this.nativeFramesSelect?.value) || 32)));
        const tickStride = Math.max(1, Math.min(8, Math.trunc(
            Number(this.nativeStrideInput?.value) || EXPLORE_CONFIG.nativeTickStride,
        )));
        if ((frameCount - 1) * tickStride > 256) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                message: 'Training slice span must be 256 ticks or less.',
                type: 'error',
            });
            return null;
        }
        return {
            frameCount,
            tickStride,
        };
    }

    _updatePresetChip(presetKey) {
        const chip = this.element.querySelector('[data-field="preset-chip"]');
        if (chip) chip.textContent = presetKey === 'custom' ? 'Custom' : (SCORING_PRESETS[presetKey]?.label || '');
    }

    /** Public entry point for tours/other surfaces that need a specific tab shown. */
    selectTab(tab) {
        this._selectTab(tab);
    }

    _selectTab(tab, persist = true) {
        const valid = ['setup', 'objective', 'finds'].includes(tab) ? tab : 'setup';
        this.tabButtons?.forEach((button) => {
            const selected = button.dataset.tab === valid;
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
        });
        this.tabPanels?.forEach((panel) => {
            panel.hidden = panel.id !== `explore-panel-${valid}`;
        });
        if (persist) PersistenceService.saveUISetting(SETTING_KEYS.activeTab, valid);
    }

    _onTabKeydown(event) {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const current = this.tabButtons.indexOf(event.currentTarget);
        const last = this.tabButtons.length - 1;
        const next = event.key === 'Home' ? 0
            : event.key === 'End' ? last
                : (current + (event.key === 'ArrowRight' ? 1 : -1) + this.tabButtons.length)
                    % this.tabButtons.length;
        const button = this.tabButtons[next];
        this._selectTab(button.dataset.tab);
        button.focus();
    }

    /** Coerce any inbound population value (UI select, persisted, or share link) to an int in range. */
    _sanitizePopulation(value) {
        const n = Math.floor(Number(value));
        if (!Number.isFinite(n)) return EXPLORE_CONFIG.populationSize;
        return Math.min(POPULATION_MAX, Math.max(POPULATION_MIN, n));
    }

    _readICLabels() {
        return Array.from(this.element.querySelectorAll('[data-ic-label]'))
            .filter(cb => cb.checked)
            .map(cb => cb.dataset.icLabel);
    }

    _startExploration() {
        const icLabels = this._readICLabels();
        if (icLabels.length === 0) {
            this._selectTab('setup');
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Select at least one initial condition to explore.', type: 'error' });
            return;
        }
        // v3.1 custom objective. Weights that sum to zero over the terms a run can actually
        // measure would score every candidate 0 and bank nothing — refuse loudly instead.
        const scoring = this.scoringPanel.getScoring();
        const effectiveKeys = WEIGHT_KEYS;
        if (effectiveKeys.every((k) => (scoring.weights[k] || 0) === 0)) {
            // Reveal the controls that need attention.
            this._selectTab('objective');
            if (this.scoringGroup) this.scoringGroup.open = true;
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                message: 'All scoring weights are 0 — nothing would ever be banked. Raise at least one weight.',
                type: 'error',
            });
            return;
        }
        const payload = {
            mutationRate: this.sliders.rate.getValue() / 100,
            mutationMode: this.element.querySelector('input[name="explore-mutation-mode"]:checked')?.value || EXPLORE_CONFIG.mutationMode,
            evalTicks: this.sliders.ticks.getValue(),
            populationSize: this._sanitizePopulation(this.populationSelect?.value),
            maxGenerations: Math.max(0, Math.floor(Number(this.budgetInput?.value) || 0)),
            icLabels,
            scoring,
            findThreshold: scoring.findThreshold,
            objective: this.objectiveRadios.find((radio) => radio.checked)?.value || 'native-beta',
        };
        // One-shot replay seed from a shared search link (see _consumeSharedSearch).
        if (this._pendingBaseSeed != null) {
            payload.baseSeed = this._pendingBaseSeed;
            this._pendingBaseSeed = null;
            this.element.querySelector('#explore-shared-banner')?.remove();
        }
        EventBus.dispatch(EVENTS.COMMAND_START_AUTO_EXPLORE, payload);
    }

    /** Copy a link that replays the current (or most recent) search trajectory exactly. */
    _copySearchLink() {
        const descriptor = this.service.getSearchDescriptor();
        if (!descriptor) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Run a search first — then you can share it.', type: 'info' });
            return;
        }
        const url = ShareCodec.encodeSearch({
            ...descriptor,
            gridRows: Config.GRID_ROWS,
            origin: window.location.origin,
            pathname: window.location.pathname,
        });
        navigator.clipboard.writeText(url)
            .then(() => EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Search link copied — it replays this exact search.', type: 'success' }))
            .catch(() => EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Could not copy link.', type: 'error' }));
    }

    /** Download the session gallery as a dated pack file (no-op with a toast when it's empty). */
    _exportGallery() {
        if (this.service.getGalleryEntries().length === 0) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'No gallery finds to export yet.', type: 'info' });
            return;
        }
        const date = new Date().toISOString().slice(0, 10);
        downloadFile(`hexlife-finds-${date}.json`, this.service.exportGalleryPackJSON(), 'application/json');
    }

    /** Read + decode a chosen pack file, then confirm-gate the gallery merge and toast the result. */
    async _handleImportFile(file) {
        if (this.service.isRunning()) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Stop the run before importing finds.', type: 'error' });
            return;
        }
        let decoded;
        try {
            decoded = decodePack(await file.text());
        } catch (err) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Import failed: ${err.message}`, type: 'error' });
            return;
        }
        const finds = decoded.finds;
        if (finds.length === 0) {
            const detail = decoded.rulesets.length > 0 ? ' (this pack only contains rulesets — import it from the Ruleset Library).' : '.';
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `No importable finds in that file${detail}`, type: 'info' });
            return;
        }
        const warnLine = decoded.warnings.length ? `\n\n${decoded.warnings.length} item(s) were cleaned up on import.` : '';
        EventBus.dispatch(EVENTS.COMMAND_SHOW_CONFIRMATION, {
            title: 'Import gallery finds',
            message: `Merge ${finds.length} find(s) into your session gallery? Each is scored into the archive; better scores win their cell, near-duplicates are dropped.${warnLine}`,
            confirmLabel: 'Import',
            onConfirm: () => {
                const { added, improved, rejected } = this.service.importGalleryFinds(finds);
                const parts = [];
                if (added) parts.push(`${added} added`);
                if (improved) parts.push(`${improved} improved`);
                if (rejected) parts.push(`${rejected} skipped`);
                const msg = added || improved ? `Imported: ${parts.join(', ')}.` : `Nothing new — ${rejected} already covered.`;
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: msg, type: added || improved ? 'success' : 'info' });
            },
        });
    }

    _togglePause() {
        const state = this.service.getStatus().state;
        if (state === 'running') EventBus.dispatch(EVENTS.COMMAND_PAUSE_AUTO_EXPLORE, {});
        else if (state === 'paused') EventBus.dispatch(EVENTS.COMMAND_RESUME_AUTO_EXPLORE, {});
    }

    _onProgress(payload) {
        if (!payload) return;
        this._applyState(payload.state || 'idle', payload);
    }

    _onFindAdded() {
        this._renderGallery();
    }

    _syncFromStatus() {
        const status = this.service.getStatus();
        this._applyState(status.state, status);
    }

    _applyState(state, payload = {}) {
        const isRunning = state === 'running' || state === 'paused';
        this.element.classList.toggle('is-running', isRunning);
        this.settingsEl?.classList.toggle('disabled', isRunning);

        if (this.runButtons.start) this.runButtons.start.disabled = isRunning;
        if (this.runButtons.stop) this.runButtons.stop.disabled = !isRunning;
        if (this.runButtons.adopt) this.runButtons.adopt.disabled = !isRunning;
        if (this.runButtons.pause) {
            this.runButtons.pause.disabled = !isRunning;
            this.runButtons.pause.textContent = state === 'paused' ? 'Resume' : 'Pause';
        }
        if (this.budgetInput) this.budgetInput.disabled = isRunning;
        if (this.populationSelect) this.populationSelect.disabled = isRunning;
        this.scoringPanel?.setDisabled(isRunning);
        this.objectiveRadios?.forEach((radio) => { radio.disabled = isRunning; });
        if (this.nativeExportButton) this.nativeExportButton.disabled = isRunning;
        if (this.nativeEvaluateButton) {
            this.nativeEvaluateButton.disabled = isRunning ||
                this.worldManager.nativeTrajectoryModelService?.getStatus?.().status !== 'ready';
        }

        const stateEl = this.statusEl?.querySelector('[data-field="state"]');
        const detailEl = this.statusEl?.querySelector('[data-field="detail"]');
        if (stateEl) {
            const labels = { idle: 'Idle', running: 'Exploring…', paused: 'Paused' };
            stateEl.textContent = labels[state] || 'Idle';
            stateEl.className = `explore-status-state state-${state || 'idle'}`;
        }
        if (detailEl) {
            if (isRunning) {
                const gen = payload.generation ?? 0;
                const best = typeof payload.bestScore === 'number' ? ` · best ${payload.bestScore.toFixed(2)}` : '';
                detailEl.textContent = `gen ${gen}${best}`;
            } else {
                detailEl.textContent = '';
            }
        }
        const countEl = this.element.querySelector('[data-field="count"]');
        if (countEl) countEl.textContent = `(${payload.gallerySize ?? this.service.getGalleryEntries().length})`;
    }

    _renderGallery() {
        if (!this.galleryList) return;
        const entries = this.service.getGalleryEntries();
        const countEl = this.element.querySelector('[data-field="count"]');
        if (countEl) countEl.textContent = `(${entries.length})`;
        // Rate / export / clear act on finds that do not exist yet — with an empty gallery they are
        // three controls whose only outcome is a toast (#29). Import stays: it is how you get finds.
        this.galleryGroup?.classList.toggle('is-empty', entries.length === 0);

        if (entries.length === 0) {
            this.galleryList.innerHTML = `
                <div class="panel-empty-state">
                    <div class="panel-empty-state-icon">${ICONS.compass}</div>
                    <p class="panel-empty-state-title">No finds yet</p>
                    <p class="panel-empty-state-desc">Press <strong>Find me something interesting</strong> above to auto-search all nine worlds. The most interesting rulesets it discovers collect here, best-first.</p>
                </div>`;
            return;
        }

        const shown = entries.slice(0, MAX_GALLERY_RENDER);
        let html = shown.map((entry, i) => this._renderFind(entry, i)).join('');
        if (entries.length > shown.length) {
            html += `<p class="empty-state-text">Showing top ${shown.length} of ${entries.length} finds.</p>`;
        }
        this.galleryList.innerHTML = html;
        // Best find's measured raw metrics drive the Scoring explainer curve markers (v3.1).
        this.scoringPanel?.setMarkers(entries[0]?.rawMetrics || null);
    }

    _renderFind(entry, index) {
        const score = typeof entry.score === 'number' ? entry.score.toFixed(2) : '–';
        const name = this._escape(entry.mnemonic || entry.hex);
        const ic = this._escape(entry.icLabel || '');
        const bars = this._renderComponentBars(entry.perComponent);
        // Honest labeling (v2.4, principle 3): a confirmed long cycle is a legitimate category — tag it.
        const cyclicChip = entry.cyclic
            ? `<span class="explore-find-cyclic" title="Settles into a period-${entry.cyclic} cycle">↻${entry.cyclic}</span>`
            : '';
        // Honest labeling of the uniform-chaos penalty (v3.1): show the factor that scaled the score.
        const uf = entry.perComponent?.uniformFactor;
        const chaosChip = (entry.perComponent?.uniformUsed && typeof uf === 'number' && uf < 0.995)
            ? `<span class="explore-find-chaos" title="${this._escape(UNIFORM_FACTOR_META.hint)}">chaos ×${uf.toFixed(2)}</span>`
            : '';
        // #37 Stage 3: surface both the raw nuisance similarity and the factor that scaled confirmation.
        const modelChip = entry.nativeModelId
            ? `<span class="explore-find-model" title="Ranked by calibrated native beta reward">native beta</span>`
            : `<span class="explore-find-model" title="Native model unavailable or Statistical only selected">statistical</span>`;
        // Structural constraint class (roadmap #38), derived from the hex like it is on library cards:
        // symmetric tables are disproportionately likely to be interesting, so the class is worth
        // scanning down the leaderboard. Sits next to the name — it is a fact about the ruleset,
        // where the chips after it describe this particular run.
        const badge = constraintBadge(entry.hex);
        const constraintChip = badge
            ? `<span class="constraint-badge constraint-${badge.cls}" title="${this._escape(badge.title)}">${this._escape(badge.label)}</span>`
            : '';
        // Visual preview (v2.6, F6). v1/old entries have no `thumb` (principle 4) — show a placeholder.
        const thumb = entry.thumb
            ? `<img class="explore-find-thumb" src="${this._escape(entry.thumb)}" alt="" loading="lazy" />`
            : `<div class="explore-find-thumb explore-find-thumb--empty" title="No preview">⬡</div>`;
        return `
            <div class="explore-find" data-index="${index}">
                <div class="explore-find-row">
                    ${thumb}
                    <div class="explore-find-body">
                        <div class="explore-find-head">
                            <span class="explore-find-score" title="Interestingness score">${score}</span>
                            <span class="explore-find-name" title="${this._escape(entry.hex)}">${name}</span>
                            ${constraintChip}
                            <span class="explore-find-ic" title="Winning initial condition">${ic}</span>
                            ${cyclicChip}${chaosChip}${modelChip}
                        </div>
                        ${bars}
                        <div class="explore-find-actions">
                            <button class="button-icon" data-action="apply" title="Apply to selected world (ruleset + winning IC)" aria-label="Apply find to selected world">${ICONS.target}</button>
                            <button class="button-icon" data-action="retest" title="Re-test this find on the selected world (re-scores it)" aria-label="Re-test find">${ICONS.refreshCw}</button>
                            <button class="button-icon" data-action="save" title="Save ruleset to your library" aria-label="Save ruleset to library">${ICONS.star}</button>
                            <button class="button-icon" data-action="share" title="Copy share link" aria-label="Copy share link">${ICONS.share}</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Debug surface: per-component score breakdown. Each bar is the component's [0,1] contribution.
    _renderComponentBars(perComponent) {
        if (!perComponent) return '';
        let rows = COMPONENT_META.map(({ key, label, usedFlag, hint }) => {
            // A gated term shows "n/a" unless its flag is truthy (σ with no probe; spatial terms on
            // v1/old entries that predate them — flag absent ⇒ n/a). Ungated terms always render.
            const used = !usedFlag || !!perComponent[usedFlag];
            const val = used ? Math.max(0, Math.min(1, perComponent[key] || 0)) : 0;
            const pct = Math.round(val * 100);
            const valText = used ? val.toFixed(2) : 'n/a';
            return `
                <div class="explore-bar-row" title="${this._escape(`${label} — ${hint}`)}">
                    <span class="explore-bar-label">${label}</span>
                    <span class="explore-bar-track"><span class="explore-bar-fill" style="width:${pct}%"></span></span>
                    <span class="explore-bar-val">${valText}</span>
                </div>
            `;
        }).join('');
        // Uniform-chaos factor (v3.1): a multiplier on the whole score, not a weighted term — the
        // bar shows the factor itself (full = no penalty) and turns amber when it bit.
        if (perComponent.uniformUsed && typeof perComponent.uniformFactor === 'number') {
            const uf = Math.max(0, Math.min(1, perComponent.uniformFactor));
            const penalized = uf < 0.995;
            rows += `
                <div class="explore-bar-row" title="${this._escape(`${UNIFORM_FACTOR_META.label} — ${UNIFORM_FACTOR_META.hint}`)}">
                    <span class="explore-bar-label">${UNIFORM_FACTOR_META.label}</span>
                    <span class="explore-bar-track"><span class="explore-bar-fill${penalized ? ' explore-bar-fill--penalty' : ''}" style="width:${Math.round(uf * 100)}%"></span></span>
                    <span class="explore-bar-val">×${uf.toFixed(2)}</span>
                </div>
            `;
        }
        return `<div class="explore-find-bars">${rows}</div>`;
    }

    _onGalleryClick(e) {
        const findEl = e.target.closest('.explore-find');
        const actionBtn = e.target.closest('[data-action]');
        if (!findEl || !actionBtn) return;
        const index = parseInt(findEl.dataset.index, 10);
        const entry = this.service.getGalleryEntries()[index];
        if (!entry) return;

        const action = actionBtn.dataset.action;
        if (action === 'apply') {
            EventBus.dispatch(EVENTS.COMMAND_APPLY_EXPLORE_FIND, { find: entry });
            EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
        } else if (action === 'retest') {
            if (this.service.isRunning()) {
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Stop the run before re-testing a find.', type: 'error' });
                return;
            }
            EventBus.dispatch(EVENTS.COMMAND_RETEST_EXPLORE_FIND, { find: entry });
        } else if (action === 'save') {
            // Carry the find's paired initial condition + seed + thumbnail into the save modal so the
            // saved library entry reproduces the find's behavior via "Load + IC" with no re-baking.
            EventBus.dispatch(EVENTS.COMMAND_SHOW_SAVE_RULESET_MODAL, {
                hex: entry.hex,
                name: entry.mnemonic,
                initialState: entry.initialState || null,
                seed: entry.seed ?? null,
                thumb: entry.thumb || null,
                // Carry the find's behaviour metrics so the save modal can pre-suggest tags (§T4).
                metrics: entry.metrics || null,
                cyclic: entry.cyclic ?? null,
            });
        } else if (action === 'share') {
            const url = new URL(window.location.href);
            url.search = `?r=${entry.hex}`;
            navigator.clipboard.writeText(url.toString())
                .then(() => EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Share link copied!', type: 'success' }))
                .catch(() => EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Could not copy link.', type: 'error' }));
        }
    }

    _escape(str) {
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    destroy() {
        if (this.rater) { this.rater.destroy(); this.rater = null; }
        this.scoringPanel?.destroy?.();
        super.destroy();
    }
}
