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
        this.historyItemCache = []; // Add cache for DOM elements
        this.saveStatus = { isPersonal: false, isPublic: false };
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
            historyPopout: document.getElementById('historyPopout'),
            rulesetDisplayContainer: document.getElementById('rulesetDisplayContainer')
        };

        const saveBtn = document.createElement('button');
        saveBtn.id = 'saveRulesetButton';
        saveBtn.className = 'button-icon save-ruleset-button';
        saveBtn.setAttribute('data-tour-id', 'save-ruleset-button');
        saveBtn.title = 'Save this ruleset to your personal library';
        saveBtn.innerHTML = '⭐';
        this.uiElements.rulesetDisplayContainer.appendChild(saveBtn);
        this.uiElements.saveRulesetButton = saveBtn;
        
        this._setupEventListeners();

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
        
        this.updateSaveStatus(this.worldManager.getCurrentRulesetHex());
    }

    _setupEventListeners() {
        EventBus.subscribe(EVENTS.RULESET_CHANGED, (hex) => {
            this.updateMainRulesetDisplay(hex);
            this.updateSaveStatus(hex);
        });
        EventBus.subscribe(EVENTS.RULESET_VISUALIZATION_CHANGED, () => this.updateMainRulesetDisplay(this.worldManager.getCurrentRulesetHex()));
        EventBus.subscribe(EVENTS.HISTORY_CHANGED, () => this.updateUndoRedoButtons());
        EventBus.subscribe(EVENTS.WORLD_STATS_UPDATED, (stats) => this.updateStatsDisplay(stats));
        EventBus.subscribe(EVENTS.ALL_WORLDS_RESET, () => this.updateStatsDisplay(this.worldManager.getSelectedWorldStats()));
        EventBus.subscribe(EVENTS.BRUSH_SIZE_CHANGED, (size) => this.updateBrushSizeDisplay(size));
        EventBus.subscribe(EVENTS.PERFORMANCE_METRICS_UPDATED, (data) => this.updatePerformanceDisplay(data.fps, data.tps, data.targetTps));
        EventBus.subscribe(EVENTS.SELECTED_WORLD_CHANGED, () => {
            const hex = this.worldManager.getCurrentRulesetHex();
            this.updateMainRulesetDisplay(hex);
            this.updateStatsDisplay(this.worldManager.getSelectedWorldStats());
            this.updateUndoRedoButtons();
            this.updateSaveStatus(hex);
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
        
        // Add listener for the save button
        this.uiElements.saveRulesetButton.addEventListener('click', () => {
            const hex = this.worldManager.getCurrentRulesetHex();
            if (hex && hex !== 'N/A' && hex !== 'Error' && !this.saveStatus.isPersonal) {
                EventBus.dispatch(EVENTS.COMMAND_SHOW_SAVE_RULESET_MODAL, { hex });
            }
        });

        // Add subscription to update the star on library changes
        EventBus.subscribe(EVENTS.USER_LIBRARY_CHANGED, () => {
            this.updateSaveStatus(this.worldManager.getCurrentRulesetHex());
        });

        EventBus.subscribe(EVENTS.VIEW_SHOWN, (data) => {
            if (data.view === this.popoutPanels.history) {
                this._efficientUpdateHistoryPopout();
            }
        });
        EventBus.subscribe(EVENTS.HISTORY_CHANGED, (data) => {
            if (data.worldIndex === this.worldManager.getSelectedWorldIndex() && this.popoutPanels.history && !this.popoutPanels.history.isHidden()) {
                this._efficientUpdateHistoryPopout();
            }
        });
    }
    _efficientUpdateHistoryPopout() {
        const listContainer = this.uiElements.historyPopout.querySelector('#historyList');
        if (!listContainer) return;

        const { history } = this.worldManager.getRulesetHistoryArrays(this.worldManager.getSelectedWorldIndex());
        const reversedHistory = history.slice().reverse();

        // Ensure cache is the correct size
        while (this.historyItemCache.length < reversedHistory.length) {
            const newItem = document.createElement('div');
            newItem.className = 'history-item';
            this.historyItemCache.push(newItem);
        }

        // Hide all elements in the container to start
        listContainer.innerHTML = '';

        // Update and show the necessary elements from the cache
        reversedHistory.forEach((hex, index) => {
            const item = this.historyItemCache[index];
            item.textContent = formatHexCode(hex);
            
            // Clone node to safely remove all previous event listeners
            const newItem = item.cloneNode(true);
            this.historyItemCache[index] = newItem;

            if (index === 0) { // First item in reversed list is the current one
                newItem.classList.add('is-current');
                const tag = document.createElement('span');
                tag.className = 'tag';
                tag.textContent = 'Current';
                newItem.appendChild(tag);
            } else {
                newItem.classList.remove('is-current');
                newItem.addEventListener('click', () => {
                    const originalIndex = history.length - 1 - index;
                    EventBus.dispatch(EVENTS.COMMAND_REVERT_TO_HISTORY_STATE, { worldIndex: this.worldManager.getSelectedWorldIndex(), historyIndex: originalIndex });
                    this.popoutPanels.history.hide();
                });
            }
            listContainer.appendChild(newItem);
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

    updateSaveStatus(hex) {
        if (!hex || hex === "N/A" || hex === "Error") {
            this.uiElements.saveRulesetButton.classList.add('hidden');
            return;
        }
        this.uiElements.saveRulesetButton.classList.remove('hidden');

        const status = this.appContext.libraryController.getRulesetStatus(hex);
        this.saveStatus = status; // Cache the status
        this.uiElements.saveRulesetButton.classList.remove('is-personal', 'is-public', 'not-saved');

        if (status.isPersonal) {
            this.uiElements.saveRulesetButton.classList.add('is-personal');
            this.uiElements.saveRulesetButton.title = 'This ruleset is in your personal library.';
        } else if (status.isPublic) {
            this.uiElements.saveRulesetButton.classList.add('is-public');
            this.uiElements.saveRulesetButton.title = 'This is a public ruleset. Click to save to your library.';
        } else {
            this.uiElements.saveRulesetButton.classList.add('not-saved');
            this.uiElements.saveRulesetButton.title = 'Save this ruleset to your personal library.';
        }
    }
}