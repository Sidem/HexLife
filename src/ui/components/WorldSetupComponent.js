import * as Config from '../../core/config.js';
import { BaseComponent } from './BaseComponent.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { formatHexCode } from '../../utils/utils.js';
import { rulesetVisualizer } from '../../utils/rulesetVisualizer.js';

export class WorldSetupComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options); // No mountPoint

        if (!appContext || !appContext.worldManager) {
            console.error('WorldSetupComponent: appContext or worldManager is null.');
            return;
        }
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        // No more this.context
        this.element = document.createElement('div');
        this.element.className = 'world-setup-component-content';
        
        this.uiElements = {}; 
        this.worldControlCache = [];
        
        this.render(); 
        this._setupInternalListeners();
        this._createWorldSetupGrid();
        this.refresh();
        
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
            <div id="world-setup-config-grid" class="world-config-grid"></div>
            <div id="world-setup-panel-actions" class="panel-actions">
                <button class="button" data-action="apply-density-all">Apply Selected Density to All</button>
                <button class="button" data-action="reset-densities">Reset Densities to Default</button>
                <button class="button" data-action="reset-all-worlds">Apply & Reset All Enabled Worlds</button>
            </div>
        `;
        
        
        this.uiElements.worldSetupGrid = this.element.querySelector('.world-config-grid');
        this.uiElements.applySetupButton = this.element.querySelector('[data-action="reset-all-worlds"]');
        this.uiElements.applySelectedDensityButton = this.element.querySelector('[data-action="apply-density-all"]');
        this.uiElements.resetDensitiesButton = this.element.querySelector('[data-action="reset-densities"]');
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

    _createWorldSetupGrid() {
        const grid = this.uiElements.worldSetupGrid;
        grid.innerHTML = ''; 
        this.worldControlCache = [];

        const fragment = document.createDocumentFragment();

        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const cell = document.createElement('div');
            cell.className = 'world-config-cell';

            cell.innerHTML =
                `<div class="world-label">World ${i}</div>` +
                `<div class="ruleset-viz-container"></div>` +
                `<div class="setting-control density-control"><div id="world-setup-density-slider-mount-${i}"></div></div>` +
                `<div class="setting-control enable-control"><div id="world-setup-enable-switch-mount-${i}"></div></div>` +
                `<button class="button set-ruleset-button" data-world-index="${i}" title="Apply selected world's ruleset to World ${i} & reset">Use Main Ruleset</button>`;

            const vizContainer = cell.querySelector('.ruleset-viz-container');
            const sliderMount = cell.querySelector(`#world-setup-density-slider-mount-${i}`);
            const enableSwitchMount = cell.querySelector(`#world-setup-enable-switch-mount-${i}`);

            const densitySlider = new SliderComponent(sliderMount, {
                id: `world-setup-density-slider-${i}`, // Static ID with index
                label: 'Density:', min: 0, max: 1, step: 0.001,
                value: 0.5, unit: '', showValue: true,
                onChange: (newDensity) => {
                    EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_INITIAL_DENSITY, { worldIndex: i, density: newDensity });
                }
            });

            const enableSwitch = new SwitchComponent(enableSwitchMount, {
                type: 'checkbox',
                name: `world-setup-enable-switch-${i}`, // Static name with index
                initialValue: true,
                items: [{ value: 'enabled', text: 'Enabled' }],
                onChange: (isEnabled) => {
                    EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_ENABLED, { worldIndex: i, isEnabled });
                    
                    const label = enableSwitchMount.querySelector('label');
                    if (label) {
                        label.textContent = isEnabled ? 'Enabled' : 'Disabled';
                    }
                }
            });
            this.worldControlCache[i] = {
                vizContainer,
                densitySlider,
                enableSwitch,
                enableSwitchLabel: enableSwitchMount.querySelector('label')
            };

            fragment.appendChild(cell);
        }
        grid.appendChild(fragment);
    }

    /**
     * Updates the existing grid elements with new state.
     * This is now the only method called on state changes.
     */
    refresh() {
        if (!this.worldManager || this.worldControlCache.length === 0) return;

        const currentWorldSettings = this.worldManager.getWorldSettingsForUI();

        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const settings = currentWorldSettings[i] || { initialDensity: 0.5, enabled: true, rulesetHex: "0".repeat(32) };
            const cache = this.worldControlCache[i];
            if (!cache) continue;

            // Update cached elements instead of recreating them
            const formattedFullHex = formatHexCode(settings.rulesetHex);
            cache.vizContainer.title = formattedFullHex;
            
            const svg = rulesetVisualizer.createRulesetSVG(settings.rulesetHex);
            svg.classList.add('ruleset-viz-svg');
            cache.vizContainer.innerHTML = ''; // Clear only the SVG container
            cache.vizContainer.appendChild(svg);

            cache.densitySlider.setValue(settings.initialDensity, false); // Update slider value without firing its change event
            cache.enableSwitch.setValue(settings.enabled);
            if (cache.enableSwitchLabel) {
                cache.enableSwitchLabel.textContent = settings.enabled ? 'Enabled' : 'Disabled';
            }
        }
    }

    destroy() {
        this.worldControlCache.forEach(cache => {
            if (cache.densitySlider) cache.densitySlider.destroy();
            if (cache.enableSwitch) cache.enableSwitch.destroy();
        });
        this.worldControlCache = [];
        super.destroy();
    }
} 