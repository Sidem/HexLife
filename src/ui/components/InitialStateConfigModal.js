import { BaseComponent } from './BaseComponent.js';
import { SliderComponent } from './SliderComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { renderInitialStatePreview } from './initialStatePreview.js';

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
};

export class InitialStateConfigModal extends BaseComponent {
    constructor(mountPoint, appContext) {
        super(mountPoint);
        this.appContext = appContext;
        this.config = {};
        this.worldIndex = -1;
        this.components = [];
        this.previewSeed = 1;
        this.render();
        this.hide();
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
            regenerateBtn: this.element.querySelector('.isc-regenerate-button'),
            presetChips: this.element.querySelector('.isc-presets-chips'),
            paramsContainer: this.element.querySelector('#initial-state-params-container'),
            saveBtn: this.element.querySelector('#confirm-state-config-button'),
            cancelBtn: this.element.querySelector('#cancel-state-config-button'),
            closeBtn: this.element.querySelector('.modal-close-button'),
        };

        this.ui.modeButtons.forEach(btn => {
            this._addDOMListener(btn, 'click', () => this._setMode(btn.dataset.mode));
        });
        this._addDOMListener(this.ui.regenerateBtn, 'click', () => {
            this.previewSeed = (this.previewSeed + 1) >>> 0 || 1;
            this._updatePreview();
        });
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
        this._renderForMode();
    }

    // Rebuilds mode-dependent UI: active mode button, presets, sliders, and the preview.
    _renderForMode() {
        const mode = this.config.mode;
        this.ui.modeButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));

        this._ensureDefaultParams(mode);
        this._renderPresets();
        this._renderParams();
        this._updatePreview();
        this._syncActivePreset();
    }

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
        EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_INITIAL_STATE, {
            worldIndex: this.worldIndex,
            initialState: this.config,
        });
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
