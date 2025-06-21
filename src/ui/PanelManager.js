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
        
        // The config now just maps a name to a panel shell and identifies its content type
        this.panelConfig = [
            { name: 'ruleset', elementId: 'rulesetEditorPanel', presenter: DraggablePanel, contentType: RulesetEditorComponent, options: { handleSelector: 'h3' } },
            { name: 'worldsetup', elementId: 'worldSetupPanel', presenter: DraggablePanel, contentType: WorldSetupComponent, options: { handleSelector: 'h3' } },
            { name: 'analysis', elementId: 'analysisPanel', presenter: DraggablePanel, contentType: AnalysisComponent, options: { handleSelector: 'h3' } },
            { name: 'rulerank', elementId: 'ruleRankPanel', presenter: DraggablePanel, contentType: RuleRankComponent, options: { handleSelector: 'h3' } },
            { name: 'learning', elementId: 'learningPanel', presenter: DraggablePanel, contentType: LearningComponent, options: { handleSelector: 'h3' } },
            { name: 'rulesetactions', elementId: 'rulesetActionsPanel', presenter: DraggablePanel, contentType: RulesetActionsComponent, options: { handleSelector: 'h3' } }
        ];
    }

    init() { // No longer needs libraryData
        this.panelConfig.forEach(config => {
            const panelElement = document.getElementById(config.elementId);
            if (panelElement) {
                const PresenterClass = config.presenter;
                const contentContainer = panelElement.querySelector('.panel-content-area');

                // Create the Panel/DraggablePanel SHELL.
                // It does NOT get a content component instance anymore.
                const presenterInstance = new PresenterClass(panelElement, {
                    ...config.options,
                    persistence: { identifier: config.name },
                    // Pass the constructor as a type identifier and the content mount point
                    contentComponentType: config.contentType,
                    contentContainer: contentContainer
                });

                this.panels[config.name] = presenterInstance;
            }
        });
        this._setupEventListeners();
    }
    


    _setupEventListeners() {
        EventBus.subscribe(EVENTS.RULESET_CHANGED, (hex) => {
            if (this.panels.ruleset && !this.panels.ruleset.isHidden()) {
                const editorRulesetInput = document.getElementById('ruleset-editor-input');
                if (document.activeElement !== editorRulesetInput) {
                    editorRulesetInput.value = (hex === "Error" || hex === "N/A") ? "" : hex;
                }
                // The UIManager will handle refreshing the component when it's visible
            }
        });
        
        // Note: Component-specific events are now handled by the UIManager's shared components
        // These events will be processed by the UIManager since it owns the singleton components

        
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