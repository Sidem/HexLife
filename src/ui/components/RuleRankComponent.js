import { BaseComponent } from './BaseComponent.js';
import { createOrUpdateRuleVizElement } from '../../utils/ruleVizUtils.js';
import { Throttler } from '../../utils/throttler.js';
import * as Config from '../../core/config.js';


class ElementPool {
    constructor(creator) {
        this.pool = [];
        this.creator = creator;
    }
    get() {
        return this.pool.length > 0 ? this.pool.pop() : this.creator();
    }
    release(element) {
        this.pool.push(element);
    }
}

export class RuleRankComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options); // No mountPoint

        this.appContext = appContext;
        if (!this.appContext || !this.appContext.worldManager) {
            console.error('RuleRankComponent: appContext or worldManager is null.');
            return;
        }
        this.worldManager = this.appContext.worldManager;
        this.element = document.createElement('div');
        this.element.className = 'rule-rank-component-content';
        this.throttler = new Throttler(() => this.refresh(), Config.UI_UPDATE_THROTTLE_MS);
        this.lastRuleUsageHash = null;
        this.activationRuleItems = [];
        this.deactivationRuleItems = [];
        this.ruleItemPool = new ElementPool(() => this._createRuleItemElement());
        this.render();
        this.refresh();
    }

    
    getElement() {
        return this.element;
    }

    render() {
        this.element.innerHTML = `
            <div class="dual-rank-container">
                <div class="rank-column" id="activation-rank">
                    <div class="rank-column-header">Activation Rules</div>
                    <div class="rank-list-header"><span>Rank</span><span>Rule</span><span>Usage</span></div>
                    <div class="rank-list-content"></div>
                </div>
                <div class="rank-column" id="deactivation-rank">
                    <div class="rank-column-header">Deactivation Rules</div>
                    <div class="rank-list-header"><span>Rank</span><span>Rule</span><span>Usage</span></div>
                    <div class="rank-list-content"></div>
                </div>
            </div>
        `;

        this.uiElements = {
            activationRankContent: this.element.querySelector('#activation-rank .rank-list-content'),
            deactivationRankContent: this.element.querySelector('#deactivation-rank .rank-list-content'),
        };
    }

    
    refresh() {
        if (!this.worldManager) return;

        const stats = this.worldManager.getSelectedWorldStats();
        const ruleset = this.worldManager.getCurrentRulesetArray();
        const ruleUsage = stats.ruleUsage;

        if (!ruleUsage || !ruleset) {
            this.element.querySelector('.dual-rank-container').innerHTML = '<p class="empty-state-text">No rule usage data available.</p>';
            return;
        }

        const ruleUsageHash = Array.from(ruleUsage).join(',');
        if (ruleUsageHash === this.lastRuleUsageHash) return;

        this.lastRuleUsageHash = ruleUsageHash;

        let totalActivationInvocations = 0;
        let totalDeactivationInvocations = 0;
        const activationRules = [];
        const deactivationRules = [];

        for (let i = 0; i < ruleUsage.length; i++) {
            if (ruleUsage[i] > 0) {
                const rule = { index: i, count: ruleUsage[i] };
                if (ruleset[i] === 1) {
                    activationRules.push(rule);
                    totalActivationInvocations += rule.count;
                } else {
                    deactivationRules.push(rule);
                    totalDeactivationInvocations += rule.count;
                }
            }
        }

        activationRules.sort((a, b) => b.count - a.count);
        deactivationRules.sort((a, b) => b.count - a.count);

        this._renderRankList(this.uiElements.activationRankContent, this.activationRuleItems, activationRules, totalActivationInvocations, ruleset);
        this._renderRankList(this.uiElements.deactivationRankContent, this.deactivationRuleItems, deactivationRules, totalDeactivationInvocations, ruleset);
    }
    
    
    scheduleRefresh() {
        this.throttler.schedule();
    }
    
    _createRuleItemElement() {
        const listItem = document.createElement('div');
        listItem.className = 'rank-list-item';

        const usageBar = document.createElement('div');
        usageBar.className = 'usage-background-bar';
        listItem.appendChild(usageBar);

        const rankEl = document.createElement('span');
        rankEl.className = 'rank-list-rank';
        listItem.appendChild(rankEl);

        const vizContainer = document.createElement('div');
        vizContainer.className = 'rank-list-viz-container';
        listItem.appendChild(vizContainer);

        const usageEl = document.createElement('span');
        usageEl.className = 'rank-list-usage';
        listItem.appendChild(usageEl);

        listItem._cache = { usageBar, rankEl, vizContainer, usageEl };
        return listItem;
    }

    _updateRuleItem(element, rule, rank, totalInvocations, ruleset) {
        const { usageBar, rankEl, vizContainer, usageEl } = element._cache;
        const usagePercent = totalInvocations > 0 ? (rule.count / totalInvocations) * 100 : 0;

        rankEl.textContent = `#${rank + 1}`;
        usageBar.style.width = `${usagePercent}%`;

        const vizEl = createOrUpdateRuleVizElement({
            existingElement: vizContainer.firstChild,
            ruleIndex: rule.index,
            outputState: ruleset[rule.index],
            rawUsageCount: rule.count,
            usagePercent: usagePercent,
        });
        vizEl.classList.add('rank-list-viz');

        if (!vizContainer.firstChild) {
            vizContainer.appendChild(vizEl);
        }

        usageEl.innerHTML = `<div class="usage-percent">${usagePercent.toFixed(2)}%</div><div class="usage-count">${rule.count} calls</div>`;
    }

    _renderRankList(container, elementCache, rankedRules, totalInvocations, ruleset) {
        const topRules = rankedRules.slice(0, 20);
        while (elementCache.length > topRules.length) {
            const el = elementCache.pop();
            container.removeChild(el);
            this.ruleItemPool.release(el);
        }
        while (elementCache.length < topRules.length) {
            elementCache.push(this.ruleItemPool.get());
        }
        topRules.forEach((rule, rank) => {
            const element = elementCache[rank];
            this._updateRuleItem(element, rule, rank, totalInvocations, ruleset);
            if (!element.parentNode) {
                container.appendChild(element);
            }
        });
    }

    destroy() {
        this.throttler.destroy();
        super.destroy();
    }
} 