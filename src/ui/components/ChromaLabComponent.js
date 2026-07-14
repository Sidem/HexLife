import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { generateColorLUT, generatePaletteVisualizationLUT, colorLUTtoBase64, hexToRgb } from '../../utils/ruleVizUtils.js';
import { ICONS } from '../icons.js';

// The curated palette for the color pickers
const CURATED_PALETTE = ['#fed4d4', '#fe9494', '#ff3f3f', '#ff0000', '#bf0000', '#6a0000', '#2a0000', '#fee9d4', '#fec994', '#ff9f3f', '#ff7f00', '#bf5f00', '#6a3500', '#2a1500', '#fefed4', '#fefe94', '#feff3f', '#feff00', '#bfbf00', '#6a6a00', '#2a2a00', '#dffed4', '#affe94', '#6fff3f', '#3fff00', '#2fbf00', '#1a6a00', '#0a2a00', '#d4fee9', '#94fec9', '#3fff9f', '#00ff7f', '#00bf5f', '#006a35', '#002a15', '#d4fefe', '#94fefe', '#3ffeff', '#00feff', '#00bfbf', '#006a6a', '#002a2a', '#d4e9fe', '#94c9fe', '#3f9fff', '#007fff', '#005fbf', '#00356a', '#00152a', '#d4d4fe', '#9494fe', '#3f3fff', '#0000ff', '#0000bf', '#00006a', '#00002a', '#e9d4fe', '#c994fe', '#9f3fff', '#7f00ff', '#5f00bf', '#35006a', '#15002a', '#fed4fe', '#fe94fe', '#ff3ffe', '#ff00fe', '#bf00bf', '#6a006a', '#2a002a', '#fed4e9', '#fe94c9', '#ff3f9f', '#ff007f', '#bf005f', '#6a0035', '#2a0015', '#ffffff', '#d4d4d4', '#aaaaaa', '#7f7f7f', '#555555', '#2a2a2a', '#000000'];

// Tab metadata: id ↔ ColorController mode mapping lives in _tabForMode / _onTabClick.
const TAB_DEFS = [
    { id: 'palettes', label: 'Palettes', hint: 'Ready-made looks. Hover to preview live, click to apply.' },
    { id: 'gradient', label: 'Gradient', hint: 'Paint all 128 rules along your own color ramp — or roll a random one.' },
    { id: 'finetune', label: 'Fine-Tune', hint: 'Hand-pick colors per rule family.' },
];

/** Multiply a hex color's channels down to a dark "background" variant. */
function darkenHex(hex, factor = 0.28) {
    const [r, g, b] = hexToRgb(hex).map(ch => Math.round(ch * factor));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** HSL → hex, for the gradient shuffle (h in [0,360), s/l in [0,1]). */
function hslToHex(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
        const k = (n + h / 30) % 12;
        const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

export class ChromaLabComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options);
        if (!appContext || !appContext.colorController) {
            console.error('ChromaLabComponent: appContext or colorController is null.');
            return;
        }
        this.appContext = appContext;
        this.colorController = appContext.colorController;
        this.selectedSwatches = [];
        // Which grouping the Fine-Tune tab shows; follows settings.mode when it's a group mode.
        this.groupMode = 'neighbor_count';
        this._hoverPreviewCard = null;
        this.element = document.createElement('div');
        this.element.className = 'chroma-lab-component-content';
        this.render();
        this._setupEventListeners();
        this.refresh();
    }

    getElement() { return this.element; }

    render() {
        this.element.innerHTML = `
            <div class="chroma-lab-content">
                <div id="chroma-tabs" class="chroma-tabs" role="tablist" aria-label="Coloring mode">
                    ${TAB_DEFS.map(t => `
                        <button class="chroma-tab" data-tab="${t.id}" role="tab" aria-selected="false">${t.label}</button>
                    `).join('')}
                </div>
                <p class="chroma-tab-hint" id="chroma-tab-hint"></p>
                <div class="chroma-hue-shift" title="Rotate every color around the wheel to steer the whole palette off a hue you don't want (e.g. the default's harsh red). Blacks and grays stay put.">
                    <label for="chroma-hue-shift-slider">Hue shift</label>
                    <input type="range" id="chroma-hue-shift-slider" class="chroma-hue-slider" min="0" max="359" step="1" value="0" aria-label="Global palette hue shift in degrees">
                    <output id="chroma-hue-shift-value" class="chroma-hue-value">0°</output>
                    <button type="button" id="chroma-hue-shift-reset" class="chroma-hue-reset" title="Reset hue shift to 0°">Reset</button>
                </div>
                <div id="chroma-batch-action-bar" class="hidden"></div>
                <div id="chroma-preset-section" class="chroma-section"></div>
                <div id="chroma-gradient-section" class="chroma-section hidden"></div>
                <div id="chroma-finetune-section" class="chroma-section hidden">
                    <div class="chroma-finetune-switch">
                        <span class="chroma-finetune-switch-label">Group rules by</span>
                        <div class="chroma-subtabs" role="tablist" aria-label="Rule grouping">
                            <button class="chroma-subtab" data-group="neighbor_count" role="tab">Neighbor Count</button>
                            <button class="chroma-subtab" data-group="symmetry" role="tab">Symmetry</button>
                        </div>
                    </div>
                    <p class="chroma-finetune-hint">Click a swatch to recolor that whole rule family. <kbd>Ctrl</kbd>-click selects several — then paint them all at once or sweep a gradient across them.</p>
                    <div id="chroma-neighbor-section" class="chroma-groups"></div>
                    <div id="chroma-symmetry-section" class="chroma-groups hidden"></div>
                </div>
                <input type="color" class="chroma-native-color" aria-hidden="true" tabindex="-1">
            </div>
        `;
        this.uiElements = {
            tabs: this.element.querySelector('#chroma-tabs'),
            tabHint: this.element.querySelector('#chroma-tab-hint'),
            presetSection: this.element.querySelector('#chroma-preset-section'),
            gradientSection: this.element.querySelector('#chroma-gradient-section'),
            finetuneSection: this.element.querySelector('#chroma-finetune-section'),
            neighborSection: this.element.querySelector('#chroma-neighbor-section'),
            symmetrySection: this.element.querySelector('#chroma-symmetry-section'),
            batchActionBar: this.element.querySelector('#chroma-batch-action-bar'),
            nativeColor: this.element.querySelector('.chroma-native-color'),
            hueSlider: this.element.querySelector('#chroma-hue-shift-slider'),
            hueValue: this.element.querySelector('#chroma-hue-shift-value'),
            hueReset: this.element.querySelector('#chroma-hue-shift-reset'),
        };
        this._renderAllSections();
    }

    _renderAllSections() {
        this._renderPresetSection();
        this._renderGradientSection();
        this._renderGroupSection('neighbor_count');
        this._renderGroupSection('symmetry');
    }

    // --- Palettes tab --------------------------------------------------------

    _renderPresetSection() {
        // A re-render replaces any card the pointer is on, so close a dangling hover preview.
        this._hoverPreviewCard = null;
        this.colorController.endPreview();

        const presets = this.colorController.getPresets();
        const settings = this.colorController.getSettings();
        const symmetryData = this.appContext.worldManager.getSymmetryData();

        const checkedAttr = settings.flickerProofPresets ? 'checked' : '';
        let html = `
            <div class="preset-controls">
                <label title="Forces 'a cell being born' and 'a cell dying' to render black, so busy rulesets don't strobe between two bright colors.">
                    <input type="checkbox" id="flicker-proof-cb" ${checkedAttr}> Prevent birth/death flash <span class="preset-controls-hint">(recommended)</span>
                </label>
            </div>
        `;
        if (!settings.flickerProofPresets) {
            html += `
                <div class="preset-warning">
                    <span>⚠️ Some palettes may flicker rapidly on busy rulesets. Re-enable the guard above if a world starts strobing.</span>
                </div>
            `;
        }

        let visHtml = '';
        for (const [key, preset] of Object.entries(presets)) {
            let tempSettingsForViz;
            let isActive = false;

            if (preset.logic) {
                // Logic presets ("Symmetry Groups", "Neighbor Counts") preview the CURRENT custom
                // colors for that mode and are active when the app's mode matches their logic type.
                tempSettingsForViz = { ...settings, mode: preset.logic };
                isActive = settings.mode === preset.logic;
            } else {
                tempSettingsForViz = { ...settings, mode: 'preset', activePreset: key, flickerProofPresets: settings.flickerProofPresets };
                isActive = settings.mode === 'preset' && settings.activePreset === key;
            }

            const lut = generatePaletteVisualizationLUT(tempSettingsForViz, symmetryData);
            const base64 = colorLUTtoBase64(lut);
            const cvdBadge = preset.cvdSafe
                ? `<span class="preset-badge preset-badge--cvd" title="Colorblind-safe: luminance rises steadily along the ramp, readable with any color vision">CVD-safe</span>`
                : '';
            visHtml += `
                <button class="preset-vis-container ${isActive ? 'active' : ''}" data-preset="${key}" title="${preset.name}" aria-label="Apply ${preset.name} palette" aria-pressed="${isActive}">
                    <span class="preset-active-check" aria-hidden="true">${ICONS.check}</span>
                    <img src="${base64}" alt="" aria-hidden="true">
                    <span class="preset-name">${preset.name}</span>
                    ${cvdBadge}
                </button>
            `;
        }

        html += `<div class="preset-visualizations">${visHtml}</div>`;
        this.uiElements.presetSection.innerHTML = html;

        const cb = this.uiElements.presetSection.querySelector('#flicker-proof-cb');
        if (cb) {
            cb.addEventListener('change', (e) => {
                this.colorController.toggleFlickerProofPresets(e.target.checked);
                this.refresh();
            });
        }
    }

    // --- Gradient tab ---------------------------------------------------------

    _currentGradient() {
        const g = this.colorController.getSettings().customGradient || {};
        const on = Array.isArray(g.on) && g.on.length ? [...g.on] : ['#3cb44b', '#ffe119'];
        const off = Array.isArray(g.off) && g.off.length ? [...g.off] : on.map(c => darkenHex(c));
        return { on, off, autoOff: g.autoOff !== false };
    }

    _commitGradient({ on, off, autoOff }) {
        const effectiveOff = autoOff ? on.map(c => darkenHex(c)) : off;
        this.colorController.setCustomGradient({ on, off: effectiveOff, autoOff });
    }

    _renderGradientSection() {
        const settings = this.colorController.getSettings();
        const g = this._currentGradient();
        const symmetryData = this.appContext.worldManager.getSymmetryData();
        const lut = generateColorLUT({ ...settings, mode: 'gradient', customGradient: g }, symmetryData);

        const chipRow = (stops, band) => `
            <div class="chroma-stops-row" data-band="${band}">
                ${stops.map((c, i) => `
                    <span class="chroma-stop-chip" data-band="${band}" data-index="${i}" style="background:${c}" role="button" tabindex="0" title="Change this color" aria-label="Color stop ${i + 1}: ${c}">
                        ${stops.length > 1 ? `<button class="chroma-stop-remove" data-remove="1" title="Remove this color" aria-label="Remove color stop ${i + 1}">&times;</button>` : ''}
                    </span>
                `).join('')}
                <button class="chroma-stop-add" data-band="${band}" title="Add a color" aria-label="Add a color stop">${ICONS.plus}</button>
            </div>
        `;

        this.uiElements.gradientSection.innerHTML = `
            <div class="chroma-gradient-lab">
                <div class="chroma-gradient-preview" title="How the 128 rules get painted — top row: inactive cells, bottom row: active cells">
                    <img src="${colorLUTtoBase64(lut)}" alt="Gradient preview across the 128 rules">
                    <div class="chroma-gradient-preview-labels" aria-hidden="true"><span>rule 0</span><span>rule 127</span></div>
                </div>
                <div class="chroma-stops-group">
                    <div class="chroma-stops-head"><h5>Active cells</h5></div>
                    ${chipRow(g.on, 'on')}
                </div>
                <label class="chroma-auto-off" title="Inactive cells get an automatically darkened version of each active color, so structure stays readable.">
                    <input type="checkbox" id="chroma-auto-off-cb" ${g.autoOff ? 'checked' : ''}>
                    <span>Auto-darken for inactive cells</span>
                </label>
                <div class="chroma-stops-group ${g.autoOff ? 'hidden' : ''}" id="chroma-off-stops-group">
                    <div class="chroma-stops-head"><h5>Inactive cells</h5></div>
                    ${chipRow(g.off, 'off')}
                </div>
                <div class="chroma-gradient-actions">
                    <button class="button chroma-shuffle-btn" id="chroma-shuffle" title="Roll a brand-new random gradient" aria-label="Roll a random gradient"><span class="inline-icon">${ICONS.wand}</span> Surprise me</button>
                </div>
            </div>
        `;
    }

    /** Roll a random 2–4 stop gradient with related hues (analogous or complementary spread). */
    _shuffleGradient() {
        const stops = 2 + Math.floor(Math.random() * 3);
        const baseHue = Math.random() * 360;
        // Half the rolls sweep nearby hues (harmonious), half leap across the wheel (bold).
        const spread = Math.random() < 0.5 ? 40 + Math.random() * 60 : 140 + Math.random() * 100;
        const on = Array.from({ length: stops }, (_, i) => {
            const h = (baseHue + (i / Math.max(1, stops - 1)) * spread) % 360;
            const s = 0.65 + Math.random() * 0.3;
            const l = 0.45 + Math.random() * 0.15;
            return hslToHex(h, s, l);
        });
        this._commitGradient({ on, off: [], autoOff: true });
    }

    /**
     * Open the browser's native color picker for a callback pair. `onInput` fires live while the
     * user drags (wire it to a non-persisting preview); `onChange` fires on close (commit).
     */
    _openNativeColor(initial, { onInput, onChange }) {
        const input = this.uiElements.nativeColor;
        if (!input) return;
        this._nativeColorHandlers = { onInput, onChange };
        input.value = /^#[0-9a-f]{6}$/i.test(initial) ? initial : '#ffffff';
        input.click();
    }

    // --- Fine-Tune tab ---------------------------------------------------------

    _renderGroupSection(groupType) {
        const container = groupType === 'neighbor_count' ? this.uiElements.neighborSection : this.uiElements.symmetrySection;
        const symmetryData = this.appContext.worldManager.getSymmetryData();
        const groups = groupType === 'neighbor_count'
            ? Array.from({ length: 7 }, (_, i) => ({ id: i, label: `${i} neighbors` }))
            : symmetryData.canonicalRepresentatives.map(g => ({
                id: g.representative,
                orbitSize: g.orbitSize
            }));

        let html = '<div class="color-group-grid">';
        ['OFF', 'ON'].forEach(stateName => {
            const centerState = stateName === 'ON' ? 1 : 0;
            html += `<div class="color-group-column" data-center-state="${centerState}">
                        <h5>
                            Cell currently ${stateName}
                            <div class="column-actions">
                                <button class="button-link select-all-swatches" data-state-type="off">Select →offs</button>
                                <button class="button-link select-all-swatches" data-state-type="on">Select →ons</button>
                                <button class="button-link reset-column-defaults" data-mode="${groupType}" title="Reset all colors for this mode to defaults">Reset</button>
                            </div>
                        </h5>`;
            groups.forEach(group => {
                const groupKey = `${groupType}-${centerState}-${group.id}`;
                const labelHtml = groupType === 'neighbor_count'
                    ? group.label
                    : `<div class="r-sym-rule-viz">${this._getSymmetryVizHtml(group.id, group.orbitSize, centerState)}</div>`;

                html += `<div class="color-group" data-group-key="${groupKey}">
                           <div class="group-label-container">${labelHtml}</div>
                           <div class="color-swatch-pair">
                               <div class="color-swatch-wrapper" data-state-type="off" title="Color when the rule turns the cell OFF" role="button" tabindex="0" aria-label="Color for ${groupType === 'neighbor_count' ? group.label : 'this rule family'}, cell ${stateName}, output off">
                                   <span class="swatch-label">→ off</span>
                                   <div class="color-swatch"></div>
                               </div>
                               <div class="color-swatch-wrapper" data-state-type="on" title="Color when the rule turns the cell ON" role="button" tabindex="0" aria-label="Color for ${groupType === 'neighbor_count' ? group.label : 'this rule family'}, cell ${stateName}, output on">
                                   <span class="swatch-label">→ on</span>
                                   <div class="color-swatch"></div>
                               </div>
                           </div>
                         </div>`;
            });
            html += '</div>';
        });
        html += '</div>';
        container.innerHTML = html;
    }

    _getSymmetryVizHtml(bitmask, orbitSize, centerState = 0) {
        const neighborHexes = Array.from({ length: 6 }, (_, n) => `<div class="hexagon neighbor-hex neighbor-${n} state-${(bitmask >> n) & 1}"></div>`).join('');
        return `<div class="rule-viz-hex-display">
                    <div class="hexagon center-hex state-${centerState}"></div> ${neighborHexes}
                </div>
                <div class="orbit-size-display">Orbit: ${orbitSize}</div>`;
    }

    // --- Events ----------------------------------------------------------------

    _setupEventListeners() {
        // Tab strip → mode. The Fine-Tune tab restores the last grouping the user was on.
        this.uiElements.tabs.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('.chroma-tab');
            if (!tabBtn) return;
            const tab = tabBtn.dataset.tab;
            if (tab === 'palettes') this.colorController.setMode('preset');
            else if (tab === 'gradient') this.colorController.setMode('gradient');
            else this.colorController.setMode(this.groupMode);
            this.refresh();
        });

        this.uiElements.finetuneSection.addEventListener('click', (e) => {
            const subtab = e.target.closest('.chroma-subtab');
            if (!subtab) return;
            this.groupMode = subtab.dataset.group;
            this.colorController.setMode(this.groupMode);
        });

        // Hover a preset card → live palette preview on the real canvas (pointer devices only).
        if (window.matchMedia && window.matchMedia('(hover: hover)').matches) {
            this.uiElements.presetSection.addEventListener('mouseover', (e) => {
                const card = e.target.closest('.preset-vis-container');
                if (!card || card === this._hoverPreviewCard) return;
                this._hoverPreviewCard = card;
                const preset = this.colorController.getPresets()[card.dataset.preset];
                if (!preset) return;
                this.colorController.previewSettings(
                    preset.logic ? { mode: preset.logic } : { mode: 'preset', activePreset: card.dataset.preset }
                );
            });
            this.uiElements.presetSection.addEventListener('mouseout', (e) => {
                const card = e.target.closest('.preset-vis-container');
                if (!card || (e.relatedTarget && card.contains(e.relatedTarget))) return;
                this._hoverPreviewCard = null;
                this.colorController.endPreview();
            });
        }

        // Gradient tab (delegated; the section re-renders on every commit).
        this.uiElements.gradientSection.addEventListener('click', (e) => {
            const g = this._currentGradient();

            if (e.target.closest('#chroma-shuffle')) {
                this._shuffleGradient();
                return;
            }
            const removeBtn = e.target.closest('.chroma-stop-remove');
            if (removeBtn) {
                const chip = removeBtn.closest('.chroma-stop-chip');
                const band = chip.dataset.band;
                g[band].splice(parseInt(chip.dataset.index, 10), 1);
                this._commitGradient(g);
                return;
            }
            const addBtn = e.target.closest('.chroma-stop-add');
            if (addBtn) {
                g[addBtn.dataset.band].push(hslToHex(Math.random() * 360, 0.8, 0.55));
                this._commitGradient(g);
                return;
            }
            const chip = e.target.closest('.chroma-stop-chip');
            if (chip) {
                const band = chip.dataset.band;
                const index = parseInt(chip.dataset.index, 10);
                this._openNativeColor(g[band][index], {
                    onInput: (color) => {
                        const live = this._currentGradient();
                        live[band][index] = color;
                        if (live.autoOff) live.off = live.on.map(c => darkenHex(c));
                        this.colorController.previewSettings({ mode: 'gradient', customGradient: live });
                    },
                    onChange: (color) => {
                        const done = this._currentGradient();
                        done[band][index] = color;
                        this.colorController.endPreview();
                        this._commitGradient(done);
                    },
                });
            }
        });
        this.uiElements.gradientSection.addEventListener('change', (e) => {
            if (e.target.id === 'chroma-auto-off-cb') {
                const g = this._currentGradient();
                this._commitGradient({ ...g, autoOff: e.target.checked });
            }
        });

        // Native color picker plumbing (one hidden input, per-open handlers).
        if (this.uiElements.nativeColor) {
            this.uiElements.nativeColor.addEventListener('input', (e) => {
                this._nativeColorHandlers?.onInput?.(e.target.value);
            });
            this.uiElements.nativeColor.addEventListener('change', (e) => {
                const handlers = this._nativeColorHandlers;
                this._nativeColorHandlers = null;
                handlers?.onChange?.(e.target.value);
            });
        }

        this.element.addEventListener('click', (e) => {
            const visContainer = e.target.closest('.preset-vis-container');
            if (visContainer) {
                this.colorController.applyPreset(visContainer.dataset.preset);
                return;
            }

            if (e.target.matches('.select-all-swatches')) {
                const column = e.target.closest('.color-group-column');
                const stateTypeToSelect = e.target.dataset.stateType;
                const swatchesInColumn = column.querySelectorAll(`.color-swatch-wrapper[data-state-type="${stateTypeToSelect}"]`);
                const areAllSelected = Array.from(swatchesInColumn).every(sw => sw.classList.contains('selected'));

                swatchesInColumn.forEach(swatch => {
                    const groupKey = swatch.closest('.color-group').dataset.groupKey;
                    const swatchKey = `${groupKey}-${stateTypeToSelect}`;
                    if (areAllSelected) {
                        const selectedIndex = this.selectedSwatches.indexOf(swatchKey);
                        if (selectedIndex > -1) this.selectedSwatches.splice(selectedIndex, 1);
                    } else if (!this.selectedSwatches.includes(swatchKey)) {
                        this.selectedSwatches.push(swatchKey);
                    }
                });
                this._updateSelectionVisuals();
                this._updateBatchActionBar();
                return;
            }

            if (e.target.matches('.reset-column-defaults')) {
                const mode = e.target.dataset.mode;
                const modeDisplayName = mode === 'neighbor_count' ? 'Neighbor Count' : 'Symmetry';
                EventBus.dispatch(EVENTS.COMMAND_SHOW_CONFIRMATION, {
                    title: 'Reset Colors',
                    message: `Reset all '${modeDisplayName}' colors to their defaults?`,
                    confirmLabel: 'Reset',
                    onConfirm: () => this.colorController.resetToDefaults(mode),
                });
                return;
            }

            const swatchWrapper = e.target.closest('.color-swatch-wrapper');
            if (swatchWrapper) {
                const groupKey = swatchWrapper.closest('.color-group').dataset.groupKey;
                const stateType = swatchWrapper.dataset.stateType;
                const swatchKey = `${groupKey}-${stateType}`;

                if (e.metaKey || e.ctrlKey) {
                    const selectedIndex = this.selectedSwatches.indexOf(swatchKey);
                    if (selectedIndex > -1) this.selectedSwatches.splice(selectedIndex, 1);
                    else this.selectedSwatches.push(swatchKey);
                    this._updateSelectionVisuals();
                } else {
                    this._openColorPalette(swatchWrapper);
                }
                this._updateBatchActionBar();
            }
        });
        // Global hue-shift slider: live-preview the canvas while dragging (no persist), commit on
        // release. Achromatic colors are untouched by the rotation (see rotateHue), so blacks/grays
        // stay put and only the chromatic palette rotates off the unwanted hue.
        if (this.uiElements.hueSlider) {
            this.uiElements.hueSlider.addEventListener('input', (e) => {
                const deg = parseInt(e.target.value, 10) || 0;
                if (this.uiElements.hueValue) this.uiElements.hueValue.textContent = `${deg}°`;
                this.colorController.previewSettings({ hueShift: deg });
            });
            this.uiElements.hueSlider.addEventListener('change', (e) => {
                const deg = parseInt(e.target.value, 10) || 0;
                this.colorController.setHueShift(deg);
                this.colorController.endPreview();
            });
        }
        if (this.uiElements.hueReset) {
            this.uiElements.hueReset.addEventListener('click', () => {
                this.colorController.endPreview();
                this.colorController.setHueShift(0);
            });
        }

        this._subscribeToEvent(EVENTS.COLOR_SETTINGS_CHANGED, this.refresh);
    }

    /** Keep the hue-shift slider + readout in sync with the persisted setting. */
    _syncHueShiftControl() {
        const deg = this.colorController.getSettings().hueShift || 0;
        if (this.uiElements.hueSlider) this.uiElements.hueSlider.value = String(deg);
        if (this.uiElements.hueValue) this.uiElements.hueValue.textContent = `${deg}°`;
        if (this.uiElements.hueReset) this.uiElements.hueReset.disabled = deg === 0;
    }

    // --- Pickers / batch tools ---------------------------------------------------

    /** Shared picker body: curated swatch grid + a free custom-color row. */
    _paletteModalBody() {
        return `
            <div class="color-palette-content">${CURATED_PALETTE.map(c => `<div class="palette-color" style="background-color: ${c}" data-color="${c}" role="button" aria-label="Pick ${c}"></div>`).join('')}</div>
            <div class="palette-custom-row">
                <label>Custom <input type="color" class="palette-custom-input" value="#ffffff"></label>
                <button class="button palette-custom-apply">Use this color</button>
            </div>
        `;
    }

    /** Wire the shared picker body: any curated click OR custom apply resolves with the color. */
    _bindPaletteModal(modal, onPick) {
        modal.addEventListener('click', (e) => {
            if (e.target.matches('.palette-color')) {
                onPick(e.target.dataset.color);
            } else if (e.target.matches('.palette-custom-apply')) {
                onPick(modal.querySelector('.palette-custom-input').value);
            } else if (e.target === modal) {
                modal.remove();
            }
        });
    }

    _openColorPalette(targetWrapper) {
        let modal = document.getElementById('color-palette-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'color-palette-modal';
        modal.innerHTML = `<div class="color-palette-panel">${this._paletteModalBody()}</div>`;

        this._bindPaletteModal(modal, (color) => {
            const domKey = targetWrapper.closest('.color-group').dataset.groupKey;
            const mode = this.colorController.getSettings().mode;
            const dataKey = domKey.substring(mode.length + 1);
            const stateType = targetWrapper.dataset.stateType;
            this.colorController.setColorForGroup(mode, dataKey, stateType, color);
            modal.remove();
        });
        document.body.appendChild(modal);
    }

    _updateSelectionVisuals() {
        this.element.querySelectorAll('.color-swatch-wrapper.selected').forEach(el => {
            el.classList.remove('selected');
            const marker = el.querySelector('.selection-order-marker');
            if (marker) marker.remove();
        });

        this.selectedSwatches.forEach((swatchKey, index) => {
            const parts = swatchKey.split('-');
            const stateType = parts.pop();
            const groupKey = parts.join('-');
            const selector = `[data-group-key="${groupKey}"] [data-state-type="${stateType}"]`;
            const el = this.element.querySelector(selector);
            if (el) {
                el.classList.add('selected');
                const marker = document.createElement('div');
                marker.className = 'selection-order-marker';
                marker.textContent = index + 1;
                el.appendChild(marker);
            }
        });
    }

    refresh = () => {
        const settings = this.colorController.getSettings();
        this._syncHueShiftControl();
        if (settings.mode === 'neighbor_count' || settings.mode === 'symmetry') {
            this.groupMode = settings.mode;
        }
        const activeTab = settings.mode === 'preset' ? 'palettes'
            : settings.mode === 'gradient' ? 'gradient'
            : 'finetune';

        this.uiElements.tabs.querySelectorAll('.chroma-tab').forEach(btn => {
            const isActive = btn.dataset.tab === activeTab;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
        });
        const tabDef = TAB_DEFS.find(t => t.id === activeTab);
        if (this.uiElements.tabHint) this.uiElements.tabHint.textContent = tabDef ? tabDef.hint : '';

        this.uiElements.presetSection.classList.toggle('hidden', activeTab !== 'palettes');
        this.uiElements.gradientSection.classList.toggle('hidden', activeTab !== 'gradient');
        this.uiElements.finetuneSection.classList.toggle('hidden', activeTab !== 'finetune');

        // Re-render the tab bodies so previews reflect the latest colors.
        this._renderPresetSection();
        this._renderGradientSection();

        this.uiElements.finetuneSection.querySelectorAll('.chroma-subtab').forEach(btn => {
            const isActive = btn.dataset.group === this.groupMode;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
        });
        this.uiElements.neighborSection.classList.toggle('hidden', this.groupMode !== 'neighbor_count');
        this.uiElements.symmetrySection.classList.toggle('hidden', this.groupMode !== 'symmetry');

        const updateSwatches = (groupType, colorMap) => {
            const section = groupType === 'neighbor_count' ? this.uiElements.neighborSection : this.uiElements.symmetrySection;
            section.querySelectorAll('.color-group').forEach(group => {
                const domKey = group.dataset.groupKey; // e.g. "symmetry-0-12"
                const dataKey = domKey.substring(groupType.length + 1); // e.g. "0-12"
                const colors = colorMap[dataKey] || { on: '#ffffff', off: '#333333' };
                const onSwatch = group.querySelector('[data-state-type="on"] .color-swatch');
                const offSwatch = group.querySelector('[data-state-type="off"] .color-swatch');
                if (onSwatch) onSwatch.style.backgroundColor = colors.on;
                if (offSwatch) offSwatch.style.backgroundColor = colors.off;
            });
        };
        updateSwatches('neighbor_count', settings.customNeighborColors);
        updateSwatches('symmetry', settings.customSymmetryColors);

        this.selectedSwatches = [];
        this._updateSelectionVisuals();
        this._updateBatchActionBar();

        // Flicker warning for the group modes.
        if (settings.mode === 'neighbor_count' || settings.mode === 'symmetry') {
            const section = settings.mode === 'neighbor_count' ? this.uiElements.neighborSection : this.uiElements.symmetrySection;
            let warning = section.querySelector('.flicker-warning');
            const isProne = this._isFlickerProne(settings);
            if (isProne) {
                if (!warning) {
                    warning = document.createElement('div');
                    warning.className = 'flicker-warning';
                    warning.innerHTML = `
                        <span>⚠️ This coloring may flash on birth/death transitions.</span>
                        <button class="button deflicker-btn">Fix it</button>
                    `;
                    section.insertBefore(warning, section.firstChild);
                    warning.querySelector('.deflicker-btn').addEventListener('click', (e) => {
                        e.stopPropagation();
                        this._deflicker();
                    });
                }
            } else if (warning) {
                warning.remove();
            }
        }
    }

    _isFlickerProne(settings) {
        const { mode, customNeighborColors, customSymmetryColors } = settings;
        if (mode === 'neighbor_count') {
            const birthColor = customNeighborColors['0-0']?.on ?? '#ffffff';
            const deathColor = customNeighborColors['1-6']?.off ?? '#333333';
            return birthColor.toLowerCase() !== deathColor.toLowerCase();
        } else if (mode === 'symmetry') {
            const birthColor = customSymmetryColors['0-0']?.on ?? '#ffffff';
            const deathColor = customSymmetryColors['1-63']?.off ?? '#333333';
            return birthColor.toLowerCase() !== deathColor.toLowerCase();
        }
        return false;
    }

    _deflicker() {
        const settings = this.colorController.getSettings();
        const mode = settings.mode;
        let birthKey, deathKey;
        if (mode === 'neighbor_count') {
            birthKey = '0-0';
            deathKey = '1-6';
        } else {
            birthKey = '0-0';
            deathKey = '1-63';
        }
        const black = '#000000';
        this.colorController.setColorForGroup(mode, birthKey, 'on', black);
        this.colorController.setColorForGroup(mode, deathKey, 'off', black);
    }

    _updateBatchActionBar() {
        const bar = this.uiElements.batchActionBar;
        if (this.selectedSwatches.length > 0) {
            bar.innerHTML = `<span>${this.selectedSwatches.length} selected</span>
                             <div class="batch-actions">
                                 <button class="button-link clear-selection" title="Clear selection">Clear</button>
                                 <div class="batch-swatch" role="button" tabindex="0"></div>
                             </div>`;
            bar.classList.remove('hidden');

            const batchSwatch = bar.querySelector('.batch-swatch');
            const clearButton = bar.querySelector('.clear-selection');

            if (this.selectedSwatches.length > 1) {
                batchSwatch.textContent = 'Sweep a gradient…';
                batchSwatch.title = 'Create a gradient across the selected swatches, in selection order';
                batchSwatch.addEventListener('click', () => this._openGradientCreator(), { once: true });
            } else {
                batchSwatch.textContent = 'Set color…';
                batchSwatch.title = 'Set the color of the selected swatch';
                batchSwatch.addEventListener('click', () => this._openBatchColorPalette(), { once: true });
            }

            clearButton.addEventListener('click', () => {
                this.selectedSwatches = [];
                this._updateSelectionVisuals();
                this._updateBatchActionBar();
            }, { once: true });
        } else {
            bar.classList.add('hidden');
        }
    }

    _openBatchColorPalette() {
        let modal = document.getElementById('color-palette-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'color-palette-modal';
        modal.innerHTML = `<div class="color-palette-panel">${this._paletteModalBody()}</div>`;

        this._bindPaletteModal(modal, (color) => {
            const mode = this.colorController.getSettings().mode;
            const onKeys = [], offKeys = [];
            this.selectedSwatches.forEach(swatchKey => {
                const parts = swatchKey.split('-');
                const stateType = parts.pop();
                const domKey = parts.join('-');
                const dataKey = domKey.substring(mode.length + 1);
                if (stateType === 'on') onKeys.push(dataKey);
                else offKeys.push(dataKey);
            });
            if (onKeys.length > 0) this.colorController.setBatchColors(mode, onKeys, 'on', color);
            if (offKeys.length > 0) this.colorController.setBatchColors(mode, offKeys, 'off', color);

            this.selectedSwatches = [];
            this._updateSelectionVisuals();
            this._updateBatchActionBar();
            modal.remove();
        });
        document.body.appendChild(modal);
    }

    _openGradientCreator() {
        let modal = document.getElementById('gradient-creator-modal');
        if (modal) modal.remove();

        let gradientStops = [];

        modal = document.createElement('div');
        modal.id = 'gradient-creator-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 450px;">
                <h4>Sweep a Gradient</h4>
                <p>Click colors in order to build your gradient — it's applied across the swatches in the order you selected them.</p>
                <div id="gradient-preview-strip"></div>
                ${this._paletteModalBody()}
                <div class="modal-actions">
                    <button class="button" id="gradient-undo-btn" disabled>Undo last</button>
                    <button class="button" id="gradient-cancel-btn">Cancel</button>
                    <button class="button" id="gradient-apply-btn" disabled>Apply Gradient</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const previewStrip = modal.querySelector('#gradient-preview-strip');
        const applyBtn = modal.querySelector('#gradient-apply-btn');
        const undoBtn = modal.querySelector('#gradient-undo-btn');

        const updatePreview = () => {
            if (gradientStops.length > 0) {
                previewStrip.style.background = gradientStops.length === 1
                    ? gradientStops[0]
                    : `linear-gradient(to right, ${gradientStops.join(', ')})`;
            } else {
                previewStrip.style.background = '#222';
            }
            applyBtn.disabled = gradientStops.length === 0;
            undoBtn.disabled = gradientStops.length === 0;
        };

        modal.addEventListener('click', e => {
            if (e.target.matches('.palette-color')) {
                gradientStops.push(e.target.dataset.color);
                updatePreview();
            } else if (e.target.matches('.palette-custom-apply')) {
                gradientStops.push(modal.querySelector('.palette-custom-input').value);
                updatePreview();
            } else if (e.target === modal) {
                modal.remove();
            }
        });

        undoBtn.addEventListener('click', () => {
            gradientStops.pop();
            updatePreview();
        });

        applyBtn.addEventListener('click', () => {
            this.appContext.colorController.applyGradientToSelection(this.selectedSwatches, gradientStops);
            modal.remove();
        }, { once: true });

        modal.querySelector('#gradient-cancel-btn').addEventListener('click', () => modal.remove(), { once: true });

        updatePreview();
    }
}
