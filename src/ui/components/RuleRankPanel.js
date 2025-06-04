import { DraggablePanel } from './DraggablePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { createRuleVizElement, getRuleIndexColor } from '../../utils/ruleVizUtils.js';

export class RuleRankPanel {
    constructor(panelElement, worldManagerInterface) {
        this.panelElement = panelElement;
        this.worldManager = worldManagerInterface;
        this.panelIdentifier = 'ruleRank';
        this.uiElements = {
            closeButton: panelElement.querySelector('#closeRankPanelButton'),
            contentArea: panelElement.querySelector('#ruleRankContent'),
        };
        this.draggablePanel = new DraggablePanel(this.panelElement, 'h3');
        
        // Throttling and caching for performance
        this.lastUpdateTime = 0;
        this.updateThrottleMs = 500; // Only update every 500ms max
        this.lastRuleUsageHash = null;
        this.pendingUpdate = false;
        
        // DOM element pooling for efficient updates
        this.ruleItemElements = [];
        this.headerElement = null;
        this.lastDisplayedRuleCount = 0;
        
        this._loadPanelState();
        this._setupInternalListeners();
        if (!this.panelElement.classList.contains('hidden')) this.refreshViews();
    }

    _setupInternalListeners() {
        this.uiElements.closeButton.addEventListener('click', () => this.hide());
        this.draggablePanel.onDragEnd = () => this._savePanelState();
    }

    _createRuleItemElement() {
        const listItem = document.createElement('div');
        listItem.className = 'rank-list-item';
        listItem.style.position = 'relative';

        const usageBar = document.createElement('div');
        usageBar.className = 'usage-background-bar';
        usageBar.style.cssText = `
            position: absolute;
            left: 0;
            top: 0;
            height: 100%;
            background-color: rgba(59, 130, 246, 0.15);
            z-index: 0;
            pointer-events: none;
        `;

        const rankEl = document.createElement('span');
        rankEl.className = 'rank-list-rank';
        rankEl.style.cssText = 'position: relative; z-index: 1;';

        const vizContainer = document.createElement('div');
        vizContainer.className = 'rank-list-viz-container';
        vizContainer.style.cssText = 'position: relative; z-index: 1;';

        const usageEl = document.createElement('span');
        usageEl.className = 'rank-list-usage';
        usageEl.style.cssText = 'position: relative; z-index: 1;';

        listItem.appendChild(usageBar);
        listItem.appendChild(rankEl);
        listItem.appendChild(vizContainer);
        listItem.appendChild(usageEl);

        // Store references for easy access
        listItem._usageBar = usageBar;
        listItem._rankEl = rankEl;
        listItem._vizContainer = vizContainer;
        listItem._usageEl = usageEl;
        listItem._currentRuleIndex = -1; // Track what rule this element is showing

        return listItem;
    }

    _updateRuleVizElement(vizElement, ruleIndex, outputState, usagePercent, normalizedUsage, rawUsageCount, showUsageOverlay = false) {
        const centerState = (ruleIndex >> 6) & 1;
        const neighborMask = ruleIndex & 0x3F;

        // Update title and dataset
        vizElement.title = `Rule ${ruleIndex}: Center ${centerState}, N ${neighborMask.toString(2).padStart(6, '0')} -> Out ${outputState}\nUsage: ${usagePercent.toFixed(2)}% (${rawUsageCount} calls)`;
        vizElement.dataset.ruleIndex = ruleIndex;

        // Update center hexagon colors
        const centerHex = vizElement.querySelector('.center-hex');
        const innerHex = vizElement.querySelector('.inner-hex');
        
        const centerColor = centerState === 1 ? 'rgb(255, 255, 255)' : 'rgb(100, 100, 100)';
        const outputColor = getRuleIndexColor(ruleIndex, outputState);
        
        centerHex.style.backgroundColor = centerColor;
        innerHex.style.backgroundColor = outputColor;

        // Update neighbor hexagons
        for (let n = 0; n < 6; n++) {
            const neighborHex = vizElement.querySelector(`.neighbor-${n}`);
            const neighborState = (neighborMask >> n) & 1;
            const neighborColor = neighborState === 1 ? 'rgb(255, 255, 255)' : 'rgb(100, 100, 100)';
            neighborHex.style.backgroundColor = neighborColor;
        }

        // Handle usage overlay
        let usageOverlay = vizElement.querySelector('.rule-usage-overlay');
        if (showUsageOverlay && normalizedUsage > 0) {
            if (!usageOverlay) {
                usageOverlay = document.createElement('div');
                usageOverlay.className = 'rule-usage-overlay';
                vizElement.appendChild(usageOverlay);
            }
            usageOverlay.style.opacity = normalizedUsage * 0.8; // Max 80% opacity
        } else if (usageOverlay) {
            usageOverlay.remove();
        }
    }

    _updateRuleItemElement(element, rule, rank, usagePercent, normalizedUsage, ruleset, totalInvocations) {
        // Update rank
        element._rankEl.textContent = `#${rank + 1}`;
        
        // Update usage bar width
        element._usageBar.style.width = `${usagePercent}%`;
        
        // Create or update visualization element
        let vizEl = element._vizContainer.firstChild;
        
        // If we don't have a viz element or it's for a different rule, create a new one
        if (!vizEl || element._currentRuleIndex !== rule.index) {
            if (vizEl) {
                element._vizContainer.removeChild(vizEl);
            }
            
            vizEl = createRuleVizElement({
                ruleIndex: rule.index,
                outputState: ruleset[rule.index],
                usagePercent: usagePercent,
                normalizedUsage: normalizedUsage,
                rawUsageCount: rule.count,
                showUsageOverlay: false
            });
            vizEl.classList.add('rank-list-viz');
            vizEl.style.cssText = 'position: relative; z-index: 1;';
            element._vizContainer.appendChild(vizEl);
            element._currentRuleIndex = rule.index;
        } else {
            // Update existing viz element
            this._updateRuleVizElement(
                vizEl,
                rule.index,
                ruleset[rule.index],
                usagePercent,
                normalizedUsage,
                rule.count,
                false
            );
        }
        
        // Update usage text
        element._usageEl.innerHTML = `<div class="usage-percent">${usagePercent.toFixed(2)}%</div><div class="usage-count">${rule.count} calls</div>`;
    }

    // Throttled version of refreshViews
    refreshViews() {
        if (this.isHidden() || !this.worldManager) return;

        const now = Date.now();
        const timeSinceLastUpdate = now - this.lastUpdateTime;

        // Throttle updates to avoid excessive DOM manipulation
        if (timeSinceLastUpdate < this.updateThrottleMs) {
            if (!this.pendingUpdate) {
                this.pendingUpdate = true;
                setTimeout(() => {
                    this.pendingUpdate = false;
                    this._actuallyRefreshViews();
                }, this.updateThrottleMs - timeSinceLastUpdate);
            }
            return;
        }

        this._actuallyRefreshViews();
    }

    _actuallyRefreshViews() {
        if (this.isHidden() || !this.worldManager) return;

        const stats = this.worldManager.getSelectedWorldStats();
        const ruleset = this.worldManager.getCurrentRulesetArray();
        const ruleUsage = stats.ruleUsage;

        if (!ruleUsage || !ruleset) {
            this.uiElements.contentArea.innerHTML = '<p class="empty-state-text">No rule usage data available.</p>';
            this.lastRuleUsageHash = null;
            this.ruleItemElements = [];
            this.headerElement = null;
            return;
        }

        // Create a simple hash of the rule usage data to detect changes
        const ruleUsageHash = ruleUsage.reduce((hash, count, index) => {
            return hash + `${index}:${count};`;
        }, '');

        // Only update if the data has actually changed
        if (ruleUsageHash === this.lastRuleUsageHash) {
            return;
        }

        this.lastRuleUsageHash = ruleUsageHash;
        this.lastUpdateTime = Date.now();

        let totalInvocations = 0;
        let maxUsage = 0;
        const rankedRules = [];

        for (let i = 0; i < ruleUsage.length; i++) {
            totalInvocations += ruleUsage[i];
            rankedRules.push({ index: i, count: ruleUsage[i] });
        }
        
        if (totalInvocations === 0) {
            this.uiElements.contentArea.innerHTML = '<p class="empty-state-text">Run a simulation to see rule usage statistics.</p>';
            this.ruleItemElements = [];
            this.headerElement = null;
            return;
        }

        rankedRules.sort((a, b) => b.count - a.count);
        maxUsage = rankedRules[0].count;

        // Display top 20 or all rules with usage > 0
        const topRules = rankedRules.filter(r => r.count > 0).slice(0, 20);

        // Create header if it doesn't exist
        if (!this.headerElement) {
            this.headerElement = document.createElement('div');
            this.headerElement.className = 'rank-list-header';
            this.headerElement.innerHTML = '<span>Rank</span><span>Rule Visualization</span><span>Usage</span>';
        }

        // Ensure we have enough rule item elements
        while (this.ruleItemElements.length < topRules.length) {
            this.ruleItemElements.push(this._createRuleItemElement());
        }

        // Update existing elements
        topRules.forEach((rule, rank) => {
            const usagePercent = (rule.count / totalInvocations) * 100;
            const normalizedUsage = (maxUsage > 0) ? (rule.count / maxUsage) : 0;
            
            this._updateRuleItemElement(
                this.ruleItemElements[rank],
                rule,
                rank,
                usagePercent,
                normalizedUsage,
                ruleset,
                totalInvocations
            );
        });

        // Only rebuild DOM if the number of displayed rules changed
        if (this.lastDisplayedRuleCount !== topRules.length) {
            this.uiElements.contentArea.innerHTML = '';
            this.uiElements.contentArea.appendChild(this.headerElement);
            
            for (let i = 0; i < topRules.length; i++) {
                this.uiElements.contentArea.appendChild(this.ruleItemElements[i]);
            }
            
            this.lastDisplayedRuleCount = topRules.length;
        }
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
            this.panelElement.style.left = '50%'; 
            this.panelElement.style.top = '50%'; 
            this.panelElement.style.transform = 'translate(-50%, -50%)';
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
        const v = this.draggablePanel.toggle(); 
        this._savePanelState(); 
        if (v) this.refreshViews(); 
        return v; 
    }
    
    isHidden() { 
        return this.panelElement.classList.contains('hidden'); 
    }
    
    destroy() { 
        this.draggablePanel.destroy(); 
    }
} 