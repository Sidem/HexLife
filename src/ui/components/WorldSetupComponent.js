import * as Config from '../../core/config.js';
import { BaseComponent } from './BaseComponent.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { formatHexCode } from '../../utils/utils.js';
import { rulesetVisualizer } from '../../utils/rulesetVisualizer.js';

export class WorldSetupComponent extends BaseComponent {
    constructor(mountPoint, options = {}) {
        super(mountPoint, options); 

        const appContext = options.appContext;
        if (!appContext || !appContext.worldManager) {
            console.error('WorldSetupComponent: appContext or worldManager is null.');
            return;
        }
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        
        
        this.element = document.createElement('div');
        this.element.className = 'world-setup-component-content';
        
        this.uiElements = {}; 
        this.worldSliderComponents = [];
        
        this.render(); 
        this._setupInternalListeners();
        EventBus.subscribe(EVENTS.WORLD_SETTINGS_CHANGED, () => this.refresh());
        EventBus.subscribe(EVENTS.RULESET_VISUALIZATION_CHANGED, () => this.refresh());
        EventBus.subscribe(EVENTS.ALL_WORLDS_RESET, () => this.refresh());
    }

    getElement() {
        return this.element;
    }

    render() {
        this.element.innerHTML = `
            <p class="editor-text info-text">Configure initial density and enable/disable individual worlds. Click "Use Main Ruleset" to apply the selected world's ruleset and reset.</p>
            <div class="world-config-grid"></div>
            <div class="panel-actions">
                <button class="button" data-action="apply-density-all">Apply Selected Density to All</button>
                <button class="button" data-action="reset-densities">Reset Densities to Default</button>
                <button class="button" data-action="reset-all-worlds">Apply & Reset All Enabled Worlds</button>
            </div>
        `;
        
        
        if (this.mountPoint) {
            this.mountPoint.appendChild(this.element);
        }
        
        
        this.uiElements.worldSetupGrid = this.element.querySelector('.world-config-grid');
        this.uiElements.applySetupButton = this.element.querySelector('[data-action="reset-all-worlds"]');
        this.uiElements.applySelectedDensityButton = this.element.querySelector('[data-action="apply-density-all"]');
        this.uiElements.resetDensitiesButton = this.element.querySelector('[data-action="reset-densities"]');
        
        this.refresh(); 
    }

    _setupInternalListeners() {
        this.element.addEventListener('click', (event) => {
            const action = event.target.dataset.action;
            if (action === 'reset-all-worlds') {
                EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES);
            } else if (action === 'apply-density-all') {
                EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTED_DENSITY_TO_ALL);
            } else if (action === 'reset-densities') {
                EventBus.dispatch(EVENTS.COMMAND_RESET_DENSITIES_TO_DEFAULT);
            } else if (event.target.classList.contains('set-ruleset-button')) {
                const worldIndex = parseInt(event.target.dataset.worldIndex, 10);
                if (!isNaN(worldIndex)) {
                    EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, { scope: worldIndex, copyPrimaryRuleset: true });
                }
            }
        });
    }

    refresh() {
        if (!this.worldManager || !this.uiElements.worldSetupGrid) return;
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

            cell.innerHTML =
                `<div class="world-label">World ${i}</div>` +
                `<div class="ruleset-viz-container" title="${formattedFullHex}"></div>` +
                `<div class="setting-control density-control"><div id="densitySliderMount_${i}"></div></div>` +
                `<div class="setting-control enable-control"><div id="enableSwitchMount_${i}"></div></div>` +
                `<button class="button set-ruleset-button" data-world-index="${i}" title="Apply selected world's ruleset to World ${i} & reset">Use Main Ruleset</button>`;

            const vizContainer = cell.querySelector('.ruleset-viz-container');
            if (vizContainer) {
                const svg = rulesetVisualizer.createRulesetSVG(settings.rulesetHex);
                svg.classList.add('ruleset-viz-svg');
                vizContainer.appendChild(svg);
            }

            const sliderMount = cell.querySelector(`#densitySliderMount_${i}`);
            const densitySlider = new SliderComponent(sliderMount, {
                id: `densitySlider_${i}`, label: 'Density:', min: 0, max: 1, step: 0.001,
                value: settings.initialDensity, unit: '', showValue: true,
                onChange: (newDensity) => {
                    EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_INITIAL_DENSITY, { worldIndex: i, density: newDensity });
                }
            });
            this.worldSliderComponents.push(densitySlider);

            
            const enableSwitchMount = cell.querySelector(`#enableSwitchMount_${i}`);
            new SwitchComponent(enableSwitchMount, {
                type: 'checkbox',
                name: `enableSwitch_${i}`,
                initialValue: settings.enabled,
                items: [{ value: 'enabled', text: settings.enabled ? 'Enabled' : 'Disabled' }],
                onChange: (isEnabled) => {
                    EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_ENABLED, { worldIndex: i, isEnabled });
                    
                    const label = enableSwitchMount.querySelector('label');
                    if (label) {
                        label.textContent = isEnabled ? 'Enabled' : 'Disabled';
                    }
                }
            });
            
            fragment.appendChild(cell);
        }
        grid.appendChild(fragment);
    }

    destroy() {
        super.destroy();
        this.worldSliderComponents.forEach(s => s.destroy());
        this.worldSliderComponents = [];
    }
} 