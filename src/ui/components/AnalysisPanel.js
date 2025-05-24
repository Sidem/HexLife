import * as Config from '../../core/config.js';
import { DraggablePanel } from './DraggablePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js';
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
            pluginsMountArea: this.panelElement.querySelector('.plugins-mount-area')
        };

        if (!this.uiElements.pluginsMountArea) {
            console.error('AnalysisPanel: .plugins-mount-area not found in panel HTML.');
        }

        this.draggablePanel = new DraggablePanel(this.panelElement, 'h3');

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
                const stats = this.worldManager.getSelectedWorldStats();
                return (stats && stats.ratioHistory) ? [...stats.ratioHistory] : [];
            },
            getSelectedWorldEntropyHistory: () => {
                const stats = this.worldManager.getSelectedWorldStats();
                return (stats && stats.entropyHistory) ? [...stats.entropyHistory] : [];
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

        if (this.draggablePanel) {
            this.draggablePanel.onDragEnd = () => this._savePanelState();
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
    destroy() { this.plugins.forEach(plugin => plugin.destroy()); this.plugins = []; this.draggablePanel.destroy(); }
}