import { EventBus, EVENTS } from '../services/EventBus.js';
import { formatHexCode } from '../utils/utils.js';

export class TopInfoBar {
    constructor(worldManagerInterface) {
        this.worldManager = worldManagerInterface;
        this.uiElements = null;
    }

    init(uiElements) {
        this.uiElements = uiElements;
        this._setupEventListeners();

        // Initial state update
        this.updateMainRulesetDisplay(this.worldManager.getCurrentRulesetHex());
        this.updateStatsDisplay(this.worldManager.getSelectedWorldStats());
        this.updateBrushSizeDisplay(this.worldManager.getCurrentBrushSize());
        this.updateUndoRedoButtons();
        if (this.uiElements?.statTargetTps) {
            this.uiElements.statTargetTps.textContent = String(this.worldManager.getCurrentSimulationSpeed());
        }
    }

    _setupEventListeners() {
        EventBus.subscribe(EVENTS.RULESET_CHANGED, (hex) => this.updateMainRulesetDisplay(hex));
        EventBus.subscribe(EVENTS.HISTORY_CHANGED, () => this.updateUndoRedoButtons());
        EventBus.subscribe(EVENTS.WORLD_STATS_UPDATED, (stats) => this.updateStatsDisplay(stats));
        EventBus.subscribe(EVENTS.ALL_WORLDS_RESET, () => this.updateStatsDisplay(this.worldManager.getSelectedWorldStats()));
        EventBus.subscribe(EVENTS.BRUSH_SIZE_CHANGED, (size) => this.updateBrushSizeDisplay(size));
        EventBus.subscribe(EVENTS.PERFORMANCE_METRICS_UPDATED, (data) => this.updatePerformanceDisplay(data.fps, data.tps, data.targetTps));
        EventBus.subscribe(EVENTS.SELECTED_WORLD_CHANGED, () => {
            this.updateMainRulesetDisplay(this.worldManager.getCurrentRulesetHex());
            this.updateStatsDisplay(this.worldManager.getSelectedWorldStats());
            this.updateUndoRedoButtons();
        });
    }

    updateMainRulesetDisplay(hex) {
        if (this.uiElements?.rulesetDisplay) {
            this.uiElements.rulesetDisplay.textContent = formatHexCode(hex);
        }
    }

    updateStatsDisplay(stats) {
        if (!stats || !this.uiElements) return;
        if (stats.worldIndex !== undefined && stats.worldIndex !== this.worldManager.getSelectedWorldIndex()) return;
        
        this.uiElements.statTick.textContent = stats.tick !== undefined ? String(stats.tick) : '--';
        this.uiElements.statRatio.textContent = stats.ratio !== undefined ? (stats.ratio * 100).toFixed(2) : '--';
    }

    updatePerformanceDisplay(fps, tpsOfSelectedWorld, targetTps) {
        if (this.uiElements?.statFps) this.uiElements.statFps.textContent = fps !== undefined ? String(fps) : '--';
        if (this.uiElements?.statActualTps) this.uiElements.statActualTps.textContent = tpsOfSelectedWorld !== undefined ? String(Math.round(tpsOfSelectedWorld)) : '--';
        if (this.uiElements?.statTargetTps) this.uiElements.statTargetTps.textContent = targetTps !== undefined ? String(targetTps) : '--';
    }

    updateBrushSizeDisplay(brushSize) {
        if (this.uiElements?.statBrushSize) {
            this.uiElements.statBrushSize.textContent = brushSize !== undefined ? String(brushSize) : '--';
        }
    }
    
    updateUndoRedoButtons() {
        if (!this.worldManager || !this.uiElements.undoButton) return;
        const selectedIndex = this.worldManager.getSelectedWorldIndex();
        const { history, future } = this.worldManager.getRulesetHistoryArrays(selectedIndex);

        this.uiElements.undoButton.disabled = history.length <= 1;
        this.uiElements.redoButton.disabled = future.length === 0;
    }
}