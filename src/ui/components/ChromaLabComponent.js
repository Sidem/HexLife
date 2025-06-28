import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

// The curated palette for the color pickers
const CURATED_PALETTE = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080', '#ffffff', '#000000'];

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
            html += `<div class="color-group-column"><h5>Center ${stateName}</h5>`;
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
            html += `<div class="color-group-column"><h5>Center ${stateName}</h5>`;
            const centerState = (stateName === 'ON' ? 1 : 0);
            symmetryData.canonicalRepresentatives.forEach(group => {
                 html += `<div class="color-group" data-center-state="${centerState}" data-canonical-bitmask="${group.representative}">
                           <span class="color-group-label">Group ${group.representative} (Orbit: ${group.orbitSize})</span>
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