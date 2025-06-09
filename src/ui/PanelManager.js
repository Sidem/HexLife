import { RulesetEditor } from './components/RulesetEditor.js';
import { SetupPanel } from './components/SetupPanel.js';
import { AnalysisPanel } from './components/AnalysisPanel.js';
import { RuleRankPanel } from './components/RuleRankPanel.js';
import { EventBus, EVENTS } from '../services/EventBus.js';

export class PanelManager {
    constructor(worldManagerInterface) {
        this.worldManager = worldManagerInterface;
        this.panels = {};
        this.uiElements = null;
    }

    init(uiElements) {
        this.uiElements = uiElements;

        if (this.uiElements.rulesetEditorPanel) {
            this.panels.rulesetEditor = new RulesetEditor(this.uiElements.rulesetEditorPanel, this.worldManager);
        }
        if (this.uiElements.setupPanel) {
            this.panels.setupPanel = new SetupPanel(this.uiElements.setupPanel, this.worldManager);
        }
        if (this.uiElements.analysisPanel) {
            this.panels.analysisPanel = new AnalysisPanel(this.uiElements.analysisPanel, this.worldManager, this);
        }
        if (this.uiElements.ruleRankPanel) {
            this.panels.ruleRankPanel = new RuleRankPanel(this.uiElements.ruleRankPanel, this.worldManager);
        }

        this._setupPanelToggleListeners();
        this._setupEventListeners();
    }
    
    _setupPanelToggleListeners() {
        this.uiElements.editRuleButton?.addEventListener('click', () => this.panels.rulesetEditor?.toggle());
        this.uiElements.setupPanelButton?.addEventListener('click', () => this.panels.setupPanel?.toggle());
        this.uiElements.analysisPanelButton?.addEventListener('click', () => this.panels.analysisPanel?.toggle());
        this.uiElements.rankPanelButton?.addEventListener('click', () => this.panels.ruleRankPanel?.toggle());
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
    }

    getPanel(panelName) {
        return this.panels[panelName];
    }
    
    hideAllPanels() {
        Object.values(this.panels).forEach(panel => panel.hide());
    }
}