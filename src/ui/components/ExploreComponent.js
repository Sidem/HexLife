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
import { EMBEDDING_MODELS } from '../../services/EmbeddingService.js';

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
    // #29 re-tier: the "Advanced" disclosure remembers its state per surface. Mobile Discover is a
    // newcomer tab and opens collapsed; the desktop Auto-Explore panel is reached by an explicit
    // rail icon, so it keeps the expert layout and opens expanded.
    advancedOpenMobile: 'exploreAdvancedOpenMobile',
    advancedOpenDesktop: 'exploreAdvancedOpenDesktop',
    embeddingModel: 'embeddingModelId',
    targetPrompt: 'exploreTargetPrompt',
    targetBank: 'exploreTargetBankThreshold',
};

/** Cap on the target prompt length (chars) — sanitized here and again in AutoExploreService/share links. */
const TARGET_PROMPT_MAXLEN = 200;

/** Strip control chars and clamp length from an untrusted prompt (UI input, persisted, or share link). */
function sanitizeTargetPrompt(value) {
    if (typeof value !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\u0000-\u001F\u007F]+/g, ' ').slice(0, TARGET_PROMPT_MAXLEN).trim();
}

/** Human-readable status line for the perceptual-objective toggle, keyed by EMBEDDING_STATUS. */
const EMBEDDING_STATUS_TEXT = {
    disabled: '',
    loading: 'Loading vision model… (downloads ~tens of MB once, then cached)',
    ready: 'Vision model ready — finds are also scored on perceptual novelty.',
    error: 'Vision model unavailable — using the statistical objective.',
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
        // The component is a single shared instance moved between the desktop panel and the mobile
        // Discover tab, so the Advanced tier has to be re-read on every mount (#29).
        this._setAdvancedOpen(this._loadAdvancedOpen());
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
        // v3.2 supervised target search: a shared prompt shapes the trajectory, so replay adopts it —
        // sanitized (untrusted URL: control chars stripped, length-capped). Only when non-empty.
        if (typeof cfg.targetPrompt === 'string') {
            const prompt = sanitizeTargetPrompt(cfg.targetPrompt);
            if (prompt) PersistenceService.saveUISetting(SETTING_KEYS.targetPrompt, prompt);
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
        const status = this.service.getStatus();
        const embeddingEnabled = !!status.embeddingEnabled;
        const embeddingStatus = status.embeddingStatus || 'disabled';
        const scoringOpen = !!PersistenceService.loadUISetting(SETTING_KEYS.scoringOpen, false);
        const advancedOpen = this._loadAdvancedOpen();
        const activeModelId = this.worldManager.embeddingService?.getModelId?.()
            || PersistenceService.loadUISetting(SETTING_KEYS.embeddingModel, EMBEDDING_MODELS[0].id);
        const targetPrompt = sanitizeTargetPrompt(PersistenceService.loadUISetting(SETTING_KEYS.targetPrompt, ''));
        const targetBank = this._sanitizeTargetBank(
            PersistenceService.loadUISetting(SETTING_KEYS.targetBank, EXPLORE_CONFIG.targetBankThreshold),
        );

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
            <!-- #19 Prediction mode. Newcomer tier, so by the #29 rule it lives ABOVE the Advanced
                 disclosure — the first thing a visitor meets on Discover is a question they can
                 answer, not the search's expert controls. Mounted lazily (see _mountPredictionDeck):
                 dealing a card borrows a scratch world, which must not happen on a surface the user
                 never opened. CURRENTLY INERT — PREDICTION_MODE_ENABLED is false, so this div stays
                 empty and renders nothing. The div is kept so the placement contract above the
                 disclosure survives re-enabling; tests/exploreDisclosure.test.js pins both.
                 NB no backticks in this comment: it lives inside a template literal, where one
                 would close the string and take the whole render template with it. -->
            <div id="explore-prediction-mount"></div>
            <details class="tool-group explore-advanced" id="explore-advanced" ${advancedOpen ? 'open' : ''}>
                <summary class="explore-advanced-summary">
                    <h5>Advanced <span class="explore-advanced-chip" data-field="advanced-chip"></span></h5>
                </summary>
                <p class="explore-advanced-blurb">Each generation: candidates are <strong>screened</strong> cheaply across an initial-condition suite, promising ones are <strong>confirmed</strong> with a long burst, and survivors are <strong>banked</strong> in the gallery — the best two breed the next generation. Scoring decides what "interesting" means.</p>
            <div class="tool-group explore-settings" id="explore-settings">
                <h5>Search Settings</h5>
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
                <div class="form-group explore-embedding-field">
                    <label class="explore-embedding-toggle" title="Score finds on perceptual novelty using a vision model (CLIP) embedding of their frames — ASAL-style. Optional: the model loads on demand (tens of MB, cached) and the search falls back to the statistical objective if it can't load.">
                        <input type="checkbox" id="explore-embedding-enabled" ${embeddingEnabled ? 'checked' : ''}>
                        <span>Perceptual novelty (CLIP) <span class="explore-field-hint">experimental</span></span>
                    </label>
                    <div class="explore-embedding-model" id="explore-embedding-model-field" ${embeddingEnabled ? '' : 'hidden'}>
                        <label class="explore-field-label" for="explore-embedding-model">Vision model</label>
                        <select id="explore-embedding-model" class="explore-embedding-model-select">
                            ${EMBEDDING_MODELS.map((m) => `<option value="${this._escape(m.id)}" title="${this._escape(m.detail)}" ${m.id === activeModelId ? 'selected' : ''}>${this._escape(m.label)}</option>`).join('')}
                        </select>
                        <div class="explore-field-hint explore-embedding-model-hint">${this._escape(EMBEDDING_MODELS.find((m) => m.id === activeModelId)?.detail || '')} Changing models resets the perceptual-novelty archive (different models see differently).</div>
                    </div>
                    <div class="explore-embedding-status" id="explore-embedding-status" data-status="${embeddingStatus}">${this._escape(EMBEDDING_STATUS_TEXT[embeddingStatus] || '')}</div>
                </div>
                <div class="form-group explore-target-field" id="explore-target-field">
                    <label class="explore-field-label" for="explore-target-prompt">
                        Find life that looks like…
                        <span class="explore-mode-chip" data-field="mode-chip" title="Statistical: no vision model. Open-ended: perceptual novelty. Target: evolution steered toward your prompt."></span>
                    </label>
                    <input type="text" id="explore-target-prompt" class="explore-target-input" maxlength="${TARGET_PROMPT_MAXLEN}"
                        placeholder="e.g. spirals, a maze, gliders" value="${this._escape(targetPrompt)}"
                        ${embeddingEnabled ? '' : 'disabled'}
                        title="Type what you want the search to hunt for. Evolution is steered toward frames a vision model (CLIP) reads as your prompt (ASAL supervised target search). Requires the perceptual-novelty toggle above.">
                    <div class="explore-field-hint explore-target-hint" data-field="target-hint">${embeddingEnabled
                        ? 'Steers evolution toward frames that match your prompt. Leave empty for open-ended novelty.'
                        : 'Enable “Perceptual novelty (CLIP)” above to search by prompt.'}</div>
                    <div class="explore-target-advanced" id="explore-target-advanced" ${embeddingEnabled ? '' : 'hidden'}>
                        <label class="explore-field-label" for="explore-target-bank">Match threshold <span class="explore-field-hint">bank finds with cosine ≥ this</span></label>
                        <input type="number" id="explore-target-bank" class="explore-budget-input" min="0" max="1" step="0.01" value="${targetBank}"
                            title="A target-mode find enters the gallery only when its mean frame→prompt cosine similarity reaches this. CLIP image-text similarities sit around 0.1–0.35, so 0.22 keeps the genuine matches.">
                    </div>
                </div>
            </div>
            <details class="tool-group explore-scoring-group" id="explore-scoring-group" ${scoringOpen ? 'open' : ''}>
                <summary class="explore-scoring-summary">
                    <h5>Scoring <span class="explore-scoring-preset-chip" data-field="preset-chip"></span></h5>
                </summary>
                <div id="explore-scoring-mount"></div>
            </details>
            </details><!-- /#explore-advanced: Search Settings + Scoring are its children -->
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
        `;

        this.statusEl = this.element.querySelector('#explore-status');
        this.settingsEl = this.element.querySelector('#explore-settings');
        this.advancedGroup = this.element.querySelector('#explore-advanced');
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
        this.embeddingToggle = this.element.querySelector('#explore-embedding-enabled');
        this.embeddingStatusEl = this.element.querySelector('#explore-embedding-status');
        this.embeddingModelField = this.element.querySelector('#explore-embedding-model-field');
        this.embeddingModelSelect = this.element.querySelector('#explore-embedding-model');
        this.targetInput = this.element.querySelector('#explore-target-prompt');
        this.targetBankInput = this.element.querySelector('#explore-target-bank');
        this.targetAdvanced = this.element.querySelector('#explore-target-advanced');
        this.targetHintEl = this.element.querySelector('[data-field="target-hint"]');
        this.scoringGroup = this.element.querySelector('#explore-scoring-group');
        this._updateModeChip();
        this._updateAdvancedChip();

        // Scoring panel (v3.1): user-customizable objective. The summary chip mirrors the active
        // preset; explainer curve markers follow the current best find's measured raw metrics.
        this.scoringPanel = new ExploreScoringPanel(this.element.querySelector('#explore-scoring-mount'), {
            onChange: (_scoring, presetKey) => this._updatePresetChip(presetKey),
            voteBank: this.voteBank,
        });
        this._updatePresetChip(this.scoringPanel.getPresetKey());
        this._updateAdvancedChip();

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

        if (this.targetInput) {
            // Persist + refresh the mode chip live; dispatch the command so any other surface can react.
            this._addDOMListener(this.targetInput, 'input', () => {
                const prompt = sanitizeTargetPrompt(this.targetInput.value);
                PersistenceService.saveUISetting(SETTING_KEYS.targetPrompt, prompt);
                EventBus.dispatch(EVENTS.COMMAND_SET_EXPLORE_TARGET_PROMPT, { prompt });
                this._updateModeChip();
            });
        }

        if (this.targetBankInput) {
            this._addDOMListener(this.targetBankInput, 'change', () => {
                const v = this._sanitizeTargetBank(this.targetBankInput.value);
                this.targetBankInput.value = v;
                PersistenceService.saveUISetting(SETTING_KEYS.targetBank, v);
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

        if (this.embeddingToggle) {
            this._addDOMListener(this.embeddingToggle, 'change', () => {
                EventBus.dispatch(EVENTS.COMMAND_SET_EMBEDDING_ENABLED, { enabled: this.embeddingToggle.checked });
            });
        }

        if (this.embeddingModelSelect) {
            this._addDOMListener(this.embeddingModelSelect, 'change', () => {
                const modelId = this.embeddingModelSelect.value;
                const hintEl = this.element.querySelector('.explore-embedding-model-hint');
                if (hintEl) {
                    const detail = EMBEDDING_MODELS.find((m) => m.id === modelId)?.detail || '';
                    hintEl.textContent = `${detail} Changing models resets the perceptual-novelty archive (different models see differently).`;
                }
                EventBus.dispatch(EVENTS.COMMAND_SET_EMBEDDING_MODEL, { modelId });
            });
        }

        if (this.scoringGroup) {
            this._addDOMListener(this.scoringGroup, 'toggle', () => {
                PersistenceService.saveUISetting(SETTING_KEYS.scoringOpen, this.scoringGroup.open);
            });
        }

        const advancedSummary = this.advancedGroup?.querySelector('summary');
        if (advancedSummary) {
            // Persist the *user's* choice per surface, so opening the expert block on desktop does
            // not un-tier mobile Discover. Deliberately not the `toggle` event: that also fires for
            // the parser setting `open` and for programmatic opens (mount, tour, error rescue), and
            // it fires asynchronously — a startup render could land on the wrong surface's key.
            // `click` covers keyboard activation too (summary synthesizes one) and runs *before* the
            // default action, so the state being chosen is `!open`.
            this._addDOMListener(advancedSummary, 'click', () => {
                const key = this._isMobileSurface() ? SETTING_KEYS.advancedOpenMobile : SETTING_KEYS.advancedOpenDesktop;
                PersistenceService.saveUISetting(key, !this.advancedGroup.open);
            });
        }

        this._addDOMListener(this.galleryList, 'click', (e) => this._onGalleryClick(e));

        this._subscribeToEvent(EVENTS.EXPLORE_PROGRESS, this._onProgress);
        this._subscribeToEvent(EVENTS.EXPLORE_FIND_ADDED, this._onFindAdded);
        this._subscribeToEvent(EVENTS.EMBEDDING_STATUS_CHANGED, this._onEmbeddingStatus);
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

    _onEmbeddingStatus(payload) {
        if (!payload) return;
        if (this.embeddingToggle) this.embeddingToggle.checked = !!payload.enabled;
        if (this.embeddingStatusEl) {
            const status = payload.status || 'disabled';
            this.embeddingStatusEl.dataset.status = status;
            this.embeddingStatusEl.textContent = EMBEDDING_STATUS_TEXT[status] || '';
        }
        if (this.embeddingModelField) this.embeddingModelField.hidden = !payload.enabled;
        // The mode chip + target-field gating depend on the embedding toggle.
        this._updateModeChip();
    }

    _updatePresetChip(presetKey) {
        const chip = this.element.querySelector('[data-field="preset-chip"]');
        if (chip) chip.textContent = presetKey === 'custom' ? 'Custom' : (SCORING_PRESETS[presetKey]?.label || '');
        this._updateAdvancedChip();
    }

    /** True on the mobile Discover tab, false in the desktop Auto-Explore panel (#29 tiering). */
    _isMobileSurface() {
        return !!this.appContext?.uiManager?.isMobile?.();
    }

    /** Persisted open-state of the Advanced disclosure — collapsed by default on mobile only. */
    _loadAdvancedOpen() {
        const mobile = this._isMobileSurface();
        const key = mobile ? SETTING_KEYS.advancedOpenMobile : SETTING_KEYS.advancedOpenDesktop;
        return !!PersistenceService.loadUISetting(key, !mobile);
    }

    /**
     * #29: collapsing Advanced must not hide *state*, only controls — the summary chip carries the
     * two settings that change what a run does (search mode and scoring preset) up to the summary.
     */
    _updateAdvancedChip() {
        const chip = this.element.querySelector('[data-field="advanced-chip"]');
        if (!chip) return;
        const mode = this.element.querySelector('[data-field="mode-chip"]')?.textContent || '';
        const preset = this.element.querySelector('[data-field="preset-chip"]')?.textContent || '';
        chip.textContent = [mode, preset].filter(Boolean).join(' · ');
    }

    /** Open/close Advanced. Programmatic changes are not a user preference, so they never persist. */
    _setAdvancedOpen(open) {
        if (this.advancedGroup) this.advancedGroup.open = open;
    }

    /** Open the Advanced disclosure (and optionally Scoring inside it) — used by tours and errors. */
    openAdvanced({ scoring = false } = {}) {
        this._setAdvancedOpen(true);
        if (scoring && this.scoringGroup) this.scoringGroup.open = true;
    }

    /** Coerce any inbound population value (UI select, persisted, or share link) to an int in range. */
    _sanitizePopulation(value) {
        const n = Math.floor(Number(value));
        if (!Number.isFinite(n)) return EXPLORE_CONFIG.populationSize;
        return Math.min(POPULATION_MAX, Math.max(POPULATION_MIN, n));
    }

    /** Coerce the target-match banking threshold to a cosine in [0,1] (2 dp), defaulting to the config. */
    _sanitizeTargetBank(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return EXPLORE_CONFIG.targetBankThreshold;
        return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
    }

    /**
     * Update the search-mode chip + target-field gating from the live embedding toggle and prompt input:
     * Statistical (no vision model) → Open-ended (perceptual novelty, no prompt) → 🎯 Target (prompt set).
     */
    _updateModeChip() {
        const embeddingsOn = !!this.embeddingToggle?.checked;
        const hasPrompt = !!(this.targetInput && sanitizeTargetPrompt(this.targetInput.value));
        const chip = this.element.querySelector('[data-field="mode-chip"]');
        if (chip) {
            const label = !embeddingsOn ? 'Statistical' : (hasPrompt ? '🎯 Target' : 'Open-ended');
            chip.textContent = label;
            chip.dataset.mode = !embeddingsOn ? 'statistical' : (hasPrompt ? 'target' : 'open');
        }
        if (this.targetInput) this.targetInput.disabled = !embeddingsOn;
        if (this.targetAdvanced) this.targetAdvanced.hidden = !embeddingsOn;
        if (this.targetHintEl) {
            this.targetHintEl.textContent = embeddingsOn
                ? 'Steers evolution toward frames that match your prompt. Leave empty for open-ended novelty.'
                : 'Enable “Perceptual novelty (CLIP)” above to search by prompt.';
        }
        this._updateAdvancedChip();
    }

    _readICLabels() {
        return Array.from(this.element.querySelectorAll('[data-ic-label]'))
            .filter(cb => cb.checked)
            .map(cb => cb.dataset.icLabel);
    }

    _startExploration() {
        const icLabels = this._readICLabels();
        if (icLabels.length === 0) {
            this.openAdvanced();
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Select at least one initial condition to explore.', type: 'error' });
            return;
        }
        // v3.1 custom objective. Weights that sum to zero over the terms a run can actually
        // measure would score every candidate 0 and bank nothing — refuse loudly instead.
        const scoring = this.scoringPanel.getScoring();
        const embeddingsOn = !!this.embeddingToggle?.checked;
        const effectiveKeys = embeddingsOn ? WEIGHT_KEYS : WEIGHT_KEYS.filter((k) => k !== 'openEndedness');
        if (effectiveKeys.every((k) => (scoring.weights[k] || 0) === 0)) {
            // The sliders that caused this may be collapsed behind Advanced — reveal them, or the
            // toast points at controls the user cannot see.
            this.openAdvanced({ scoring: true });
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                message: embeddingsOn
                    ? 'All scoring weights are 0 — nothing would ever be banked. Raise at least one weight.'
                    : 'All active scoring weights are 0 (Novelty needs the CLIP objective enabled). Raise at least one other weight.',
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
            // Supervised target search (v3.2): the prompt only takes effect when embeddings are on (the
            // service also re-checks). targetBankThreshold gates which matches enter the gallery.
            targetPrompt: embeddingsOn ? sanitizeTargetPrompt(this.targetInput?.value) : '',
            targetBankThreshold: this._sanitizeTargetBank(this.targetBankInput?.value),
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
        if (this.embeddingModelSelect) this.embeddingModelSelect.disabled = isRunning;
        // Target controls are read at Start; a running search also can't have embeddings toggled off.
        if (this.targetInput) this.targetInput.disabled = isRunning || !this.embeddingToggle?.checked;
        if (this.targetBankInput) this.targetBankInput.disabled = isRunning;

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
                // In target mode `bestScore` is the best prompt-match cosine, so label it "match".
                const bestLabel = payload.targetMode ? 'match' : 'best';
                const best = typeof payload.bestScore === 'number' ? ` · ${bestLabel} ${payload.bestScore.toFixed(2)}` : '';
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
        // Supervised target search (v3.2): a find banked in target mode carries its trajectory→prompt match.
        const targetChip = (typeof entry.targetSimilarity === 'number')
            ? `<span class="explore-find-target" title="Mean cosine similarity of this find's frames to the target prompt (higher = closer match)">🎯 ${entry.targetSimilarity.toFixed(2)}</span>`
            : '';
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
                            ${cyclicChip}${chaosChip}${targetChip}
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
