import * as Config from '../../core/config.js';
import { PersistentDraggablePanel } from './PersistentDraggablePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { SliderComponent } from './SliderComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { formatHexCode } from '../../utils/utils.js'; 

export class SetupPanel extends PersistentDraggablePanel {
    constructor(panelElement, worldManagerInterface) { 
        super(panelElement, 'h3', 'setup');

        if (!worldManagerInterface) {
            console.error('SetupPanel: worldManagerInterface is null.');
            return;
        }
        this.worldManager = worldManagerInterface;
        this.uiElements = {
            closeButton: panelElement.querySelector('#closeSetupPanelButton') || panelElement.querySelector('.close-panel-button'),
            worldSetupGrid: panelElement.querySelector('#worldSetupGrid'),
            applySetupButton: panelElement.querySelector('#applySetupButton'),
            applySelectedDensityButton: panelElement.querySelector('#applySelectedDensityButton'),
            resetDensitiesButton: panelElement.querySelector('#resetDensitiesButton'),
        };
        this.worldSliderComponents = [];
        this._setupInternalListeners();
        if (!this.isHidden()) this.refreshViews();

        EventBus.subscribe(EVENTS.WORLD_SETTINGS_CHANGED, () => this.refreshViews());
        EventBus.subscribe(EVENTS.ALL_WORLDS_RESET, () => this.refreshViews());
    }

    _setupInternalListeners() {
        if (this.uiElements.closeButton) {
            this.uiElements.closeButton.addEventListener('click', () => this.hide());
        }
        if (this.uiElements.applySetupButton) {
            this.uiElements.applySetupButton.addEventListener('click', () => {
                EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES);
            });
        }
        if (this.uiElements.applySelectedDensityButton) {
            this.uiElements.applySelectedDensityButton.addEventListener('click', () => {
                EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTED_DENSITY_TO_ALL);
            });
        }
        if (this.uiElements.resetDensitiesButton) {
            this.uiElements.resetDensitiesButton.addEventListener('click', () => {
                EventBus.dispatch(EVENTS.COMMAND_RESET_DENSITIES_TO_DEFAULT);
            });
        }
        if (this.uiElements.worldSetupGrid) {
            this.uiElements.worldSetupGrid.addEventListener('click', (event) => {
                if (event.target.classList.contains('set-ruleset-button')) {
                    const worldIndex = parseInt(event.target.dataset.worldIndex, 10);
                    if (!isNaN(worldIndex)) {
                        EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, {
                            scope: worldIndex,
                            copyPrimaryRuleset: true 
                        });
                    }
                }
            });
        }
    }

    refreshViews() {
        if (!this.worldManager || !this.uiElements.worldSetupGrid || this.isHidden()) return;
        this._populateWorldSetupGrid();
    }

    _populateWorldSetupGrid() {
        const grid = this.uiElements.worldSetupGrid;
        grid.innerHTML = ''; 
        this.worldSliderComponents.forEach(slider => slider.destroy());
        this.worldSliderComponents = [];

        const fragment = document.createDocumentFragment();
        const currentWorldSettings = this.worldManager.getWorldSettingsForUI(); 

        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const settings = currentWorldSettings[i] || { initialDensity: 0.5, enabled: true, rulesetHex: "0".repeat(32) };
            const cell = document.createElement('div');
            cell.className = 'world-config-cell';
            
            const formattedFullHex = formatHexCode(settings.rulesetHex); 
            const shortHex = settings.rulesetHex && settings.rulesetHex !== "Error" ? settings.rulesetHex.substring(0,4) : "ERR";

            cell.innerHTML =
                `<div class="world-label" title="${formattedFullHex}">World ${i} (Rules: ${shortHex}...)</div>` + 
                `<div class="setting-control density-control"><div id="densitySliderMount_${i}"></div></div>` +
                `<div class="setting-control enable-control">` +
                    `<input type="checkbox" id="enableSwitch_${i}" class="enable-switch checkbox-input" ${settings.enabled ? 'checked' : ''} data-world-index="${i}">` +
                    `<label for="enableSwitch_${i}" class="checkbox-label">${settings.enabled ? 'Enabled' : 'Disabled'}</label>` +
                `</div>` +
                `<button class="button set-ruleset-button" data-world-index="${i}" title="Apply selected world's ruleset to World ${i} & reset">Use Main Ruleset</button>`;

            const sliderMount = cell.querySelector(`#densitySliderMount_${i}`);
            const densitySlider = new SliderComponent(sliderMount, {
                id: `densitySlider_${i}`, label: 'Density:', min: 0, max: 1, step: 0.001,
                value: settings.initialDensity, unit: '', showValue: true,
                onChange: (newDensity) => {
                    EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_INITIAL_DENSITY, { worldIndex: i, density: newDensity });
                }
            });
            this.worldSliderComponents.push(densitySlider);

            const enableSwitch = cell.querySelector(`#enableSwitch_${i}`);
            const enableLabel = cell.querySelector(`label[for="enableSwitch_${i}"]`);
            enableSwitch.addEventListener('change', (event) => {
                const isEnabled = event.target.checked;
                enableLabel.textContent = isEnabled ? 'Enabled' : 'Disabled';
                EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_ENABLED, { worldIndex: i, isEnabled: isEnabled });
            });
            fragment.appendChild(cell);
        }
        grid.appendChild(fragment);
    }

    show(save = true) {
        super.show(save);
        this.refreshViews();
    }

    toggle() {
        const isVisible = super.toggle();
        if (isVisible) {
            this.refreshViews();
        }
        return isVisible;
    }

    destroy() {
        super.destroy();
        this.worldSliderComponents.forEach(s => s.destroy());
        this.worldSliderComponents = [];
    }
}
