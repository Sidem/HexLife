import * as Config from '../../core/config.js';
import { PersistentDraggablePanel } from './PersistentDraggablePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

import { RatioHistoryPlugin } from './analysis_plugins/RatioHistoryPlugin.js';
import { EntropyPlotPlugin } from './analysis_plugins/EntropyPlotPlugin.js';


export class AnalysisPanel extends PersistentDraggablePanel {
    constructor(panelElement, worldManagerInterface, uiManagerRef) {
        
        super(panelElement, 'h3', 'analysis');

        if (!worldManagerInterface) {
            console.error('AnalysisPanel: worldManagerInterface is null.');
            return;
        }

        
        this.worldManager = worldManagerInterface;
        this.uiManager = uiManagerRef;
        this.plugins = [];

        this.uiElements = {
            closeButton: this.panelElement.querySelector('#closeAnalysisPanelButton') || this.panelElement.querySelector('.close-panel-button'),
            pluginsMountArea: this.panelElement.querySelector('.plugins-mount-area')
        };

        if (!this.uiElements.pluginsMountArea) {
            console.error('AnalysisPanel: .plugins-mount-area not found in panel HTML.');
        }

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
                const stats = this.worldManager.getSelectedWorldStats();
                return (stats && stats.ratioHistory) ? [...stats.ratioHistory] : [];
            },
            getSelectedWorldEntropyHistory: () => {
                const stats = this.worldManager.getSelectedWorldStats();
                return (stats && stats.entropyHistory) ? [...stats.entropyHistory] : [];
            },
            getSelectedWorldBlockEntropyHistory: () => {
                const stats = this.worldManager.getSelectedWorldStats();
                return (stats && stats.hexBlockEntropyHistory) ? [...stats.hexBlockEntropyHistory] : [];
            },
            getEntropySamplingState: () => this.worldManager.getEntropySamplingState()
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
        
    }

    _setupEventSubscriptions() {
        
        EventBus.subscribe(EVENTS.WORLD_STATS_UPDATED, (statsData) => { 
            if (this.isHidden() || statsData.worldIndex !== this.worldManager.getSelectedWorldIndex()) return;

            this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: statsData }));
        });

        EventBus.subscribe(EVENTS.ALL_WORLDS_RESET, () => {
            if (this.isHidden()) return;
            
            const stats = this.worldManager.getSelectedWorldStats();
            this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'allWorldsReset', payload: stats }));
        });

        EventBus.subscribe(EVENTS.SELECTED_WORLD_CHANGED, (newIndex) => {
            if (this.isHidden()) return;
            
            const stats = this.worldManager.getSelectedWorldStats(); 
            this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: stats })); 
        });
    }

    refreshViews() {
        if (this.isHidden() || !this.worldManager) return;

        const currentSelectedStats = this.worldManager.getSelectedWorldStats();
        this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: currentSelectedStats }));
    }

    show(saveState = true) {
        super.show(saveState);
        this.refreshViews();
    }

    hide(saveState = true) {
        super.hide(saveState);
    }

    toggle() {
        const isVisible = super.toggle();
        if (isVisible) {
            this.refreshViews();
        }
        return isVisible;
    }

    destroy() {
        this.plugins.forEach(plugin => plugin.destroy());
        this.plugins = [];
        super.destroy();
    }

    
}