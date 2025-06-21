import { EventBus, EVENTS } from '../services/EventBus.js';
import { TopInfoBar } from './TopInfoBar.js';
import { KeyboardShortcutManager } from './KeyboardShortcutManager.js';
import { BottomTabBar } from './BottomTabBar.js';
import { ToolsBottomSheet } from './components/ToolsBottomSheet.js';
import { MoreView } from './views/MoreView.js';
import { MobileView } from './views/MobileView.js';
import { WorldSetupComponent } from './components/WorldSetupComponent.js';
import { AnalysisComponent } from './components/AnalysisComponent.js';
import { RulesetEditorComponent } from './components/RulesetEditorComponent.js';
import { RulesetActionsComponent } from './components/RulesetActionsComponent.js';
import { LearningComponent } from './components/LearningComponent.js';
import { downloadFile } from '../utils/utils.js';
import * as PersistenceService from '../services/PersistenceService.js';
import * as Config from '../core/config.js';
import { generateShareUrl } from '../utils/utils.js';
import { ControlsComponent } from './components/ControlsComponent.js';
import { RuleRankComponent } from './components/RuleRankComponent.js';



const MOBILE_QUERY = '(max-width: 768px), (pointer: coarse) and (hover: none)';

export class UIManager {
    constructor(appContext) {
        this.appContext = appContext;
        this.onboardingManager = appContext.onboardingManager; 
        this.mode = 'desktop';
        this.mediaQueryList = window.matchMedia(MOBILE_QUERY);
        this.mobileViews = {};
        this.activeMobileViewName = 'simulate';
        this.managedComponents = [];
        this.sharedComponents = {}; // NEW: Property to hold singleton instances
    }

    #mobileViewConfig = {
        rules: { constructor: RulesetActionsComponent, title: 'Rulesets' },
        worlds: { constructor: WorldSetupComponent, title: 'World Setup' },
        analyze: { constructor: AnalysisComponent, title: 'Analysis' },
        editor: { constructor: RulesetEditorComponent, title: 'Ruleset Editor' },
        learning: { constructor: LearningComponent, title: 'Learning Hub (Alpha)' },
    };

    /**
     * Initializes the entire UI layer, sets up mode detection,
     * and wires all necessary event listeners.
     */
    init() {
        const { appContext, appContext: { worldManager, panelManager, toolbar, onboardingManager, libraryController } } = this;
        const libraryData = libraryController.getLibraryData();

        // NEW: Instantiate all shared components ONCE
        this.sharedComponents = {
            controls: new ControlsComponent(appContext),
            rulesetActions: new RulesetActionsComponent(appContext, { libraryData }),
            rulesetEditor: new RulesetEditorComponent(appContext),
            worldSetup: new WorldSetupComponent(appContext),
            analysis: new AnalysisComponent(appContext),
            ruleRank: new RuleRankComponent(appContext),
            learning: new LearningComponent(appContext)
        };

        
        this.updateMode(false); 
        this.mediaQueryList.addEventListener('change', () => this.updateMode(true));

        
        const topInfoBar = new TopInfoBar(appContext);
        topInfoBar.init();
        toolbar.init();
        panelManager.init(); // No longer needs libraryData

        const keyboardManager = new KeyboardShortcutManager(appContext, panelManager, toolbar);
        keyboardManager.init();

        
        this.managedComponents.push(topInfoBar, toolbar, keyboardManager);

        
        this.initMobileUI(libraryData);
        
        
        this.setupGlobalEventListeners();
        this._setupHelpTriggerListeners();



        
        EventBus.dispatch(EVENTS.UI_MODE_CHANGED, { mode: this.mode });
        this.#initGuidingBoxes();

        console.log(`UIManager initialized in '${this.mode}' mode.`);
    }

    #initGuidingBoxes() {
        const canvas = document.getElementById('hexGridCanvas');
        const selectedWorldGuide = document.getElementById('selected-world-guide');
        const miniMapGuide = document.getElementById('minimap-guide');

        if (canvas && selectedWorldGuide && miniMapGuide) {
            EventBus.subscribe(EVENTS.LAYOUT_CALCULATED, (layout) => {
                if (layout && layout.selectedView && layout.miniMap) {
                    const canvasOffsetX = canvas.offsetLeft;
                    const canvasOffsetY = canvas.offsetTop;
                    const { x, y, width, height } = layout.selectedView;
                    selectedWorldGuide.style.left = `${x + canvasOffsetX}px`;
                    selectedWorldGuide.style.top = `${y + canvasOffsetY}px`;
                    selectedWorldGuide.style.width = `${width}px`;
                    selectedWorldGuide.style.height = `${height}px`;
                    selectedWorldGuide.style.display = 'block';

                    const { gridContainerX, gridContainerY, miniMapW, miniMapH, miniMapSpacing } = layout.miniMap;
                    const miniMapGridWidth = miniMapW * Config.WORLD_LAYOUT_COLS + miniMapSpacing * (Config.WORLD_LAYOUT_COLS - 1);
                    const miniMapGridHeight = miniMapH * Config.WORLD_LAYOUT_ROWS + miniMapSpacing * (Config.WORLD_LAYOUT_ROWS - 1);

                    miniMapGuide.style.left = `${gridContainerX + canvasOffsetX}px`;
                    miniMapGuide.style.top = `${gridContainerY + canvasOffsetY}px`;
                    miniMapGuide.style.width = `${miniMapGridWidth}px`;
                    miniMapGuide.style.height = `${miniMapGridHeight}px`;
                    miniMapGuide.style.display = 'block';
                }
            });
        }
    }
    
    /**
     * Checks the media query, updates the internal mode, and dispatches an
     * event if the mode has changed. This also handles showing/hiding mobile-only components.
     * @param {boolean} [dispatchEvent=true] - Whether to dispatch the UI_MODE_CHANGED event.
     */
    updateMode(dispatchEvent = true) {
        const newMode = this.mediaQueryList.matches ? 'mobile' : 'desktop';
        if (newMode !== this.mode) {
            this.mode = newMode;
            console.log(`UI mode changed to: ${this.mode}`);
            
            
            document.getElementById('bottom-tab-bar')?.classList.toggle('hidden', !this.isMobile());
            document.getElementById('mobile-canvas-controls')?.classList.toggle('hidden', !this.isMobile());
            document.getElementById('vertical-toolbar')?.classList.toggle('hidden', this.isMobile());

            if (dispatchEvent) {
                EventBus.dispatch(EVENTS.UI_MODE_CHANGED, { mode: this.mode });
            }
        }
    }

    isMobile() {
        return this.mode === 'mobile';
    }

    initMobileUI(libraryData) {
        const { appContext, appContext: { worldManager, panelManager } } = this;

        
        const mobileViewsContainer = document.getElementById('mobile-views-container');
        if (mobileViewsContainer) {
            this.mobileViews.more = new MoreView(mobileViewsContainer, appContext);
            this.mobileViews.more.render();
        }

        const bottomTabBarEl = document.getElementById('bottom-tab-bar');
        if (bottomTabBarEl) new BottomTabBar(bottomTabBarEl, panelManager);

        const fabRightContainer = document.getElementById('mobile-fab-container-right');
        const fabLeftContainer = document.getElementById('mobile-fab-container-left');

        if (fabRightContainer) {
            fabRightContainer.innerHTML = `
                <button id="mobileToolsFab" class="mobile-fab secondary-fab" title="Adjust Speed & Brush"><span class="icon">🛠️</span></button>
                <button id="interaction-mode-toggle" class="mobile-fab secondary-fab" title="Toggle Pan/Draw Mode"><span class="icon">🖐️</span></button>
                <button id="mobilePlayPauseButton" class="mobile-fab primary-fab">▶</button>
            `;
            new ToolsBottomSheet('fab-tools-bottom-sheet', fabRightContainer.querySelector('#mobileToolsFab'), appContext);
            fabRightContainer.querySelector('#mobilePlayPauseButton').addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE));
            fabRightContainer.querySelector('#interaction-mode-toggle').addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_INTERACTION_MODE));
            
            EventBus.subscribe(EVENTS.SIMULATION_PAUSED, (isPaused) => {
                const mobilePlayPause = fabRightContainer.querySelector('#mobilePlayPauseButton');
                if (mobilePlayPause) mobilePlayPause.textContent = isPaused ? "▶" : "❚❚";
            });
            EventBus.subscribe(EVENTS.INTERACTION_MODE_CHANGED, (mode) => {
                const toggleIcon = fabRightContainer.querySelector('#interaction-mode-toggle .icon');
                if (toggleIcon) toggleIcon.textContent = mode === 'pan' ? '🖐️' : '✏️';
            });
        }

        this.renderCustomFabs(fabLeftContainer);
        EventBus.subscribe(EVENTS.COMMAND_UPDATE_FAB_UI, () => this.renderCustomFabs(fabLeftContainer));
    }

    renderCustomFabs(fabLeftContainer) {
        if (!fabLeftContainer) return;
        fabLeftContainer.innerHTML = '';
        const { appContext } = this;
        const fabActionMap = {
            'generate': { icon: '✨', title: 'Generate', command: EVENTS.COMMAND_EXECUTE_GENERATE_RULESET, payload: {} },
            'mutate': { icon: '🦠', title: 'Mutate', command: EVENTS.COMMAND_EXECUTE_MUTATE_RULESET, payload: {} },
            'clone': { icon: '👯', title: 'Clone', command: EVENTS.COMMAND_CLONE_RULESET, payload: {} },
            'clone-mutate': { icon: '🧬', title: 'Clone & Mutate', command: EVENTS.COMMAND_EXECUTE_CLONE_AND_MUTATE, payload: {} },
            'clear-one': { icon: '🧹', title: 'Clear World', command: EVENTS.COMMAND_CLEAR_WORLDS, payload: { scope: 'selected' } },
            'clear-all': { icon: '🌍', title: 'Clear All', command: EVENTS.COMMAND_CLEAR_WORLDS, payload: { scope: 'all' } },
            'reset-one': { icon: '🔄', title: 'Reset World', command: EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, payload: { scope: 'selected' } },
            'reset-all': { icon: '♻️', title: 'Reset All', command: EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES, payload: {} },
            'reset-densities': { icon: '🎨', title: 'Default Densities', command: EVENTS.COMMAND_RESET_DENSITIES_TO_DEFAULT, payload: {} },
            'apply-density-all': { icon: '🎯', title: 'Apply Density', command: EVENTS.COMMAND_APPLY_SELECTED_DENSITY_TO_ALL, payload: {} }
        };

        const fabSettings = PersistenceService.loadUISetting('fabSettings', { enabled: ['generate', 'clone-mutate', 'reset-all'], locked: true, order: [] });
        const orderedIds = (fabSettings.order && fabSettings.order.length > 0) ? fabSettings.order : fabSettings.enabled;
        const enabledSet = new Set(fabSettings.enabled);

        orderedIds.forEach(actionId => {
            if (!enabledSet.has(actionId)) return; 
            const action = fabActionMap[actionId];
            if (!action) return;
            const button = document.createElement('button');
            button.className = 'mobile-fab secondary-fab';
            button.innerHTML = `<span class="icon">${action.icon}</span>`;
            button.title = action.title;
            button.addEventListener('click', () => {
                EventBus.dispatch(action.command, action.payload);
            });
            fabLeftContainer.appendChild(button);
        });
    }

    // NEW: Method to handle reparenting
    _placeComponentInView({ view, contentComponentType, contentContainer }) {
        if (!contentComponentType || !contentContainer) return;

        // Find the singleton component instance based on its constructor (type)
        const componentToPlace = Object.values(this.sharedComponents).find(
            component => component.constructor === contentComponentType
        );

        if (componentToPlace) {
            // Clear the container first
            contentContainer.innerHTML = '';
            contentContainer.appendChild(componentToPlace.getElement());

            // NEW: Apply context class for styling
            const contextClass = this.isMobile() ? 'mobile-context' : 'desktop-context';
            const oppositeClass = this.isMobile() ? 'desktop-context' : 'mobile-context';
            componentToPlace.getElement().classList.add(contextClass);
            componentToPlace.getElement().classList.remove(oppositeClass);

            // Refresh component if it has a refresh method
            if (typeof componentToPlace.refresh === 'function') {
                componentToPlace.refresh();
            }
        }
    }

    setupGlobalEventListeners() {
        
        EventBus.subscribe(EVENTS.TRIGGER_DOWNLOAD, (data) => downloadFile(data.filename, data.content, data.mimeType));
        EventBus.subscribe(EVENTS.TRIGGER_FILE_LOAD, (data) => {
            const reader = new FileReader();
            reader.onload = (re) => {
                try {
                    const loadedData = JSON.parse(re.target.result);
                    EventBus.dispatch(EVENTS.COMMAND_LOAD_WORLD_STATE, { worldIndex: this.appContext.worldManager.getSelectedWorldIndex(), loadedData });
                } catch (err) { alert(`Error processing file: ${err.message}`); }
            };
            reader.onerror = () => { alert(`Error reading file.`); };
            reader.readAsText(data.file);
        });
        EventBus.subscribe(EVENTS.COMMAND_SHARE_SETUP, this._onShareSetup.bind(this));
        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_PANEL, this._handleTogglePanel.bind(this));
        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_POPOUT, this._handleTogglePopout.bind(this));
        EventBus.subscribe(EVENTS.COMMAND_SHOW_MOBILE_VIEW, this._showMobileViewInternal.bind(this));

        // NEW: Add the listener for the VIEW_SHOWN event
        EventBus.subscribe(EVENTS.VIEW_SHOWN, (data) => {
            this._placeComponentInView(data);
        });
        
        
        EventBus.subscribe(EVENTS.COMMAND_HIDE_ALL_OVERLAYS, () => {
            
            this.appContext.toolbar.closeAllPopouts();
        });

        
        const handleClickOutside = (event) => {
            
            if (this.onboardingManager && this.onboardingManager.isActive()) {
                const tooltip = document.getElementById('onboarding-tooltip');
                
                if (tooltip && tooltip.contains(event.target)) {
                    return; 
                }
            }
    
            const toolbar = this.appContext.toolbar;
            if (!toolbar || toolbar.activePopouts.every(p => p.isHidden())) return;
    
            
            
            const clickedInsidePopout = toolbar.activePopouts.some(p => !p.isHidden() && p.popoutElement.contains(event.target));
            const clickedOnTrigger = toolbar.activePopouts.some(p => p.triggerElement.contains(event.target));
    
            if (!clickedInsidePopout && !clickedOnTrigger) {
                
                toolbar.closeAllPopouts();
            }
        };

        
        this.boundHandleClickOutside = handleClickOutside;
        document.addEventListener('click', this.boundHandleClickOutside);
    }

    /**
     * Sets up a single, delegated event listener on the document body to handle
     * clicks on all help trigger buttons '[?]'. This is more efficient than
     * attaching individual listeners.
     * @private
     */
    _setupHelpTriggerListeners() {
        document.body.addEventListener('click', (event) => {
            const helpButton = event.target.closest('.button-help-trigger');

            
            if (!helpButton) {
                return;
            }

            
            
            event.preventDefault();
            event.stopPropagation();

            const tourName = helpButton.dataset.tourName;
            if (tourName && this.onboardingManager) { 
                
                this.onboardingManager.startTour(tourName, true); 
            } else {
                console.warn('Help button clicked, but no tour name found or OnboardingManager is not available.', helpButton);
            }
        });
    }

    /**
     * Destroys all managed UI components to prevent memory leaks.
     */
    destroy() {
        console.log("Destroying UIManager and its components...");
        if (this.boundHandleClickOutside) { 
            document.removeEventListener('click', this.boundHandleClickOutside);
        }
        this.managedComponents.forEach(component => {
            if (typeof component.destroy === 'function') {
                component.destroy();
            }
        });
        this.managedComponents = [];

        // NEW: Destroy shared components
        Object.values(this.sharedComponents).forEach(component => {
            if (typeof component.destroy === 'function') {
                component.destroy();
            }
        });
        this.sharedComponents = {};

        Object.values(this.mobileViews).forEach(view => {
            if(typeof view.destroy === 'function') {
                view.destroy();
            }
        });
        this.mobileViews = {};
    }

    _onShareSetup() {
        const url = generateShareUrl(this.appContext.worldManager);
        if (!url) {
            alert('Could not generate a share link for the current setup.');
            return;
        }
        if (this.isMobile() && navigator.share) {
            navigator.share({
                title: 'HexLife Explorer Setup',
                text: 'Check out this cellular automaton setup!',
                url: url,
            }).catch(err => {
                
                if (err.name !== 'AbortError') {
                    console.error('Share failed:', err);
                }
            });
        } else {
            const shareLinkInput = document.getElementById('shareLinkInput');

            if (shareLinkInput) {
                shareLinkInput.value = url;
                shareLinkInput.select();
            } else {
                navigator.clipboard.writeText(url).then(() => {
                    alert('Share link copied to clipboard!');
                }).catch(err => {
                    console.error('Failed to copy share link:', err);
                    alert('Could not copy link.');
                });
            }
        }
    }

    /**
     * Handles toggling of draggable panels on desktop.
     * @param {{panelName: string, show?: boolean}} data
     * @private
     */
    _handleTogglePanel({ panelName, show }) {
        if (this.isMobile()) return; 
        const panel = this.appContext.panelManager.getPanel(panelName);
        if (panel) {
            if (show === true) panel.show();
            else if (show === false) panel.hide();
            else panel.toggle();
        } else {
            console.warn(`No draggable panel found with name: ${panelName}`);
        }
    }

    /**
     * Handles toggling of popout panels on desktop.
     * @param {{popoutName: string, show?: boolean}} data
     * @private
     */
    _handleTogglePopout({ popoutName, show }) {
        if (this.isMobile()) return; 
        const popout = this.appContext.toolbar.getPopout(popoutName);
        if (popout) {
            const shouldShow = show !== undefined ? show : popout.isHidden();
            if (shouldShow) {
                this.appContext.toolbar.closeAllPopouts(popout); 
            }
            if (show === true) popout.show();
            else if (show === false) popout.hide();
            else popout.toggle();
        } else {
            console.warn(`No popout panel found with name: ${popoutName}`);
        }
    }



    _showMobileViewInternal({ targetView }) {
        if (!this.isMobile()) return;
        
        Object.values(this.mobileViews).forEach(v => v.hide());
    
        
        this.#createMobileView(targetView);
    
        
        const viewToShow = this.mobileViews[targetView];
        if (viewToShow) {
            viewToShow.show();
        }

        this.activeMobileViewName = targetView;
        EventBus.dispatch(EVENTS.MOBILE_VIEW_CHANGED, { activeView: targetView });
    }

    #createMobileView(viewName) {
        // Check if view already exists
        if (this.mobileViews[viewName]) {
            return;
        }

        const config = this.#mobileViewConfig[viewName];
        if (!config) return; 

        const mobileViewsContainer = document.getElementById('mobile-views-container');
        if (mobileViewsContainer) {
            // Create the MobileView shell without content component
            const presenter = new MobileView(mobileViewsContainer, { 
                id: `${viewName}-mobile-view`,
                title: config.title,
                contentComponentType: config.constructor // Pass the constructor as type identifier
            });
            
            // Store the view
            this.mobileViews[viewName] = presenter;
        }
    }


}