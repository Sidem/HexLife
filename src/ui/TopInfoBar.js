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
        this.saveStatus = { isPersonal: false, isPublic: false };
    }

    init() {
        this.uiElements = {
            rulesetDisplay: document.getElementById('rulesetDisplay'),
            rulesetDisplayName: document.getElementById('rulesetDisplayName'),
            rulesetDisplayCode: document.getElementById('rulesetDisplayCode'),
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
            rulesetDisplayContainer: document.getElementById('rulesetDisplayContainer'),
            saveRulesetButton: document.getElementById('saveRulesetButton'),
            rulesetVizContainer: document.querySelector('.ruleset-viz-container'),
            appMenuButton: document.getElementById('appMenuButton'),
            appMenuPopout: document.getElementById('appMenuPopout')
        };
        
        this._setupEventListeners();

        this.updateMainRulesetDisplay(this.worldManager.getCurrentRulesetHex());
        this.updateStatsDisplay(this.worldManager.getSelectedWorldStats());
        this.updateBrushSizeDisplay(this.appContext.brushController.getBrushSize());
        this.updateUndoRedoButtons();
        if (this.uiElements?.statTargetTps) {
            this.uiElements.statTargetTps.textContent = String(this.appContext.simulationController.getSpeed());
        }
        this.popoutPanels.history = new PopoutPanel(this.uiElements.historyPopout, this.uiElements.historyButton, { position: 'bottom', alignment: 'end' });
        
        // Initialize the App Menu Popout (desktop only)
        if (!this.appContext.uiManager.isMobile() && this.uiElements.appMenuButton && this.uiElements.appMenuPopout) {
            this.popoutPanels.appMenu = new PopoutPanel(this.uiElements.appMenuPopout, this.uiElements.appMenuButton, {
                position: 'bottom',
                alignment: 'start'
            });
        }
        
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
        
        if (!this.appContext.uiManager.isMobile()) {
            this.uiElements.appMenuButton?.addEventListener('click', () => {
                this.popoutPanels.appMenu?.toggle();
            });
        }
        
        // Add listener for the save button
        this.uiElements.saveRulesetButton.addEventListener('click', () => {
            const hex = this.worldManager.getCurrentRulesetHex();
            // Only allow saving if it's NOT personal and NOT public.
            // Or editing if it IS personal. Public rulesets are not editable via this button.
            if (this.saveStatus.isPersonal) {
                const rule = this.appContext.libraryController.getUserLibrary().find(r => r.hex === hex);
                if (rule) EventBus.dispatch(EVENTS.COMMAND_SHOW_SAVE_RULESET_MODAL, rule);
            } else if (!this.saveStatus.isPublic) {
                if (hex && hex !== 'N/A' && hex !== 'Error') {
                    EventBus.dispatch(EVENTS.COMMAND_SHOW_SAVE_RULESET_MODAL, { hex });
                }
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

        listContainer.innerHTML = ''; // Clear previous content

        reversedHistory.forEach((hex, index) => {
            const isCurrent = index === 0;
            const item = this.appContext.rulesetDisplayFactory.createHistoryListItem(hex, isCurrent);
            
            if (!isCurrent) {
                item.addEventListener('click', () => {
                    const originalIndex = history.length - 1 - index;
                    EventBus.dispatch(EVENTS.COMMAND_REVERT_TO_HISTORY_STATE, { worldIndex: this.worldManager.getSelectedWorldIndex(), historyIndex: originalIndex });
                    this.popoutPanels.history.hide();
                });
            }
            listContainer.appendChild(item);
        });
    }
    updateMainRulesetDisplay(hex) {
        if (!this.uiElements?.rulesetDisplay) return;

        // Update the small visualization
        if (this.uiElements.rulesetVizContainer) {
            this.uiElements.rulesetVizContainer.innerHTML = '';
            const svg = rulesetVisualizer.createRulesetSVG(hex, {width: '100%', height: '100%'});
            svg.classList.add('ruleset-viz-svg');
            this.uiElements.rulesetVizContainer.appendChild(svg);
        }

        // Check library for a name
        const personalRule = this.appContext.libraryController.getUserLibrary().find(r => r.hex === hex);
        const publicRule = this.appContext.libraryController.getLibraryData().rulesets.find(r => r.hex === hex);
        
        const ruleName = personalRule?.name || publicRule?.name;

        this.uiElements.rulesetDisplayCode.textContent = formatHexCode(hex);
        if (ruleName) {
            this.uiElements.rulesetDisplayName.textContent = ruleName;
            this.uiElements.rulesetDisplay.classList.add('has-name');
        } else {
            this.uiElements.rulesetDisplayName.textContent = '';
            this.uiElements.rulesetDisplay.classList.remove('has-name');
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
        if (this.uiElements?.statTargetTps) {
            const speed = this.appContext.simulationController.getSpeed();
            this.uiElements.statTargetTps.textContent = targetTps !== undefined ? String(targetTps) : String(speed);
        }
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
            this.uiElements.saveRulesetButton.style.cursor = 'pointer';
            this.uiElements.saveRulesetButton.title = 'Edit this ruleset in your personal library.';
        } else if (status.isPublic) {
            this.uiElements.saveRulesetButton.classList.add('is-public');
            this.uiElements.saveRulesetButton.style.cursor = 'not-allowed'; // Make it non-clickable
            this.uiElements.saveRulesetButton.title = 'This is a public ruleset from the library.';
        } else {
            this.uiElements.saveRulesetButton.classList.add('not-saved');
            this.uiElements.saveRulesetButton.style.cursor = 'pointer'; // Reset cursor
            this.uiElements.saveRulesetButton.title = 'Save this ruleset to your personal library.';
        }
    }
}