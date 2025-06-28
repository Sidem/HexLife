import { RulesetEditorComponent } from './components/RulesetEditorComponent.js';
import { WorldSetupComponent } from './components/WorldSetupComponent.js';
import { AnalysisComponent } from './components/AnalysisComponent.js';
import { RuleRankComponent } from './components/RuleRankComponent.js';
import { LearningComponent } from './components/LearningComponent.js';
import { RulesetActionsComponent } from './components/RulesetActionsComponent.js';
import { ChromaLabComponent } from './components/ChromaLabComponent.js';
import { DraggablePanel } from './components/DraggablePanel.js';
import { EventBus, EVENTS } from '../services/EventBus.js';

export class PanelManager {
    constructor(appContext) {
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.panels = {};
        this.panelConfig = [
            { name: 'ruleset', elementId: 'rulesetEditorPanel', presenter: DraggablePanel, contentType: RulesetEditorComponent, options: { handleSelector: 'h3' } },
            { name: 'worldsetup', elementId: 'worldSetupPanel', presenter: DraggablePanel, contentType: WorldSetupComponent, options: { handleSelector: 'h3' } },
            { name: 'analysis', elementId: 'analysisPanel', presenter: DraggablePanel, contentType: AnalysisComponent, options: { handleSelector: 'h3' } },
            { name: 'rulerank', elementId: 'ruleRankPanel', presenter: DraggablePanel, contentType: RuleRankComponent, options: { handleSelector: 'h3' } },
            { name: 'learning', elementId: 'learningPanel', presenter: DraggablePanel, contentType: LearningComponent, options: { handleSelector: 'h3' } },
            { name: 'rulesetactions', elementId: 'rulesetActionsPanel', presenter: DraggablePanel, contentType: RulesetActionsComponent, options: { handleSelector: 'h3' } },
            { name: 'chromalab', elementId: 'chromaLabPanel', presenter: DraggablePanel, contentType: ChromaLabComponent, options: { handleSelector: 'h3' } }
        ];
    }

    init() { 
        this.panelConfig.forEach(config => {
            const panelElement = document.getElementById(config.elementId);
            if (panelElement) {
                const PresenterClass = config.presenter;
                const contentContainer = panelElement.querySelector('.panel-content-area');
                const presenterInstance = new PresenterClass(panelElement, {
                    ...config.options,
                    persistence: { identifier: config.name },
                    
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