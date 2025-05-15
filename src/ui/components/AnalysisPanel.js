import * as Config from '../../core/config.js';
import { DraggablePanel } from './DraggablePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { SliderComponent } from './SliderComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

// Import Plugins
import { RatioHistoryPlugin } from './analysis_plugins/RatioHistoryPlugin.js';
import { EntropyPlotPlugin } from './analysis_plugins/EntropyPlotPlugin.js';
// Import other plugins here as they are created

export class AnalysisPanel {
    constructor(panelElement, simulationInterface, uiManagerRef) { // uiManagerRef to access other components if needed
        if (!panelElement) {
            console.error('AnalysisPanel: panelElement is null or undefined.');
            return;
        }
        if (!simulationInterface) {
            console.error('AnalysisPanel: simulationInterface is null or undefined.');
            return;
        }

        this.panelElement = panelElement;
        this.simulationInterface = simulationInterface;
        this.uiManager = uiManagerRef; // Reference to the main UI manager (ui.js)
        this.panelIdentifier = 'analysis';
        this.plugins = [];

        this.uiElements = {
            closeButton: this.panelElement.querySelector('#closeAnalysisPanelButton') || this.panelElement.querySelector('.close-panel-button'),
            enableEntropySamplingCheckbox: this.panelElement.querySelector('#enableEntropySamplingCheckbox'),
            entropySampleRateSliderMount: this.panelElement.querySelector('#entropySampleRateSliderMount'),
            statEntropy: this.panelElement.querySelector('#stat-entropy'),
            pluginsMountArea: this.panelElement.querySelector('.plugins-mount-area')
        };
        
        if (!this.uiElements.pluginsMountArea) {
            console.error('AnalysisPanel: .plugins-mount-area not found in panel HTML.');
        }


        this.draggablePanel = new DraggablePanel(this.panelElement, 'h3');
        this.entropySampleRateSlider = null;

        this._loadPanelState();
        this._setupInternalListeners();
        this._registerPlugins();
        this._initializePluginsUI();
        this._setupEventSubscriptions();
        this.refreshViews(); // Initial population of controls and plugins
    }

    _registerPlugins() {
        // Manually register plugins for now
        this.plugins.push(new RatioHistoryPlugin());
        this.plugins.push(new EntropyPlotPlugin());
        // Add more plugins here:
        // this.plugins.push(new YourNewAnalysisPlugin());

        console.log(`AnalysisPanel: Registered ${this.plugins.length} plugins.`);
    }

    _initializePluginsUI() {
        if (!this.uiElements.pluginsMountArea) return;
        this.uiElements.pluginsMountArea.innerHTML = ''; // Clear previous

        this.plugins.forEach(plugin => {
            const pluginContainer = document.createElement('div');
            pluginContainer.className = `analysis-plugin-container ${plugin.id}-plugin-wrapper`;
            // Optionally add a title for the plugin from plugin.name
            // const pluginTitle = document.createElement('h5');
            // pluginTitle.textContent = plugin.name;
            // pluginContainer.appendChild(pluginTitle);

            const pluginMountPoint = document.createElement('div');
            pluginMountPoint.className = 'plugin-content-mount';
            pluginContainer.appendChild(pluginMountPoint);
            
            this.uiElements.pluginsMountArea.appendChild(pluginContainer);
            plugin.init(pluginMountPoint, this.simulationInterface);
        });
    }

    _setupInternalListeners() {
        if (this.uiElements.closeButton) {
            this.uiElements.closeButton.addEventListener('click', () => {
                this.hide();
            });
        }

        if (this.uiElements.enableEntropySamplingCheckbox) {
            this.uiElements.enableEntropySamplingCheckbox.addEventListener('change', () => this._handleSamplingControlsChange());
        }

        if (this.uiElements.entropySampleRateSliderMount) {
            this.entropySampleRateSlider = new SliderComponent(this.uiElements.entropySampleRateSliderMount, {
                id: 'entropySampleRateSliderInPanel', // Ensure unique ID if old one still exists
                label: 'Rate:',
                min: 1, max: 100, step: 1, showValue: true, unit: '/tick',
                value: this.simulationInterface.getEntropySamplingState().rate,
                disabled: !this.simulationInterface.getEntropySamplingState().enabled,
                onChange: (value) => this._handleSamplingControlsChange()
            });
        }
        
        if (this.draggablePanel) {
            this.draggablePanel.onDragEnd = () => this._savePanelState();
        }
    }

    _setupEventSubscriptions() {
        // Subscribe to events that plugins might need
        EventBus.subscribe(EVENTS.WORLD_STATS_UPDATED, (statsData) => {
            if (this.isHidden()) return;
            this.updateCurrentEntropyDisplay(statsData);
            this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: statsData }));
        });

        EventBus.subscribe(EVENTS.ENTROPY_SAMPLING_CHANGED, (samplingData) => {
            if (this.isHidden()) return;
            this._updateSamplingControlsUI(samplingData);
            this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'entropySamplingChanged', payload: samplingData }));
        });
        EventBus.subscribe(EVENTS.ALL_WORLDS_RESET, () => {
             if (this.isHidden()) return;
            this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'allWorldsReset' }));
        });
         EventBus.subscribe(EVENTS.SELECTED_WORLD_CHANGED, () => { // Refresh plots on world change
             if (this.isHidden()) return;
            // Trigger an update for plugins, perhaps with current stats of new world
            const stats = this.simulationInterface.getSelectedWorldStats();
            this.updateCurrentEntropyDisplay(stats);
            this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: stats }));
        });
    }
    
    _handleSamplingControlsChange() {
        if (!this.uiElements.enableEntropySamplingCheckbox || !this.entropySampleRateSlider) return;
        const enabled = this.uiElements.enableEntropySamplingCheckbox.checked;
        const rate = this.entropySampleRateSlider.getValue();
        EventBus.dispatch(EVENTS.COMMAND_SET_ENTROPY_SAMPLING, { enabled, rate });
    }

    _updateSamplingControlsUI(samplingData) {
        if (this.uiElements.enableEntropySamplingCheckbox) {
            this.uiElements.enableEntropySamplingCheckbox.checked = samplingData.enabled;
        }
        if (this.entropySampleRateSlider) {
            this.entropySampleRateSlider.setValue(samplingData.rate);
            this.entropySampleRateSlider.setDisabled(!samplingData.enabled);
        }
    }
    
    updateCurrentEntropyDisplay(statsData) {
        if (this.uiElements.statEntropy) {
            this.uiElements.statEntropy.textContent = (statsData && statsData.entropy !== undefined) ? statsData.entropy.toFixed(4) : "N/A";
        }
    }

    refreshViews() {
        if (this.isHidden()) return;

        const samplingState = this.simulationInterface.getEntropySamplingState();
        this._updateSamplingControlsUI(samplingState);
        
        const currentStats = this.simulationInterface.getSelectedWorldStats();
        this.updateCurrentEntropyDisplay(currentStats);

        // Notify all plugins to update with current data
        this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: currentStats }));
    }

    getAllPluginFitnessValues() {
        const fitnessValues = {};
        this.plugins.forEach(plugin => {
            fitnessValues[plugin.id] = plugin.getFitnessValue();
        });
        return fitnessValues;
    }
    
    _savePanelState() {
        if (!this.panelElement) return;
        const state = {
            isOpen: !this.panelElement.classList.contains('hidden'),
            x: this.panelElement.style.left,
            y: this.panelElement.style.top,
        };
        PersistenceService.savePanelState(this.panelIdentifier, state);
    }

    _loadPanelState() {
        if (!this.panelElement) return;
        const savedState = PersistenceService.loadPanelState(this.panelIdentifier);
        if (savedState.isOpen) {
            this.show(false);
        } else {
            this.hide(false);
        }
        if (savedState.x && savedState.x.endsWith('px')) this.panelElement.style.left = savedState.x;
        if (savedState.y && savedState.y.endsWith('px')) this.panelElement.style.top = savedState.y;

        if ((savedState.x || savedState.y) && parseFloat(this.panelElement.style.left) > 0 && parseFloat(this.panelElement.style.top) > 0) {
            this.panelElement.style.transform = 'none';
        } else if (this.panelElement.style.transform === 'none' && savedState.isOpen) {
             this.panelElement.style.left = '50%'; this.panelElement.style.top = '50%'; this.panelElement.style.transform = 'translate(-50%, -50%)';
        }
    }

    show(saveState = true) {
        this.draggablePanel.show();
        if (saveState) this._savePanelState();
        this.refreshViews();
    }

    hide(saveState = true) {
        this.draggablePanel.hide();
        if (saveState) this._savePanelState();
    }

    toggle() {
        const nowVisible = this.draggablePanel.toggle();
        this._savePanelState();
        if (nowVisible) {
            this.refreshViews();
        }
        return nowVisible;
    }
    
    isHidden(){
        return this.panelElement.classList.contains('hidden');
    }

    destroy() {
        this.plugins.forEach(plugin => plugin.destroy());
        this.plugins = [];
        if (this.entropySampleRateSlider) this.entropySampleRateSlider.destroy();
        this.draggablePanel.destroy();
        // Unsubscribe from EventBus events if direct subscriptions were made here (most are handled by BaseComponent in plugins)
    }
} 