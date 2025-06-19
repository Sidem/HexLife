import { RulesetEditor } from './components/RulesetEditor.js';
import { WorldSetupComponent } from './components/WorldSetupComponent.js';
import { AnalysisComponent } from './components/AnalysisComponent.js';
import { RuleRankPanel } from './components/RuleRankPanel.js';
import { LearningPanel } from './components/LearningPanel.js';
import { DraggablePanel } from './components/DraggablePanel.js';
import { EventBus, EVENTS } from '../services/EventBus.js';



export class PanelManager {
    constructor(appContext) {
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.panels = {};

        this.libraryData = null;
        this.panelConfig = [
            { name: 'rulesetEditor', elementId: 'rulesetEditorPanel', buttonId: 'editRuleButton', constructor: RulesetEditor, options: {} },
            { name: 'worldSetup', elementId: 'worldSetupPanel', buttonId: 'setupPanelButton', constructor: DraggablePanel, contentComponent: WorldSetupComponent, persistenceKey: 'worldSetup', options: { handleSelector: 'h3' } },
            { name: 'analysis', elementId: 'analysisPanel', buttonId: 'analysisPanelButton', constructor: DraggablePanel, contentComponent: AnalysisComponent, persistenceKey: 'analysis', options: { handleSelector: 'h3' } },
            { name: 'ruleRankPanel', elementId: 'ruleRankPanel', buttonId: 'rankPanelButton', constructor: RuleRankPanel, options: {} },
            { name: 'learningPanel', elementId: 'learningPanel', buttonId: 'helpButton', constructor: LearningPanel, options: {} },
            { name: 'rulesetActions', elementId: 'rulesetActionsPanel', buttonId: 'rulesetActionsButton', constructor: DraggablePanel, options: { handleSelector: 'h3', persistence: { identifier: 'rulesetActions' } } }
        ];
    }

    init(libraryData) {
        this.libraryData = libraryData;

        this.panelConfig.forEach(config => {
            const panelElement = document.getElementById(config.elementId);
            if (panelElement) {
                const PresenterClass = config.constructor;
                const presenterInstance = new PresenterClass(panelElement, {
                    appContext: this.appContext,
                    ...config.options,
                    persistence: { identifier: config.persistenceKey || config.name }
                });

                if (config.contentComponent) {
                    const contentContainer = panelElement.querySelector('.panel-content-area');
                    if (contentContainer) {
                        // Instantiate the content component, passing null for the mountPoint
                        // as we are manually placing its element.
                        const contentInstance = new config.contentComponent(null, { appContext: this.appContext });

                        // Append the component's rendered element to the panel's content area.
                        contentContainer.appendChild(contentInstance.getElement());
                        
                        // Store reference to content component for potential future use
                        presenterInstance.contentComponent = contentInstance;
                    }
                }
                
                // Store the presenter, which is the main handle for showing/hiding
                this.panels[config.name] = presenterInstance;
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
            this.panels.worldSetup?.contentComponent?.refresh();
            this.panels.ruleRankPanel?.refreshViews();
        });

        EventBus.subscribe(EVENTS.WORLD_SETTINGS_CHANGED, () => {
            this.panels.worldSetup?.contentComponent?.refresh();
        });

        EventBus.subscribe(EVENTS.SELECTED_WORLD_CHANGED, () => {
             if (this.panels.rulesetEditor && !this.panels.rulesetEditor.isHidden()) this.panels.rulesetEditor.refreshViews();
             if (this.panels.analysis && !this.panels.analysis.isHidden()) this.panels.analysis.contentComponent.refresh();
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