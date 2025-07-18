import * as Config from '../../core/config.js';
import { BaseComponent } from './BaseComponent.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { formatHexCode } from '../../utils/utils.js';
import { rulesetVisualizer } from '../../utils/rulesetVisualizer.js';

export class WorldSetupComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options); 

        if (!appContext || !appContext.worldManager) {
            console.error('WorldSetupComponent: appContext or worldManager is null.');
            return;
        }
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
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
            <div class="panel-header-controls">
                <p class="editor-text info-text">Configure the initial state for each world.</p>
                <div id="world-setup-deterministic-switch-mount"></div>
            </div>
            <div id="world-setup-config-grid" class="world-config-grid"></div>
            <div id="world-setup-panel-actions" class="panel-actions">
                <button class="button" data-action="apply-state-all">Apply Initial State to All</button>
                <button class="button" data-action="reset-states">Reset States to Default</button>
                <button class="button" data-action="reset-all-worlds">Apply & Reset All Worlds</button>
            </div>
        `;
        
        
        this.uiElements.worldSetupGrid = this.element.querySelector('.world-config-grid');
        this.uiElements.applySetupButton = this.element.querySelector('[data-action="reset-all-worlds"]');
        this.uiElements.applySelectedDensityButton = this.element.querySelector('[data-action="apply-state-all"]');
        this.uiElements.resetDensitiesButton = this.element.querySelector('[data-action="reset-states"]');
    }

    _setupInternalListeners() {
        this.element.addEventListener('click', (event) => {
            const action = event.target.dataset.action;
            if (action === 'reset-all-worlds') {
                EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES);
            } else if (action === 'apply-state-all') {
                EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTED_INITIAL_STATE_TO_ALL);
            } else if (action === 'reset-states') {
                EventBus.dispatch(EVENTS.COMMAND_RESET_INITIAL_STATES_TO_DEFAULT);
            } else if (action === 'edit-state') {
                const worldIndex = parseInt(event.target.dataset.worldIndex, 10);
                const worldSettings = this.worldManager.worldSettings[worldIndex];
                if (worldSettings) {
                     EventBus.dispatch(EVENTS.COMMAND_SHOW_INITIAL_STATE_MODAL, {
                         worldIndex: worldIndex,
                         config: worldSettings.initialState
                     });
                }
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

        const deterministicSwitchMount = this.element.querySelector('#world-setup-deterministic-switch-mount');
        new SwitchComponent(deterministicSwitchMount, {
            type: 'checkbox', name: 'deterministic-reset-switch',
            initialValue: this.worldManager.deterministic,
            items: [{ value: 'deterministic', text: 'Deterministic Reset' }],
            onChange: (isChecked) => EventBus.dispatch(EVENTS.COMMAND_SET_DETERMINISTIC_RESET, isChecked)
        });

        const fragment = document.createDocumentFragment();

        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const cell = document.createElement('div');
            cell.className = 'world-config-cell';

            cell.innerHTML = `
                <div class="world-label">World ${i}</div>
                <div class="ruleset-viz-container"></div>
                <div class="setting-control state-control">
                    <span class="state-mode-label">Mode: <b class="state-mode-value">Density</b></span>
                    <button class="button" data-action="edit-state" data-world-index="${i}">Edit...</button>
                </div>
                <div class="setting-control enable-control"><div id="world-setup-enable-switch-mount-${i}"></div></div>
                <button class="button set-ruleset-button" data-world-index="${i}" title="Apply selected world's ruleset to World ${i} & reset">Use Main Ruleset</button>
            `;

            const vizContainer = cell.querySelector('.ruleset-viz-container');
            const enableSwitchMount = cell.querySelector(`#world-setup-enable-switch-mount-${i}`);

            const enableSwitch = new SwitchComponent(enableSwitchMount, {
                type: 'checkbox',
                name: `world-setup-enable-switch-${i}`, 
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
                stateModeValue: cell.querySelector('.state-mode-value'),
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
            const settings = currentWorldSettings[i] || { initialState: { mode: 'density' }, enabled: true, rulesetHex: "0".repeat(32) };
            const cache = this.worldControlCache[i];
            if (!cache) continue;

            
            const formattedFullHex = formatHexCode(settings.rulesetHex);
            cache.vizContainer.title = formattedFullHex;
            
            const svg = rulesetVisualizer.createRulesetSVG(settings.rulesetHex);
            svg.classList.add('ruleset-viz-svg');
            cache.vizContainer.innerHTML = ''; 
            cache.vizContainer.appendChild(svg);

            const mode = settings.initialState?.mode || 'density';
            cache.stateModeValue.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
            
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