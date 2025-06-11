import { BottomSheet } from './BottomSheet.js';
import { SliderComponent } from './SliderComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as Config from '../../core/config.js';
import * as PersistenceService from '../../services/PersistenceService.js';


export class ToolsBottomSheet extends BottomSheet {
    constructor(id, triggerElement, worldManagerInterface) {
        super(id, triggerElement, { title: 'Simulation Tools' });
        this.worldManager = worldManagerInterface;
        this.render();
        this.attachEventListeners();
    }

    render() {
        const content = document.createElement('div');
        content.className = 'tools-bottom-sheet-content';

        content.innerHTML = `
            <div class="bottom-sheet-tabs">
                <button class="tab-button active" data-tab="tools">Tools</button>
                <button class="tab-button" data-tab="customize-fabs">Customize FABs</button>
            </div>
            <div class="bottom-sheet-panes">
                <div id="tools-pane" class="pane active">
                    <div class="tool-group">
                        <h5>Speed</h5>
                        <div id="mobileSpeedSliderMount"></div>
                    </div>
                    <div class="tool-group">
                        <h5>Brush Size</h5>
                        <div id="mobileBrushSliderMount"></div>
                    </div>
                    <div class="tool-group">
                        <h5>Reset / Clear</h5>
                        <div class="reset-clear-buttons">
                            <button class="button" data-action="reset">Reset World</button>
                            <button class="button" data-action="clear">Clear World</button>
                        </div>
                    </div>
                </div>
                <div id="customize-fabs-pane" class="pane hidden">
                    <div class="tool-group">
                        <h5>Quick Actions (Select up to 3)</h5>
                        <ul id="fab-action-list" class="fab-action-list"></ul>
                    </div>
                </div>
            </div>
        `;

        this.setContent(content);

        // Initialize Slider Components
        new SliderComponent(content.querySelector('#mobileSpeedSliderMount'), {
            id: 'mobileSpeedSlider',
            min: 1,
            max: Config.MAX_SIM_SPEED,
            step: 1,
            value: this.worldManager.getCurrentSimulationSpeed(),
            unit: 'tps',
            showValue: true,
            onChange: val => EventBus.dispatch(EVENTS.COMMAND_SET_SPEED, val)
        });

        new SliderComponent(content.querySelector('#mobileBrushSliderMount'), {
            id: 'mobileBrushSlider',
            min: 0,
            max: Config.MAX_NEIGHBORHOOD_SIZE,
            step: 1,
            value: this.worldManager.getCurrentBrushSize(),
            showValue: true,
            onChange: val => EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_SIZE, val)
        });
        this._initCustomizeFabsPane();
    }

    _initCustomizeFabsPane() {
        // NEW METHOD
        const fabActionList = this.sheetContent.querySelector('#fab-action-list');
        const actions = [
            { id: 'generate', icon: '✨', text: 'Generate' },
            { id: 'mutate', icon: '🦠', text: 'Mutate' },
            { id: 'clone', icon: '🧬', text: 'Clone & Mutate' },
            { id: 'clear-one', icon: '🧹', text: 'Clear' },
            { id: 'clear-all', icon: '💥', text: 'Clear All' },
            { id: 'reset-one', icon: '🔄', text: 'Reset' },
            { id: 'reset-all', icon: '🌍', text: 'Reset All' }
        ];

        const savedSettings = PersistenceService.loadUISetting('fabSettings', { enabled: ['generate', 'clone', 'reset-all'], locked: true });

        actions.forEach(action => {
            const isChecked = savedSettings.enabled.includes(action.id);
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="icon">${action.icon}</span>
                <span class="text">${action.text}</span>
                <input type="checkbox" id="fab-toggle-${action.id}" class="checkbox-input fab-action-toggle" data-action-id="${action.id}" ${isChecked ? 'checked' : ''}>
                <label for="fab-toggle-${action.id}" class="checkbox-label">${isChecked ? 'Enabled' : 'Disabled'}</label>
            `;
            fabActionList.appendChild(li);
        });

    }

    attachEventListeners() {
        this.sheetContent.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (action === 'reset') {
                EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, { scope: 'selected' });
                this.hide();
            } else if (action === 'clear') {
                EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'selected' });
                this.hide();
            }

            // Tab switching logic
            if (e.target.matches('.tab-button')) {
                const tabId = e.target.dataset.tab;
                this.sheetContent.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                this.sheetContent.querySelectorAll('.pane').forEach(p => p.classList.add('hidden'));
                e.target.classList.add('active');
                this.sheetContent.querySelector(`#${tabId}-pane`).classList.remove('hidden');
            }
        });

        // Listeners for the new FAB customization tab
        const fabPane = this.sheetContent.querySelector('#customize-fabs-pane');
        fabPane.addEventListener('change', e => {
            if (e.target.matches('.fab-action-toggle')) {
                const label = e.target.nextElementSibling;
                label.textContent = e.target.checked ? 'Enabled' : 'Disabled';

                const toggles = fabPane.querySelectorAll('.fab-action-toggle:checked');
                if (toggles.length > 3) {
                    alert('You can only enable up to 3 custom actions.');
                    e.target.checked = false;
                    label.textContent = 'Disabled';
                    return;
                }

                const enabledIds = Array.from(toggles).map(t => t.dataset.actionId);
                const currentSettings = PersistenceService.loadUISetting('fabSettings', { enabled: [], locked: true });
                currentSettings.enabled = enabledIds;
                PersistenceService.saveUISetting('fabSettings', currentSettings);
                EventBus.dispatch(EVENTS.COMMAND_UPDATE_FAB_UI);
            }
        });
    }
}