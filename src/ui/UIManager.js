import { EventBus, EVENTS } from '../services/EventBus.js';
import { TopInfoBar } from './TopInfoBar.js';
import { KeyboardShortcutManager } from './KeyboardShortcutManager.js';
import { BottomTabBar } from './BottomTabBar.js';
import { ToolsBottomSheet } from './components/ToolsBottomSheet.js';
import { MoreView } from './views/MoreView.js';
import { RulesView } from './views/RulesView.js';
import { WorldsView } from './views/WorldsView.js';
import { AnalyzeView } from './views/AnalyzeView.js';
import { EditorView } from './views/EditorView.js';
import { LearningView } from './views/LearningView.js';
import { downloadFile } from '../utils/utils.js';
import * as PersistenceService from '../services/PersistenceService.js';
import * as Config from '../core/config.js';
import { generateShareUrl } from '../utils/utils.js';


// The media query is a constant local to the manager that needs it.
const MOBILE_QUERY = '(max-width: 768px), (pointer: coarse) and (hover: none)';

export class UIManager {
    constructor(appContext) {
        this.appContext = appContext;
        this.mode = 'desktop';
        this.mediaQueryList = window.matchMedia(MOBILE_QUERY);
        this.mobileViews = {};
        this.managedComponents = [];
    }

    /**
     * Initializes the entire UI layer, sets up mode detection,
     * and wires all necessary event listeners.
     */
    init() {
        const { appContext, appContext: { worldManager, panelManager, toolbar, onboardingManager, libraryController } } = this;
        const libraryData = libraryController.getLibraryData();

        // 1. Initialize Mode Detection
        this.updateMode(false); // Set initial mode without dispatching event yet
        this.mediaQueryList.addEventListener('change', () => this.updateMode(true));

        // 2. Initialize Core UI Components
        const topInfoBar = new TopInfoBar(appContext);
        topInfoBar.init();
        toolbar.init();

        const keyboardManager = new KeyboardShortcutManager(appContext, panelManager, toolbar);
        keyboardManager.init();

        // Add components to the managed list
        this.managedComponents.push(topInfoBar, toolbar, keyboardManager);

        // 3. Initialize Mobile-Specific UI
        this.initMobileUI(libraryData);
        
        // 4. Bind Global UI Event Listeners
        this.setupGlobalEventListeners();

        // Make onboarding manager globally accessible for tours
        window.OnboardingManager = onboardingManager;

        // 5. Dispatch initial UI mode to inform all components
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
            
            // Toggle visibility of persistent mobile/desktop elements
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

        // Init container views for mobile
        const mobileViewsContainer = document.getElementById('mobile-views-container');
        if (mobileViewsContainer) {
            this.mobileViews.more = new MoreView(mobileViewsContainer, appContext);
            this.mobileViews.more.render();
            this.mobileViews.rules = new RulesView(mobileViewsContainer, appContext, libraryData);
            this.mobileViews.rules.render();
            this.mobileViews.worlds = new WorldsView(mobileViewsContainer, appContext);
            this.mobileViews.worlds.render();
            this.mobileViews.analyze = new AnalyzeView(mobileViewsContainer, appContext);
            this.mobileViews.analyze.render();
            this.mobileViews.editor = new EditorView(mobileViewsContainer, panelManager);
            this.mobileViews.editor.render();
            this.mobileViews.learning = new LearningView(mobileViewsContainer);
            this.mobileViews.learning.render();
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
            fabRightContainer.querySelector('#mobilePlayPauseButton').addEventListener('click', () => appContext.simulationController.togglePause());
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
            'generate': { icon: '✨', title: 'Generate', handler: () => appContext.rulesetActionController.generate() },
            'mutate': { icon: '🦠', title: 'Mutate', handler: () => appContext.rulesetActionController.mutate() },
            'clone': { icon: '👯', title: 'Clone', handler: () => appContext.rulesetActionController.clone() },
            'clone-mutate': { icon: '🧬', title: 'Clone & Mutate', handler: () => appContext.rulesetActionController.cloneAndMutate() },
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
                if (action.handler) action.handler();
                else EventBus.dispatch(action.command, action.payload);
            });
            fabLeftContainer.appendChild(button);
        });
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
        EventBus.subscribe(EVENTS.COMMAND_SHOW_VIEW, this.showMobileView.bind(this));
    }

    /**
     * Destroys all managed UI components to prevent memory leaks.
     */
    destroy() {
        console.log("Destroying UIManager and its components...");
        this.managedComponents.forEach(component => {
            if (typeof component.destroy === 'function') {
                component.destroy();
            }
        });
        this.managedComponents = [];

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
                // Ignore AbortError, log others
                if (err.name !== 'AbortError') {
                    console.error('Share failed:', err);
                }
            });
        } else {
            // Desktop logic: open popout and copy to clipboard
            const sharePopout = this.appContext.toolbar.getPopout('share');
            const shareLinkInput = document.getElementById('shareLinkInput');

            if (sharePopout && shareLinkInput) {
                shareLinkInput.value = url;
                sharePopout.show();
                // Select the text for easy copying
                shareLinkInput.select();
            } else {
                // Fallback for when popout isn't available
                navigator.clipboard.writeText(url).then(() => {
                    alert('Share link copied to clipboard!');
                }).catch(err => {
                    console.error('Failed to copy share link:', err);
                    alert('Could not copy link.');
                });
            }
        }
    }

    showMobileView({ targetView, currentView }) {
        if (!this.isMobile()) return;
    
        const nextView = (targetView === currentView && targetView !== 'simulate') ? 'simulate' : targetView;
    
        Object.values(this.mobileViews).forEach(v => v.hide());
    
        const viewToShow = this.mobileViews[nextView];
        if (viewToShow) {
            viewToShow.show();
        }
        EventBus.dispatch(EVENTS.MOBILE_VIEW_CHANGED, { activeView: nextView });
    }
}