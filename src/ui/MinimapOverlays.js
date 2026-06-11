import { BaseComponent } from './components/BaseComponent.js';
import { EVENTS } from '../services/EventBus.js';
import { rulesetVisualizer } from '../utils/rulesetVisualizer.js';
import * as Config from '../core/config.js';

export class MinimapOverlays extends BaseComponent {
    constructor(appContext) {
        super(document.getElementById('minimap-guide'));
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.visualizationController = appContext.visualizationController;
        this.layoutCache = {};
        this.overlayElements = [];
        this.cycleIndicatorElements = [];
        this.statusBadgeElements = [];
        this.init();
    }

    init() {
        if (!this.mountPoint) return;
        this.mountPoint.innerHTML = ''; 

        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const overlay = document.createElement('div');
            overlay.className = 'minimap-ruleset-overlay';
            overlay.style.display = 'none';
            this.mountPoint.appendChild(overlay);
            this.overlayElements.push(overlay);

            const indicator = document.createElement('div');
            indicator.className = 'cycle-indicator hidden';
            indicator.dataset.worldId = i;
            this.mountPoint.appendChild(indicator);
            this.cycleIndicatorElements.push(indicator);

            // At-a-glance terminal-state badge (extinct / saturated / cycling). Surfaces metrics
            // already computed per world so the 3×3 minimap is scannable without selecting each tile.
            const badge = document.createElement('div');
            badge.className = 'world-status-badge hidden';
            badge.dataset.worldId = i;
            this.mountPoint.appendChild(badge);
            this.statusBadgeElements.push(badge);
        }

        this._subscribeToEvent(EVENTS.LAYOUT_UPDATED, this.handleLayoutUpdate);
        this._subscribeToEvent(EVENTS.WORLD_STATS_UPDATED, this.updateOverlays);
        this._subscribeToEvent(EVENTS.RULESET_VISUALIZATION_CHANGED, this.updateOverlays);
        this._subscribeToEvent(EVENTS.ALL_WORLDS_RESET, this.updateOverlays);
        this._subscribeToEvent(EVENTS.UI_MODE_CHANGED, this.handleUIModeChange);
    }

    handleLayoutUpdate(layout) {
        this.layoutCache = layout;
        this.updateOverlays();
    }

    handleUIModeChange({ mode }) {
        const isMobile = mode === 'mobile';
        this.overlayElements.forEach(overlay => overlay.classList.toggle('mini', isMobile));
        this.cycleIndicatorElements.forEach(indicator => indicator.classList.toggle('mini', isMobile));
        this.statusBadgeElements.forEach(badge => badge.classList.toggle('mini', isMobile));
    }

    updateOverlays() {
        if (!this.layoutCache.miniMap || !this.worldManager) return;

        const allWorldsStatus = this.worldManager.getWorldsFullStatus();
        const selectedWorldIndex = this.worldManager.getSelectedWorldIndex();
        const selectedWorldRuleset = allWorldsStatus[selectedWorldIndex]?.stats.rulesetHex;
        const vizState = {
            showCycleIndicator: this.visualizationController.getShowCycleIndicator(),
            showMinimapOverlay: this.visualizationController.getShowMinimapOverlay(),
            showStatusBadges: this.visualizationController.getShowStatusBadges(),
            vizType: this.visualizationController.getVizType(),
        };

        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const worldStatus = allWorldsStatus[i];
            const { miniMapW, miniMapH, miniMapSpacing } = this.layoutCache.miniMap;
            const row = Math.floor(i / Config.WORLD_LAYOUT_COLS);
            const col = i % Config.WORLD_LAYOUT_COLS;
            const miniX = col * (miniMapW + miniMapSpacing);
            const miniY = row * (miniMapH + miniMapSpacing);

            
            const indicatorEl = this.cycleIndicatorElements[i];
            const showIndicators = vizState?.showCycleIndicator ?? false;
            if (indicatorEl && worldStatus?.stats.isInCycle && showIndicators) {
                indicatorEl.classList.remove('hidden');
                indicatorEl.style.left = `${miniX + miniMapW - 20 - miniMapSpacing}px`;
                indicatorEl.style.top = `${miniY}px`;
                const cycleLength = worldStatus.stats.cycleLength;
                if (indicatorEl.dataset.cycleLength !== String(cycleLength)) {
                    indicatorEl.dataset.cycleLength = String(cycleLength);
                    indicatorEl.innerHTML = `
                        <svg viewBox="0 0 24 24" width="100%" height="100%">
                            <path d="M12 2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8V2z" fill="#fff"/>
                            <path d="M22 12a10 10 0 0 0-10-10v2a8 8 0 0 1 8 8h2z" fill="#fff" transform="rotate(180 12 12)"/>
                            <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-size="9" font-weight="bold">${cycleLength}</text>
                        </svg>
                    `;
                }
            } else if (indicatorEl) {
                indicatorEl.classList.add('hidden');
            }


            const badgeEl = this.statusBadgeElements[i];
            const showBadges = vizState?.showStatusBadges ?? false;
            const status = (badgeEl && showBadges && worldStatus?.renderData.enabled)
                ? MinimapOverlays._computeStatus(worldStatus.stats)
                : null;
            if (status) {
                badgeEl.className = `world-status-badge ${status.type}`;
                badgeEl.classList.toggle('mini', this.overlayElements[i]?.classList.contains('mini'));
                badgeEl.style.left = `${miniX + miniMapSpacing}px`;
                badgeEl.style.top = `${miniY + miniMapH - 18 - miniMapSpacing}px`;
                badgeEl.title = status.title;
                const badgeSig = `${status.type}-${status.label}`;
                if (badgeEl.dataset.badgeSig !== badgeSig) {
                    badgeEl.textContent = status.label;
                    badgeEl.dataset.badgeSig = badgeSig;
                }
            } else if (badgeEl) {
                badgeEl.classList.add('hidden');
                badgeEl.dataset.badgeSig = '';
            }


            const overlayEl = this.overlayElements[i];
            const showOverlay = vizState?.showMinimapOverlay ?? false;
            if (overlayEl && worldStatus?.renderData.enabled && showOverlay) {
                overlayEl.style.display = 'block';
                overlayEl.style.left = `${miniX}px`;
                overlayEl.style.top = `${miniY}px`;
                const currentSignature = `${i}-${worldStatus.stats.rulesetHex}-${selectedWorldIndex}-${selectedWorldRuleset}-${rulesetVisualizer.getVisualizationType()}`;
                if (overlayEl.dataset.signature !== currentSignature) {
                    overlayEl.innerHTML = '';
                    const svg = (i === selectedWorldIndex)
                        ? rulesetVisualizer.createRulesetSVG(worldStatus.stats.rulesetHex)
                        : rulesetVisualizer.createDiffSVG(selectedWorldRuleset, worldStatus.stats.rulesetHex);
                    if (svg) {
                        svg.classList.add('ruleset-viz-svg');
                        overlayEl.appendChild(svg);
                    }
                    overlayEl.dataset.signature = currentSignature;
                }
            } else if (overlayEl) {
                overlayEl.style.display = 'none';
            }
        }
    }

    // Classify a world's terminal state from already-computed stats. Extinct/saturated take
    // precedence over cycling (a period-1 cycle at ratio 0/1 is really just dead/full). Returns
    // null for an actively-evolving world so no badge is shown.
    static _computeStatus(stats) {
        if (!stats) return null;
        if (stats.ratio <= 0) {
            return { type: 'extinct', label: '✕', title: 'Extinct — all cells dead' };
        }
        if (stats.ratio >= 1) {
            return { type: 'saturated', label: '■', title: 'Saturated — all cells alive' };
        }
        if (stats.isInCycle) {
            const period = stats.cycleLength || 0;
            return { type: 'cycling', label: `↻${period}`, title: `Stable cycle — period ${period}` };
        }
        return null;
    }
}