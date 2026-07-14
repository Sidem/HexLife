import { BaseComponent } from './BaseComponent.js';
import { SliderComponent } from './SliderComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as Config from '../../core/config.js';
import { renderInitialStatePreview } from './initialStatePreview.js';
import { SavedStartsList, importStateFileToLibrary } from './SavedStartsList.js';

// Plain-language metadata for every tunable param, grouped so the dialog can show a small "basics"
// set up front and tuck the fine-grained knobs behind an "Advanced" disclosure. paramKey values are
// unchanged from the original modal so the saved config stays byte-compatible with the strategies.
const CLUSTER_BASICS = [
    { key: 'count', label: 'Number of clumps', min: 1, max: 50, step: 1, help: 'How many separate blobs of live cells to scatter across the world.' },
    { key: 'diameter', label: 'Clump size', min: 5, max: 100, step: 1, help: 'Roughly how wide each blob is, measured in cells.' },
    { key: 'density', label: 'Fill amount', min: 0, max: 1, step: 0.01, help: 'How solidly each blob is filled with live cells (0 = empty, 1 = packed).' },
];
const CLUSTER_SHAPE = [
    { key: 'gaussianStdDev', label: 'Center focus', min: 0.5, max: 5, step: 0.1, help: 'Higher values pack cells toward each blob\'s center, leaving soft, thin edges.' },
    { key: 'eccentricity', label: 'Stretch', min: 0, max: 1, step: 0.01, help: '0 = round blobs, 1 = long thin streaks.' },
    { key: 'orientation', label: 'Angle', min: 0, max: 180, step: 1, help: 'Direction stretched blobs point, in degrees.' },
];
const CLUSTER_RANDOMNESS = [
    { key: 'diameterVariation', label: 'Size variation', min: 0, max: 50, step: 1, help: 'How much blob sizes differ from one another.' },
    { key: 'densityVariation', label: 'Fill variation', min: 0, max: 1, step: 0.01, help: 'How much the fill amount varies between blobs.' },
    { key: 'orientationVariation', label: 'Angle variation', min: 0, max: 1, step: 0.01, help: 'How much blob angles differ from one another.' },
];

const DENSITY_CONTROLS = [
    { key: 'density', label: 'Fill amount', min: 0, max: 1, step: 0.001, help: 'Fraction of cells that start alive. Setting it to exactly 0 or 1 places a single opposite seed cell in the center.' },
];

// Named starting points. Each preset is a full cluster param bundle; picking one fills the sliders.
const CLUSTER_PRESETS = [
    { name: 'Scattered', params: { count: 35, density: 0.6, densityVariation: 0.2, diameter: 6, diameterVariation: 3, eccentricity: 0.2, orientation: 0, orientationVariation: 1.0, gaussianStdDev: 2.5 } },
    { name: 'Islands', params: { count: 12, density: 0.75, densityVariation: 0.15, diameter: 18, diameterVariation: 6, eccentricity: 0.3, orientation: 0, orientationVariation: 1.0, gaussianStdDev: 2.0 } },
    { name: 'Big blobs', params: { count: 5, density: 0.8, densityVariation: 0.1, diameter: 42, diameterVariation: 10, eccentricity: 0.2, orientation: 0, orientationVariation: 1.0, gaussianStdDev: 1.6 } },
    { name: 'Streaks', params: { count: 14, density: 0.7, densityVariation: 0.2, diameter: 24, diameterVariation: 8, eccentricity: 0.82, orientation: 30, orientationVariation: 0.6, gaussianStdDev: 2.6 } },
];
const DENSITY_PRESETS = [
    { name: 'Sparse', params: { density: 0.15 } },
    { name: 'Balanced', params: { density: 0.5 } },
    { name: 'Dense', params: { density: 0.85 } },
    { name: 'Single seed', params: { density: 1 } },
];

const DEFAULT_PARAMS = {
    density: { density: 0.5 },
    clusters: { count: 25, density: 0.7, densityVariation: 0.2, diameter: 10, diameterVariation: 5, eccentricity: 0.33, orientation: 0, orientationVariation: 1.0, distribution: 'gaussian', gaussianStdDev: 2.0 },
    // Saved starts carry a captured payload, never defaults: an empty selection means "Save" is off.
    saved: {},
};

export class InitialStateConfigModal extends BaseComponent {
    constructor(mountPoint, appContext) {
        super(mountPoint);
        this.appContext = appContext;
        this.stateLibrary = appContext.stateLibraryService;
        this.config = {};
        this.worldIndex = -1;
        this.components = [];
        this.previewSeed = 1;
        // Saved tab: which world(s) Save assigns to.
        this.applyScope = 'selected';
        this.render();
        this.hide();
        EventBus.subscribe(EVENTS.SAVED_STATES_CHANGED, () => {
            if (!this.element.classList.contains('hidden') && this.config.mode === 'saved') this._renderSavedList();
        });
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'initial-state-config-modal';
        this.element.className = 'modal-overlay hidden';
        this.element.innerHTML = `
            <div class="modal-content" role="dialog" aria-modal="true">
                <h3 id="initial-state-modal-title">Configure Initial State</h3>
                <button class="modal-close-button" aria-label="Close">&times;</button>

                <div class="isc-mode-toggle" role="group" aria-label="Initial state mode">
                    <button type="button" class="isc-mode-button" data-mode="density">Random fill</button>
                    <button type="button" class="isc-mode-button" data-mode="clusters">Clumps</button>
                    <button type="button" class="isc-mode-button" data-mode="saved">Saved</button>
                </div>

                <div class="isc-preview-block">
                    <canvas class="isc-preview-canvas" aria-label="Initial state preview"></canvas>
                    <div class="isc-preview-meta">
                        <span class="info-text isc-preview-caption">Live preview &mdash; the exact layout reshuffles on every reset.</span>
                        <button type="button" class="button isc-regenerate-button" title="Reshuffle the random preview using the same settings">&#x21bb; Regenerate</button>
                    </div>
                </div>

                <div class="isc-presets-row">
                    <span class="isc-presets-label">Presets</span>
                    <div class="isc-presets-chips"></div>
                </div>

                <div id="initial-state-params-container" class="params-container"></div>

                <div class="isc-saved-block hidden">
                    <div class="isc-saved-actions">
                        <button type="button" class="button isc-capture-button" title="Freeze the selected world's current cells into the library">Capture current world</button>
                        <button type="button" class="button isc-import-button" title="Import a saved world-state file as a start">Import&hellip;</button>
                        <input type="file" class="isc-import-input" accept=".json,.txt" hidden />
                    </div>
                    <div class="isc-saved-list" role="listbox" aria-label="Saved starts"></div>
                </div>

                <div class="isc-scope-row hidden">
                    <span class="isc-scope-label">Apply to</span>
                    <div class="isc-scope-buttons" role="group" aria-label="Apply this start to">
                        <button type="button" class="isc-scope-button active" data-scope="selected">This world</button>
                        <button type="button" class="isc-scope-button" data-scope="all">All worlds</button>
                    </div>
                </div>

                <div class="modal-actions">
                    <button class="button" id="cancel-state-config-button">Cancel</button>
                    <button class="button isc-save-button" id="confirm-state-config-button">Save</button>
                </div>
            </div>
        `;
        this.mountPoint.appendChild(this.element);

        this.ui = {
            title: this.element.querySelector('#initial-state-modal-title'),
            modeButtons: Array.from(this.element.querySelectorAll('.isc-mode-button')),
            previewCanvas: this.element.querySelector('.isc-preview-canvas'),
            previewCaption: this.element.querySelector('.isc-preview-caption'),
            regenerateBtn: this.element.querySelector('.isc-regenerate-button'),
            presetsRow: this.element.querySelector('.isc-presets-row'),
            presetChips: this.element.querySelector('.isc-presets-chips'),
            paramsContainer: this.element.querySelector('#initial-state-params-container'),
            savedBlock: this.element.querySelector('.isc-saved-block'),
            savedList: this.element.querySelector('.isc-saved-list'),
            captureBtn: this.element.querySelector('.isc-capture-button'),
            importBtn: this.element.querySelector('.isc-import-button'),
            importInput: this.element.querySelector('.isc-import-input'),
            scopeRow: this.element.querySelector('.isc-scope-row'),
            scopeButtons: Array.from(this.element.querySelectorAll('.isc-scope-button')),
            saveBtn: this.element.querySelector('#confirm-state-config-button'),
            cancelBtn: this.element.querySelector('#cancel-state-config-button'),
            closeBtn: this.element.querySelector('.modal-close-button'),
        };

        this.savedStartsList = new SavedStartsList(this.ui.savedList, {
            stateLibrary: this.stateLibrary,
            getSelectedId: () => this.config.params?.id,
            onSelect: (entry) => this._selectEntry(entry),
            // The world's assignment embeds the name, so keep the in-flight config label in step.
            onRename: (id, name) => { if (this.config.params?.id === id) this.config.params.name = name; },
            emptyHtml: 'No saved starts yet. Press <kbd>T</kbd> to capture the selected world, or use the button above.',
        });

        this.ui.modeButtons.forEach(btn => {
            this._addDOMListener(btn, 'click', () => this._setMode(btn.dataset.mode));
        });
        this.ui.scopeButtons.forEach(btn => {
            this._addDOMListener(btn, 'click', () => this._setApplyScope(btn.dataset.scope));
        });
        this._addDOMListener(this.ui.regenerateBtn, 'click', () => {
            this.previewSeed = (this.previewSeed + 1) >>> 0 || 1;
            this._updatePreview();
        });
        this._addDOMListener(this.ui.captureBtn, 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_CAPTURE_STATE_TO_LIBRARY, { assignScope: 'none' });
        });
        this._addDOMListener(this.ui.importBtn, 'click', () => this.ui.importInput.click());
        this._addDOMListener(this.ui.importInput, 'change', (e) => this._handleImportFile(e));
        this._addDOMListener(this.ui.saveBtn, 'click', this._handleSave);
        this._addDOMListener(this.ui.cancelBtn, 'click', this.hide);
        this._addDOMListener(this.ui.closeBtn, 'click', this.hide);
        this._addDOMListener(this.element, 'click', (e) => {
            if (e.target === this.element) this.hide();
        });
    }

    show = (worldIndex, config) => {
        this.worldIndex = worldIndex;
        this.config = structuredClone(config);
        if (!this.config.mode) this.config.mode = 'density';
        this.previewSeed = 1;
        this.applyScope = 'selected';
        this.savedStartsList.resetRowStates();
        this._syncScopeButtons();
        this.ui.title.textContent = `Configure Initial State (World ${worldIndex})`;
        this._renderForMode();
        this.element.classList.remove('hidden');
    }

    hide = () => {
        this.element.classList.add('hidden');
        this._destroySliders();
        this.ui.paramsContainer.innerHTML = '';
    }

    _destroySliders() {
        this.components.forEach(c => c.destroy());
        this.components = [];
    }

    _setMode(mode) {
        if (this.config.mode === mode) return;
        this.config.mode = mode;
        this.config.params = {}; // re-seed from defaults for the new mode
        this.previewSeed = 1;
        this.savedStartsList.resetRowStates();
        this._renderForMode();
    }

    _setApplyScope(scope) {
        this.applyScope = scope === 'all' ? 'all' : 'selected';
        this._syncScopeButtons();
    }

    _syncScopeButtons() {
        this.ui.scopeButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.scope === this.applyScope));
    }

    // Rebuilds mode-dependent UI: active mode button, presets, sliders/picker, and the preview.
    _renderForMode() {
        const mode = this.config.mode;
        const isSaved = mode === 'saved';
        this.ui.modeButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));

        this._ensureDefaultParams(mode);

        // Generative modes get presets + sliders + a reshuffle button; saved starts get the library
        // picker and an apply-to scope (their cells are fixed, so there is nothing to reshuffle).
        this.ui.presetsRow.classList.toggle('hidden', isSaved);
        this.ui.paramsContainer.classList.toggle('hidden', isSaved);
        this.ui.savedBlock.classList.toggle('hidden', !isSaved);
        this.ui.scopeRow.classList.toggle('hidden', !isSaved);
        this.ui.regenerateBtn.classList.toggle('hidden', isSaved);
        this.ui.previewCaption.textContent = isSaved
            ? 'Preview of the highlighted start — every reset replays these exact cells.'
            : 'Live preview — the exact layout reshuffles on every reset.';

        if (isSaved) {
            this._destroySliders();
            this.ui.paramsContainer.innerHTML = '';
            this._renderSavedList();
        } else {
            this._renderPresets();
            this._renderParams();
            this._syncActivePreset();
        }
        this._updatePreview();
        this._syncSaveEnabled();
    }

    _syncSaveEnabled() {
        const needsPick = this.config.mode === 'saved' && !this.config.params?.stateB64;
        this.ui.saveBtn.disabled = needsPick;
        this.ui.saveBtn.title = needsPick ? 'Pick a saved start first' : '';
    }

    // --- Saved starts tab ---------------------------------------------------------------------

    _renderSavedList() {
        this.savedStartsList.render();
    }

    _selectEntry(entry) {
        this.config = this.stateLibrary.buildInitialState(entry);
        this.savedStartsList.resetRowStates();
        this._renderSavedList();
        this._updatePreview();
        this._syncSaveEnabled();
    }

    _handleImportFile(e) {
        const file = e.target.files?.[0];
        if (!file) { e.target.value = null; return; }
        importStateFileToLibrary(file, this.stateLibrary)
            .then(({ entry, deduped }) => {
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                    message: deduped ? `Already in the library as "${entry.name}"` : `Imported "${entry.name}"`,
                });
                this._selectEntry(entry);
            })
            .catch(err => {
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Import failed: ${err.message}`, type: 'error' });
            })
            .finally(() => { e.target.value = null; });
    }

    // --- Generative modes ---------------------------------------------------------------------

    _renderPresets() {
        const mode = this.config.mode;
        const presets = mode === 'clusters' ? CLUSTER_PRESETS : DENSITY_PRESETS;
        this.ui.presetChips.innerHTML = '';
        presets.forEach(preset => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'isc-preset-chip';
            chip.textContent = preset.name;
            chip.dataset.preset = preset.name;
            this._addDOMListener(chip, 'click', () => this._applyPreset(preset));
            this.ui.presetChips.appendChild(chip);
        });
    }

    _applyPreset(preset) {
        // Merge over current params so untouched keys (e.g. distribution) survive.
        this.config.params = { ...this.config.params, ...preset.params };
        this.components.forEach(c => {
            const key = c.options.paramKey;
            if (key in preset.params) c.setValue(preset.params[key]);
        });
        this._updatePreview();
        this._syncActivePreset();
    }

    _renderParams() {
        const mode = this.config.mode;
        const container = this.ui.paramsContainer;
        this._destroySliders();
        container.innerHTML = '';

        const params = this.config.params;

        if (mode === 'clusters') {
            this._renderGroup(container, null, CLUSTER_BASICS, params);
            const adv = this._renderAdvancedDisclosure(container);
            this._renderGroup(adv, 'Shape', CLUSTER_SHAPE, params);
            this._renderGroup(adv, 'Randomness', CLUSTER_RANDOMNESS, params);
        } else {
            this._renderGroup(container, null, DENSITY_CONTROLS, params);
        }
    }

    _renderAdvancedDisclosure(container) {
        const details = document.createElement('details');
        details.className = 'isc-advanced';
        const summary = document.createElement('summary');
        summary.textContent = 'Advanced';
        details.appendChild(summary);
        container.appendChild(details);
        return details;
    }

    _renderGroup(parent, heading, defs, params) {
        if (heading) {
            const h = document.createElement('div');
            h.className = 'isc-group-heading';
            h.textContent = heading;
            parent.appendChild(h);
        }
        defs.forEach(def => this._createSlider(parent, def, params[def.key]));
    }

    _createSlider(parent, def, value) {
        const mount = document.createElement('div');
        parent.appendChild(mount);
        const slider = new SliderComponent(mount, {
            id: `initial-state-${def.key}-slider`,
            label: `${def.label}:`,
            min: def.min, max: def.max, step: def.step,
            value: value ?? def.min,
            showValue: true,
            paramKey: def.key,
            onInput: (v) => {
                this.config.params[def.key] = v;
                this._updatePreview();
                this._syncActivePreset();
            },
        });
        if (def.help && slider.labelElement) {
            slider.labelElement.title = def.help;
            slider.labelElement.classList.add('isc-has-help');
        }
        this.components.push(slider);
    }

    _collectParams() {
        const params = { ...this.config.params };
        this.components.forEach(c => { params[c.options.paramKey] = c.getValue(); });
        return params;
    }

    _updatePreview() {
        this.config.params = this._collectParams();
        renderInitialStatePreview(this.ui.previewCanvas, {
            mode: this.config.mode,
            params: this.config.params,
        }, { maxDim: 170, seed: this.previewSeed });
    }

    // Highlights the preset chip whose bundle exactly matches the current sliders (else none = custom).
    _syncActivePreset() {
        const mode = this.config.mode;
        const presets = mode === 'clusters' ? CLUSTER_PRESETS : DENSITY_PRESETS;
        const current = this.config.params;
        const match = presets.find(p =>
            Object.entries(p.params).every(([k, v]) => Math.abs((current[k] ?? NaN) - v) < 1e-6)
        );
        this.ui.presetChips.querySelectorAll('.isc-preset-chip').forEach(chip => {
            chip.classList.toggle('active', !!match && chip.dataset.preset === match.name);
        });
    }

    _handleSave = () => {
        this.config.params = this._collectParams();
        if (this.config.mode === 'saved' && !this.config.params.stateB64) return;

        // "All worlds" just fans the same command over every index — no new plumbing, and it works
        // regardless of which world's Edit… button opened the modal.
        const targets = (this.config.mode === 'saved' && this.applyScope === 'all')
            ? Array.from({ length: Config.NUM_WORLDS }, (_, i) => i)
            : [this.worldIndex];

        targets.forEach(worldIndex => {
            EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_INITIAL_STATE, {
                worldIndex,
                initialState: structuredClone(this.config),
            });
        });
        if (targets.length > 1) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Start applied to all ${Config.NUM_WORLDS} worlds (R resets to it)` });
        }
        this.hide();
    }

    _ensureDefaultParams(mode) {
        if (this.config.mode !== mode) {
            this.config.mode = mode;
            this.config.params = {};
        }
        this.config.params = { ...DEFAULT_PARAMS[mode], ...this.config.params };
    }
}
