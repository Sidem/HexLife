import * as Config from '../../core/config.js';
import { BaseComponent } from './BaseComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { formatHexCode } from '../../utils/utils.js';
import { rulesetVisualizer } from '../../utils/rulesetVisualizer.js';
import { renderInitialStatePreview } from './initialStatePreview.js';

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
        this._createGridSizeControl();
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
                <div id="world-setup-grid-size-mount" class="grid-size-control"></div>
            </div>
            <div id="world-setup-config-grid" class="world-config-grid"></div>
            <div id="world-setup-panel-actions" class="panel-actions">
                <button class="button" data-action="apply-state-all" title="Copy the selected world's initial-state settings to all 9 worlds">Copy Selected &rarr; All</button>
                <button class="button" data-action="reset-states" title="Reset every world's initial-state settings back to the default random fill">Reset to Defaults</button>
                <button class="button" data-action="reset-all-worlds" title="Re-seed all 9 worlds from their current initial-state settings">Regenerate All Worlds</button>
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
                <div class="wsc-cell-header">
                    <span class="world-label">World ${i}</span>
                    <div class="enable-control"><div id="world-setup-enable-switch-mount-${i}"></div></div>
                </div>
                <div class="wsc-ruleset-row">
                    <div class="ruleset-viz-container"></div>
                    <div class="world-ruleset-name" title="This world's ruleset name"></div>
                </div>
                <div class="wsc-state-row">
                    <canvas class="world-state-preview" aria-hidden="true"></canvas>
                    <div class="wsc-state-info">
                        <span class="state-mode-label">Start: <b class="state-mode-value">Random fill</b></span>
                        <button class="button" data-action="edit-state" data-world-index="${i}">Edit&hellip;</button>
                    </div>
                </div>
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
                rulesetName: cell.querySelector('.world-ruleset-name'),
                stateModeValue: cell.querySelector('.state-mode-value'),
                statePreview: cell.querySelector('.world-state-preview'),
                lastStateKey: null,
                enableSwitch,
                enableSwitchLabel: enableSwitchMount.querySelector('label')
            };

            fragment.appendChild(cell);
        }
        grid.appendChild(fragment);
    }

    _createGridSizeControl() {
        const mount = this.element.querySelector('#world-setup-grid-size-mount');
        if (!mount) return;

        const presets = Config.GRID_SIZE_PRESETS;
        const items = Object.entries(presets).map(([key, rows]) => {
            const { cols } = Config.deriveGridDimensions(rows);
            const label = key.charAt(0).toUpperCase() + key.slice(1);
            return { value: key, text: `${label} (${rows}×${cols})` };
        });

        // Match the current live size to a preset (null if a custom size came in via share URL).
        this._currentGridSizeKey = Object.keys(presets).find(k => presets[k] === Config.GRID_ROWS) || null;

        const labelEl = document.createElement('span');
        labelEl.className = 'state-mode-label';
        labelEl.innerHTML = 'Grid Size <span class="info-text">(restarts simulation)</span>';
        mount.appendChild(labelEl);

        this.gridSizeSwitch = new SwitchComponent(mount, {
            type: 'radio',
            name: 'world-setup-grid-size-switch',
            initialValue: this._currentGridSizeKey,
            items,
            onChange: (value) => this._handleGridSizeChange(value)
        });
    }

    _handleGridSizeChange(presetKey) {
        const rows = Config.GRID_SIZE_PRESETS[presetKey];
        if (!rows || rows === Config.GRID_ROWS) return;

        const { rows: r, cols: c } = Config.deriveGridDimensions(rows);

        // Revert the visible selection immediately; the change is only committed (with a page
        // reload, which cleanly rebuilds the renderer buffers and all workers) if the user confirms.
        this.gridSizeSwitch.setValue(this._currentGridSizeKey);

        EventBus.dispatch(EVENTS.COMMAND_SHOW_CONFIRMATION, {
            title: 'Change grid size?',
            message: `Resize the grid to ${r} × ${c} (${(r * c).toLocaleString()} cells) and restart the simulation? Rulesets and initial-state settings are kept; the current live evolution is not.`,
            confirmLabel: 'Resize & Restart',
            onConfirm: () => {
                PersistenceService.saveUISetting('gridRows', rows);
                window.location.reload();
            }
        });
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
            const { name: displayName } = this.appContext.libraryController.getDisplayName(settings.rulesetHex);
            cache.vizContainer.title = `${displayName}\n${formattedFullHex}`;
            if (cache.rulesetName) cache.rulesetName.textContent = displayName;

            const svg = rulesetVisualizer.createRulesetSVG(settings.rulesetHex);
            svg.classList.add('ruleset-viz-svg');
            cache.vizContainer.innerHTML = ''; 
            cache.vizContainer.appendChild(svg);

            const initialState = settings.initialState || { mode: 'density' };
            const mode = initialState.mode || 'density';
            cache.stateModeValue.textContent = mode === 'clusters' ? 'Clumps' : 'Random fill';

            // Render the per-world initial-state thumbnail; cache by config so repeated refreshes
            // (e.g. ruleset-viz changes) don't needlessly regenerate it.
            if (cache.statePreview) {
                const stateKey = JSON.stringify(initialState);
                if (stateKey !== cache.lastStateKey) {
                    cache.lastStateKey = stateKey;
                    renderInitialStatePreview(cache.statePreview, initialState, { maxDim: 64, seed: i + 1 });
                }
            }

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
        if (this.gridSizeSwitch) this.gridSizeSwitch.destroy();
        super.destroy();
    }
} 