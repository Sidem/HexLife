import { BaseComponent } from './BaseComponent.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { EXPLORE_CONFIG, IC_SUITE } from '../../core/AutoExploreService.js';
import { ICONS } from '../icons.js';

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
};

const COMPONENT_META = [
    { key: 'criticality', label: 'σ', usedFlag: 'criticalityUsed' },
    { key: 'entropyBand', label: 'Entropy' },
    { key: 'fluctuation', label: 'Flux' },
    { key: 'ruleDiversity', label: 'Diversity' },
    { key: 'spatialStructure', label: 'Structure', usedFlag: 'spatialUsed' },
    { key: 'spatialHeterogeneity', label: 'Heterog.', usedFlag: 'spatialUsed' },
];

const MAX_GALLERY_RENDER = 40;

export class ExploreComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options);
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.service = this.worldManager.autoExploreService;
        this.sliders = {};
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

    render() {
        const ratePct = PersistenceService.loadUISetting(SETTING_KEYS.rate, Math.round(EXPLORE_CONFIG.mutationRate * 100));
        const mode = PersistenceService.loadUISetting(SETTING_KEYS.mode, EXPLORE_CONFIG.mutationMode);
        const ticks = PersistenceService.loadUISetting(SETTING_KEYS.ticks, EXPLORE_CONFIG.evalTicks);
        const icLabels = PersistenceService.loadUISetting(SETTING_KEYS.icLabels, IC_SUITE.map(ic => ic.label));

        this.element.innerHTML = `
            <div class="tool-group explore-intro">
                <p class="explore-blurb">Searches all 9 worlds for "interesting" rulesets near the edge of chaos. Each candidate is scored across an initial-condition suite; the best feed the next generation.</p>
            </div>
            <div class="tool-group">
                <div class="explore-status" id="explore-status">
                    <span class="explore-status-state" data-field="state">Idle</span>
                    <span class="explore-status-detail" data-field="detail"></span>
                </div>
                <div class="form-group-buttons explore-run-buttons">
                    <button class="button action-button" data-action="start"><span class="inline-icon">${ICONS.compass}</span> Start</button>
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
            </div>
            <div class="tool-group explore-gallery-group">
                <div class="explore-gallery-header">
                    <h5>Gallery / Leaderboard <span class="explore-gallery-count" data-field="count">(0)</span></h5>
                    <button class="button-icon" data-action="clear-gallery" title="Clear the session gallery">${ICONS.trash}</button>
                </div>
                <div id="explore-gallery-list" class="explore-gallery-list"></div>
            </div>
        `;

        this.statusEl = this.element.querySelector('#explore-status');
        this.settingsEl = this.element.querySelector('#explore-settings');
        this.galleryList = this.element.querySelector('#explore-gallery-list');
        this.runButtons = {
            start: this.element.querySelector('[data-action="start"]'),
            stop: this.element.querySelector('[data-action="stop"]'),
            adopt: this.element.querySelector('[data-action="adopt"]'),
        };

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
            ],
            onChange: (v) => PersistenceService.saveUISetting(SETTING_KEYS.mode, v),
        });

        this.sliders.ticks = new SliderComponent(this.element.querySelector('#explore-eval-ticks-mount'), {
            id: 'explore-eval-ticks',
            label: 'Ticks / Evaluation:',
            min: 40, max: 400, step: 20,
            value: ticks,
            showValue: true,
            onChange: (v) => PersistenceService.saveUISetting(SETTING_KEYS.ticks, v),
        });
    }

    attachEventListeners() {
        this._addDOMListener(this.runButtons.start, 'click', () => this._startExploration());
        this._addDOMListener(this.runButtons.stop, 'click', () => EventBus.dispatch(EVENTS.COMMAND_STOP_AUTO_EXPLORE, {}));
        this._addDOMListener(this.runButtons.adopt, 'click', () => EventBus.dispatch(EVENTS.COMMAND_STOP_AUTO_EXPLORE, { adopt: true }));

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

        this._addDOMListener(this.galleryList, 'click', (e) => this._onGalleryClick(e));

        this._subscribeToEvent(EVENTS.EXPLORE_PROGRESS, this._onProgress);
        this._subscribeToEvent(EVENTS.EXPLORE_FIND_ADDED, this._onFindAdded);
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
        EventBus.dispatch(EVENTS.COMMAND_START_AUTO_EXPLORE, {
            mutationRate: this.sliders.rate.getValue() / 100,
            mutationMode: this.element.querySelector('input[name="explore-mutation-mode"]:checked')?.value || EXPLORE_CONFIG.mutationMode,
            evalTicks: this.sliders.ticks.getValue(),
            icLabels,
        });
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
            this.galleryList.innerHTML = `<p class="empty-state-text">No finds yet. Click "Start" to begin exploring — interesting rulesets will collect here.</p>`;
            return;
        }

        const shown = entries.slice(0, MAX_GALLERY_RENDER);
        let html = shown.map((entry, i) => this._renderFind(entry, i)).join('');
        if (entries.length > shown.length) {
            html += `<p class="empty-state-text">Showing top ${shown.length} of ${entries.length} finds.</p>`;
        }
        this.galleryList.innerHTML = html;
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
                            ${cyclicChip}
                        </div>
                        ${bars}
                        <div class="explore-find-actions">
                            <button class="button-icon" data-action="apply" title="Apply to selected world (ruleset + winning IC)">${ICONS.target}</button>
                            <button class="button-icon" data-action="save" title="Save ruleset to your library">${ICONS.star}</button>
                            <button class="button-icon" data-action="share" title="Copy share link">${ICONS.share}</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Debug surface: per-component score breakdown. Each bar is the component's [0,1] contribution.
    _renderComponentBars(perComponent) {
        if (!perComponent) return '';
        const rows = COMPONENT_META.map(({ key, label, usedFlag }) => {
            // A gated term shows "n/a" unless its flag is truthy (σ with no probe; spatial terms on
            // v1/old entries that predate them — flag absent ⇒ n/a). Ungated terms always render.
            const used = !usedFlag || !!perComponent[usedFlag];
            const val = used ? Math.max(0, Math.min(1, perComponent[key] || 0)) : 0;
            const pct = Math.round(val * 100);
            const valText = used ? val.toFixed(2) : 'n/a';
            return `
                <div class="explore-bar-row" title="${label}: ${valText}">
                    <span class="explore-bar-label">${label}</span>
                    <span class="explore-bar-track"><span class="explore-bar-fill" style="width:${pct}%"></span></span>
                    <span class="explore-bar-val">${valText}</span>
                </div>
            `;
        }).join('');
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
        } else if (action === 'save') {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_SAVE_RULESET_MODAL, { hex: entry.hex, name: entry.mnemonic });
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
