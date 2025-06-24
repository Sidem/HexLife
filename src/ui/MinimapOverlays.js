import { BaseComponent } from './components/BaseComponent.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
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
        this.init();
    }

    init() {
        if (!this.mountPoint) return;
        this.mountPoint.innerHTML = ''; // Clear any previous content

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
    }

    updateOverlays() {
        if (!this.layoutCache.miniMap || !this.worldManager) return;

        const allWorldsStatus = this.worldManager.getWorldsFullStatus();
        const selectedWorldIndex = this.worldManager.getSelectedWorldIndex();
        const selectedWorldRuleset = allWorldsStatus[selectedWorldIndex]?.stats.rulesetHex;
        const vizState = {
            showCycleIndicator: this.visualizationController.getShowCycleIndicator(),
            showMinimapOverlay: this.visualizationController.getShowMinimapOverlay(),
            vizType: this.visualizationController.getVizType(),
        };

        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const worldStatus = allWorldsStatus[i];
            const { miniMapW, miniMapH, miniMapSpacing, gridContainerX, gridContainerY } = this.layoutCache.miniMap;
            const row = Math.floor(i / Config.WORLD_LAYOUT_COLS);
            const col = i % Config.WORLD_LAYOUT_COLS;
            const miniX = col * (miniMapW + miniMapSpacing);
            const miniY = row * (miniMapH + miniMapSpacing);

            // Update Cycle Indicator
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

            // Update Ruleset Overlay
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
} 