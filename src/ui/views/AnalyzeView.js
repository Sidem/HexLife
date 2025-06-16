import { BaseComponent } from '../components/BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { RatioHistoryPlugin } from '../components/analysis_plugins/RatioHistoryPlugin.js';
import { EntropyPlotPlugin } from '../components/analysis_plugins/EntropyPlotPlugin.js';
import { createOrUpdateRuleVizElement } from '../../utils/ruleVizUtils.js';

export class AnalyzeView extends BaseComponent {
    constructor(mountPoint, worldManagerInterface) {
        super(mountPoint);
        this.worldManager = worldManagerInterface;
        this.element = null;
        this.plugins = [];
        this.panes = {};
        this.segments = {};
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'analyze-view';
        this.element.className = 'mobile-view hidden';
        this.element.innerHTML = `
    <div class="mobile-view-header">
        <h2 class="mobile-view-title">Analysis</h2>
        <button class="mobile-view-close-button" data-action="close">&times;</button>
    </div>
    <div class="analyze-view-header">
        <button class="analyze-view-segment active" data-pane="plots">Plots</button>
        <button class="analyze-view-segment" data-pane="ranks">Rule Ranks</button>
    </div>
    <div class="analyze-view-content">
        <div id="plots-pane" class="analyze-pane"></div>
        <div id="ranks-pane" class="analyze-pane hidden"></div>
    </div>
`;
        this.mountPoint.appendChild(this.element);

        this.panes = {
            plots: this.element.querySelector('#plots-pane'),
            ranks: this.element.querySelector('#ranks-pane'),
        };

        this.segments = {
            plots: this.element.querySelector('[data-pane="plots"]'),
            ranks: this.element.querySelector('[data-pane="ranks"]'),
        };

        this._initializePlugins();
        this._renderRankPane();
        this.attachEventListeners();
    }

    _initializePlugins() {
        const simulationInterface = {
            getSelectedWorldStats: () => this.worldManager.getSelectedWorldStats(),
            getSelectedWorldRatioHistory: () => this.worldManager.getSelectedWorldStats().ratioHistory || [],
            getSelectedWorldEntropyHistory: () => this.worldManager.getSelectedWorldStats().entropyHistory || [],
            getSelectedWorldBlockEntropyHistory: () => this.worldManager.getSelectedWorldStats().hexBlockEntropyHistory || [],
            getEntropySamplingState: () => this.worldManager.getEntropySamplingState()
        };

        this.plugins.push(new RatioHistoryPlugin());
        this.plugins.push(new EntropyPlotPlugin());

        this.plugins.forEach(plugin => {
            const container = document.createElement('div');
            this.panes.plots.appendChild(container);
            plugin.init(container, simulationInterface);
        });
    }

    _renderRankPane() {
        this.panes.ranks.innerHTML = `
            <h4>Activation Rules</h4>
            <div id="mobile-activation-list" class="mobile-rank-list"></div>
            <h4 style="margin-top: 20px;">Deactivation Rules</h4>
            <div id="mobile-deactivation-list" class="mobile-rank-list"></div>
         `;
    }

    refreshRanks() {
        const stats = this.worldManager.getSelectedWorldStats();
        const ruleset = this.worldManager.getCurrentRulesetArray();
        if (!stats.ruleUsage || !ruleset) return;

        const activationRules = [];
        const deactivationRules = [];

        stats.ruleUsage.forEach((count, index) => {
            if (count > 0) {
                const rule = { index, count };
                if (ruleset[index] === 1) activationRules.push(rule);
                else deactivationRules.push(rule);
            }
        });

        activationRules.sort((a, b) => b.count - a.count);
        deactivationRules.sort((a, b) => b.count - a.count);

        this._populateRankList('#mobile-activation-list', activationRules.slice(0, 10));
        this._populateRankList('#mobile-deactivation-list', deactivationRules.slice(0, 10));
    }

    _populateRankList(selector, rules) {
        const container = this.element.querySelector(selector);
        container.innerHTML = '';
        rules.forEach((rule, rank) => {
            const item = document.createElement('div');
            item.className = 'mobile-rank-item';
            const viz = createOrUpdateRuleVizElement({ ruleIndex: rule.index, outputState: rule.outputState });
            item.innerHTML = `
                <div class="rank">#${rank + 1}</div>
                <div class="viz"></div>
                <div class="info">${rule.count} calls</div>
            `;
            item.querySelector('.viz').appendChild(viz);
            container.appendChild(item);
        });
    }

    attachEventListeners() {
        this.element.addEventListener('click', e => {
            if (e.target.matches('.mobile-view-close-button')) {
                EventBus.dispatch(EVENTS.COMMAND_SHOW_VIEW, { targetView: 'simulate' });
                return;
            }
        });
        this.element.querySelector('.analyze-view-header').addEventListener('click', e => {
            if (e.target.matches('.analyze-view-segment')) {
                this.setActivePane(e.target.dataset.pane);
            }
        });

        EventBus.subscribe(EVENTS.WORLD_STATS_UPDATED, (statsData) => {
            if (this.element.classList.contains('hidden')) return;
            this.plugins.forEach(plugin => plugin.onDataUpdate({ type: 'worldStats', payload: statsData }));
            if (this.panes.ranks && !this.panes.ranks.classList.contains('hidden')) {
                this.refreshRanks();
            }
        });
    }

    setActivePane(paneName) {
        for (const pane in this.panes) {
            this.panes[pane].classList.add('hidden');
            this.segments[pane].classList.remove('active');
        }
        this.panes[paneName].classList.remove('hidden');
        this.segments[paneName].classList.add('active');

        if (paneName === 'ranks') {
            this.refreshRanks();
        }
    }

    show() {
        this.element.classList.remove('hidden');
        this.plugins.forEach(p => p.updatePlot && p.updatePlot()); // Refresh plots on show
    }

    hide() {
        this.element.classList.add('hidden');
    }
}