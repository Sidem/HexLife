import { BaseComponent } from './BaseComponent.js';
import { EVENTS } from '../../services/EventBus.js';
import { generatePaletteVisualizationLUT, colorLUTtoBase64 } from '../../utils/ruleVizUtils.js';

// The curated palette for the color pickers
const CURATED_PALETTE = ['#fed4d4', '#fe9494', '#ff3f3f', '#ff0000', '#bf0000', '#6a0000', '#2a0000', '#fee9d4', '#fec994', '#ff9f3f', '#ff7f00', '#bf5f00', '#6a3500', '#2a1500', '#fefed4', '#fefe94', '#feff3f', '#feff00', '#bfbf00', '#6a6a00', '#2a2a00', '#dffed4', '#affe94', '#6fff3f', '#3fff00', '#2fbf00', '#1a6a00', '#0a2a00', '#d4fee9', '#94fec9', '#3fff9f', '#00ff7f', '#00bf5f', '#006a35', '#002a15', '#d4fefe', '#94fefe', '#3ffeff', '#00feff', '#00bfbf', '#006a6a', '#002a2a', '#d4e9fe', '#94c9fe', '#3f9fff', '#007fff', '#005fbf', '#00356a', '#00152a', '#d4d4fe', '#9494fe', '#3f3fff', '#0000ff', '#0000bf', '#00006a', '#00002a', '#e9d4fe', '#c994fe', '#9f3fff', '#7f00ff', '#5f00bf', '#35006a', '#15002a', '#fed4fe', '#fe94fe', '#ff3ffe', '#ff00fe', '#bf00bf', '#6a006a', '#2a002a', '#fed4e9', '#fe94c9', '#ff3f9f', '#ff007f', '#bf005f', '#6a0035', '#2a0015', '#ffffff', '#d4d4d4', '#aaaaaa', '#7f7f7f', '#555555', '#2a2a2a', '#000000'];

export class ChromaLabComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options);
        if (!appContext || !appContext.colorController) {
            console.error('ChromaLabComponent: appContext or colorController is null.');
            return;
        }
        this.appContext = appContext;
        this.colorController = appContext.colorController;
        this.selectedSwatches = new Set();
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
                <div id="chroma-batch-action-bar" class="hidden"></div>
                <div class="chroma-mode-section">
                    <h4>Mode</h4>
                    <select id="chroma-mode-select" title="Select color mode">
                        <option value="preset">Preset Palettes</option>
                        <option value="neighbor_count">Neighbor Count</option>
                        <option value="symmetry">Symmetry Groups</option>
                    </select>
                </div>
                <div id="chroma-preset-section" class="chroma-section"></div>
                <div id="chroma-neighbor-section" class="chroma-section hidden"></div>
                <div id="chroma-symmetry-section" class="chroma-section hidden"></div>
            </div>
        `;
        this.uiElements = {
            modeSelect: this.element.querySelector('#chroma-mode-select'),
            presetSection: this.element.querySelector('#chroma-preset-section'),
            neighborSection: this.element.querySelector('#chroma-neighbor-section'),
            symmetrySection: this.element.querySelector('#chroma-symmetry-section'),
            batchActionBar: this.element.querySelector('#chroma-batch-action-bar'),
        };
        this._renderAllSections();
    }

    _renderAllSections() {
        this._renderPresetSection();
        this._renderGroupSection('neighbor_count');
        this._renderGroupSection('symmetry');
    }

    _renderPresetSection() {
        const presets = this.colorController.getPresets();
        const settings = this.colorController.getSettings();
        const symmetryData = this.appContext.worldManager.getSymmetryData();

        let visHtml = '';

        // 1. Generate visualizations for all static presets
        for (const [key, preset] of Object.entries(presets)) {
            const tempSettings = { ...settings, mode: 'preset', activePreset: key };
            const lut = generatePaletteVisualizationLUT(tempSettings, symmetryData);
            const base64 = colorLUTtoBase64(lut);
            const isActive = settings.mode === 'preset' && settings.activePreset === key;
            visHtml += `
                <div class="preset-vis-container ${isActive ? 'active' : ''}" data-preset="${key}" title="${preset.name}">
                    <img src="${base64}" alt="${preset.name} Palette Preview">
                    <span>${preset.name}</span>
                </div>
            `;
        }

        // 2. Generate visualization for the current "Neighbor Count" settings
        const neighborSettings = { ...settings, mode: 'neighbor_count' };
        const neighborLut = generatePaletteVisualizationLUT(neighborSettings, symmetryData);
        const neighborBase64 = colorLUTtoBase64(neighborLut);
        const isNeighborModeActive = settings.mode === 'neighbor_count';
        visHtml += `
            <div class="preset-vis-container ${isNeighborModeActive ? 'active' : ''}" data-preset="neighbor_count" title="Current Custom Neighbor Count Colors">
                <img src="${neighborBase64}" alt="Custom Neighbor Count Palette Preview">
                <span>Custom (Neighbors)</span>
            </div>
        `;

        // 3. Generate visualization for the current "Symmetry" settings
        const symmetrySettings = { ...settings, mode: 'symmetry' };
        const symmetryLut = generatePaletteVisualizationLUT(symmetrySettings, symmetryData);
        const symmetryBase64 = colorLUTtoBase64(symmetryLut);
        const isSymmetryModeActive = settings.mode === 'symmetry';
        visHtml += `
            <div class="preset-vis-container ${isSymmetryModeActive ? 'active' : ''}" data-preset="symmetry" title="Current Custom Symmetry Group Colors">
                <img src="${symmetryBase64}" alt="Custom Symmetry Palette Preview">
                <span>Custom (Symmetry)</span>
            </div>
        `;
        
        this.uiElements.presetSection.innerHTML = `<div class="preset-visualizations">${visHtml}</div>`;
    }

    _renderGroupSection(groupType) {
        const container = groupType === 'neighbor_count' ? this.uiElements.neighborSection : this.uiElements.symmetrySection;
        const symmetryData = this.appContext.worldManager.getSymmetryData();
        const groups = groupType === 'neighbor_count'
            ? Array.from({ length: 7 }, (_, i) => ({ id: i, label: `${i} Neighbors` }))
            : symmetryData.canonicalRepresentatives.map(g => ({
                id: g.representative,
                orbitSize: g.orbitSize
            }));

        let html = '<div class="color-group-grid">';
        ['OFF', 'ON'].forEach(stateName => {
            const centerState = stateName === 'ON' ? 1 : 0;
            html += `<div class="color-group-column" data-center-state="${centerState}">
                        <h5>
                            Cell ${stateName}
                            <div class="select-all-buttons">
                                <button class="button-link select-all-swatches" data-state-type="off">Select OFFs</button> |
                                <button class="button-link select-all-swatches" data-state-type="on">Select ONs</button>
                            </div>
                        </h5>`;
            groups.forEach(group => {
                const groupKey = `${centerState}-${group.id}`;
                const labelHtml = groupType === 'neighbor_count'
                    ? group.label
                    : `<div class="r-sym-rule-viz">${this._getSymmetryVizHtml(group.id, group.orbitSize, centerState)}</div>`;

                html += `<div class="color-group" data-group-key="${groupKey}">
                           <div class="group-label-container">${labelHtml}</div>
                           <div class="color-swatch-pair">
                               <div class="color-swatch-wrapper" data-state-type="off">
                                   <span class="swatch-label">🢂OFF</span>
                                   <div class="color-swatch"></div>
                               </div>
                               <div class="color-swatch-wrapper" data-state-type="on">
                                   <span class="swatch-label">🢂ON</span>
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

    _setupEventListeners() {
        this.uiElements.modeSelect.addEventListener('change', (e) => this.colorController.setMode(e.target.value));
        this.element.addEventListener('click', (e) => {
            // Modify the preset button handler
            const visContainer = e.target.closest('.preset-vis-container');
            if (visContainer) {
                const presetName = visContainer.dataset.preset;
                if (presetName === 'neighbor_count' || presetName === 'symmetry') {
                    this.colorController.setMode(presetName);
                } else {
                    this.colorController.applyPreset(presetName);
                }
                return;
            }

            if (e.target.matches('.select-all-swatches')) {
                const column = e.target.closest('.color-group-column');
                const stateTypeToSelect = e.target.dataset.stateType;

                const swatchesInColumn = column.querySelectorAll(`.color-swatch-wrapper[data-state-type="${stateTypeToSelect}"]`);
                
                // Determine if we are selecting or deselecting
                const areAllSelected = Array.from(swatchesInColumn).every(sw => sw.classList.contains('selected'));

                swatchesInColumn.forEach(swatch => {
                    const groupKey = swatch.closest('.color-group').dataset.groupKey;
                    const swatchKey = `${groupKey}-${stateTypeToSelect}`;

                    if (areAllSelected) {
                        swatch.classList.remove('selected');
                        this.selectedSwatches.delete(swatchKey);
                    } else {
                        swatch.classList.add('selected');
                        this.selectedSwatches.add(swatchKey);
                    }
                });
                this._updateBatchActionBar();
                return;
            }

            const swatchWrapper = e.target.closest('.color-swatch-wrapper');
            if (swatchWrapper) {
                const groupKey = swatchWrapper.closest('.color-group').dataset.groupKey;
                const stateType = swatchWrapper.dataset.stateType;
                const swatchKey = `${groupKey}-${stateType}`;

                if (e.metaKey || e.ctrlKey) {
                    swatchWrapper.classList.toggle('selected');
                    if (this.selectedSwatches.has(swatchKey)) {
                        this.selectedSwatches.delete(swatchKey);
                    } else {
                        this.selectedSwatches.add(swatchKey);
                    }
                } else {
                    this._openColorPalette(swatchWrapper);
                }
                this._updateBatchActionBar();
            }
        });
        this._subscribeToEvent(EVENTS.COLOR_SETTINGS_CHANGED, this.refresh);
    }

    _openColorPalette(targetWrapper) {
        let modal = document.getElementById('color-palette-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'color-palette-modal';
        modal.innerHTML = `<div class="color-palette-content">${CURATED_PALETTE.map(c => `<div class="palette-color" style="background-color: ${c}" data-color="${c}"></div>`).join('')}</div>`;

        modal.addEventListener('click', (e) => {
            if (e.target.matches('.palette-color')) {
                const color = e.target.dataset.color;
                const groupKey = targetWrapper.closest('.color-group').dataset.groupKey;
                const stateType = targetWrapper.dataset.stateType;
                const mode = this.colorController.getSettings().mode;
                
                this.colorController.setColorForGroup(mode, groupKey, stateType, color);
                modal.remove();
            } else if (e.target.id === 'color-palette-modal') {
                modal.remove();
            }
        });
        document.body.appendChild(modal);
    }

    refresh = () => {
        const settings = this.colorController.getSettings();
        this.uiElements.modeSelect.value = settings.mode;

        // Re-render the preset visualizations every time to reflect the latest custom colors.
        this._renderPresetSection();

        this.element.querySelectorAll('.chroma-section').forEach(s => s.classList.add('hidden'));
        const sectionToShow = this.element.querySelector(`#chroma-${settings.mode.replace('_count', '')}-section`);
        if(sectionToShow) {
            sectionToShow.classList.remove('hidden');
        }

        const updateSwatches = (groupType, colorMap) => {
            const sectionId = `#chroma-${groupType.replace('_count', '')}-section`;
            this.element.querySelectorAll(`${sectionId} .color-group`).forEach(group => {
                const groupKey = group.dataset.groupKey;
                const colors = colorMap[groupKey] || { on: '#ffffff', off: '#333333' };
                const onSwatch = group.querySelector('[data-state-type="on"] .color-swatch');
                const offSwatch = group.querySelector('[data-state-type="off"] .color-swatch');
                if (onSwatch) onSwatch.style.backgroundColor = colors.on;
                if (offSwatch) offSwatch.style.backgroundColor = colors.off;
            });
        };

        updateSwatches('neighbor_count', settings.customNeighborColors);
        updateSwatches('symmetry', settings.customSymmetryColors);

        this.selectedSwatches.clear();
        this.element.querySelectorAll('.color-swatch-wrapper.selected').forEach(el => el.classList.remove('selected'));
        this._updateBatchActionBar();
    }

    _updateBatchActionBar() {
        const bar = this.uiElements.batchActionBar;
        if (this.selectedSwatches.size > 0) {
            bar.innerHTML = `<span>${this.selectedSwatches.size} swatches selected.</span>
                             <div style="display: flex; gap: 8px; align-items: center;">
                                 <button class="button-link clear-selection" title="Clear selection">Clear</button>
                                 <div class="batch-swatch" title="Set color for all selected swatches"></div>
                             </div>`;
            bar.classList.remove('hidden');
            bar.querySelector('.batch-swatch').addEventListener('click', () => {
                this._openBatchColorPalette();
            }, { once: true });
            bar.querySelector('.clear-selection').addEventListener('click', () => {
                this.selectedSwatches.clear();
                this.element.querySelectorAll('.color-swatch-wrapper.selected').forEach(el => el.classList.remove('selected'));
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
        modal.innerHTML = `<div class="color-palette-content">${CURATED_PALETTE.map(c => `<div class="palette-color" style="background-color: ${c}" data-color="${c}"></div>`).join('')}</div>`;
        
        modal.addEventListener('click', (e) => {
            if (e.target.matches('.palette-color')) {
                const color = e.target.dataset.color;
                const mode = this.colorController.getSettings().mode;

                const onKeys = [], offKeys = [];
                this.selectedSwatches.forEach(swatchKey => {
                    const parts = swatchKey.split('-');
                    const stateType = parts.pop();
                    const groupKey = parts.join('-');
                    if (stateType === 'on') onKeys.push(groupKey);
                    else offKeys.push(groupKey);
                });
                
                if (onKeys.length > 0) this.colorController.setBatchColors(mode, onKeys, 'on', color);
                if (offKeys.length > 0) this.colorController.setBatchColors(mode, offKeys, 'off', color);

                this.selectedSwatches.clear();
                this.element.querySelectorAll('.color-swatch-wrapper.selected').forEach(el => el.classList.remove('selected'));
                this._updateBatchActionBar();
                modal.remove();
            } else if (e.target.id === 'color-palette-modal') {
                modal.remove();
            }
        });
        document.body.appendChild(modal);
    }
} 