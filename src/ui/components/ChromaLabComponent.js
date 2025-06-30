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
        this.selectedSwatches = [];
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

        // Generate visualizations for all presets defined in colorPalettes.js
        for (const [key, preset] of Object.entries(presets)) {
            let tempSettingsForViz;
            let isActive = false;
            let lut;

            if (preset.logic) {
                // For logic-based presets ("Symmetry Groups", "Neighbor Counts")
                // The preview should reflect the CURRENT custom colors for that mode.
                tempSettingsForViz = { ...settings, mode: preset.logic };
                lut = generatePaletteVisualizationLUT(tempSettingsForViz, symmetryData);
                // This preset is active if the app's mode matches its logic type.
                isActive = settings.mode === preset.logic;
            } else {
                // For standard gradient presets ("Volcanic", "Oceanic", etc.)
                // The preview is based on its own definition.
                tempSettingsForViz = { ...settings, mode: 'preset', activePreset: key };
                lut = generatePaletteVisualizationLUT(tempSettingsForViz, symmetryData);
                // This preset is active if the app's mode is 'preset' and its key matches.
                isActive = settings.mode === 'preset' && settings.activePreset === key;
            }

            const base64 = colorLUTtoBase64(lut);
            visHtml += `
                <div class="preset-vis-container ${isActive ? 'active' : ''}" data-preset="${key}" title="${preset.name}">
                    <img src="${base64}" alt="${preset.name} Palette Preview">
                    <span>${preset.name}</span>
                </div>
            `;
        }
        
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
                            <div class="column-actions">
                                <button class="button-link select-all-swatches" data-state-type="off">Select OFFs</button> |
                                <button class="button-link select-all-swatches" data-state-type="on">Select ONs</button>
                                <button class="button-link reset-column-defaults" data-mode="${groupType}" title="Reset all colors for this mode to defaults">Reset Mode</button>
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
            const visContainer = e.target.closest('.preset-vis-container');
            if (visContainer) {
                const presetName = visContainer.dataset.preset;
                
                // Simplified logic using the updated controller method
                this.colorController.applyPreset(presetName);
                
                return; // Prevent other handlers from firing
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
                        const selectedIndex = this.selectedSwatches.indexOf(swatchKey);
                        if (selectedIndex > -1) {
                            this.selectedSwatches.splice(selectedIndex, 1);
                        }
                    } else {
                        if (!this.selectedSwatches.includes(swatchKey)) {
                            this.selectedSwatches.push(swatchKey);
                        }
                    }
                });
                this._updateSelectionVisuals();
                this._updateBatchActionBar();
                return;
            }

            if (e.target.matches('.reset-column-defaults')) {
                const mode = e.target.dataset.mode;
                const modeDisplayName = mode === 'neighbor_count' ? 'Neighbor Count' : 'Symmetry';
                if (confirm(`Are you sure you want to reset all colors for '${modeDisplayName}' mode to their defaults?`)) {
                    this.colorController.resetToDefaults(mode);
                }
                return;
            }

            const swatchWrapper = e.target.closest('.color-swatch-wrapper');
            if (swatchWrapper) {
                const groupKey = swatchWrapper.closest('.color-group').dataset.groupKey;
                const stateType = swatchWrapper.dataset.stateType;
                const swatchKey = `${groupKey}-${stateType}`;

                if (e.metaKey || e.ctrlKey) {
                    const selectedIndex = this.selectedSwatches.indexOf(swatchKey);
                    
                    if (selectedIndex > -1) {
                        // If already selected, remove it
                        this.selectedSwatches.splice(selectedIndex, 1);
                    } else {
                        // If not selected, add it to the end
                        this.selectedSwatches.push(swatchKey);
                    }
                    // Re-render all selection numbers to maintain correct order
                    this._updateSelectionVisuals();
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
                const domKey = targetWrapper.closest('.color-group').dataset.groupKey;
                const mode = this.colorController.getSettings().mode;
                const dataKey = domKey.substring(mode.length + 1);
                const stateType = targetWrapper.dataset.stateType;
                
                this.colorController.setColorForGroup(mode, dataKey, stateType, color);
                modal.remove();
            } else if (e.target.id === 'color-palette-modal') {
                modal.remove();
            }
        });
        document.body.appendChild(modal);
    }

    _updateSelectionVisuals() {
        // First, remove all existing selection markers
        this.element.querySelectorAll('.color-swatch-wrapper.selected').forEach(el => {
            el.classList.remove('selected');
            const marker = el.querySelector('.selection-order-marker');
            if (marker) marker.remove();
        });

        // Then, add new markers based on the ordered array
        this.selectedSwatches.forEach((swatchKey, index) => {
            const parts = swatchKey.split('-');
            const stateType = parts.pop();
            const groupKey = parts.join('-'); // The rest of the key is the full group key
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
                const domKey = group.dataset.groupKey; // e.g., "symmetry-0-12"
                // The data key is the part AFTER the prefix
                const dataKey = domKey.substring(groupType.length + 1); // e.g., "0-12"
                
                const colors = colorMap[dataKey] || { on: '#ffffff', off: '#333333' };
                const onSwatch = group.querySelector('[data-state-type="on"] .color-swatch');
                const offSwatch = group.querySelector('[data-state-type="off"] .color-swatch');
                if (onSwatch) onSwatch.style.backgroundColor = colors.on;
                if (offSwatch) offSwatch.style.backgroundColor = colors.off;
            });
        };

        updateSwatches('neighbor_count', settings.customNeighborColors);
        updateSwatches('symmetry', settings.customSymmetryColors);

        this.selectedSwatches = []; // Clear the array
        this._updateSelectionVisuals(); // Update the UI
        this._updateBatchActionBar();
    }

    _updateBatchActionBar() {
        const bar = this.uiElements.batchActionBar;
        if (this.selectedSwatches.length > 0) {
            bar.innerHTML = `<span>${this.selectedSwatches.length} swatches selected.</span>
                             <div style="display: flex; gap: 8px; align-items: center;">
                                 <button class="button-link clear-selection" title="Clear selection">Clear</button>
                                 <div class="batch-swatch" title="Set color for all selected swatches"></div>
                             </div>`;
            bar.classList.remove('hidden');

            // Find the batch-swatch and clear-selection buttons and add listeners
            const batchSwatch = bar.querySelector('.batch-swatch');
            const clearButton = bar.querySelector('.clear-selection');

            if (this.selectedSwatches.length > 1) {
                batchSwatch.textContent = 'Create Gradient...';
                batchSwatch.title = 'Create a gradient across selected swatches';
                batchSwatch.addEventListener('click', () => {
                    this._openGradientCreator();
                }, { once: true });
            } else {
                batchSwatch.textContent = 'Set Color...';
                batchSwatch.title = 'Set color for selected swatch';
                batchSwatch.addEventListener('click', () => {
                    this._openBatchColorPalette(); // Re-use old logic for single selection
                }, { once: true });
            }
            
            clearButton.addEventListener('click', () => {
                this.selectedSwatches = []; // Clear the array
                this._updateSelectionVisuals(); // Update the UI
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
                    const domKey = parts.join('-');
                    const mode = this.colorController.getSettings().mode;
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
            } else if (e.target.id === 'color-palette-modal') {
                modal.remove();
            }
        });
        document.body.appendChild(modal);
    }

    _openGradientCreator() {
        let modal = document.getElementById('gradient-creator-modal');
        if (modal) modal.remove();

        let gradientStops = [];

        modal = document.createElement('div');
        modal.id = 'gradient-creator-modal';
        modal.className = 'modal-overlay'; // Use the same styling as other modals
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 450px;">
                <h4>Create Gradient</h4>
                <p>Click colors below in order to define your gradient stops.</p>
                <div id="gradient-preview-strip"></div>
                <div class="color-palette-content">${CURATED_PALETTE.map(c => `<div class="palette-color" style="background-color: ${c}" data-color="${c}"></div>`).join('')}</div>
                <div class="modal-actions">
                    <button class="button" id="gradient-cancel-btn">Cancel</button>
                    <button class="button" id="gradient-apply-btn" disabled>Apply Gradient</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const previewStrip = modal.querySelector('#gradient-preview-strip');
        const applyBtn = modal.querySelector('#gradient-apply-btn');
        const palette = modal.querySelector('.color-palette-content');
        
        const updatePreview = () => {
            if (gradientStops.length > 0) {
                previewStrip.style.background = gradientStops.length === 1 
                    ? gradientStops[0] 
                    : `linear-gradient(to right, ${gradientStops.join(', ')})`;
                applyBtn.disabled = false;
            } else {
                previewStrip.style.background = '#222';
                applyBtn.disabled = true;
            }
        };

        palette.addEventListener('click', e => {
            if (e.target.matches('.palette-color')) {
                gradientStops.push(e.target.dataset.color);
                updatePreview();
            }
        });

        modal.querySelector('#gradient-apply-btn').addEventListener('click', () => {
            this.appContext.colorController.applyGradientToSelection(
                this.selectedSwatches,
                gradientStops
            );
            modal.remove();
        }, { once: true });

        modal.querySelector('#gradient-cancel-btn').addEventListener('click', () => modal.remove(), { once: true });
        
        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        updatePreview();
    }
} 