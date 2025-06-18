import { RulesetEditor } from './components/RulesetEditor.js';
import { SetupPanel } from './components/SetupPanel.js';
import { AnalysisPanel } from './components/AnalysisPanel.js';
import { RuleRankPanel } from './components/RuleRankPanel.js';
import { LearningPanel } from './components/LearningPanel.js';
import { EventBus, EVENTS } from '../services/EventBus.js';



export class PanelManager {
    constructor(appContext) {
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.panels = {};

        this.libraryData = null;
        this.panelConfig = [
            { name: 'rulesetEditor', elementId: 'rulesetEditorPanel', buttonId: 'editRuleButton', constructor: RulesetEditor, options: {} },
            { name: 'setupPanel', elementId: 'setupPanel', buttonId: 'setupPanelButton', constructor: SetupPanel, options: {} },
            { name: 'analysisPanel', elementId: 'analysisPanel', buttonId: 'analysisPanelButton', constructor: AnalysisPanel, options: {} },
            { name: 'ruleRankPanel', elementId: 'ruleRankPanel', buttonId: 'rankPanelButton', constructor: RuleRankPanel, options: {} },
            { name: 'learningPanel', elementId: 'learningPanel', buttonId: 'helpButton', constructor: LearningPanel, options: {} }
        ];
    }

    init(libraryData) {
        this.libraryData = libraryData;

        this.panelConfig.forEach(config => {
            const panelElement = document.getElementById(config.elementId);
            if (panelElement) {
                const PanelClass = config.constructor;
                // Standardize constructor call to pass the full appContext
                this.panels[config.name] = new PanelClass(panelElement, this.appContext, config.options);
            }
        });

        this._setupPanelToggleListeners();
        this._setupEventListeners();
    }
    
    _setupPanelToggleListeners() {
        this.panelConfig.forEach(config => {
            const buttonElement = document.getElementById(config.buttonId);
            if (buttonElement) {
                buttonElement.addEventListener('click', () => this.panels[config.name]?.toggle());
            }
        });
    }

    _setupEventListeners() {
        EventBus.subscribe(EVENTS.RULESET_CHANGED, (hex) => {
            if (this.panels.rulesetEditor && !this.panels.rulesetEditor.isHidden()) {
                const editorRulesetInput = document.getElementById('editorRulesetInput');
                if (document.activeElement !== editorRulesetInput) {
                    editorRulesetInput.value = (hex === "Error" || hex === "N/A") ? "" : hex;
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

        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_PANEL, (data) => {
            const panel = this.getPanel(data.panelName);
            if (!panel) return;
        
            if (data.show === true) {
                panel.show();
            } else if (data.show === false) {
                panel.hide();
            } else {
                panel.toggle();
            }
        });
        
        EventBus.subscribe(EVENTS.COMMAND_HIDE_ALL_OVERLAYS, () => {
            this.hideAllPanels();
        });

    }
    


    getPanel(panelName) {
        return this.panels[panelName];
    }


    
    hideAllPanels() {
        Object.values(this.panels).forEach(panel => panel.hide());
    }
}