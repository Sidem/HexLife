import { EventBus, EVENTS } from '../services/EventBus.js';
import { formatHexCode, formatCompactNumber } from '../utils/utils.js';
import { PopoutPanel } from './components/PopoutPanel.js';
import { rulesetVisualizer } from '../utils/rulesetVisualizer.js';
import { computeStatusWord } from './worldStatus.js';
import { ICONS } from './icons.js';

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
            statRatioBar: document.getElementById('stat-ratio-bar'),
            statStatus: document.getElementById('stat-status'),
            statBrushSize: document.getElementById('stat-brush-size'),
            statFps: document.getElementById('stat-fps'),
            statFpsTile: document.querySelector('.stat-tile-fps'),
            statTpsTile: document.querySelector('.stat-tile-tps'),
            statActualTps: document.getElementById('stat-actual-tps'),
            statTargetTps: document.getElementById('stat-target-tps'),
            statTpsBar: document.getElementById('stat-tps-bar'),
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
        
        // Replace the emoji placeholders (kept in index.html as a no-JS fallback)
        // with the shared SVG icon set, matching the toolbar/tab-bar treatment.
        if (this.uiElements.historyButton) this.uiElements.historyButton.innerHTML = ICONS.history;
        if (this.uiElements.saveRulesetButton) this.uiElements.saveRulesetButton.innerHTML = ICONS.star;

        this._buildRuleDeck();
        this._setupEventListeners();

        this.updateMainRulesetDisplay(this.worldManager.getCurrentRulesetHex());
        this.updateStatsDisplay(this.worldManager.getSelectedWorldStats());
        this.updateBrushSizeDisplay(this.appContext.brushController.getBrushSize());
        this.updateUndoRedoButtons();
        this.applyShowPerformance(this.appContext.visualizationController.getShowPerformance());
        if (this.uiElements?.statTargetTps) {
            this.uiElements.statTargetTps.textContent = String(this.appContext.simulationController.getSpeed());
        }
        this.popoutPanels.history = new PopoutPanel(this.uiElements.historyPopout, this.uiElements.historyButton, { position: 'bottom', alignment: 'end' });
        // Register with the toolbar so these top-bar popouts also close on
        // outside-click and Escape, like the toolbar's own popouts.
        this.appContext.toolbar?.registerPopout(this.popoutPanels.history);


        if (!this.appContext.uiManager.isMobile() && this.uiElements.appMenuButton && this.uiElements.appMenuPopout) {
            this.popoutPanels.appMenu = new PopoutPanel(this.uiElements.appMenuPopout, this.uiElements.appMenuButton, {
                position: 'bottom',
                alignment: 'start'
            });
            this.appContext.toolbar?.registerPopout(this.popoutPanels.appMenu);

            // The app-menu "Settings" entry opens the Settings panel (a second entry point
            // beside the toolbar's gear button) and closes the menu behind it.
            document.getElementById('appMenuSettingsButton')?.addEventListener('click', () => {
                this.popoutPanels.appMenu?.hide();
                EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'settings', show: true });
            });
        }
        
        this.updateSaveStatus(this.worldManager.getCurrentRulesetHex());
    }

    /**
     * Builds the always-visible "rule deck" — the core creative loop (Surprise /
     * Generate / Mutate) docked beside the ruleset identity so the 90% action never
     * needs a panel. Desktop-only (mobile keeps its FAB stack); hidden via CSS there.
     * @private
     */
    _buildRuleDeck() {
        const container = this.uiElements.rulesetDisplayContainer;
        const anchor = this.uiElements.saveRulesetButton;
        if (!container || !anchor) return;

        const deck = document.createElement('div');
        deck.className = 'ruleset-deck-controls';
        deck.setAttribute('data-tour-id', 'rule-deck');

        const makeBtn = (id, iconSvg, label, tourId) => {
            const b = document.createElement('button');
            b.id = id;
            b.className = 'button-icon rule-deck-button';
            b.innerHTML = iconSvg;
            b.title = label;
            b.setAttribute('aria-label', label);
            if (tourId) b.setAttribute('data-tour-id', tourId);
            deck.appendChild(b);
            return b;
        };

        // Surprise Me leads the deck as the hero action. It is dispatched on click
        // only — it never auto-fires and does not touch the onboarding tour.
        const surpriseBtn = makeBtn('ruleDeckSurprise', ICONS.wand,
            'Surprise me — fresh random rule on all 9 worlds, then play', 'surprise-me-button');
        surpriseBtn.classList.add('rule-deck-surprise');
        const generateBtn = makeBtn('ruleDeckGenerate', ICONS.sparkles, 'Generate a new ruleset (G)');
        const cloneMutateBtn = makeBtn('ruleDeckCloneMutate', ICONS.copyPlus, 'Clone & mutate other worlds (M)');

        container.insertBefore(deck, anchor);

        surpriseBtn.addEventListener('click', () => this._surpriseMe());
        generateBtn.addEventListener('click', () => {
            EventBus.dispatch(EVENTS.COMMAND_EXECUTE_GENERATE_RULESET);
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Generated new ruleset' });
        });
        cloneMutateBtn.addEventListener('click', () => {
            EventBus.dispatch(EVENTS.COMMAND_EXECUTE_CLONE_AND_MUTATE);
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Cloned ruleset to all worlds & mutated others' });
        });
    }

    /**
     * One-click "wow": generate a fresh random ruleset across all 9 worlds, reseed,
     * and start playing — independent of the user's saved scope / auto-reset settings,
     * so it behaves identically on a brand-new visit.
     * @private
     */
    _surpriseMe() {
        EventBus.dispatch(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, {
            bias: Math.random(),
            generationMode: 'r_sym',
            applyScope: 'all',
            shouldReset: true
        });
        EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, false);
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: '✨ Surprise! New random rule on all worlds.', type: 'success' });
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
        EventBus.subscribe(EVENTS.COMMAND_SET_SHOW_PERFORMANCE, (shouldShow) => this.applyShowPerformance(shouldShow));
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
        
        
        this.uiElements.saveRulesetButton.addEventListener('click', () => {
            const hex = this.worldManager.getCurrentRulesetHex();
            
            
            if (this.saveStatus.isPersonal) {
                const rule = this.appContext.libraryController.getUserLibrary().find(r => r.hex === hex);
                if (rule) EventBus.dispatch(EVENTS.COMMAND_SHOW_SAVE_RULESET_MODAL, rule);
            } else if (!this.saveStatus.isPublic) {
                if (hex && hex !== 'N/A' && hex !== 'Error') {
                    EventBus.dispatch(EVENTS.COMMAND_SHOW_SAVE_RULESET_MODAL, { hex });
                }
            }
        });

        
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

        listContainer.innerHTML = ''; 

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

        
        if (this.uiElements.rulesetVizContainer) {
            this.uiElements.rulesetVizContainer.innerHTML = '';
            const svg = rulesetVisualizer.createRulesetSVG(hex, {width: '100%', height: '100%'});
            svg.classList.add('ruleset-viz-svg');
            this.uiElements.rulesetVizContainer.appendChild(svg);
        }

        
        // Every ruleset gets a human-friendly identity: the library name if it has one,
        // otherwise a derived two-word mnemonic. Derived names are styled differently
        // (see .is-derived) so users can tell them apart from a name they chose.
        const isValidHex = hex && hex !== 'N/A' && hex !== 'Error';

        this.uiElements.rulesetDisplayCode.textContent = formatHexCode(hex);
        if (isValidHex) {
            const { name, isDerived } = this.appContext.libraryController.getDisplayName(hex);
            this.uiElements.rulesetDisplayName.textContent = name;
            this.uiElements.rulesetDisplay.classList.add('has-name');
            this.uiElements.rulesetDisplay.classList.toggle('is-derived', isDerived);
        } else {
            this.uiElements.rulesetDisplayName.textContent = '';
            this.uiElements.rulesetDisplay.classList.remove('has-name', 'is-derived');
        }
    }

    updateStatsDisplay(stats) {
        if (!stats || !this.uiElements) return;
        if (stats.worldIndex !== undefined && stats.worldIndex !== this.worldManager.getSelectedWorldIndex()) return;
        
        this.uiElements.statTick.textContent = stats.tick !== undefined ? formatCompactNumber(stats.tick) : '--';

        const ratioPct = stats.ratio !== undefined ? stats.ratio * 100 : null;
        this.uiElements.statRatio.textContent = ratioPct !== null ? ratioPct.toFixed(1) : '--';
        if (this.uiElements.statRatioBar) {
            this.uiElements.statRatioBar.style.width = `${ratioPct !== null ? Math.max(0, Math.min(100, ratioPct)) : 0}%`;
        }

        // Plain-language state chip ("Active" / "Died out" / "Full" / "Cycling ↻N") for
        // the selected world — surfaces the same classification the minimap badges use.
        if (this.uiElements.statStatus) {
            const status = computeStatusWord(stats);
            const el = this.uiElements.statStatus;
            if (el.textContent !== status.word) el.textContent = status.word;
            el.className = `status-chip status-${status.type}`;
            el.title = status.title;
        }
    }

    updatePerformanceDisplay(fps, tpsOfSelectedWorld, targetTps) {
        if (this.uiElements?.statFps) this.uiElements.statFps.textContent = fps !== undefined ? String(fps) : '--';
        if (this.uiElements?.statActualTps) this.uiElements.statActualTps.textContent = tpsOfSelectedWorld !== undefined ? formatCompactNumber(Math.round(tpsOfSelectedWorld)) : '--';
        const speed = this.appContext.simulationController.getSpeed();
        const target = targetTps !== undefined ? targetTps : speed;
        if (this.uiElements?.statTargetTps) {
            this.uiElements.statTargetTps.textContent = formatCompactNumber(target);
        }
        // Meter shows how close the world is running to its target speed.
        if (this.uiElements?.statTpsBar) {
            const ratio = target > 0 && tpsOfSelectedWorld !== undefined ? (tpsOfSelectedWorld / target) * 100 : 0;
            this.uiElements.statTpsBar.style.width = `${Math.max(0, Math.min(100, ratio))}%`;
        }
    }

    /**
     * Show or hide the FPS/TPS telemetry tiles (and their preceding separator) per the
     * persisted "Show performance" preference. Hidden by default-off users; the tiles keep
     * updating in the background so re-enabling is instant.
     */
    applyShowPerformance(shouldShow) {
        const show = !!shouldShow;
        this.uiElements?.statFpsTile?.classList.toggle('hidden', !show);
        this.uiElements?.statTpsTile?.classList.toggle('hidden', !show);
        // The hairline separator directly before the FPS tile only makes sense when the
        // telemetry group is visible.
        const sep = this.uiElements?.statFpsTile?.previousElementSibling;
        if (sep && sep.classList.contains('stat-sep')) sep.classList.toggle('hidden', !show);
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
        this.saveStatus = status; 
        this.uiElements.saveRulesetButton.classList.remove('is-personal', 'is-public', 'not-saved');

        // Filled star = this ruleset is known/saved (personal or public);
        // outline star = unsaved. Colour is driven by the state class in CSS.
        if (status.isPersonal) {
            this.uiElements.saveRulesetButton.classList.add('is-personal');
            this.uiElements.saveRulesetButton.innerHTML = ICONS.starFilled;
            this.uiElements.saveRulesetButton.style.cursor = 'pointer';
            this.uiElements.saveRulesetButton.title = 'Edit this ruleset in your personal library.';
        } else if (status.isPublic) {
            this.uiElements.saveRulesetButton.classList.add('is-public');
            this.uiElements.saveRulesetButton.innerHTML = ICONS.starFilled;
            this.uiElements.saveRulesetButton.style.cursor = 'not-allowed';
            this.uiElements.saveRulesetButton.title = 'This is a public ruleset from the library.';
        } else {
            this.uiElements.saveRulesetButton.classList.add('not-saved');
            this.uiElements.saveRulesetButton.innerHTML = ICONS.star;
            this.uiElements.saveRulesetButton.style.cursor = 'pointer';
            this.uiElements.saveRulesetButton.title = 'Save this ruleset to your personal library.';
        }
    }
}