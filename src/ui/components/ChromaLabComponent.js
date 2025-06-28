import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

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
        this.element = document.createElement('div');
        this.element.className = 'chroma-lab-component-content';
        this.render();
        this._setupEventListeners();
        this.refresh();
    }

    getElement() { return this.element; }

    render() {
        this.element.innerHTML = `
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
        `;
        this.uiElements = {
            modeSelect: this.element.querySelector('#chroma-mode-select'),
            presetSection: this.element.querySelector('#chroma-preset-section'),
            neighborSection: this.element.querySelector('#chroma-neighbor-section'),
            symmetrySection: this.element.querySelector('#chroma-symmetry-section'),
        };
        this._renderAllSections();
    }

    _renderAllSections() {
        this._renderPresetSection();
        this._renderNeighborCountSection();
        this._renderSymmetrySection();
    }

    _renderPresetSection() {
        const presets = this.colorController.getPresets();
        let buttonsHtml = '';
        for (const key in presets) {
            buttonsHtml += `<button class="preset-button" data-preset="${key}">${presets[key].name}</button>`;
        }
        this.uiElements.presetSection.innerHTML = `<div class="preset-buttons">${buttonsHtml}</div>`;
    }

    _renderNeighborCountSection() {
        let html = '<div class="color-group-grid">';
        ['OFF', 'ON'].forEach(stateName => {
            html += `<div class="color-group-column"><h5>Cell ${stateName}</h5>`;
            for (let i = 0; i <= 6; i++) {
                const centerState = (stateName === 'ON' ? 1 : 0);
                html += `<div class="color-group" data-center-state="${centerState}" data-neighbor-count="${i}">
                           <span class="color-group-label">${i} Neighbors</span>
                           <div class="color-swatch" title="Click to change color for this group"></div>
                         </div>`;
            }
            html += `</div>`;
        });
        html += '</div>';
        this.uiElements.neighborSection.innerHTML = html;
    }

    _renderSymmetrySection() {
        const symmetryData = this.appContext.worldManager.getSymmetryData();
        let html = '<div class="color-group-grid">';
         ['OFF', 'ON'].forEach(stateName => {
            html += `<div class="color-group-column"><h5>Cell ${stateName}</h5>`;
            const centerState = (stateName === 'ON' ? 1 : 0);
            symmetryData.canonicalRepresentatives.forEach(group => {
                const bitmask = group.representative;

                // Create the mini visualization HTML
                const neighborHexes = Array.from({ length: 6 }, (_, n) => 
                    `<div class="mini-hex" style="background-color: ${((bitmask >> n) & 1) ? '#FFF' : '#555'};"></div>`
                ).join('');

                html += `<div class="color-group" data-center-state="${centerState}" data-canonical-bitmask="${bitmask}">
                           <div class="color-group-label">
                               <div class="mini-viz">
                                   <div class="mini-hex center" style="background-color: ${centerState ? '#FFF' : '#555'};"></div>
                                   ${neighborHexes}
                               </div>
                               (Orbit: ${group.orbitSize})
                           </div>
                           <div class="color-swatch" title="Click to change color for this group"></div>
                         </div>`;
            });
            html += `</div>`;
        });
        html += '</div>';
        this.uiElements.symmetrySection.innerHTML = html;
    }

    _setupEventListeners() {
        this.uiElements.modeSelect.addEventListener('change', (e) => this.colorController.setMode(e.target.value));

        this.element.addEventListener('click', (e) => {
            if (e.target.matches('.preset-button')) {
                this.colorController.applyPreset(e.target.dataset.preset);
            } else if (e.target.matches('.color-swatch')) {
                this._openColorPalette(e.target);
            }
        });

        this._subscribeToEvent(EVENTS.COLOR_SETTINGS_CHANGED, this.refresh);
    }

    _openColorPalette(targetSwatch) {
        let modal = document.getElementById('color-palette-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'color-palette-modal';
        let paletteHtml = '<div class="color-palette-content">';
        CURATED_PALETTE.forEach(color => {
            paletteHtml += `<div class="palette-color" style="background-color: ${color}" data-color="${color}"></div>`;
        });
        paletteHtml += '</div>';
        modal.innerHTML = paletteHtml;

        const close = () => modal.remove();
        modal.addEventListener('click', (e) => {
            if (e.target.matches('.palette-color')) {
                const color = e.target.dataset.color;
                const group = targetSwatch.closest('.color-group');
                const mode = this.colorController.getSettings().mode;

                if (mode === 'neighbor_count') {
                    const { centerState, neighborCount } = group.dataset;
                    this.colorController.setNeighborColor(parseInt(centerState), parseInt(neighborCount), color);
                } else if (mode === 'symmetry') {
                    const { centerState, canonicalBitmask } = group.dataset;
                    this.colorController.setSymmetryColor(parseInt(centerState), parseInt(canonicalBitmask), color);
                }
                close();
            } else if (e.target.id === 'color-palette-modal') {
                close();
            }
        });
        document.body.appendChild(modal);
    }

    refresh = () => {
        const settings = this.colorController.getSettings();
        this.uiElements.modeSelect.value = settings.mode;

        this.element.querySelectorAll('.chroma-section').forEach(s => s.classList.add('hidden'));
        this.element.querySelector(`#chroma-${settings.mode.replace('_count', '')}-section`).classList.remove('hidden');

        this.element.querySelectorAll('.preset-button').forEach(btn => btn.classList.remove('active'));
        if (settings.mode === 'preset') {
            const activeBtn = this.element.querySelector(`[data-preset="${settings.activePreset}"]`);
            if (activeBtn) activeBtn.classList.add('active');
        }
        
        this.uiElements.neighborSection.querySelectorAll('.color-group').forEach(group => {
            const { centerState, neighborCount } = group.dataset;
            const key = `${centerState}-${neighborCount}`;
            const color = settings.customNeighborColors[key] || '#808080';
            group.querySelector('.color-swatch').style.backgroundColor = color;
        });

        this.uiElements.symmetrySection.querySelectorAll('.color-group').forEach(group => {
            const { centerState, canonicalBitmask } = group.dataset;
            const key = `${centerState}-${canonicalBitmask}`;
            const color = settings.customSymmetryColors[key] || '#808080';
            group.querySelector('.color-swatch').style.backgroundColor = color;
        });
    }
} 