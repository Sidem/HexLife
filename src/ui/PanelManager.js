import { RulesetEditorComponent } from './components/RulesetEditorComponent.js';
import { WorldSetupComponent } from './components/WorldSetupComponent.js';
import { AnalysisComponent } from './components/AnalysisComponent.js';
import { RuleRankComponent } from './components/RuleRankComponent.js';
import { LearningComponent } from './components/LearningComponent.js';
import { RulesetActionsComponent } from './components/RulesetActionsComponent.js';
import { DraggablePanel } from './components/DraggablePanel.js';
import { EventBus, EVENTS } from '../services/EventBus.js';



export class PanelManager {
    constructor(appContext) {
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.panels = {};

        this.libraryData = null;
        this.panelConfig = [
            { name: 'rulesetEditor', elementId: 'rulesetEditorPanel', constructor: DraggablePanel, contentComponent: RulesetEditorComponent, persistenceKey: 'ruleset', options: { handleSelector: 'h3' } },
            { name: 'worldSetup', elementId: 'worldSetupPanel', constructor: DraggablePanel, contentComponent: WorldSetupComponent, persistenceKey: 'worldSetup', options: { handleSelector: 'h3' } },
            { name: 'analysis', elementId: 'analysisPanel', constructor: DraggablePanel, contentComponent: AnalysisComponent, persistenceKey: 'analysis', options: { handleSelector: 'h3' } },
            { name: 'ruleRankPanel', elementId: 'ruleRankPanel', constructor: DraggablePanel, contentComponent: RuleRankComponent, persistenceKey: 'ruleRank', options: { handleSelector: 'h3' } },
            { name: 'learning', elementId: 'learningPanel', constructor: DraggablePanel, contentComponent: LearningComponent, persistenceKey: 'learning', options: { handleSelector: 'h3' } },
            { name: 'rulesetActions', elementId: 'rulesetActionsPanel', constructor: DraggablePanel, contentComponent: RulesetActionsComponent, persistenceKey: 'rulesetActions', options: { handleSelector: 'h3' } }
        ];
    }

    init(libraryData) {
        this.libraryData = libraryData;

        this.panelConfig.forEach(config => {
            const panelElement = document.getElementById(config.elementId);
            if (panelElement) {
                const PresenterClass = config.constructor;
                
                let contentInstance = null;
                if (config.contentComponent) {
                    contentInstance = new config.contentComponent(null, { 
                        appContext: this.appContext, 
                        libraryData: this.libraryData,
                        context: 'desktop'
                    });
                }

                const presenterInstance = new PresenterClass(panelElement, {
                    appContext: this.appContext,
                    ...config.options,
                    persistence: { identifier: config.persistenceKey || config.name },
                    contentComponent: contentInstance 
                });

                if (config.contentComponent) {
                    const contentContainer = panelElement.querySelector('.panel-content-area');
                    if (contentContainer) {
                        
                        if (contentInstance) {
                            contentContainer.innerHTML = '';
                            const componentElement = contentInstance.getElement();
                            if (componentElement) {
                                contentContainer.appendChild(componentElement);
                            } else {
                                console.error(`Failed to get element from ${config.contentComponent.name} for panel ${config.name}`);
                            }
                            
                            
                            presenterInstance.contentComponent = contentInstance;
                        }
                    }
                }
                
                
                this.panels[config.name] = presenterInstance;
            }
        });

        this._setupEventListeners();
    }
    


    _setupEventListeners() {
        EventBus.subscribe(EVENTS.RULESET_CHANGED, (hex) => {
            if (this.panels.rulesetEditor && !this.panels.rulesetEditor.isHidden()) {
                const editorRulesetInput = document.getElementById('desktop-editorRulesetInput');
                if (document.activeElement !== editorRulesetInput) {
                    editorRulesetInput.value = (hex === "Error" || hex === "N/A") ? "" : hex;
                }
                this.panels.rulesetEditor.contentComponent?.refresh();
            }
        });
        
        EventBus.subscribe(EVENTS.WORLD_STATS_UPDATED, () => {
            this.panels.ruleRankPanel?.contentComponent?.scheduleRefresh();
        });

        EventBus.subscribe(EVENTS.ALL_WORLDS_RESET, () => {
            this.panels.worldSetup?.contentComponent?.refresh();
            this.panels.ruleRankPanel?.contentComponent?.scheduleRefresh();
        });

        EventBus.subscribe(EVENTS.WORLD_SETTINGS_CHANGED, () => {
            this.panels.worldSetup?.contentComponent?.refresh();
        });

        EventBus.subscribe(EVENTS.SELECTED_WORLD_CHANGED, () => {
             if (this.panels.rulesetEditor && !this.panels.rulesetEditor.isHidden()) this.panels.rulesetEditor.contentComponent?.refresh();
             if (this.panels.analysis && !this.panels.analysis.isHidden()) this.panels.analysis.contentComponent.refresh();
             if (this.panels.ruleRankPanel && !this.panels.ruleRankPanel.isHidden()) this.panels.ruleRankPanel.contentComponent.refresh();
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