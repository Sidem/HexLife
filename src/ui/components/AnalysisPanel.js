// src/ui/components/AnalysisPanel.js
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
            statEntropy: this.panelElement.querySelector('#stat-entropy'), // Displays selected world's current entropy
            pluginsMountArea: this.panelElement.querySelector('.plugins-mount-area')
        };

        if (!this.uiElements.pluginsMountArea) {
            console.error('AnalysisPanel: .plugins-mount-area not found in panel HTML.');
        }

        this.draggablePanel = new DraggablePanel(this.panelElement, 'h3');
        this.entropySampleRateSlider = null;

        this._loadPanelState(); // Loads panel visibility, position, and persisted entropy settings
        this._setupInternalListeners();
        this._registerPlugins();
        this._initializePluginsUI();
        this._setupEventSubscriptions(); // Subscribes to events like WORLD_STATS_UPDATED
        this.refreshViews(); // Initial population based on current state
    }

    _registerPlugins() {
        this.plugins.push(new RatioHistoryPlugin());
        this.plugins.push(new EntropyPlotPlugin());
        console.log(`AnalysisPanel: Registered ${this.plugins.length} plugins.`);
    }

    _initializePluginsUI() {
        if (!this.uiElements.pluginsMountArea) return;
        this.uiElements.pluginsMountArea.innerHTML = '';

        // Create a simulation interface wrapper for plugins
        // This ensures plugins get data for the *currently selected world*
        // or global data as appropriate.
        const pluginSimInterface = {
            // Selected world specific data getters
            getSelectedWorldStats: () => this.worldManager.getSelectedWorldStats(),
            // These methods will need to be implemented in WorldManager or adapted
            // For now, they might be approximations or need careful thought on how they fit
            // with asynchronous per-world data.
            // If a plugin needs history, it might need to accumulate it itself based on STATS_UPDATED events.
            // Or WorldManager could maintain a short history for the selected world.
            // For simplicity, let's assume WorldManager could provide this for the selected world.
            // This part needs the most adaptation for the worker model.
            // A possible approach: AnalysisPanel subscribes to WORLD_STATS_UPDATED for the selected world,
            // and maintains its own history buffers (ratio, entropy) for that world.
            // Then, the pluginSimInterface provides access to these buffers.

            // For now, let's make them dummy or point to what WorldManager might provide:
            getSelectedWorldRatioHistory: () => {
                // This needs to be implemented. AnalysisPanel could listen to stats
                // and build this history for the selected world.
                // For now, returning an empty array.
                console.warn("getSelectedWorldRatioHistory for plugins needs implementation with worker model.");
                const stats = this.worldManager.getSelectedWorldStats();
                return stats && stats.history ? stats.history : []; // Assuming WorldManager stores history for selected world
            },
            getSelectedWorldEntropyHistory: () => {
                console.warn("getSelectedWorldEntropyHistory for plugins needs implementation with worker model.");
                const stats = this.worldManager.getSelectedWorldStats();
                return stats && stats.entropyHistory ? stats.entropyHistory : []; // Assuming WorldManager stores history for selected world
            },
            getEntropySamplingState: () => ({ // Global setting
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
            plugin.init(pluginMountPoint, pluginSimInterface); // Pass the wrapped interface
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
        // Listen for stats of the *selected* world
        EventBus.subscribe(EVENTS.WORLD_STATS_UPDATED, (statsData) => { // statsData includes worldIndex
            if (this.isHidden() || statsData.worldIndex !== this.worldManager.getSelectedWorldIndex()) return;

            this.updateCurrentEntropyDisplay(statsData);
            this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: statsData }));
        });

        // Entropy sampling is a global setting, not per-world in this design
        EventBus.subscribe(EVENTS.ENTROPY_SAMPLING_CHANGED, (samplingData) => {
            if (this.isHidden()) return;
            this._updateSamplingControlsUI(samplingData); // Update controls if changed elsewhere
            // Plugins might react to this change as well
            this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'entropySamplingChanged', payload: samplingData }));
        });

        EventBus.subscribe(EVENTS.ALL_WORLDS_RESET, () => {
            if (this.isHidden()) return;
            // Refresh plots if current world was reset
            const stats = this.worldManager.getSelectedWorldStats();
            this.updateCurrentEntropyDisplay(stats);
            this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'allWorldsReset', payload: stats }));
        });

        EventBus.subscribe(EVENTS.SELECTED_WORLD_CHANGED, (newIndex) => {
            if (this.isHidden()) return;
            const stats = this.worldManager.getSelectedWorldStats(); // Gets stats for the new selected world
            this.updateCurrentEntropyDisplay(stats);
            this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: stats })); // Treat as a stats update for plugins
        });
    }

    _handleSamplingControlsChange() {
        if (!this.uiElements.enableEntropySamplingCheckbox || !this.entropySampleRateSlider) return;
        const enabled = this.uiElements.enableEntropySamplingCheckbox.checked;
        const rate = this.entropySampleRateSlider.getValue();
        this.entropySampleRateSlider.setDisabled(!enabled);
        // Dispatch a command for WorldManager if entropy sampling logic is handled per worker
        // For now, assuming it's a global setting affecting how often WorldManager might poll/log
        // Or this might be purely a UI/AnalysisPanel local setting for its plugins.
        // Let's assume it's a global setting for now, dispatched via EventBus.
        EventBus.dispatch(EVENTS.COMMAND_SET_ENTROPY_SAMPLING, { enabled, rate });
    }

    _updateSamplingControlsUI(samplingData) { // samplingData: { enabled, rate }
        if (this.uiElements.enableEntropySamplingCheckbox) {
            this.uiElements.enableEntropySamplingCheckbox.checked = samplingData.enabled;
        }
        if (this.entropySampleRateSlider) {
            this.entropySampleRateSlider.setValue(samplingData.rate);
            this.entropySampleRateSlider.setDisabled(!samplingData.enabled);
        }
    }

    updateCurrentEntropyDisplay(statsData) { // statsData for selected world
        if (this.uiElements.statEntropy) {
            this.uiElements.statEntropy.textContent = (statsData && statsData.entropy !== undefined) ? statsData.entropy.toFixed(4) : "N/A";
        }
    }

    refreshViews() {
        if (this.isHidden() || !this.worldManager) return;

        // Load persisted entropy settings and apply them to controls
        const samplingEnabled = PersistenceService.loadUISetting('entropySamplingEnabled', false);
        const sampleRate = PersistenceService.loadUISetting('entropySampleRate', 10);
        this._updateSamplingControlsUI({ enabled: samplingEnabled, rate: sampleRate });
        // Dispatch this initial loaded state so other parts (like WorldManager if it cares) are aware.
        EventBus.dispatch(EVENTS.COMMAND_SET_ENTROPY_SAMPLING, { enabled: samplingEnabled, rate: sampleRate });


        const currentSelectedStats = this.worldManager.getSelectedWorldStats();
        this.updateCurrentEntropyDisplay(currentSelectedStats);

        // Notify all plugins to update with current data for the selected world
        this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: currentSelectedStats }));
    }

    _savePanelState() {
        if (!this.panelElement) return;
        PersistenceService.savePanelState(this.panelIdentifier, {
            isOpen: !this.panelElement.classList.contains('hidden'),
            x: this.panelElement.style.left,
            y: this.panelElement.style.top,
        });
        // Entropy settings are saved on change by their respective controls.
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
        // Entropy settings are loaded and applied during control initialization (_setupInternalListeners or refreshViews)
    }

    show(saveState = true) { this.draggablePanel.show(); if (saveState) this._savePanelState(); this.refreshViews(); }
    hide(saveState = true) { this.draggablePanel.hide(); if (saveState) this._savePanelState(); }
    toggle() { const v = this.draggablePanel.toggle(); this._savePanelState(); if (v) this.refreshViews(); return v; }
    isHidden() { return this.panelElement.classList.contains('hidden'); }
    destroy() { this.plugins.forEach(plugin => plugin.destroy()); this.plugins = []; if (this.entropySampleRateSlider) this.entropySampleRateSlider.destroy(); this.draggablePanel.destroy(); }
}