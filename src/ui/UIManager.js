import { EventBus, EVENTS } from '../services/EventBus.js';
import { TopInfoBar } from './TopInfoBar.js';
import { KeyboardShortcutManager } from './KeyboardShortcutManager.js';
import { KeyboardShortcutsComponent } from './components/KeyboardShortcutsComponent.js';
import { BottomTabBar } from './BottomTabBar.js';
import { ToolsBottomSheet } from './components/ToolsBottomSheet.js';
import { MoreView } from './views/MoreView.js';
import { MobileView } from './views/MobileView.js';
import { BuildView } from './views/BuildView.js';
import { WorldSetupComponent } from './components/WorldSetupComponent.js';
import { AnalysisComponent } from './components/AnalysisComponent.js';
import { RulesetEditorComponent } from './components/RulesetEditorComponent.js';
import { RulesetActionsComponent } from './components/RulesetActionsComponent.js';
import { RulesetLibraryComponent } from './components/RulesetLibraryComponent.js';
import { PatternsComponent } from './components/PatternsComponent.js';
import { LearningComponent } from './components/LearningComponent.js';
import { ChromaLabComponent } from './components/ChromaLabComponent.js';
import { ExploreComponent } from './components/ExploreComponent.js';
import { SettingsComponent } from './components/SettingsComponent.js';
import { SnapshotsComponent } from './components/SnapshotsComponent.js';
import { downloadFile } from '../utils/utils.js';
import * as Config from '../core/config.js';
import { ControlsComponent } from './components/ControlsComponent.js';
import { RuleRankComponent } from './components/RuleRankComponent.js';
import { SaveRulesetModal } from './components/SaveRulesetModal.js';
import { SavePatternModal } from './components/SavePatternModal.js';
import { ActionsPopover } from './components/ActionsPopover.js';
import { ConfirmationDialog } from './components/ConfirmationDialog.js';
import { RulesetDisplayFactory } from './RulesetDisplayFactory.js';
import { MinimapOverlays } from './MinimapOverlays.js';
import { ScrubBar } from './ScrubBar.js';
import { InitialStateConfigModal } from './components/InitialStateConfigModal.js';
import { CaptureStudioModal } from './components/CaptureStudioModal.js';
import { ToastManager } from './ToastManager.js';
import { CommandPalette } from './components/CommandPalette.js';
import { ICONS } from './icons.js';
import * as PersistenceService from '../services/PersistenceService.js';
import { QUICK_ACTION_MAP, DEFAULT_FAB_SETTINGS, getEnabledQuickActionIds } from './mobileQuickActions.js';
import {
    REDDIT_SUB_URL,
    buildPostTitle,
    buildPostKit,
    formatCodeSize,
    redditHandoffToast,
    postKitFromLibraryEntry,
    encodeWorldCodeFromLibraryEntry,
} from '../services/RedditShareService.js';
import { rulesetName } from '../utils/utils.js';
import { explorerUrlForRuleset } from '../core/WorldCodec.js';



const MOBILE_QUERY = '(max-width: 768px), (pointer: coarse) and (hover: none)';

export class UIManager {
    constructor(appContext) {
        this.appContext = appContext;
        this.onboardingManager = appContext.onboardingManager; 
        this.mode = 'desktop';
        this.mediaQueryList = window.matchMedia(MOBILE_QUERY);
        this.mobileViews = {};
        this.activeMobileViewName = 'watch';
        this.managedComponents = [];
        this.sharedComponents = {}; 
        this.initialStateConfigModal = null; // Add this
        this.saveRulesetModal = null;
        this.savePatternModal = null;
        this.actionsPopover = null;
        this.confirmationDialog = null;
        this.rulesetDisplayFactory = null;
        this.toastManager = null;
        appContext.uiManager = this;
        this.init();
    }

    // Config-driven full-screen mobile views. Rules/Editor/Worlds are NOT here —
    // they live under the segmented `build` view (BuildView), created eagerly in
    // initMobileUI. `discover` is the Explore surface promoted to a primary tab.
    #mobileViewConfig = {
        discover: { constructor: ExploreComponent, title: 'Discover' },
        library: { constructor: RulesetLibraryComponent, title: 'Ruleset Library' },
        patterns: { constructor: PatternsComponent, title: 'Patterns' },
        analyze: { constructor: AnalysisComponent, title: 'Analysis' },
        explore: { constructor: ExploreComponent, title: 'Auto-Explore' },
        settings: { constructor: SettingsComponent, title: 'Settings' },
        learning: { constructor: LearningComponent, title: 'Learning Hub (Alpha)' },
    };

    // Segments of the consolidated Build tab (mobile redesign M1).
    #buildSegments = [
        { id: 'rules', label: 'Rules', componentType: RulesetActionsComponent },
        { id: 'editor', label: 'Editor', componentType: RulesetEditorComponent },
        { id: 'worlds', label: 'Worlds', componentType: WorldSetupComponent },
    ];

    // Top-level tabs the bottom bar highlights. Views not listed (More/Settings/
    // Analysis/etc. reached via the header gear) light up no tab.
    static #MOBILE_TABS = new Set(['watch', 'discover', 'build', 'library']);

    /**
     * Initializes the entire UI layer, sets up mode detection,
     * and wires all necessary event listeners.
     */
    init() {
        const { appContext, appContext: { panelManager, toolbar, libraryController } } = this;
        const libraryData = libraryController.getLibraryData();

        
        this.rulesetDisplayFactory = new RulesetDisplayFactory(appContext);
        this.appContext.rulesetDisplayFactory = this.rulesetDisplayFactory;
        
        this.actionsPopover = new ActionsPopover(document.getElementById('popover-container'));

        const keyboardManager = new KeyboardShortcutManager(appContext, panelManager, toolbar);
        keyboardManager.init();
        this.appContext.keyboardShortcutManager = keyboardManager;

        this.sharedComponents = {
            controls: new ControlsComponent(appContext),
            patterns: new PatternsComponent(appContext),
            rulesetActions: new RulesetActionsComponent(appContext),
            rulesetLibrary: new RulesetLibraryComponent(appContext, { libraryData }),
            rulesetEditor: new RulesetEditorComponent(appContext),
            worldSetup: new WorldSetupComponent(appContext),
            analysis: new AnalysisComponent(appContext),
            ruleRank: new RuleRankComponent(appContext),
            learning: new LearningComponent(appContext),
            chromaLab: new ChromaLabComponent(appContext),
            explore: new ExploreComponent(appContext),
            settings: new SettingsComponent(appContext),
            shortcuts: new KeyboardShortcutsComponent(appContext),
            snapshots: new SnapshotsComponent(appContext)
        };

        
        this.updateMode(false); 
        this.mediaQueryList.addEventListener('change', () => this.updateMode(true));

        
        const topInfoBar = new TopInfoBar(appContext);
        topInfoBar.init();
        toolbar.init();
        panelManager.init(); 

        
        const minimapOverlays = new MinimapOverlays(appContext);
        const scrubBar = new ScrubBar(appContext);
        this.managedComponents.push(topInfoBar, toolbar, keyboardManager, minimapOverlays, scrubBar);

        
        this.initMobileUI();
        
        
        this.saveRulesetModal = new SaveRulesetModal(document.getElementById('modal-container'), appContext);
        this.savePatternModal = new SavePatternModal(document.getElementById('modal-container'), appContext);
        
        
        this.confirmationDialog = new ConfirmationDialog(document.getElementById('dialog-container'));
        
        this.initialStateConfigModal = new InitialStateConfigModal(document.getElementById('modal-container'), this.appContext);
        this.captureStudioModal = new CaptureStudioModal(document.getElementById('modal-container'), this.appContext);

        this.toastManager = new ToastManager(document.getElementById('toast-container'));

        // Ctrl/⌘-K command palette (desktop launcher; refuses to open on mobile).
        this.commandPalette = new CommandPalette(appContext);

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
            document.getElementById('mobileGearButton')?.classList.toggle('hidden', !this.isMobile());
            document.getElementById('mobileWorldPill')?.classList.toggle('hidden', !this.isMobile());
            document.getElementById('vertical-toolbar')?.classList.toggle('hidden', this.isMobile());

            if (dispatchEvent) {
                EventBus.dispatch(EVENTS.UI_MODE_CHANGED, { mode: this.mode });
            }
        }
    }

    isMobile() {
        return this.mode === 'mobile';
    }

    initMobileUI() {
        const { appContext, appContext: { panelManager } } = this;

        
        const mobileViewsContainer = document.getElementById('mobile-views-container');
        if (mobileViewsContainer) {
            this.mobileViews.more = new MoreView(mobileViewsContainer, appContext);
            this.mobileViews.more.render();
            this.mobileViews.build = new BuildView(mobileViewsContainer, appContext, this.#buildSegments);
        }

        const bottomTabBarEl = document.getElementById('bottom-tab-bar');
        if (bottomTabBarEl) new BottomTabBar(bottomTabBarEl, panelManager);

        const gearButton = document.getElementById('mobileGearButton');
        if (gearButton) {
            gearButton.innerHTML = ICONS.cog;
            gearButton.addEventListener('click', () => {
                EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'more' });
            });
        }

        this._initWorldPill();

        const fabRightContainer = document.getElementById('mobile-fab-container-right');

        if (fabRightContainer) {
            fabRightContainer.innerHTML = `
                <button id="mobileToolsFab" class="mobile-fab secondary-fab" title="Adjust Speed & Brush"><span class="icon">${ICONS.wrench}</span></button>
                <button id="interaction-mode-toggle" class="mobile-fab secondary-fab" title="Toggle Pan/Draw Mode"><span class="icon">${ICONS.hand}</span></button>
                <button id="mobilePlayPauseButton" class="mobile-fab primary-fab" title="Play/Pause">${ICONS.play}</button>
            `;
            new ToolsBottomSheet('fab-tools-bottom-sheet', fabRightContainer.querySelector('#mobileToolsFab'), appContext);
            fabRightContainer.querySelector('#mobilePlayPauseButton').addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE));
            fabRightContainer.querySelector('#interaction-mode-toggle').addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_INTERACTION_MODE));
            
            EventBus.subscribe(EVENTS.SIMULATION_PAUSED, (isPaused) => {
                const mobilePlayPause = fabRightContainer.querySelector('#mobilePlayPauseButton');
                if (mobilePlayPause) mobilePlayPause.innerHTML = isPaused ? ICONS.play : ICONS.pause;
            });
            EventBus.subscribe(EVENTS.INTERACTION_MODE_CHANGED, (mode) => {
                const toggleIcon = fabRightContainer.querySelector('#interaction-mode-toggle .icon');
                if (toggleIcon) toggleIcon.innerHTML = mode === 'pan' ? ICONS.hand : ICONS.pencil;
            });

            this._initMobileQuickActionFabs();

            // Keep the FAB stacks clear of the minimap — but ONLY when the minimap actually
            // overlaps the selected view (near-square regime, where it docks as a bottom-right
            // overlay). In the landscape/portrait regimes the minimap has its own separate area,
            // so the bottom-right/left corners are empty and the stacks should sit at their
            // natural bottom position (in the empty band beside the centered minimap grid) rather
            // than floating up into the world. Raise reuses the same layout rect the on-canvas
            // guides consume (canvas backing store == CSS px, so these are CSS pixels).
            const canvasEl = document.getElementById('hexGridCanvas');
            const mainArea = document.getElementById('main-content-area');
            const fabLeftContainer = document.getElementById('mobile-fab-container-left');
            const positionFabsForMinimap = (layout) => {
                if (!this.isMobile() || !canvasEl || !mainArea) return;
                let bottom = '';
                if (layout?.isMinimapOverlay && layout?.miniMap) {
                    const gridTop = canvasEl.offsetTop + layout.miniMap.gridContainerY;
                    bottom = `${Math.max(10, mainArea.clientHeight - gridTop + 12)}px`;
                }
                // Empty string clears the inline override → falls back to the CSS bottom anchor.
                fabRightContainer.style.bottom = bottom;
                if (fabLeftContainer) fabLeftContainer.style.bottom = bottom;
            };
            EventBus.subscribe(EVENTS.LAYOUT_CALCULATED, positionFabsForMinimap);
        }

    }

    /**
     * Render the enabled quick-action FABs into the left on-canvas stack so quick evolving
     * (Generate / Clone & Mutate / …) is one tap away without opening the Tools sheet. The
     * enabled set + order is the same persisted `fabSettings` the ToolsBottomSheet "Customize"
     * pane edits, so both surfaces stay in sync via COMMAND_UPDATE_FAB_UI.
     */
    _initMobileQuickActionFabs() {
        const container = document.getElementById('mobile-fab-container-left');
        if (!container) return;
        const render = () => {
            const fabSettings = PersistenceService.loadUISetting('fabSettings', DEFAULT_FAB_SETTINGS);
            const ids = getEnabledQuickActionIds(fabSettings);
            container.innerHTML = '';
            ids.forEach(id => {
                const action = QUICK_ACTION_MAP[id];
                if (!action) return;
                const button = document.createElement('button');
                button.className = 'mobile-fab secondary-fab quick-action-fab';
                button.type = 'button';
                button.title = action.label;
                button.setAttribute('aria-label', action.label);
                button.innerHTML = `<span class="icon">${action.icon}</span>`;
                button.addEventListener('click', () => EventBus.dispatch(action.command, action.payload));
                container.appendChild(button);
            });
        };
        render();
        EventBus.subscribe(EVENTS.COMMAND_UPDATE_FAB_UI, render);
    }

    /**
     * World-paging pill in the top bar (mobile redesign M4) — the always-present
     * fallback for the swipe-to-page gesture. `‹ N/9 ›` steps the selected world
     * (wrapping) via COMMAND_SELECT_WORLD and mirrors SELECTED_WORLD_CHANGED.
     */
    _initWorldPill() {
        const pill = document.getElementById('mobileWorldPill');
        if (!pill) return;
        const prev = pill.querySelector('.world-pill-prev');
        const next = pill.querySelector('.world-pill-next');
        const label = pill.querySelector('.world-pill-label');
        prev.innerHTML = ICONS.chevronLeft;
        next.innerHTML = ICONS.chevronRight;

        const count = Config.NUM_WORLDS;
        const step = (dir) => {
            const cur = this.appContext.worldManager.getSelectedWorldIndex();
            const target = ((cur + dir) % count + count) % count;
            EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, target);
        };
        prev.addEventListener('click', () => step(-1));
        next.addEventListener('click', () => step(1));

        const updateLabel = (idx) => {
            const cur = (typeof idx === 'number') ? idx : this.appContext.worldManager.getSelectedWorldIndex();
            label.textContent = `${cur + 1}/${count}`;
        };
        EventBus.subscribe(EVENTS.SELECTED_WORLD_CHANGED, (idx) => updateLabel(idx));
        updateLabel();
    }


    _placeComponentInView({ _view, contentComponentType, contentContainer }) {
        this.mountSharedComponentInto(contentComponentType, contentContainer);
    }

    /**
     * Move a shared singleton component into a target container and apply the
     * mobile/desktop context class + refresh. Shared by config-driven MobileViews
     * (via VIEW_SHOWN) and the segmented BuildView.
     * @param {Function} componentType constructor of the shared component
     * @param {HTMLElement} container
     */
    /**
     * The single live instance of a shared component, by constructor. Shared components are
     * singletons moved between the desktop panel and the mobile view, so callers that need to
     * drive one (tour steps, keyboard shortcuts) must go through this rather than the DOM.
     * @param {Function} componentType
     * @returns {object|undefined}
     */
    getSharedComponent(componentType) {
        return Object.values(this.sharedComponents ?? {}).find(
            component => component.constructor === componentType
        );
    }

    mountSharedComponentInto(componentType, container) {
        if (!componentType || !container) return;

        const componentToPlace = this.getSharedComponent(componentType);
        if (!componentToPlace) return;

        container.innerHTML = '';
        container.appendChild(componentToPlace.getElement());

        const contextClass = this.isMobile() ? 'mobile-context' : 'desktop-context';
        const oppositeClass = this.isMobile() ? 'desktop-context' : 'mobile-context';
        componentToPlace.getElement().classList.add(contextClass);
        componentToPlace.getElement().classList.remove(oppositeClass);

        if (typeof componentToPlace.refresh === 'function') {
            componentToPlace.refresh();
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
                } catch (err) { EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Error processing file: ${err.message}`, type: 'error' }); }
            };
            reader.onerror = () => { EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Error reading file.', type: 'error' }); };
            reader.readAsText(data.file);
        });
        EventBus.subscribe(EVENTS.COMMAND_SHARE_SETUP, this._onShareSetup.bind(this));
        EventBus.subscribe(EVENTS.COMMAND_COPY_WORLD_CODE, this._onCopyWorldCode.bind(this));
        EventBus.subscribe(EVENTS.COMMAND_POST_TO_REDDIT, this._onPostToReddit.bind(this));
        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_PANEL, this._handleTogglePanel.bind(this));
        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_POPOUT, this._handleTogglePopout.bind(this));
        EventBus.subscribe(EVENTS.COMMAND_SHOW_MOBILE_VIEW, this._showMobileViewInternal.bind(this));
        EventBus.subscribe(EVENTS.COMMAND_SHOW_INITIAL_STATE_MODAL, (data) => {
            this.initialStateConfigModal.show(data.worldIndex, data.config);
        });
        EventBus.subscribe(EVENTS.COMMAND_SHOW_SAVE_RULESET_MODAL, (data) => {
            this.saveRulesetModal.show(data);
        });
        EventBus.subscribe(EVENTS.COMMAND_SHOW_SAVE_PATTERN_MODAL, (data) => {
            this.savePatternModal.show(data);
        });
        EventBus.subscribe(EVENTS.COMMAND_SHOW_CAPTURE_STUDIO, (data) => {
            this.captureStudioModal.show(data || {});
        });
        EventBus.subscribe(EVENTS.COMMAND_SHOW_CONFIRMATION, (data) => {
            this.confirmationDialog.show(data);
        });

        
        EventBus.subscribe(EVENTS.VIEW_SHOWN, (data) => {
            this._placeComponentInView(data);
        });
        
        
        EventBus.subscribe(EVENTS.COMMAND_HIDE_ALL_OVERLAYS, () => {
            
            this.appContext.toolbar.closeAllPopouts();
        });

        
        const handleClickOutside = (event) => {
            
            if (this.onboardingManager && this.onboardingManager.isActive()) {
                const tooltip = document.getElementById('onboarding-tooltip');
                if (tooltip && !tooltip.classList.contains('hidden')) {
                     
                    const highlightedEl = document.querySelector('.onboarding-highlight');
                    if (highlightedEl && highlightedEl.contains(event.target)) {
                        return;
                    }
                }
            }

            const toolbar = this.appContext.toolbar;
            const popouts = toolbar ? toolbar.activePopouts : [];

            
            const clickedInsidePopoutOrTrigger = popouts.some(p => 
                !p.isHidden() && (p.popoutElement.contains(event.target) || p.triggerElement.contains(event.target))
            );

            
            const clickedInsideActionsPopover = this.actionsPopover && !this.actionsPopover.isHidden() && this.actionsPopover.element.contains(event.target);

            
            const clickedOnActionsPopoverTrigger = this.actionsPopover && this.actionsPopover.triggerElement && this.actionsPopover.triggerElement.contains(event.target);

            
            if (!clickedInsidePopoutOrTrigger && !clickedInsideActionsPopover && !clickedOnActionsPopoverTrigger) {
                if (toolbar) {
                    toolbar.closeAllPopouts();
                }
                if (this.actionsPopover) {
                    this.actionsPopover.hide();
                }
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

        
        Object.values(this.sharedComponents).forEach(component => {
            if (typeof component.destroy === 'function') {
                component.destroy();
            }
        });
        this.sharedComponents = {};

        
        if (this.rulesetDisplayFactory) {
            this.rulesetDisplayFactory.destroy();
        }

        if (this.commandPalette) {
            this.commandPalette.destroy();
            this.commandPalette = null;
        }

        Object.values(this.mobileViews).forEach(view => {
            if(typeof view.destroy === 'function') {
                view.destroy();
            }
        });
        this.mobileViews = {};
    }

    _onShareSetup() {
        const includeWorldState = !!document.getElementById('shareIncludeStateCheckbox')?.checked;
        const url = this.appContext.worldManager.generateShareUrl({ includeWorldState });
        if (!url) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Could not generate a share link for the current setup.', type: 'error' });
            return;
        }
        this._prefillRedditTitleFromSelection();
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
                    EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Share link copied to clipboard!', type: 'success' });
                }).catch(err => {
                    console.error('Failed to copy share link:', err);
                    EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Could not copy link.', type: 'error' });
                });
            }
        }
    }

    /**
     * Prefill the Share popout title from a personal-library match or the ruleset mnemonic when empty.
     * @private
     */
    _prefillRedditTitleFromSelection() {
        const titleInput = /** @type {HTMLInputElement|null} */ (document.getElementById('redditPostTitle'));
        if (!titleInput || titleInput.value.trim()) return;

        const idx = this.appContext.worldManager.getSelectedWorldIndex?.()
            ?? this.appContext.worldManager.selectedWorldIndex;
        const hex = this.appContext.worldManager._getRulesetHexForWorld?.(idx)
            || this.appContext.worldManager.getWorldSettingsForUI?.()?.[idx]?.rulesetHex
            || null;
        if (!hex) return;

        const match = this.appContext.libraryController?.getUserLibrary?.()
            ?.find((r) => r.hex?.toUpperCase?.() === hex.toUpperCase());
        titleInput.value = match
            ? buildPostTitle({ name: match.name, tags: match.tags })
            : buildPostTitle({ name: rulesetName(hex) });
    }

    /**
     * Metadata for the currently selected world when building a Reddit post kit.
     * @returns {{ name: string, description: string, tags: string[], explorerUrl: string, icLabel: string }}
     * @private
     */
    _redditMetaForSelectedWorld() {
        const idx = this.appContext.worldManager.getSelectedWorldIndex?.()
            ?? this.appContext.worldManager.selectedWorldIndex;
        const hex = this.appContext.worldManager._getRulesetHexForWorld?.(idx)
            || this.appContext.worldManager.getWorldSettingsForUI?.()?.[idx]?.rulesetHex
            || '';
        const match = hex
            ? this.appContext.libraryController?.getUserLibrary?.()
                ?.find((r) => r.hex?.toUpperCase?.() === hex.toUpperCase())
            : null;
        const settings = this.appContext.worldManager.worldSettings?.[idx];
        const initialState = settings?.initialState;
        let icLabel = '';
        if (initialState?.mode === 'clusters') icLabel = 'IC · clumps';
        else if (initialState?.mode === 'density') {
            const d = initialState?.params?.density;
            icLabel = Number.isFinite(d) ? `IC · ${Math.round(d * 100)}% fill` : 'IC · random fill';
        } else if (initialState?.mode) {
            icLabel = `IC · ${initialState.mode}`;
        }
        const tags = Array.isArray(match?.tags) ? match.tags : [];
        const name = match?.name || (hex ? rulesetName(hex) : 'HexLife');
        return {
            name,
            description: match?.description || '',
            tags,
            explorerUrl: hex ? explorerUrlForRuleset(hex, { rows: Config.GRID_ROWS }) : '',
            icLabel,
        };
    }

    /**
     * Copy the selected world as a world code — the payload the Reddit post is built from (#26).
     * Unlike the share link this carries the exact cells, so it is kilobytes and scales with the grid
     * (it is deflated, so a sparse or structured world is far smaller than a 50%-random one). The
     * toast reports the size, because size is what decides whether the paste is comfortable.
     *
     * The code is also written into a textarea in the Share popout: encoding is async, which can cost
     * the click's transient user activation and make `clipboard.writeText` reject in some browsers.
     * The textarea is the guaranteed path — select and Ctrl+C — and the clipboard call is the nicety.
     */
    async _onCopyWorldCode() {
        const code = await this._exportWorldCodeToSharePanel();
        if (!code) return;

        const size = `${(code.length / 1024).toFixed(1)} KB`;
        try {
            await navigator.clipboard.writeText(code);
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                message: `World code copied (${size}) — paste it into the Reddit post form.`,
                type: 'success',
            });
        } catch (err) {
            console.warn('Clipboard write blocked; the code is in the Share popout:', err);
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                message: `World code ready (${size}) — press Ctrl+C to copy it from the Share panel.`,
            });
        }
    }

    /**
     * Copy a Reddit **post kit** (title, description, tags, world code) and open r/hexlife so the
     * user can create a **Live Specimen** via ⋯ → New HexLife post.
     *
     * Why not a one-click custom post from github.io?
     * - Devvit custom posts can only be created by the app (`submitCustomPost`), from a menu/form/
     *   trigger running *inside* Reddit — there is no public "create interactive post" URL.
     * - `/r/hexlife/submit` only opens a normal text/link/image composer, never the app form.
     * - Publishing the app does **not** unlock an external create-post deep link; it only lets
     *   other subreddits install the app and lifts the &lt;200-sub unpublished install cap.
     * - A best-effort `onPostSubmit` converter exists for pure-HXW1 text posts, but the supported
     *   path is the menu form (title + code fields), not the generic submit screen.
     */
    async _onPostToReddit() {
        const code = await this._exportWorldCodeToSharePanel();
        if (!code) return;

        this._prefillRedditTitleFromSelection();
        const titleInput = /** @type {HTMLInputElement|null} */ (document.getElementById('redditPostTitle'));
        const meta = this._redditMetaForSelectedWorld();
        const title = (titleInput?.value || '').trim() || buildPostTitle({ name: meta.name, tags: meta.tags });
        if (titleInput && !titleInput.value.trim()) titleInput.value = title;

        const kit = buildPostKit({
            title,
            description: meta.description,
            tags: meta.tags,
            explorerUrl: meta.explorerUrl,
            icLabel: meta.icLabel,
            worldCode: code,
        });
        const size = formatCodeSize(code);

        try {
            await navigator.clipboard.writeText(kit);
        } catch (err) {
            console.warn('Clipboard write blocked; the code is in the Share popout:', err);
        }

        // Open the subreddit (not /submit) — the Live Specimen form is the app menu item, not
        // Reddit's built-in composer.
        const opened = window.open(REDDIT_SUB_URL, '_blank', 'noopener,noreferrer');
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, redditHandoffToast({
            size,
            title,
            popupBlocked: !opened,
        }));
    }

    /**
     * Share a personal-library entry to r/hexlife: encode specimen from ruleset + IC, copy post kit.
     * @param {object} entry User library ruleset entry
     */
    async shareLibraryEntryToReddit(entry) {
        if (!entry?.hex) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Nothing to share.', type: 'error' });
            return;
        }
        const colorSettings = this.appContext.colorController?.getSettings?.();
        if (!colorSettings) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Color settings not ready.', type: 'error' });
            return;
        }

        const encoded = await encodeWorldCodeFromLibraryEntry(entry, {
            rows: Config.GRID_ROWS,
            cols: Config.GRID_COLS,
            colorSettings,
            speed: this.appContext.worldManager.simulationController?.getSpeed?.() ?? Config.DEFAULT_SPEED,
            brushSize: this.appContext.worldManager.brushController?.getBrushSize?.()
                ?? Config.DEFAULT_NEIGHBORHOOD_SIZE,
        });
        if (!encoded?.code) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                message: 'Could not build a world code for this ruleset.',
                type: 'error',
            });
            return;
        }

        const { title, kit } = postKitFromLibraryEntry(entry, encoded.code, { rows: Config.GRID_ROWS });
        const size = formatCodeSize(encoded.code);

        const output = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('worldCodeOutput'));
        if (output) {
            output.value = encoded.code;
            document.getElementById('worldCodeGroup')?.classList.remove('hidden');
        }
        const titleInput = /** @type {HTMLInputElement|null} */ (document.getElementById('redditPostTitle'));
        if (titleInput) titleInput.value = title;

        try {
            await navigator.clipboard.writeText(kit);
        } catch (err) {
            console.warn('Clipboard write blocked; world code is in the Share panel if open:', err);
        }

        const opened = window.open(REDDIT_SUB_URL, '_blank', 'noopener,noreferrer');
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, redditHandoffToast({
            size,
            title,
            popupBlocked: !opened,
        }));
    }

    /**
     * Encode the selected world and mirror it into the Share popout textarea.
     * @returns {Promise<string|null>}
     * @private
     */
    async _exportWorldCodeToSharePanel() {
        const code = await this.appContext.worldManager.exportWorldCode(
            this.appContext.colorController.getSettings(),
        );
        if (!code) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'World state is not ready yet.', type: 'error' });
            return null;
        }
        const output = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('worldCodeOutput'));
        if (output) {
            output.value = code;
            document.getElementById('worldCodeGroup')?.classList.remove('hidden');
            output.select();
        }
        return code;
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



    /**
     * Resolve a requested mobile-view id (including legacy ids and deep-link
     * segments) to the new 4-tab structure. Returns `{ view, segment?, tab }`
     * where `view` is the concrete mobile view to show ('watch' = bare canvas),
     * `segment` optionally selects a Build sub-view, and `tab` is the bottom-bar
     * tab to highlight ('' for gear-only views).
     * @param {string} requested
     * @param {string} [explicitSegment]
     */
    #resolveMobileTarget(requested, explicitSegment) {
        // Legacy aliases → new homes.
        if (requested === 'simulate') requested = 'watch';
        else if (requested === 'explore') requested = 'discover';
        else if (requested === 'rules' || requested === 'editor' || requested === 'worlds') {
            explicitSegment = explicitSegment || requested;
            requested = 'build';
        }

        const segment = requested === 'build' ? explicitSegment : undefined;
        const tab = UIManager.#MOBILE_TABS.has(requested) ? requested : '';
        return { view: requested, segment, tab };
    }

    _showMobileViewInternal({ targetView, segment }) {
        if (!this.isMobile()) return;

        const resolved = this.#resolveMobileTarget(targetView, segment);

        Object.values(this.mobileViews).forEach(v => v.hide());

        if (resolved.view === 'build' && this.mobileViews.build && resolved.segment) {
            this.mobileViews.build.setSegment(resolved.segment);
        }

        // 'watch' has no view entry — hiding everything reveals the live canvas.
        this.#createMobileView(resolved.view);
        const viewToShow = this.mobileViews[resolved.view];
        if (viewToShow) {
            viewToShow.show();
        }

        this.activeMobileViewName = resolved.view;
        EventBus.dispatch(EVENTS.MOBILE_VIEW_CHANGED, { activeView: resolved.view, activeTab: resolved.tab });
    }

    #createMobileView(viewName) {
        
        if (this.mobileViews[viewName]) {
            return;
        }

        const config = this.#mobileViewConfig[viewName];
        if (!config) return; 

        const mobileViewsContainer = document.getElementById('mobile-views-container');
        if (mobileViewsContainer) {
            
            const presenter = new MobileView(mobileViewsContainer, { 
                id: `${viewName}-mobile-view`,
                title: config.title,
                contentComponentType: config.constructor 
            });
            
            
            this.mobileViews[viewName] = presenter;
        }
    }


}