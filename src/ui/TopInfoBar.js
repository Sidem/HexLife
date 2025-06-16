import { EventBus, EVENTS } from '../services/EventBus.js';
import { formatHexCode } from '../utils/utils.js';
import { PopoutPanel } from './components/PopoutPanel.js';
import { rulesetVisualizer } from '../utils/rulesetVisualizer.js';

export class TopInfoBar {
    constructor(appContext) {
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.uiElements = null;
        this.popoutPanels = {};
    }

    init() {
        this.uiElements = {
            rulesetDisplay: document.getElementById('rulesetDisplay'),
            statTick: document.getElementById('stat-tick'),
            statRatio: document.getElementById('stat-ratio'),
            statBrushSize: document.getElementById('stat-brush-size'),
            statFps: document.getElementById('stat-fps'),
            statActualTps: document.getElementById('stat-actual-tps'),
            statTargetTps: document.getElementById('stat-target-tps'),
            undoButton: document.getElementById('undoButton'),
            redoButton: document.getElementById('redoButton'),
            historyButton: document.getElementById('historyButton'),
            historyPopout: document.getElementById('historyPopout')
        };
        this._setupEventListeners();

        // Initial state update
        this.updateMainRulesetDisplay(this.worldManager.getCurrentRulesetHex());
        this.updateStatsDisplay(this.worldManager.getSelectedWorldStats());
        this.updateBrushSizeDisplay(this.appContext.brushController.getState().brushSize);
        this.updateUndoRedoButtons();
        if (this.uiElements?.statTargetTps) {
            this.uiElements.statTargetTps.textContent = String(this.appContext.simulationController.getState().speed);
        }
        this.popoutPanels.history = new PopoutPanel(this.uiElements.historyPopout, this.uiElements.historyButton, { position: 'bottom', alignment: 'end' });
        
        const vizContainer = document.createElement('span');
        vizContainer.className = 'ruleset-viz-container';
        this.uiElements.rulesetDisplay.parentNode.insertBefore(vizContainer, this.uiElements.rulesetDisplay);
        this.uiElements.rulesetVizContainer = vizContainer;
    }

    _setupEventListeners() {
        EventBus.subscribe(EVENTS.RULESET_CHANGED, (hex) => this.updateMainRulesetDisplay(hex));
        EventBus.subscribe(EVENTS.RULESET_VISUALIZATION_CHANGED, () => this.updateMainRulesetDisplay(this.worldManager.getCurrentRulesetHex()));
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
        if (this.uiElements.undoButton) {
            this.uiElements.undoButton.addEventListener('click', () => {
                EventBus.dispatch(EVENTS.COMMAND_UNDO_RULESET, { worldIndex: this.worldManager.getSelectedWorldIndex() });
            });
        }
    
        if (this.uiElements.redoButton) {
            this.uiElements.redoButton.addEventListener('click', () => {
                EventBus.dispatch(EVENTS.COMMAND_REDO_RULESET, { worldIndex: this.worldManager.getSelectedWorldIndex() });
            });
        }
        this.uiElements.historyButton?.addEventListener('click', () => this.popoutPanels.history.toggle());
        EventBus.subscribe(EVENTS.POPOUT_SHOWN, (data) => {
            if (data.panel === this.popoutPanels.history) {
                this._updateHistoryPopout();
            }
        });
        EventBus.subscribe(EVENTS.HISTORY_CHANGED, (data) => {
            if (data.worldIndex === this.worldManager.getSelectedWorldIndex() && this.popoutPanels.history && !this.popoutPanels.history.isHidden()) {
                this._updateHistoryPopout();
            }
        });
    }
    _updateHistoryPopout() {
        const listContainer = this.uiElements.historyPopout.querySelector('#historyList');
        if (!listContainer) return;
        const selectedIndex = this.worldManager.getSelectedWorldIndex();
        const { history } = this.worldManager.getRulesetHistoryArrays(selectedIndex);
        const currentIndex = history.length - 1;
        listContainer.innerHTML = '';
        history.slice().reverse().forEach((hex, index) => {
            const reversedIndex = history.length - 1 - index;
            const item = document.createElement('div');
            item.className = 'history-item';
            item.textContent = formatHexCode(hex);
            if (reversedIndex === currentIndex) {
                item.classList.add('is-current');
                const tag = document.createElement('span');
                tag.className = 'tag';
                tag.textContent = 'Current';
                item.appendChild(tag);
            } else {
                item.addEventListener('click', () => {
                    EventBus.dispatch(EVENTS.COMMAND_REVERT_TO_HISTORY_STATE, { worldIndex: selectedIndex, historyIndex: reversedIndex });
                    this.popoutPanels.history.hide();
                });
            }
            listContainer.appendChild(item);
        });
    }
    updateMainRulesetDisplay(hex) {
        if (this.uiElements?.rulesetDisplay) {
            this.uiElements.rulesetDisplay.textContent = formatHexCode(hex);
            if (this.uiElements.rulesetVizContainer) {
                this.uiElements.rulesetVizContainer.innerHTML = '';
                const svg = rulesetVisualizer.createRulesetSVG(hex, {width: '100%', height: '100%'});
                svg.classList.add('ruleset-viz-svg');
                this.uiElements.rulesetVizContainer.appendChild(svg);
            }
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