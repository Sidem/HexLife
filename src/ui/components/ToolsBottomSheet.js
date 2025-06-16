import { BottomSheet } from './BottomSheet.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as Config from '../../core/config.js';
import * as PersistenceService from '../../services/PersistenceService.js';



export class ToolsBottomSheet extends BottomSheet {
    constructor(id, triggerElement, appContext) {
        super(id, triggerElement, { title: 'Simulation Tools' });
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
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
                        <h5>Interaction</h5>
                        <div id="mobilePauseWhileDrawingMount"></div>
                    </div>
                    <div class="tool-group">
                        <h5>Visualization</h5>
                        <div id="mobileRulesetVizMount"></div>
                        <div id="mobileShowMinimapOverlayMount" style="margin-top: 15px;"></div>
                        <div id="mobileShowCycleIndicatorMount" style="margin-top: 5px;"></div>
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

        
        const speedConfig = this.appContext.simulationController.getSpeedConfig();
        new SliderComponent(content.querySelector('#mobileSpeedSliderMount'), {
            id: 'mobileSpeedSlider',
            ...speedConfig,
            value: this.appContext.simulationController.getState().speed,
            showValue: true,
            onChange: this.appContext.simulationController.setSpeed
        });

        const brushConfig = this.appContext.brushController.getBrushConfig();
        new SliderComponent(content.querySelector('#mobileBrushSliderMount'), {
            id: 'mobileBrushSlider',
            ...brushConfig,
            value: this.appContext.brushController.getState().brushSize,
            showValue: true,
            onChange: this.appContext.brushController.setBrushSize
        });

        
        const interactionState = this.appContext.interactionController.getState();
        new SwitchComponent(content.querySelector('#mobilePauseWhileDrawingMount'), {
            type: 'checkbox',
            name: 'mobilePauseWhileDrawing',
            initialValue: interactionState.pauseWhileDrawing,
            items: [{ value: 'pause', text: 'Pause While Drawing' }],
            onChange: this.appContext.interactionController.setPauseWhileDrawing
        });

        
        const vizState = this.appContext.visualizationController.getState();
        new SwitchComponent(content.querySelector('#mobileRulesetVizMount'), {
            type: 'radio', 
            name: 'mobileRulesetViz',
            label: 'Display Type:',
            initialValue: vizState.vizType,
            items: this.appContext.visualizationController.getVisualizationOptions(),
            onChange: this.appContext.visualizationController.setVisualizationType
        });
        
        new SwitchComponent(content.querySelector('#mobileShowMinimapOverlayMount'), {
            type: 'checkbox', 
            name: 'mobileShowMinimapOverlay',
            initialValue: vizState.showMinimapOverlay,
            items: [{ value: 'show', text: 'Show Minimap Overlays' }],
            onChange: this.appContext.visualizationController.setShowMinimapOverlay
        });
        
        new SwitchComponent(content.querySelector('#mobileShowCycleIndicatorMount'), {
            type: 'checkbox', 
            name: 'mobileShowCycleIndicator',
            initialValue: vizState.showCycleIndicator,
            items: [{ value: 'show', text: 'Show Cycle Indicators' }],
            onChange: this.appContext.visualizationController.setShowCycleIndicator
        });

        this._syncVisualSettings(); 
        this._initCustomizeFabsPane();
    }

    _syncVisualSettings() {
        const vizState = this.appContext.visualizationController.getState();
        const vizSwitch = this.sheetContent.querySelector('#mobileRulesetVizMount .switch-group');
        const overlaySwitch = this.sheetContent.querySelector('#mobileShowMinimapOverlayMount .switch-group');
        const cycleIndicatorSwitch = this.sheetContent.querySelector('#mobileShowCycleIndicatorMount .switch-group');

        if(vizSwitch) {
            const radio = vizSwitch.querySelector(`input[value="${vizState.vizType}"]`);
            if(radio) radio.checked = true;
        }

        if(overlaySwitch) {
            const checkbox = overlaySwitch.querySelector('input');
            if(checkbox) checkbox.checked = vizState.showMinimapOverlay;
        }

        if(cycleIndicatorSwitch) {
            const checkbox = cycleIndicatorSwitch.querySelector('input');
            if(checkbox) checkbox.checked = vizState.showCycleIndicator;
        }
    }

    show() {
        super.show();
        this._syncVisualSettings();
    }

    _initCustomizeFabsPane() {
        const fabActionList = this.sheetContent.querySelector('#fab-action-list');
        const actions = [
            { id: 'generate', icon: '✨', text: 'Generate' },
            { id: 'mutate', icon: '🦠', text: 'Mutate' },
            { id: 'clone', icon: '👯', text: 'Clone' },
            { id: 'clone-mutate', icon: '🧬', text: 'Clone & Mutate' },
            { id: 'clear-one', icon: '🧹', text: 'Clear' },
            { id: 'clear-all', icon: '🌍', text: 'Clear All' },
            { id: 'reset-one', icon: '🔄', text: 'Reset' },
            { id: 'reset-all', icon: '♻️', text: 'Reset All' },
            { id: 'reset-densities', icon: '🎨', text: 'Default Densities' },
            { id: 'apply-density-all', icon: '🎯', text: 'Apply Density' }
        ];

        const savedSettings = PersistenceService.loadUISetting('fabSettings', { enabled: ['generate', 'clone-mutate', 'reset-all'], locked: true });
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
                this.appContext.worldsController.resetWorldsWithCurrentRuleset('selected');
                this.hide();
            } else if (action === 'clear') {
                this.appContext.worldsController.clearWorlds('selected');
                this.hide();
            }
            
            if (e.target.matches('.tab-button')) {
                const tabId = e.target.dataset.tab;
                this.sheetContent.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                this.sheetContent.querySelectorAll('.pane').forEach(p => p.classList.add('hidden'));
                e.target.classList.add('active');
                this.sheetContent.querySelector(`#${tabId}-pane`).classList.remove('hidden');
            }
        });

        EventBus.subscribe(EVENTS.RULESET_VISUALIZATION_CHANGED, () => {
            if (this.isVisible) {
                this._syncVisualSettings();
            }
        });

        
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