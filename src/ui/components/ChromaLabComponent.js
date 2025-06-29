import { BaseComponent } from './BaseComponent.js';
import { EVENTS } from '../../services/EventBus.js';

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
        let buttonsHtml = Object.entries(presets).map(([key, preset]) =>
            `<button class="preset-button" data-preset="${key}">${preset.name}</button>`
        ).join('');
        this.uiElements.presetSection.innerHTML = `<div class="preset-buttons">${buttonsHtml}</div>`;
    }

    _renderGroupSection(groupType) {
        const container = groupType === 'neighbor_count' ? this.uiElements.neighborSection : this.uiElements.symmetrySection;
        const symmetryData = this.appContext.worldManager.getSymmetryData();
        const groups = groupType === 'neighbor_count'
            ? Array.from({ length: 7 }, (_, i) => ({ id: i, label: `${i} Neighbors` }))
            : symmetryData.canonicalRepresentatives.map(g => ({
                id: g.representative,
                label: `<div class="r-sym-rule-viz">${this._getSymmetryVizHtml(g.representative, g.orbitSize)}</div>`
            }));

        let html = '<div class="color-group-grid">';
        ['OFF', 'ON'].forEach(stateName => {
            const centerState = stateName === 'ON' ? 1 : 0;
            html += `<div class="color-group-column"><h5>Cell ${stateName}</h5>`;
            groups.forEach(group => {
                const groupKey = `${centerState}-${group.id}`;
                html += `<div class="color-group" data-group-key="${groupKey}">
                           <div class="group-label-container">${group.label}</div>
                           <div class="color-swatch-pair">
                               <div class="color-swatch-wrapper" data-state-type="off">
                                   <span class="swatch-label">OFF</span>
                                   <div class="color-swatch"></div>
                               </div>
                               <div class="color-swatch-wrapper" data-state-type="on">
                                   <span class="swatch-label">ON</span>
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

    _getSymmetryVizHtml(bitmask, orbitSize) {
        const neighborHexes = Array.from({ length: 6 }, (_, n) => `<div class="hexagon neighbor-hex neighbor-${n} state-${(bitmask >> n) & 1}"></div>`).join('');
        return `<div class="rule-viz-hex-display">
                    <div class="hexagon center-hex state-0"></div> ${neighborHexes}
                </div>
                <div class="orbit-size-display">Orbit: ${orbitSize}</div>`;
    }

    _setupEventListeners() {
        this.uiElements.modeSelect.addEventListener('change', (e) => this.colorController.setMode(e.target.value));
        this.element.addEventListener('click', (e) => {
            if (e.target.matches('.preset-button')) {
                this.colorController.applyPreset(e.target.dataset.preset);
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

        this.element.querySelectorAll('.chroma-section').forEach(s => s.classList.add('hidden'));
        this.element.querySelector(`#chroma-${settings.mode.replace('_count', '')}-section`).classList.remove('hidden');
        
        this.element.querySelectorAll('.preset-button.active').forEach(b => b.classList.remove('active'));
        if (settings.mode === 'preset') {
            const activeBtn = this.element.querySelector(`[data-preset="${settings.activePreset}"]`);
            if (activeBtn) activeBtn.classList.add('active');
        }

        const updateSwatches = (groupType, colorMap) => {
            this.element.querySelectorAll(`#chroma-${groupType}-section .color-group`).forEach(group => {
                const groupKey = group.dataset.groupKey;
                const colors = colorMap[groupKey] || { on: '#ffffff', off: '#333333' };
                group.querySelector('[data-state-type="on"] .color-swatch').style.backgroundColor = colors.on;
                group.querySelector('[data-state-type="off"] .color-swatch').style.backgroundColor = colors.off;
            });
        };

        updateSwatches('neighbor_count', settings.customNeighborColors);
        updateSwatches('symmetry', settings.customSymmetryColors);

        this.selectedSwatches.clear();
        this._updateBatchActionBar();
    }

    _updateBatchActionBar() {
        const bar = this.uiElements.batchActionBar;
        if (this.selectedSwatches.size > 0) {
            bar.innerHTML = `<span>${this.selectedSwatches.size} swatches selected.</span>
                             <div class="batch-swatch" title="Set color for all selected swatches"></div>`;
            bar.classList.remove('hidden');
            bar.querySelector('.batch-swatch').addEventListener('click', () => {
                this._openBatchColorPalette();
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