import { RulesetEditorComponent } from './components/RulesetEditorComponent.js';
import { WorldSetupComponent } from './components/WorldSetupComponent.js';
import { AnalysisComponent } from './components/AnalysisComponent.js';
import { RuleRankComponent } from './components/RuleRankComponent.js';
import { LearningComponent } from './components/LearningComponent.js';
import { RulesetActionsComponent } from './components/RulesetActionsComponent.js';
import { ChromaLabComponent } from './components/ChromaLabComponent.js';
import { KeyboardShortcutsComponent } from './components/KeyboardShortcutsComponent.js';
import { DraggablePanel } from './components/DraggablePanel.js';
import { EventBus, EVENTS } from '../services/EventBus.js';

export class PanelManager {
    constructor(appContext) {
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.panels = {};
        this.panelConfig = [
            { name: 'ruleset', elementId: 'rulesetEditorPanel', presenter: DraggablePanel, contentType: RulesetEditorComponent, triggerButtonId: 'editRuleButton', options: { handleSelector: 'h3' } },
            { name: 'worldsetup', elementId: 'worldSetupPanel', presenter: DraggablePanel, contentType: WorldSetupComponent, triggerButtonId: 'setupPanelButton', options: { handleSelector: 'h3' } },
            { name: 'analysis', elementId: 'analysisPanel', presenter: DraggablePanel, contentType: AnalysisComponent, triggerButtonId: 'analysisPanelButton', options: { handleSelector: 'h3' } },
            { name: 'rulerank', elementId: 'ruleRankPanel', presenter: DraggablePanel, contentType: RuleRankComponent, triggerButtonId: 'rankPanelButton', options: { handleSelector: 'h3' } },
            { name: 'learning', elementId: 'learningPanel', presenter: DraggablePanel, contentType: LearningComponent, triggerButtonId: 'helpButton', options: { handleSelector: 'h3' } },
            { name: 'rulesetactions', elementId: 'rulesetActionsPanel', presenter: DraggablePanel, contentType: RulesetActionsComponent, triggerButtonId: 'rulesetActionsButton', options: { handleSelector: 'h3' } },
            { name: 'chromalab', elementId: 'chromaLabPanel', presenter: DraggablePanel, contentType: ChromaLabComponent, triggerButtonId: 'colorPanelButton', options: { handleSelector: 'h3' } },
            { name: 'shortcuts', elementId: 'shortcutsPanel', presenter: DraggablePanel, contentType: KeyboardShortcutsComponent, triggerButtonId: 'shortcutsButton', options: { handleSelector: 'h3' } }
        ];
    }

    init() {
        this.panelConfig.forEach((config, index) => {
            const panelElement = document.getElementById(config.elementId);
            if (panelElement) {
                const PresenterClass = config.presenter;
                const contentContainer = panelElement.querySelector('.panel-content-area');
                const triggerButton = config.triggerButtonId ? document.getElementById(config.triggerButtonId) : null;
                const presenterInstance = new PresenterClass(panelElement, {
                    ...config.options,
                    persistence: { identifier: config.name },
                    // Cascade first-time positions so freshly opened panels never
                    // stack exactly on top of each other.
                    defaultPosition: { x: 64 + index * 32, y: 52 + index * 28 },
                    onFocus: (panel) => this.bringToFront(panel),
                    onVisibilityChange: (visible) => triggerButton?.classList.toggle('active', visible),
                    contentComponentType: config.contentType,
                    contentContainer: contentContainer
                });

                this.panels[config.name] = presenterInstance;
                // Panels restored open from a previous session bypass show().
                triggerButton?.classList.toggle('active', !presenterInstance.isHidden());
            }
        });
        this._setupEventListeners();
    }

    /**
     * Re-stacks panel z-indexes deterministically with the given panel on top.
     * Keeps the whole range below popouts (z 1050) and the onboarding overlay.
     */
    bringToFront(panel) {
        const zOf = (p) => parseInt(p.panelElement.style.zIndex, 10) || 1000;
        const others = Object.values(this.panels)
            .filter(p => p !== panel)
            .sort((a, b) => zOf(a) - zOf(b));
        let z = 1001;
        others.forEach(p => { p.panelElement.style.zIndex = String(z++); });
        if (panel?.panelElement) panel.panelElement.style.zIndex = String(z);
    }

    /**
     * Returns the visible panel with the highest z-index, or null.
     */
    getTopMostVisiblePanel() {
        const zOf = (p) => parseInt(p.panelElement.style.zIndex, 10) || 1000;
        return Object.values(this.panels)
            .filter(p => !p.isHidden())
            .reduce((top, p) => (!top || zOf(p) > zOf(top) ? p : top), null);
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