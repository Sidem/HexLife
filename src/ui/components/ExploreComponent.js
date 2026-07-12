import { BaseComponent } from './BaseComponent.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import * as Config from '../../core/config.js';
import { EXPLORE_CONFIG, IC_SUITE } from '../../core/AutoExploreService.js';
import { ShareCodec } from '../../services/ShareCodec.js';
import { ICONS } from '../icons.js';
import { COMPONENT_META, UNIFORM_FACTOR_META } from './scoringTermMeta.js';
import { ExploreScoringPanel } from './ExploreScoringPanel.js';
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
    icLabels: 'exploreICLabels',
    maxGenerations: 'exploreMaxGenerations',
    scoring: 'exploreScoring',
    scoringOpen: 'exploreScoringOpen',
    embeddingModel: 'embeddingModelId',
};

/** Human-readable status line for the perceptual-objective toggle, keyed by EMBEDDING_STATUS. */
const EMBEDDING_STATUS_TEXT = {
    disabled: '',
    loading: 'Loading vision model… (downloads ~tens of MB once, then cached)',
    ready: 'Vision model ready — finds are also scored on perceptual novelty.',
    error: 'Vision model unavailable — using the statistical objective.',
};

const MAX_GALLERY_RENDER = 40;

export class ExploreComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options);
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.service = this.worldManager.autoExploreService;
        this.sliders = {};
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
        this._syncFromStatus();
        this._renderGallery();
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
        if (typeof cfg.maxGenerations === 'number') PersistenceService.saveUISetting(SETTING_KEYS.maxGenerations, cfg.maxGenerations);
        if (Array.isArray(cfg.icLabels) && cfg.icLabels.length > 0) PersistenceService.saveUISetting(SETTING_KEYS.icLabels, cfg.icLabels);
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
        const icLabels = PersistenceService.loadUISetting(SETTING_KEYS.icLabels, IC_SUITE.map(ic => ic.label));
        const maxGenerations = PersistenceService.loadUISetting(SETTING_KEYS.maxGenerations, EXPLORE_CONFIG.maxGenerations);
        const status = this.service.getStatus();
        const embeddingEnabled = !!status.embeddingEnabled;
        const embeddingStatus = status.embeddingStatus || 'disabled';
        const scoringOpen = !!PersistenceService.loadUISetting(SETTING_KEYS.scoringOpen, false);
        const activeModelId = this.worldManager.embeddingService?.getModelId?.()
            || PersistenceService.loadUISetting(SETTING_KEYS.embeddingModel, EMBEDDING_MODELS[0].id);

        this.element.innerHTML = `
            <div class="tool-group explore-intro">
                <p class="explore-blurb">Searches all 9 worlds for "interesting" rulesets near the edge of chaos. Each generation: candidates are <strong>screened</strong> cheaply across an initial-condition suite, promising ones are <strong>confirmed</strong> with a long burst, and survivors are <strong>banked</strong> in the gallery — the best two breed the next generation. The Scoring section below decides what "interesting" means.</p>
            </div>
            <div class="tool-group">
                ${this._pendingBaseSeed != null ? `
                <div class="explore-shared-banner" id="explore-shared-banner">
                    <span class="inline-icon">${ICONS.share}</span>
                    <span>Shared search loaded (seed ${this._pendingBaseSeed}) — press <strong>Start</strong> to replay it exactly.</span>
                </div>` : ''}
                <div class="explore-status" id="explore-status">
                    <span class="explore-status-state" data-field="state">Idle</span>
                    <span class="explore-status-detail" data-field="detail"></span>
                    <button class="button-icon explore-share-search" data-action="copy-search-link" title="Copy a link that replays this search exactly (same seed, same finds)" aria-label="Copy search link">${ICONS.share}</button>
                </div>
                <div class="form-group-buttons explore-run-buttons">
                    <button class="button action-button" data-action="start"><span class="inline-icon">${ICONS.compass}</span> Start</button>
                    <button class="button" data-action="pause" disabled title="Pause/resume the search at the next generation boundary">Pause</button>
                    <button class="button" data-action="stop" disabled>Stop</button>
                    <button class="button" data-action="adopt" disabled title="Stop and keep the current champion ruleset in the selected world">Stop &amp; Keep</button>
                </div>
            </div>
            <div class="tool-group explore-settings" id="explore-settings">
                <h5>Search Settings</h5>
                <div class="form-group" id="explore-mutation-rate-mount"></div>
                <div class="form-group" id="explore-mutation-mode-mount"></div>
                <div class="form-group" id="explore-eval-ticks-mount"></div>
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
            </div>
            <details class="tool-group explore-scoring-group" id="explore-scoring-group" ${scoringOpen ? 'open' : ''}>
                <summary class="explore-scoring-summary">
                    <h5>Scoring <span class="explore-scoring-preset-chip" data-field="preset-chip"></span></h5>
                </summary>
                <div id="explore-scoring-mount"></div>
            </details>
            <div class="tool-group explore-gallery-group">
                <div class="explore-gallery-header">
                    <h5>Gallery / Leaderboard <span class="explore-gallery-count" data-field="count">(0)</span></h5>
                    <button class="button-icon" data-action="clear-gallery" title="Clear the session gallery" aria-label="Clear the session gallery">${ICONS.trash}</button>
                </div>
                <div id="explore-gallery-list" class="explore-gallery-list"></div>
            </div>
        `;

        this.statusEl = this.element.querySelector('#explore-status');
        this.settingsEl = this.element.querySelector('#explore-settings');
        this.galleryList = this.element.querySelector('#explore-gallery-list');
        this.runButtons = {
            start: this.element.querySelector('[data-action="start"]'),
            pause: this.element.querySelector('[data-action="pause"]'),
            stop: this.element.querySelector('[data-action="stop"]'),
            adopt: this.element.querySelector('[data-action="adopt"]'),
        };
        this.budgetInput = this.element.querySelector('#explore-max-generations');
        this.embeddingToggle = this.element.querySelector('#explore-embedding-enabled');
        this.embeddingStatusEl = this.element.querySelector('#explore-embedding-status');
        this.embeddingModelField = this.element.querySelector('#explore-embedding-model-field');
        this.embeddingModelSelect = this.element.querySelector('#explore-embedding-model');
        this.scoringGroup = this.element.querySelector('#explore-scoring-group');

        // Scoring panel (v3.1): user-customizable objective. The summary chip mirrors the active
        // preset; explainer curve markers follow the current best find's measured raw metrics.
        this.scoringPanel = new ExploreScoringPanel(this.element.querySelector('#explore-scoring-mount'), {
            onChange: (_scoring, presetKey) => this._updatePresetChip(presetKey),
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

        this._addDOMListener(this.galleryList, 'click', (e) => this._onGalleryClick(e));

        this._subscribeToEvent(EVENTS.EXPLORE_PROGRESS, this._onProgress);
        this._subscribeToEvent(EVENTS.EXPLORE_FIND_ADDED, this._onFindAdded);
        this._subscribeToEvent(EVENTS.EMBEDDING_STATUS_CHANGED, this._onEmbeddingStatus);
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
    }

    _updatePresetChip(presetKey) {
        const chip = this.element.querySelector('[data-field="preset-chip"]');
        if (chip) chip.textContent = presetKey === 'custom' ? 'Custom' : (SCORING_PRESETS[presetKey]?.label || '');
    }

    _readICLabels() {
        return Array.from(this.element.querySelectorAll('[data-ic-label]'))
            .filter(cb => cb.checked)
            .map(cb => cb.dataset.icLabel);
    }

    _startExploration() {
        const icLabels = this._readICLabels();
        if (icLabels.length === 0) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Select at least one initial condition to explore.', type: 'error' });
            return;
        }
        // v3.1 custom objective. Weights that sum to zero over the terms a run can actually
        // measure would score every candidate 0 and bank nothing — refuse loudly instead.
        const scoring = this.scoringPanel.getScoring();
        const embeddingsOn = !!this.embeddingToggle?.checked;
        const effectiveKeys = embeddingsOn ? WEIGHT_KEYS : WEIGHT_KEYS.filter((k) => k !== 'openEndedness');
        if (effectiveKeys.every((k) => (scoring.weights[k] || 0) === 0)) {
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
            maxGenerations: Math.max(0, Math.floor(Number(this.budgetInput?.value) || 0)),
            icLabels,
            scoring,
            findThreshold: scoring.findThreshold,
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
        this.scoringPanel?.setDisabled(isRunning);
        if (this.embeddingModelSelect) this.embeddingModelSelect.disabled = isRunning;

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

        if (entries.length === 0) {
            this.galleryList.innerHTML = `
                <div class="panel-empty-state">
                    <div class="panel-empty-state-icon">${ICONS.compass}</div>
                    <p class="panel-empty-state-title">No finds yet</p>
                    <p class="panel-empty-state-desc">Press <strong>Start</strong> above to auto-search all nine worlds. The most interesting rulesets it discovers collect here, best-first.</p>
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
                            <span class="explore-find-ic" title="Winning initial condition">${ic}</span>
                            ${cyclicChip}${chaosChip}
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
}
