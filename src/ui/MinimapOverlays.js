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
        this.statusBadgeElements = [];
        this.scoreBadgeElements = [];
        /** Per-world auto-explore scores (set while a search runs; null otherwise). */
        this._exploreScores = null;
        this._exploring = false;
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

            // At-a-glance terminal-state badge (extinct / saturated / cycling). Surfaces metrics
            // already computed per world so the 3×3 minimap is scannable without selecting each tile.
            const badge = document.createElement('div');
            badge.className = 'world-status-badge hidden';
            badge.dataset.worldId = i;
            this.mountPoint.appendChild(badge);
            this.statusBadgeElements.push(badge);

            // Per-world interestingness score, shown only during an auto-explore run (top-left so it
            // never collides with the bottom-anchored status badge or the ruleset overlay).
            const scoreBadge = document.createElement('div');
            scoreBadge.className = 'world-explore-score hidden';
            scoreBadge.dataset.worldId = i;
            this.mountPoint.appendChild(scoreBadge);
            this.scoreBadgeElements.push(scoreBadge);
        }

        this._subscribeToEvent(EVENTS.LAYOUT_UPDATED, this.handleLayoutUpdate);
        this._subscribeToEvent(EVENTS.WORLD_STATS_UPDATED, this.updateOverlays);
        this._subscribeToEvent(EVENTS.RULESET_VISUALIZATION_CHANGED, this.updateOverlays);
        this._subscribeToEvent(EVENTS.ALL_WORLDS_RESET, this.updateOverlays);
        this._subscribeToEvent(EVENTS.UI_MODE_CHANGED, this.handleUIModeChange);
        this._subscribeToEvent(EVENTS.EXPLORE_PROGRESS, this.handleExploreProgress);
    }

    handleLayoutUpdate(layout) {
        this.layoutCache = layout;
        this.updateOverlays();
    }

    handleUIModeChange({ mode }) {
        const isMobile = mode === 'mobile';
        this.overlayElements.forEach(overlay => overlay.classList.toggle('mini', isMobile));
        this.statusBadgeElements.forEach(badge => badge.classList.toggle('mini', isMobile));
        this.scoreBadgeElements.forEach(badge => badge.classList.toggle('mini', isMobile));
    }

    // Track the live per-world auto-explore scores so the next overlay pass can paint the badges.
    handleExploreProgress(payload) {
        const running = payload?.state === 'running' || payload?.state === 'paused';
        this._exploring = running;
        if (running && Array.isArray(payload.perWorldScores)) {
            this._exploreScores = payload.perWorldScores;
        } else if (!running) {
            this._exploreScores = null;
        }
        this.updateOverlays();
    }

    updateOverlays() {
        if (!this.layoutCache.miniMap || !this.worldManager) return;

        const allWorldsStatus = this.worldManager.getWorldsFullStatus();
        const selectedWorldIndex = this.worldManager.getSelectedWorldIndex();
        const selectedWorldRuleset = allWorldsStatus[selectedWorldIndex]?.stats.rulesetHex;
        const vizState = {
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


            const scoreEl = this.scoreBadgeElements[i];
            const scoreInfo = (this._exploring && this._exploreScores) ? this._exploreScores[i] : null;
            if (scoreEl && scoreInfo) {
                const mini = this.overlayElements[i]?.classList.contains('mini') ? ' mini' : '';
                if (scoreInfo.killed) {
                    scoreEl.className = `world-explore-score killed${mini}`;
                    scoreEl.textContent = '✕';
                    scoreEl.title = `Killed: ${scoreInfo.killReason || 'degenerate'}`;
                } else {
                    const s = scoreInfo.score || 0;
                    const tier = s >= 0.6 ? 'high' : (s >= 0.4 ? 'mid' : 'low');
                    scoreEl.className = `world-explore-score ${tier}${mini}`;
                    scoreEl.textContent = s.toFixed(2);
                    scoreEl.title = `Interestingness ${s.toFixed(3)}`;
                }
                scoreEl.style.left = `${miniX + miniMapSpacing}px`;
                scoreEl.style.top = `${miniY + miniMapSpacing}px`;
            } else if (scoreEl) {
                scoreEl.className = 'world-explore-score hidden';
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