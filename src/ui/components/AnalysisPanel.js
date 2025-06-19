import * as Config from '../../core/config.js';
import { DraggablePanel } from './DraggablePanel.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { Throttler } from '../../utils/throttler.js';

import { RatioHistoryPlugin } from './analysis_plugins/RatioHistoryPlugin.js';
import { EntropyPlotPlugin } from './analysis_plugins/EntropyPlotPlugin.js';


export class AnalysisPanel extends DraggablePanel {
    constructor(panelElement, options = {}) {
        super(panelElement, { 
            handleSelector: 'h3', 
            ...options, 
            persistence: { identifier: 'analysis' } 
        });

        const appContext = options.appContext;
        if (!appContext || !appContext.worldManager) {
            console.error('AnalysisPanel: appContext or worldManager is null.');
            return;
        }
        
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.plugins = [];
        
        this.throttler = new Throttler(
            (stats) => this._distributeThrottledUpdate(stats),
            Config.UI_UPDATE_THROTTLE_MS
        );

        this.uiElements = {
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
        
    }

    _setupEventSubscriptions() {
        
        EventBus.subscribe(EVENTS.WORLD_STATS_UPDATED, (statsData) => { 
            if (this.isHidden() || statsData.worldIndex !== this.worldManager.getSelectedWorldIndex()) return;

            this.throttler.schedule(statsData);
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

    _distributeThrottledUpdate(statsData) {
        if (this.isHidden()) return;
        this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: statsData }));
    }

    refreshViews() {
        if (this.isHidden() || !this.worldManager) return;

        const currentSelectedStats = this.worldManager.getSelectedWorldStats();
        this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: currentSelectedStats }));
    }

    show() {
        super.show();
        this.refreshViews();
    }

    hide() {
        super.hide();
    }

    toggle() {
        const isVisible = super.toggle();
        if (isVisible) {
            this.refreshViews();
        }
        return isVisible;
    }

    destroy() {
        this.throttler.destroy();
        this.plugins.forEach(plugin => plugin.destroy());
        this.plugins = [];
        super.destroy();
    }

    
}