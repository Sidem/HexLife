import { RulesetEditor } from './components/RulesetEditor.js';
import { SetupPanel } from './components/SetupPanel.js';
import { AnalysisPanel } from './components/AnalysisPanel.js';
import { RuleRankPanel } from './components/RuleRankPanel.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { MoreView } from './views/MoreView.js';
import { RulesView } from './views/RulesView.js';
import { WorldsView } from './views/WorldsView.js';
import { AnalyzeView } from './views/AnalyzeView.js';
import { EditorView } from './views/EditorView.js';
import { uiManager } from './UIManager.js';

export class PanelManager {
    constructor(worldManagerInterface) {
        this.worldManager = worldManagerInterface;
        this.panels = {};
        this.uiElements = null;
        this.mobileViews = {};
        this.libraryData = null;
        this.panelConfig = [
            { name: 'rulesetEditor', elementId: 'rulesetEditorPanel', buttonId: 'editRuleButton', constructor: RulesetEditor, options: { isMobile: this.isMobile } },
            { name: 'setupPanel', elementId: 'setupPanel', buttonId: 'setupPanelButton', constructor: SetupPanel, options: { isMobile: this.isMobile } },
            { name: 'analysisPanel', elementId: 'analysisPanel', buttonId: 'analysisPanelButton', constructor: AnalysisPanel, options: { isMobile: this.isMobile } },
            { name: 'ruleRankPanel', elementId: 'ruleRankPanel', buttonId: 'rankPanelButton', constructor: RuleRankPanel, options: { isMobile: this.isMobile } }
        ];
    }

    init(uiElements, libraryData) {
        this.uiElements = uiElements;
        this.libraryData = libraryData;

        this.panelConfig.forEach(config => {
            const panelElement = this.uiElements[config.elementId];
            if (panelElement) {
                const PanelClass = config.constructor;
                if (PanelClass === AnalysisPanel) {
                    this.panels[config.name] = new PanelClass(panelElement, this.worldManager, this, config.options);
                } else {
                    this.panels[config.name] = new PanelClass(panelElement, this.worldManager, config.options);
                }
            }
        });

        // MOBILE VIEW INITIALIZATIONS
        if (uiManager.isMobile()) {
            const mobileViewsContainer = document.getElementById('mobile-views-container');
            if (mobileViewsContainer) {
                this.mobileViews.more = new MoreView(mobileViewsContainer, this.worldManager);
                this.mobileViews.more.render();

                this.mobileViews.rules = new RulesView(mobileViewsContainer, this.libraryData, this.worldManager);
                this.mobileViews.rules.render();
                
                this.mobileViews.worlds = new WorldsView(mobileViewsContainer, this.worldManager);
                this.mobileViews.worlds.render();

                this.mobileViews.analyze = new AnalyzeView(mobileViewsContainer, this.worldManager);
                this.mobileViews.analyze.render();
                
                this.mobileViews.editor = new EditorView(mobileViewsContainer, this);
                this.mobileViews.editor.render();
            }
        }

        this._setupPanelToggleListeners();
        this._setupEventListeners();
    }
    
    _setupPanelToggleListeners() {
        this.panelConfig.forEach(config => {
            const buttonElement = this.uiElements[config.buttonId];
            if (buttonElement) {
                buttonElement.addEventListener('click', () => this.panels[config.name]?.toggle());
            }
        });
    }

    _setupEventListeners() {
        EventBus.subscribe(EVENTS.RULESET_CHANGED, (hex) => {
            if (this.panels.rulesetEditor && !this.panels.rulesetEditor.isHidden()) {
                if (document.activeElement !== this.uiElements.editorRulesetInput) {
                    this.uiElements.editorRulesetInput.value = (hex === "Error" || hex === "N/A") ? "" : hex;
                }
                this.panels.rulesetEditor.refreshViews();
            }
        });
        
        EventBus.subscribe(EVENTS.WORLD_STATS_UPDATED, () => {
            this.panels.ruleRankPanel?.refreshViews();
        });

        EventBus.subscribe(EVENTS.ALL_WORLDS_RESET, () => {
            this.panels.setupPanel?.refreshViews();
            this.panels.ruleRankPanel?.refreshViews();
        });

        EventBus.subscribe(EVENTS.WORLD_SETTINGS_CHANGED, () => {
            this.panels.setupPanel?.refreshViews();
        });

        EventBus.subscribe(EVENTS.SELECTED_WORLD_CHANGED, () => {
             if (this.panels.rulesetEditor && !this.panels.rulesetEditor.isHidden()) this.panels.rulesetEditor.refreshViews();
             if (this.panels.analysisPanel && !this.panels.analysisPanel.isHidden()) this.panels.analysisPanel.refreshViews();
             if (this.panels.ruleRankPanel && !this.panels.ruleRankPanel.isHidden()) this.panels.ruleRankPanel.refreshViews();
        });
        EventBus.subscribe(EVENTS.COMMAND_SHOW_VIEW, this.showMobileView.bind(this));
    }
    
    getMobileViews() {
        return this.mobileViews;
    }
    
    getMobileView(viewName) {
        return this.mobileViews[viewName];
    }

    getPanel(panelName) {
        return this.panels[panelName];
    }

    showMobileView({ targetView, currentView }) {
        if (!uiManager.isMobile()) return;
    
        const nextView = (targetView === currentView && targetView !== 'simulate') ? 'simulate' : targetView;
    
        Object.values(this.mobileViews).forEach(v => v.hide());
    
        const viewToShow = this.mobileViews[nextView];
        if (viewToShow) {
            viewToShow.show();
        }
        EventBus.dispatch(EVENTS.MOBILE_VIEW_CHANGED, { activeView: nextView });
    }
    
    hideAllPanels() {
        Object.values(this.panels).forEach(panel => panel.hide());
    }
}