import * as Config from '../../core/config.js';
import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { Throttler } from '../../utils/throttler.js';

import { RatioHistoryPlugin } from './analysis_plugins/RatioHistoryPlugin.js';
import { EntropyPlotPlugin } from './analysis_plugins/EntropyPlotPlugin.js';

export class AnalysisComponent extends BaseComponent {
    constructor(mountPoint, options = {}) {
        super(mountPoint, options); 
        const appContext = options.appContext;
        if (!appContext || !appContext.worldManager) {
            console.error('AnalysisComponent: appContext or worldManager is null.');
            return;
        }
        
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.plugins = [];
        
        this.throttler = new Throttler(
            (stats) => this._distributeThrottledUpdate(stats),
            Config.UI_UPDATE_THROTTLE_MS
        );
        
        this.element = document.createElement('div');
        this.element.className = 'analysis-component-content';
        this.element.innerHTML = `<div class="plugins-mount-area"></div>`;

        this.uiElements = {
            pluginsMountArea: this.element.querySelector('.plugins-mount-area')
        };

        this._registerPlugins();
        this._initializePluginsUI();
        this._setupEventSubscriptions(); 
        this.refresh();
    }

    getElement() {
        return this.element;
    }

    _registerPlugins() {
        this.plugins.push(new RatioHistoryPlugin());
        this.plugins.push(new EntropyPlotPlugin());
        console.log(`AnalysisComponent: Registered ${this.plugins.length} plugins.`);
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

    _setupEventSubscriptions() {
        this._subscribeToEvent(EVENTS.WORLD_STATS_UPDATED, (statsData) => { 
            if (statsData.worldIndex !== this.worldManager.getSelectedWorldIndex()) return;
            this.throttler.schedule(statsData);
        });

        this._subscribeToEvent(EVENTS.ALL_WORLDS_RESET, () => {
            const stats = this.worldManager.getSelectedWorldStats();
            this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'allWorldsReset', payload: stats }));
        });

        this._subscribeToEvent(EVENTS.SELECTED_WORLD_CHANGED, (newIndex) => {
            const stats = this.worldManager.getSelectedWorldStats(); 
            this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: stats })); 
        });
    }

    _distributeThrottledUpdate(statsData) {
        this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: statsData }));
    }

    refresh() {
        if (!this.worldManager) return;
        const currentSelectedStats = this.worldManager.getSelectedWorldStats();
        this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: currentSelectedStats }));
    }

    destroy() {
        this.throttler.destroy();
        this.plugins.forEach(plugin => plugin.destroy());
        this.plugins = [];
        super.destroy();
    }
} 