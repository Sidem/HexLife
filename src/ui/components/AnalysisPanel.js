
import * as Config from '../../core/config.js';
import { DraggablePanel } from './DraggablePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { SliderComponent } from './SliderComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

import { RatioHistoryPlugin } from './analysis_plugins/RatioHistoryPlugin.js';
import { EntropyPlotPlugin } from './analysis_plugins/EntropyPlotPlugin.js';


export class AnalysisPanel {
    constructor(panelElement, worldManagerInterface, uiManagerRef) {
        if (!panelElement || !worldManagerInterface) {
            console.error('AnalysisPanel: panelElement or worldManagerInterface is null.');
            return;
        }

        this.panelElement = panelElement;
        this.worldManager = worldManagerInterface;
        this.uiManager = uiManagerRef;
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
        this.refreshViews(); 
    }

    _registerPlugins() {
        this.plugins.push(new RatioHistoryPlugin());
        this.plugins.push(new EntropyPlotPlugin());
        console.log(`AnalysisPanel: Registered ${this.plugins.length} plugins.`);
    }

    _initializePluginsUI() {
        if (!this.uiElements.pluginsMountArea) return;
        this.uiElements.pluginsMountArea.innerHTML = '';
        const pluginSimInterface = {
            
            getSelectedWorldStats: () => this.worldManager.getSelectedWorldStats(),
            getSelectedWorldRatioHistory: () => {
                console.warn("getSelectedWorldRatioHistory for plugins needs implementation with worker model.");
                const stats = this.worldManager.getSelectedWorldStats();
                return stats && stats.history ? stats.history : []; 
            },
            getSelectedWorldEntropyHistory: () => {
                console.warn("getSelectedWorldEntropyHistory for plugins needs implementation with worker model.");
                const stats = this.worldManager.getSelectedWorldStats();
                return stats && stats.entropyHistory ? stats.entropyHistory : []; 
            },
            getEntropySamplingState: () => ({ 
                enabled: this.uiElements.enableEntropySamplingCheckbox?.checked || false,
                rate: this.entropySampleRateSlider?.getValue() || 10
            }),
        };


        this.plugins.forEach(plugin => {
            const pluginContainer = document.createElement('div');
            pluginContainer.className = `analysis-plugin-container ${plugin.id}-plugin-wrapper`;
            const pluginMountPoint = document.createElement('div');
            pluginMountPoint.className = 'plugin-content-mount';
            pluginContainer.appendChild(pluginMountPoint);
            this.uiElements.pluginsMountArea.appendChild(pluginContainer);
            plugin.init(pluginMountPoint, pluginSimInterface); 
        });
    }

    _setupInternalListeners() {
        if (this.uiElements.closeButton) {
            this.uiElements.closeButton.addEventListener('click', () => this.hide());
        }

        if (this.uiElements.enableEntropySamplingCheckbox) {
            this.uiElements.enableEntropySamplingCheckbox.addEventListener('change', (e) => {
                this._handleSamplingControlsChange();
                PersistenceService.saveUISetting('entropySamplingEnabled', e.target.checked);
            });
        }

        if (this.uiElements.entropySampleRateSliderMount) {
            const initialSamplingState = PersistenceService.loadUISetting('entropySamplingEnabled', false);
            const initialSampleRate = PersistenceService.loadUISetting('entropySampleRate', 10);

            this.entropySampleRateSlider = new SliderComponent(this.uiElements.entropySampleRateSliderMount, {
                id: 'entropySampleRateSliderInPanel', label: 'Rate:',
                min: 1, max: 100, step: 1, showValue: true, unit: '/tick',
                value: initialSampleRate,
                disabled: !initialSamplingState,
                onChange: (value) => {
                    this._handleSamplingControlsChange();
                    PersistenceService.saveUISetting('entropySampleRate', value);
                }
            });
        }

        if (this.draggablePanel) {
            this.draggablePanel.onDragEnd = () => this._savePanelState();
        }
    }

    _setupEventSubscriptions() {
        
        EventBus.subscribe(EVENTS.WORLD_STATS_UPDATED, (statsData) => { 
            if (this.isHidden() || statsData.worldIndex !== this.worldManager.getSelectedWorldIndex()) return;

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
            
            const stats = this.worldManager.getSelectedWorldStats();
            this.updateCurrentEntropyDisplay(stats);
            this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'allWorldsReset', payload: stats }));
        });

        EventBus.subscribe(EVENTS.SELECTED_WORLD_CHANGED, (newIndex) => {
            if (this.isHidden()) return;
            const stats = this.worldManager.getSelectedWorldStats(); 
            this.updateCurrentEntropyDisplay(stats);
            this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: stats })); 
        });
    }

    _handleSamplingControlsChange() {
        if (!this.uiElements.enableEntropySamplingCheckbox || !this.entropySampleRateSlider) return;
        const enabled = this.uiElements.enableEntropySamplingCheckbox.checked;
        const rate = this.entropySampleRateSlider.getValue();
        this.entropySampleRateSlider.setDisabled(!enabled);
        
        
        
        
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
        if (this.isHidden() || !this.worldManager) return;

        
        const samplingEnabled = PersistenceService.loadUISetting('entropySamplingEnabled', false);
        const sampleRate = PersistenceService.loadUISetting('entropySampleRate', 10);
        this._updateSamplingControlsUI({ enabled: samplingEnabled, rate: sampleRate });
        
        EventBus.dispatch(EVENTS.COMMAND_SET_ENTROPY_SAMPLING, { enabled: samplingEnabled, rate: sampleRate });


        const currentSelectedStats = this.worldManager.getSelectedWorldStats();
        this.updateCurrentEntropyDisplay(currentSelectedStats);

        
        this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: currentSelectedStats }));
    }

    _savePanelState() {
        if (!this.panelElement) return;
        PersistenceService.savePanelState(this.panelIdentifier, {
            isOpen: !this.panelElement.classList.contains('hidden'),
            x: this.panelElement.style.left,
            y: this.panelElement.style.top,
        });
        
    }

    _loadPanelState() {
        if (!this.panelElement) return;
        const savedState = PersistenceService.loadPanelState(this.panelIdentifier);
        if (savedState.isOpen) this.show(false); else this.hide(false);
        if (savedState.x && savedState.x.endsWith('px')) this.panelElement.style.left = savedState.x;
        if (savedState.y && savedState.y.endsWith('px')) this.panelElement.style.top = savedState.y;

        const hasPosition = (savedState.x && savedState.x.endsWith('px')) || (savedState.y && savedState.y.endsWith('px'));
        if (hasPosition && (parseFloat(this.panelElement.style.left) > 0 || parseFloat(this.panelElement.style.top) > 0 || this.panelElement.style.left !== '50%' || this.panelElement.style.top !== '50%')) {
            this.panelElement.style.transform = 'none';
        } else if (!hasPosition && savedState.isOpen) {
            this.panelElement.style.left = '50%'; this.panelElement.style.top = '50%'; this.panelElement.style.transform = 'translate(-50%, -50%)';
        }
        
    }

    show(saveState = true) { this.draggablePanel.show(); if (saveState) this._savePanelState(); this.refreshViews(); }
    hide(saveState = true) { this.draggablePanel.hide(); if (saveState) this._savePanelState(); }
    toggle() { const v = this.draggablePanel.toggle(); this._savePanelState(); if (v) this.refreshViews(); return v; }
    isHidden() { return this.panelElement.classList.contains('hidden'); }
    destroy() { this.plugins.forEach(plugin => plugin.destroy()); this.plugins = []; if (this.entropySampleRateSlider) this.entropySampleRateSlider.destroy(); this.draggablePanel.destroy(); }
}