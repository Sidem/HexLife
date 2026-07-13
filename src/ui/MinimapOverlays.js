import { BaseComponent } from './components/BaseComponent.js';
import { EVENTS } from '../services/EventBus.js';
import { rulesetVisualizer } from '../utils/rulesetVisualizer.js';
import { computeWorldStatus } from './worldStatus.js';
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
        this.lockBadgeElements = [];
        this.parentRingElements = [];
        this.parentBadgeElements = [];
        this.bakingBadgeElements = [];
        this.bakingRingElements = [];
        /** Per-world auto-explore scores (set while a search runs; null otherwise). */
        this._exploreScores = null;
        this._exploring = false;
        /** Index of the world currently borrowed for library thumbnail baking (-1 = none). */
        this._bakingWorldIndex = -1;
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

            // Ruleset-lock indicator (top-right). Shown when the world's ruleset is locked against
            // the evolutionary/automatic paths (Generate/Mutate/Clone/Breed).
            const lockBadge = document.createElement('div');
            lockBadge.className = 'world-lock-badge hidden';
            lockBadge.dataset.worldId = i;
            lockBadge.textContent = '🔒';
            lockBadge.title = "Ruleset locked — protected from Generate/Mutate/Clone/Breed";
            this.mountPoint.appendChild(lockBadge);
            this.lockBadgeElements.push(lockBadge);

            // Breed-parent indicator: a full-minimap ring + a 🧬 label on every world flagged as a
            // genepool parent (driven by worldSettings.isParent, like the lock badge).
            const parentRing = document.createElement('div');
            parentRing.className = 'world-parent-ring hidden';
            parentRing.dataset.worldId = i;
            this.mountPoint.appendChild(parentRing);
            this.parentRingElements.push(parentRing);

            const parentBadge = document.createElement('div');
            parentBadge.className = 'world-parent-badge hidden';
            parentBadge.dataset.worldId = i;
            parentBadge.textContent = '🧬';
            parentBadge.title = 'Breeding parent — a source for genepool breeding';
            this.mountPoint.appendChild(parentBadge);
            this.parentBadgeElements.push(parentBadge);

            // "In use" indicator: while a world is borrowed as the scratch world for library thumbnail
            // baking, a dimming ring + a "baking…" label mark it temporarily unavailable (it flickers
            // through transient rulesets during the bake). Cleared when the batch restores the world.
            const bakingRing = document.createElement('div');
            bakingRing.className = 'world-baking-ring hidden';
            bakingRing.dataset.worldId = i;
            this.mountPoint.appendChild(bakingRing);
            this.bakingRingElements.push(bakingRing);

            const bakingBadge = document.createElement('div');
            bakingBadge.className = 'world-baking-badge hidden';
            bakingBadge.dataset.worldId = i;
            bakingBadge.textContent = '⏳ baking…';
            bakingBadge.title = 'Temporarily in use to render library thumbnails';
            this.mountPoint.appendChild(bakingBadge);
            this.bakingBadgeElements.push(bakingBadge);
        }

        this._subscribeToEvent(EVENTS.LAYOUT_UPDATED, this.handleLayoutUpdate);
        this._subscribeToEvent(EVENTS.WORLD_STATS_UPDATED, this.updateOverlays);
        this._subscribeToEvent(EVENTS.RULESET_VISUALIZATION_CHANGED, this.updateOverlays);
        this._subscribeToEvent(EVENTS.ALL_WORLDS_RESET, this.updateOverlays);
        this._subscribeToEvent(EVENTS.UI_MODE_CHANGED, this.handleUIModeChange);
        this._subscribeToEvent(EVENTS.EXPLORE_PROGRESS, this.handleExploreProgress);
        this._subscribeToEvent(EVENTS.WORLD_SETTINGS_CHANGED, this.updateOverlays);
        this._subscribeToEvent(EVENTS.WORLD_BAKING_STATE_CHANGED, this.handleBakingStateChange);
    }

    // Track which world (if any) is borrowed for thumbnail baking so the next pass can mark it "in use".
    handleBakingStateChange(payload) {
        this._bakingWorldIndex = Number.isInteger(payload?.worldIndex) ? payload.worldIndex : -1;
        this.updateOverlays();
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
        this.lockBadgeElements.forEach(badge => badge.classList.toggle('mini', isMobile));
        this.parentBadgeElements.forEach(badge => badge.classList.toggle('mini', isMobile));
        this.bakingBadgeElements.forEach(badge => badge.classList.toggle('mini', isMobile));
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
        const worldSettings = this.worldManager.getWorldSettingsForUI();
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
                ? computeWorldStatus(worldStatus.stats)
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


            const lockEl = this.lockBadgeElements[i];
            if (lockEl) {
                if (worldSettings[i]?.locked) {
                    lockEl.classList.remove('hidden');
                    lockEl.classList.toggle('mini', this.overlayElements[i]?.classList.contains('mini'));
                    const w = lockEl.classList.contains('mini') ? 15 : 18;
                    lockEl.style.left = `${miniX + miniMapW - w - miniMapSpacing}px`;
                    lockEl.style.top = `${miniY + miniMapSpacing}px`;
                } else {
                    lockEl.classList.add('hidden');
                }
            }


            const ringEl = this.parentRingElements[i];
            const parentBadgeEl = this.parentBadgeElements[i];
            const isParent = !!worldSettings[i]?.isParent && worldStatus?.renderData.enabled;
            if (ringEl && parentBadgeEl && isParent) {
                ringEl.className = 'world-parent-ring';
                ringEl.style.left = `${miniX}px`;
                ringEl.style.top = `${miniY}px`;
                ringEl.style.width = `${miniMapW}px`;
                ringEl.style.height = `${miniMapH}px`;

                parentBadgeEl.className = 'world-parent-badge';
                parentBadgeEl.classList.toggle('mini', this.overlayElements[i]?.classList.contains('mini'));
                // Sit just left of the top-right lock badge so the two never overlap.
                const w = parentBadgeEl.classList.contains('mini') ? 15 : 18;
                parentBadgeEl.style.left = `${miniX + miniMapW - 2 * w - 2 * miniMapSpacing}px`;
                parentBadgeEl.style.top = `${miniY + miniMapSpacing}px`;
            } else {
                if (ringEl) ringEl.className = 'world-parent-ring hidden';
                if (parentBadgeEl) parentBadgeEl.className = 'world-parent-badge hidden';
            }


            const bakingRingEl = this.bakingRingElements[i];
            const bakingBadgeEl = this.bakingBadgeElements[i];
            const isBaking = i === this._bakingWorldIndex;
            if (bakingRingEl && bakingBadgeEl && isBaking) {
                bakingRingEl.className = 'world-baking-ring';
                bakingRingEl.style.left = `${miniX}px`;
                bakingRingEl.style.top = `${miniY}px`;
                bakingRingEl.style.width = `${miniMapW}px`;
                bakingRingEl.style.height = `${miniMapH}px`;

                bakingBadgeEl.className = 'world-baking-badge';
                bakingBadgeEl.classList.toggle('mini', this.overlayElements[i]?.classList.contains('mini'));
                // Centered horizontally, sitting just above vertical center of the minimap cell.
                bakingBadgeEl.style.left = `${miniX + miniMapSpacing}px`;
                bakingBadgeEl.style.top = `${miniY + miniMapH / 2 - 10}px`;
                bakingBadgeEl.style.width = `${miniMapW - 2 * miniMapSpacing}px`;
            } else {
                if (bakingRingEl) bakingRingEl.className = 'world-baking-ring hidden';
                if (bakingBadgeEl) bakingBadgeEl.className = 'world-baking-badge hidden';
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

}