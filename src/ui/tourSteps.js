import { EventBus, EVENTS } from '../services/EventBus.js';
import { ICONS } from './icons.js';
import * as Config from '../core/config.js';
import { findHexagonsInNeighborhood } from '../utils/utils.js';
import { ControlsComponent } from './components/ControlsComponent.js';
import { RulesetActionsComponent } from './components/RulesetActionsComponent.js';
import { RulesetLibraryComponent } from './components/RulesetLibraryComponent.js';
import { RulesetEditorComponent } from './components/RulesetEditorComponent.js';
import { WorldSetupComponent } from './components/WorldSetupComponent.js';
import { AnalysisComponent } from './components/AnalysisComponent.js';
import { PatternsComponent } from './components/PatternsComponent.js';
import { ExploreComponent } from './components/ExploreComponent.js';
import { ChromaLabComponent } from './components/ChromaLabComponent.js';
/**
 * Provides the tour definitions for the application's onboarding process.
 * This unified structure uses functional steps to adapt to both desktop and mobile UI contexts.
 * @param {AppContext} appContext - The central application context.
 * @returns {object} A collection of all defined tours.
 */
export const getTours = (appContext) => {

    // Stable hex of the "Spontaneous Gliders" library ruleset (src/core/library/
    // rulesets.json). `RulesetDisplayFactory` puts the hex on the card itself
    // (`.library-card[data-hex]`), so this selector survives reordering of the
    // public library. Guarded by tests/tourSelectors.test.js.
    const GLIDERS_LOAD_BTN = '#ruleset-library-content .library-card[data-source="public"][data-hex="12482080480080006880800180010117"] [data-action="load-rule"]';

    const revealGlidersLibraryEntry = () => {
        document.querySelector('[data-pane="library"]')?.click();
        const search = /** @type {HTMLInputElement|null} */ (
            document.querySelector('#ruleset-library-library-pane .library-search')
        );
        if (search && search.value) {
            search.value = '';
            search.dispatchEvent(new Event('input', { bubbles: true }));
        }
        document.querySelector('[data-constraint-filter].active')?.click();
        document.querySelector('[data-tag-filter].active')?.click();
        document.querySelector('[data-source-filter="public"]')?.click();
        document.querySelector(GLIDERS_LOAD_BTN)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    /**
     * A helper function to ensure a consistent state before starting any tour.
     * Hides all panels and popouts and returns to the main simulation view on mobile.
     */
    const resetUIState = () => {
        EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
        if (appContext.uiManager.isMobile()) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'watch' });
        }
    };

    /**
     * Build remembers its last mobile segment. Prime the lesson's segment while
     * the view is hidden so tapping Build opens the promised tool immediately,
     * rather than briefly landing in an unrelated previous segment.
     */
    const prepareBuildLesson = (segment) => {
        resetUIState();
        if (appContext.uiManager.isMobile()) {
            appContext.uiManager.mobileViews.build?.setSegment(segment);
        }
    };

    /**
     * Calm first-contact focus for the core "Welcome" orientation. Rather than a
     * separate focus-mode subsystem, we lean on the orientation tour itself: clear
     * the chrome, freeze time, and centre the big viewer on a single universe so a
     * brand-new user starts on ONE still world instead of scanning nine noisy ones.
     * The subsequent steps (Play → minimap → draw → help) then reveal the rest of
     * the experience progressively. Safe to run on replays too — it just re-centres.
     */
    const focusOrientation = () => {
        resetUIState();
        EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, true);
        EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, Math.floor(appContext.worldManager.worlds.length / 2));
    };

    /**
     * Like focusOrientation, but for the hands-on "Experiments" — clear the chrome,
     * centre the big viewer on one universe, and let time run so mutations and seeds
     * are immediately visible. Experiments teach a loop by *doing*, so the sim must
     * be live rather than frozen. Safe on replays — it just re-centres and resumes.
     */
    const startExperiment = () => {
        resetUIState();
        EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, Math.floor(appContext.worldManager.worlds.length / 2));
        EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, false);
    };

    /**
     * The default ruleset is public and intentionally cannot be saved as a
     * personal duplicate. Chronicle therefore creates a guaranteed one-bit
     * variant up front; the original remains one Undo/history step away.
     */
    const preparePersonalDiscovery = () => {
        resetUIState();
        EventBus.dispatch(EVENTS.COMMAND_EDITOR_TOGGLE_RULE_OUTPUT, {
            ruleIndex: 0,
            modificationScope: 'selected',
            conditionalResetScope: 'none'
        });
    };

    /**
     * Helper to show the correct view for a tour step.
     * @param {{desktop: {type: 'panel'|'popout', name: string}, mobile: {view: string}}} config
     */
    const showView = (config) => {
        if (appContext.uiManager.isMobile()) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: config.mobile.view, segment: config.mobile.segment });
        } else {
            if(!config.desktop) return;
            const event = config.desktop.type === 'panel' ? EVENTS.COMMAND_TOGGLE_PANEL : EVENTS.COMMAND_TOGGLE_POPOUT;
            const key = config.desktop.type === 'panel' ? 'panelName' : 'popoutName';
            EventBus.dispatch(event, { [key]: config.desktop.name, show: true });
        }
    };

    /**
     * Returns true when the panel/popout/view a tour is about to open is already
     * visible — so the "Open this panel" intro step can be skipped (it otherwise
     * closes the panel via resetUIState and awkwardly asks the user to re-open it,
     * which is especially jarring when the tour was launched from that panel's own
     * [?] help trigger). A `condition` returning the negation skips step 1 cleanly.
     * Mirrors the {desktop, mobile} config shape used by showView. Returns false
     * (i.e. "not open", so don't skip) whenever the state can't be determined, e.g.
     * mobile controls which live in a FAB sheet rather than a tracked tab view.
     */
    const isViewOpen = (config) => {
        if (appContext.uiManager.isMobile()) {
            if (!config.mobile || appContext.uiManager.activeMobileViewName !== config.mobile.view) {
                return false;
            }
            if (config.mobile.view === 'build' && config.mobile.segment) {
                return appContext.uiManager.mobileViews.build?.activeSegment === config.mobile.segment;
            }
            return true;
        }
        if (!config.desktop) return false;
        if (config.desktop.type === 'popout') {
            const popout = appContext.toolbar.getPopout(config.desktop.name);
            return !!popout && !popout.isHidden();
        }
        const panel = appContext.panelManager.getPanel(config.desktop.name);
        return !!panel && !panel.isHidden();
    };
    
    /**
     * "Show me" actions for the action-gated core steps (audit fix #6). Each one
     * performs the *real* command the step is asking for, so the step advances
     * off its own `advanceOn` event and the user sees the same result they would
     * have produced themselves — a demonstration, not a bypass.
     */
    const showMePlay = () => EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, false);

    const showMeDrawMode = () => EventBus.dispatch(EVENTS.COMMAND_SET_INTERACTION_MODE, 'draw');

    const showMeFlatView = () => appContext.torusView?.setEnabled(false);

    const showMeCloneAndMutate = () => EventBus.dispatch(EVENTS.COMMAND_EXECUTE_CLONE_AND_MUTATE);

    const showMeSelectWorld = () => {
        const count = appContext.worldManager.worlds.length;
        const current = appContext.worldManager.getSelectedWorldIndex();
        EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, (current + 1) % count);
    };

    // A radius-3 hex blob at the centre of the focused world — roughly what a
    // short drag paints, and enough live cells for the ruleset to do something.
    const showMeDraw = () => {
        const cellIndices = new Set();
        findHexagonsInNeighborhood(
            Math.floor(Config.GRID_COLS / 2),
            Math.floor(Config.GRID_ROWS / 2),
            3,
            cellIndices
        );
        EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, {
            worldIndex: appContext.worldManager.getSelectedWorldIndex(),
            cellIndices,
            brushMode: 'draw'
        });
    };

    const core = [{
        element: 'body',
        title: 'Welcome to the HexLife Explorer',
        content: "You've arrived at the HexLife Observatory. Before you lie nine parallel universes, each waiting for a spark of life. Your mission: to discover the rules that govern them.",
        primaryAction: { text: 'Begin Orientation' },
        onBeforeShow: focusOrientation,
        advanceOn: { type: 'click' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '#mobilePlayPauseButton' : '[data-tour-id="play-pause-button"]',
        title: 'The Flow of Time',
        content: "Time is currently frozen. Use the <span class=\"onboarding-highlight-text\">Play/Pause button</span> to start and stop the universal clock. Let's see what these worlds are currently doing.",
        //primaryAction: { text: 'Click the Play Button' },
        advanceOn: { type: 'event', eventName: EVENTS.SIMULATION_PAUSED, condition: (isPaused) => !isPaused },
        showMe: { text: 'Start it for me', action: showMePlay },
        delayAfter: 700
    }, {
        element: '#minimap-guide',
        highlightType: 'canvas',
        title: 'The Observation Deck',
        content: "Your main viewer is focused on one universe, while the mini-map shows all nine. This is perfect for comparing experiments. <span class=\"onboarding-highlight-text\">Click any mini-map view</span> to shift your focus.",
        //primaryAction: { text: 'Select a Different World' },
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED },
        showMe: { text: 'Show me', action: showMeSelectWorld },
        delayAfter: 800
    }, {
        element: '#interaction-mode-toggle',
        title: 'Switch to Draw Mode',
        condition: (appContext) => appContext.uiManager.isMobile() && appContext.interactionController.getMode() !== 'draw',
        content: "Mobile starts in pan mode so swipes move the camera. Tap the highlighted <span class=\"onboarding-highlight-text\">hand</span> once; it changes to a pencil when drawing is active.",
        advanceOn: { type: 'event', eventName: EVENTS.INTERACTION_MODE_CHANGED, condition: (mode) => mode === 'draw' },
        showMe: { text: 'Switch for me', action: showMeDrawMode }
    }, {
        element: '.view-controls-torus',
        title: 'Switch to Flat View',
        condition: (appContext) => appContext.torusView?.getState().enabled === true,
        content: "Drawing happens on the flat grid. Select <span class=\"onboarding-highlight-text\">Flat view</span> before continuing.",
        advanceOn: { type: 'event', eventName: EVENTS.TORUS_VIEW_CHANGED, condition: ({ enabled }) => !enabled },
        showMe: { text: 'Switch for me', action: showMeFlatView }
    }, {
        element: '#selected-world-guide',
        highlightType: 'canvas',
        title: 'Draw on the Grid',
        content: "Now, <span class=\"onboarding-highlight-text\">click and drag (or touch and drag)</span> on the main view to bring cells to life. The simulation pauses automatically while you draw.",
        //primaryAction: { text: 'Try Drawing on the Grid' },
        // The brush event fires on the very first painted cell — hold the step a
        // beat so the user sees their cells appear before the tooltip moves on.
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH },
        showMe: { text: 'Draw one for me', action: showMeDraw },
        delayAfter: 1200
    }, {
        element: () => appContext.uiManager.isMobile() ? '#mobileToolsFab' : '#colorPanelButton',
        title: 'A Splash of Color',
        content: () => "Worlds start in calm <span class=\"onboarding-highlight-text\">monochrome</span>. The <span class=\"onboarding-highlight-text\">Chroma Lab</span>" + (appContext.uiManager.isMobile() ? ' under <span class="onboarding-highlight-text">Tools</span>' : '') + " can instead color each cell by <span class=\"onboarding-highlight-text\">which rule fired</span>. Start with <span class=\"onboarding-highlight-text\">Symmetry Groups</span> when you want to reveal a ruleset's hidden structure.",
        primaryAction: { text: 'Good to Know' },
        advanceOn: { type: 'click' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '#mobileGearButton' : '#helpButton',
        title: 'Your Lab Assistant',
        content: () => "Excellent. For every other tool, look for the <span class=\"onboarding-highlight-text\">[?]</span> help icon for a specific guide. " + (appContext.uiManager.isMobile()
            ? "This <span class=\"onboarding-highlight-text\">gear</span> opens the <span class=\"onboarding-highlight-text\">More</span> menu, where <span class=\"onboarding-highlight-text\">Learning Hub</span> restarts this orientation at any time."
            : "Use this main <span class=\"onboarding-highlight-text\">Help/Learn button</span> to restart this orientation at any time.") + " Good luck, Researcher.",
        primaryAction: { text: 'Begin My Research' },
        advanceOn: { type: 'click' }
    }];

    const controls = [{
        element: () => appContext.uiManager.isMobile() ? '#mobileToolsFab' : '[data-tour-id="controls-button"]',
        title: 'Tutorial: Simulation Controls',
        content: "This menu contains global controls for simulation speed, brush size, and drawing behavior. Open the highlighted control to continue.",
        condition: () => !isViewOpen({ desktop: { type: 'popout', name: 'controls' } }),
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === ControlsComponent }
    }, {
        element: '[id*="controls-speed-stepper"]',
        title: 'Simulation Speed',
        content: "Set the target <span class=\"onboarding-highlight-text\">Ticks Per Second (TPS)</span> for all worlds. Tap a preset, use the <span class=\"onboarding-highlight-text\">&minus;/+</span> buttons (hold to ramp), scroll, or type an exact value. Higher runs faster.",
        primaryAction: { text: 'Next' },
        // Re-assert the popout so the step self-heals on Back navigation.
        onBeforeShow: () => { if (!appContext.uiManager.isMobile()) showView({ desktop: { type: 'popout', name: 'controls' } }); },
        advanceOn: { type: 'click' }
    }, {
        element: '[id*="controls-brush-stepper"]',
        title: 'Brush Size',
        content: () => "Set how many cells your brush paints &mdash; the preview shows the exact hex footprint and cell count." + (appContext.uiManager.isMobile() ? '' : ' <br><br><b>Desktop shortcut:</b> Hold <kbd>Ctrl</kbd> and scroll over the grid.'),
        primaryAction: { text: 'Finish' },
        onBeforeShow: () => { if (!appContext.uiManager.isMobile()) showView({ desktop: { type: 'popout', name: 'controls' } }); },
        advanceOn: { type: 'click' }
    }];

    const ruleset_actions = [{
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="build"]' : '[data-tour-id="ruleset-actions-button"]',
        title: 'Tutorial: Ruleset Actions',
        content: "This panel is your laboratory for creating new rulesets. Use <span class=\"onboarding-highlight-text\">Generate</span> for a fresh rule or <span class=\"onboarding-highlight-text\">Mutate</span> to evolve the selected one. Open the highlighted panel to continue.",
        condition: () => !isViewOpen({ desktop: { type: 'panel', name: 'rulesetactions' }, mobile: { view: 'build', segment: 'rules' } }),
        onBeforeShow: () => prepareBuildLesson('rules'),
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === RulesetActionsComponent }
    }, {
        element: '[data-pane="generate"]',
        title: 'Generate',
        content: "Create entirely new laws of physics. <span class=\"onboarding-highlight-text\">R-Sym</span> (Rotational Symmetry) is often best for creating structured, organic patterns.",
        primaryAction: { text: 'Next' },
        onBeforeShow: (step) => { showView({ desktop: { type: 'panel', name: 'rulesetactions' }, mobile: { view: 'build', segment: 'rules' } }); document.querySelector(step.element)?.click(); },
        advanceOn: { type: 'click' }
    }, {
        element: '[data-pane="mutate"]',
        title: 'Mutate',
        content: "Introduce small, random changes to an existing ruleset to evolve it. The <span class=\"onboarding-highlight-text\">Clone & Mutate</span> action is a powerful way to run parallel experiments.",
        primaryAction: { text: 'Finish' },
        onBeforeShow: (step) => { document.querySelector(step.element)?.click(); },
        advanceOn: { type: 'click' }
    }];

    const ruleset_library = [{
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="library"]' : '[data-tour-id="library-button"]',
        title: 'Tutorial: Ruleset Library',
        content: "Load curated rulesets, revisit your own saved rules, or paste a 32-character hex code <span class=\"onboarding-highlight-text\">Directly</span>. Open the highlighted Library to continue.",
        condition: () => !isViewOpen({ desktop: { type: 'panel', name: 'library' }, mobile: { view: 'library' } }),
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === RulesetLibraryComponent }
    }, {
        element: '.ruleset-library-scope',
        title: 'Apply to:',
        content: "Choose whether loading a ruleset applies it to the <span class=\"onboarding-highlight-text\">Selected</span> world only or to <span class=\"onboarding-highlight-text\">All</span> nine. This same choice governs the Direct hex input too.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'library' }, mobile: { view: 'library' } }),
        advanceOn: { type: 'click' }
    }, {
        element: '[data-pane="library"]',
        title: 'Library',
        content: "Browse <span class=\"onboarding-highlight-text\">Public</span> rulesets or switch to <span class=\"onboarding-highlight-text\">My Rulesets</span> for the ones you've saved, then press Load.",
        primaryAction: { text: 'Next' },
        onBeforeShow: (step) => { document.querySelector(step.element)?.click(); },
        advanceOn: { type: 'click' }
    }, {
        element: '[data-pane="direct"]',
        title: 'Direct',
        content: "Already have a 32-character hex code? Paste it here to set the ruleset instantly.",
        primaryAction: { text: 'Finish' },
        onBeforeShow: (step) => { document.querySelector(step.element)?.click(); },
        advanceOn: { type: 'click' }
    }];

    const editor = [{
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="build"]' : '[data-tour-id="edit-rule-button"]',
        title: 'Tutorial: The Ruleset Editor',
        content: "The editor lets you directly change the 128 local rules governing a world. Open the highlighted Editor to try one.",
        condition: () => !isViewOpen({ desktop: { type: 'panel', name: 'ruleset' }, mobile: { view: 'build', segment: 'editor' } }),
        onBeforeShow: () => prepareBuildLesson('editor'),
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === RulesetEditorComponent }
    }, {
        // Mobile hosts the editor inside the Build view (segment 'editor'), so the
        // container is `#build-mobile-view` — `UIManager` ids views `${view}-mobile-view`
        // and there is no standalone 'editor' view.
        element: () => (appContext.uiManager.isMobile() ? '#build-mobile-view' : '#rulesetEditorPanel') + ' .r-sym-rule-viz',
        title: 'Toggling Outcomes',
        content: "The visualization shows a center cell and its six neighbors. The color of the <span class=\"onboarding-highlight-text\">inner-most hexagon</span> shows the rule's outcome. <span class=\"onboarding-highlight-text\">Simply click any rule</span> to flip its output state.",
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'ruleset' }, mobile: { view: 'build', segment: 'editor' } }),
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_EDITOR_SET_RULES_FOR_CANONICAL_REPRESENTATIVE }
    }, {
        element: '#ruleset-editor-mode',
        title: 'Analytical Lenses',
        content: "Change your 'lens' to view the rules differently. <span class=\"onboarding-highlight-text\">Rotational Symmetry</span> is great for understanding patterns, while <span class=\"onboarding-highlight-text\">Neighbor Count</span> groups rules by their local conditions.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }];
    
    const worldsetup = [{
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="build"]' : '[data-tour-id="setup-panel-button"]',
        title: 'Tutorial: World Setup',
        content: "Each of the nine universes can be configured independently. Open the <span class=\"onboarding-highlight-text\">World Setup</span> panel to manage them.",
        condition: () => !isViewOpen({ desktop: { type: 'panel', name: 'worldsetup' }, mobile: { view: 'build', segment: 'worlds' } }),
        onBeforeShow: () => prepareBuildLesson('worlds'),
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === WorldSetupComponent }
    }, {
        element: '#world-setup-config-grid .world-config-cell:nth-child(5)',
        title: 'Per-World Configuration',
        content: "Every world has its own card: <span class=\"onboarding-highlight-text\">Edit...</span> sets its initial state (random fill or clumps), the switch <span class=\"onboarding-highlight-text\">enables/disables</span> it, and <span class=\"onboarding-highlight-text\">Use Selected Ruleset</span> copies the selected world's rules here.",
        primaryAction: { text: 'Next' },
        advanceOn: { type: 'click' }
    }, {
        element: '#world-setup-panel-actions',
        title: 'Bulk Actions',
        content: "These buttons act on all worlds at once: <span class=\"onboarding-highlight-text\">Copy Selected &rarr; All</span> applies the selected world's initial state everywhere, <span class=\"onboarding-highlight-text\">Reset to Defaults</span> restores defaults, and <span class=\"onboarding-highlight-text\">Regenerate All Worlds</span> re-seeds them for a fresh, controlled experiment.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }];

    const analysis = [{
        element: () => appContext.uiManager.isMobile() ? '#more-view [data-action="analyze"]' : '[data-tour-id="analysis-panel-button"]',
        title: 'Tutorial: Analysis Tools',
        content: "Beyond watching patterns, you can measure them. Open the <span class=\"onboarding-highlight-text\">Analysis</span> panel to see live metrics for the selected world. <br><br>On mobile it's <span class=\"onboarding-highlight-text\">Full Analysis</span>, in the <span class=\"onboarding-highlight-text\">More</span> menu (the gear icon).",
        condition: () => !isViewOpen({ desktop: { type: 'panel', name: 'analysis' }, mobile: { view: 'analyze' } }),
        onBeforeShow: () => { resetUIState(); showView({ mobile: { view: 'more' } }); },
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === AnalysisComponent }
    }, {
        element: '#enableSamplingMount',
        title: 'Live Metrics',
        content: "<span class=\"onboarding-highlight-text\">Activity Ratio</span> tracks how much of the world is alive. <span class=\"onboarding-highlight-text\">Entropy</span> measures order versus chaos; use the highlighted <span class=\"onboarding-highlight-text\">Enable Sampling</span> control to start it. Flat lines suggest settling, while repeating waves can reveal cycles.",
        primaryAction: { text: 'Finish' },
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'analysis' }, mobile: { view: 'analyze' } }),
        advanceOn: { type: 'click' }
    }];

    // No toolbar button any more — the panel is reached from the command palette, so the tour
    // opens it itself instead of pointing at a rail icon.
    const rulerank = [{
        element: '#activation-rank',
        title: 'Birth Rules',
        content: "This column ranks the rules that most often make cells <span class=\"onboarding-highlight-text\">become active</span>. They are the engines of growth in your universe.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'rulerank' } }),
        advanceOn: { type: 'click' }
    }, {
        element: '#deactivation-rank',
        title: 'Death Rules',
        content: "This column ranks the rules that switch cells <span class=\"onboarding-highlight-text\">off</span>. The balance between both columns shapes whether a world grows, dies out, or stabilizes. Run the simulation to see the ranking update live.",
        primaryAction: { text: 'Finish' },
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'rulerank' } }),
        advanceOn: { type: 'click' }
    }];

    const patterns = [{
        element: () => appContext.uiManager.isMobile() ? '#more-view [data-action="patterns"]' : '[data-tour-id="patterns-button"]',
        title: 'Tutorial: Patterns',
        content: "Copy and paste regions of cells, or save a shape in your personal <span class=\"onboarding-highlight-text\">pattern library</span> and stamp it onto any world. Open the highlighted Patterns tool to continue.",
        condition: () => !isViewOpen({ desktop: { type: 'popout', name: 'patterns' }, mobile: { view: 'patterns' } }),
        onBeforeShow: () => { resetUIState(); showView({ mobile: { view: 'more' } }); },
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === PatternsComponent }
    }, {
        element: '#patterns-copy-button',
        title: 'Copy & Paste a Region',
        content: () => "Click <span class=\"onboarding-highlight-text\">Copy Region</span>, then drag a box over active cells to grab them. <span class=\"onboarding-highlight-text\">Paste</span> drops the copy back onto the grid where you click."
            + (appContext.uiManager.isMobile() ? '' : ' <br><br><b>Shortcuts:</b> <kbd>Ctrl</kbd>+<kbd>C</kbd> to copy a region, <kbd>Ctrl</kbd>+<kbd>V</kbd> to paste.'),
        primaryAction: { text: 'Next' },
        onBeforeShow: () => showView({ desktop: { type: 'popout', name: 'patterns' }, mobile: { view: 'patterns' } }),
        advanceOn: { type: 'click' }
    }, {
        element: '#patterns-capture-button',
        title: 'Capture & Save',
        content: "Click <span class=\"onboarding-highlight-text\">Capture &amp; Save…</span> and drag a box over some cells to store that shape in your library. Saved patterns persist across sessions.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => showView({ desktop: { type: 'popout', name: 'patterns' }, mobile: { view: 'patterns' } }),
        advanceOn: { type: 'click' }
    }, {
        element: '#patterns-list',
        title: 'Stamp Your Patterns',
        content: () => "Saved patterns live here. Hit the <span class=\"onboarding-highlight-text\">place</span> icon to stamp one onto the grid; you can keep stamping repeatedly."
            + (appContext.uiManager.isMobile() ? '' : ' Press <kbd>R</kbd> to rotate the stamp by 60°.')
            + ' The trash icon deletes a pattern.',
        primaryAction: { text: 'Finish' },
        onBeforeShow: () => showView({ desktop: { type: 'popout', name: 'patterns' }, mobile: { view: 'patterns' } }),
        advanceOn: { type: 'click' }
    }];

    const explore = [{
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="discover"]' : '[data-tour-id="explore-button"]',
        title: 'Tutorial: Auto-Explore',
        content: "Auto-Explore searches all nine worlds for <span class=\"onboarding-highlight-text\">interesting rulesets</span>, scoring and breeding promising candidates automatically. Open the highlighted tool; on mobile, this is the <span class=\"onboarding-highlight-text\">Discover</span> tab.",
        condition: () => !isViewOpen({ desktop: { type: 'panel', name: 'explore' }, mobile: { view: 'discover' } }),
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === ExploreComponent }
    }, {
        element: '.explore-run-buttons',
        title: 'Run the Search',
        content: "<span class=\"onboarding-highlight-text\">Start</span> begins the search; <span class=\"onboarding-highlight-text\">Pause</span>, <span class=\"onboarding-highlight-text\">Stop</span>, and <span class=\"onboarding-highlight-text\">Stop &amp; Keep</span> (which adopts the current champion into your selected world) end it. The status line above tracks the generation and best score.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'explore' }, mobile: { view: 'discover' } }),
        advanceOn: { type: 'click' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '.explore-advanced-summary' : '#explore-settings',
        title: 'Tune the Search',
        content: "Behind <span class=\"onboarding-highlight-text\">Advanced</span> you control the <span class=\"onboarding-highlight-text\">mutation rate &amp; mode</span>, ticks per evaluation, which <span class=\"onboarding-highlight-text\">initial conditions</span> each candidate is tested on, and a generation budget. The optional <span class=\"onboarding-highlight-text\">Perceptual novelty (CLIP)</span> toggle also scores finds on how they <i>look</i>.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => {
            showView({ desktop: { type: 'panel', name: 'explore' }, mobile: { view: 'discover' } });
            // #29 put Search Settings inside the "Advanced" disclosure, collapsed by default on
            // mobile. A target that resolves but never becomes visible auto-skips with only a
            // console.warn, so open it before spotlighting.
            appContext.uiManager?.getSharedComponent?.(ExploreComponent)?.openAdvanced();
        },
        advanceOn: { type: 'click' }
    }, {
        element: '.explore-gallery-group',
        title: 'The Gallery',
        content: "Every interesting find collects here, best-first, with a per-component score breakdown. Use the per-find actions to <span class=\"onboarding-highlight-text\">apply</span> it to the selected world, re-test, <span class=\"onboarding-highlight-text\">save</span> it to your library, or <span class=\"onboarding-highlight-text\">share</span> a link.",
        primaryAction: { text: 'Finish' },
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'explore' }, mobile: { view: 'discover' } }),
        advanceOn: { type: 'click' }
    }];

    // Helpers so the Chroma Lab tour can drive the live coloring mode while it
    // explains each one. The component is a single shared instance, so flipping
    // the mode here updates both the panel UI and the simulation immediately.
    const setChromaMode = (mode) => appContext.colorController.setMode(mode);
    const restoreCalmPalette = () => appContext.colorController.applyPreset('monochrome');

    const chromaLab = [{
        element: '#colorPanelButton',
        title: 'Tutorial: Chroma Lab',
        content: "New worlds start in calm <span class=\"onboarding-highlight-text\">Monochrome</span>. Chroma Lab can instead reveal <span class=\"onboarding-highlight-text\">which of the 128 rules fired</span> in every cell. Open the highlighted palette to turn that lens on.",
        condition: () => !isViewOpen({ desktop: { type: 'panel', name: 'chromalab' } }),
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === ChromaLabComponent }
    }, {
        element: '#chroma-tabs',
        title: 'Three Ways to Color',
        content: "These tabs pick <i>what the color means</i>. <span class=\"onboarding-highlight-text\">Palettes</span> are ready-made looks; <span class=\"onboarding-highlight-text\">Gradient</span> paints all 128 rules along a ramp you design (or roll at random); <span class=\"onboarding-highlight-text\">Fine-Tune</span> hand-colors individual rule families. We'll look at palettes, then the powerful Symmetry view.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => { showView({ desktop: { type: 'panel', name: 'chromalab' } }); setChromaMode('preset'); },
        advanceOn: { type: 'click' }
    }, {
        element: '#chroma-preset-section [data-preset="monochrome"]',
        title: 'Preset Palettes',
        content: "Ready-made looks &mdash; <span class=\"onboarding-highlight-text\">hover any card to preview it live</span> on your worlds, click to keep it. <span class=\"onboarding-highlight-text\">Monochrome</span> (the default) keeps things quiet; <span class=\"onboarding-highlight-text\">Default Spectrum</span> gives every rule its own hue so structure pops; <span class=\"onboarding-highlight-text\">Viridis</span> and <span class=\"onboarding-highlight-text\">Cividis</span> are colorblind-safe ramps. Keep the <span class=\"onboarding-highlight-text\">birth/death flash guard</span> on for busy rulesets &mdash; your choice is saved automatically.",
        primaryAction: { text: 'Show me Symmetry Groups' },
        onBeforeShow: () => { showView({ desktop: { type: 'panel', name: 'chromalab' } }); setChromaMode('preset'); },
        advanceOn: { type: 'click' }
    }, {
        element: '#chroma-symmetry-section .color-group',
        title: 'Symmetry Groups &mdash; the big idea',
        content: "Each row is one rule pattern plus all its rotations: a <span class=\"onboarding-highlight-text\">symmetry group</span>. The hex shows the pattern; <span class=\"onboarding-highlight-text\">Orbit</span> says how many rotations it represents. Its paired swatches color outcomes that turn the cell <span class=\"onboarding-highlight-text\">off</span> or <span class=\"onboarding-highlight-text\">on</span>. Recoloring a family makes its use visible across the whole world.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => { showView({ desktop: { type: 'panel', name: 'chromalab' } }); setChromaMode('symmetry'); },
        advanceOn: { type: 'click' }
    }, {
        element: '#chroma-tabs',
        title: "You're in control of the lens",
        content: "That's the whole idea: color is a <i>lens</i> on the rules, not just decoration. We've set you back to the calm <span class=\"onboarding-highlight-text\">Monochrome</span> default &mdash; come back to these tabs whenever you want to see the machinery underneath, or hit <span class=\"onboarding-highlight-text\">Surprise me</span> on the Gradient tab for a fresh coat of paint.",
        primaryAction: { text: 'Finish' },
        onBeforeShow: () => { showView({ desktop: { type: 'panel', name: 'chromalab' } }); restoreCalmPalette(); },
        advanceOn: { type: 'click' }
    }];

    const history = [{
        element: '#historyList',
        title: 'Tutorial: Ruleset History',
        content: "Every ruleset change of the selected world is recorded here. <span class=\"onboarding-highlight-text\">Click any entry</span> to revert the world to that ruleset.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => {
            if (!appContext.uiManager.isMobile() && document.getElementById('historyPopout')?.classList.contains('hidden')) {
                document.getElementById('historyButton')?.click();
            }
        },
        advanceOn: { type: 'click' }
    }, {
        element: '#historyButton',
        title: 'Undo & Redo',
        content: "Use the history list to jump back to any recorded ruleset. For quick steps, press <span class=\"onboarding-highlight-text\">Ctrl+Z</span> to undo or <span class=\"onboarding-highlight-text\">Ctrl+Shift+Z</span> to redo.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }];

    const resetClear = [{
        element: '[data-tour-id="reset-clear-popout"]',
        title: 'Tutorial: Reset & Clear',
        content: 'These actions manage the state of the cells on the grid.',
        primaryAction: { text: 'Next' },
        onBeforeShow: () => { resetUIState(); showView({ desktop: {type: 'popout', name: 'resetClear'}, mobile: {view: 'watch' /* No mobile equivalent yet */} }) },
        advanceOn: { type: 'click' }
    }, {
        element: '[data-tour-id="reset-clear-popout"] #resetAllButtonPopout',
        title: 'Reset Worlds',
        content: "<span class=\"onboarding-highlight-text\">Reset</span> re-seeds the grid with new random cells according to each world's configured density. It's like starting a new petri dish culture.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => showView({ desktop: { type: 'popout', name: 'resetClear' } }),
        advanceOn: { type: 'click' }
    }, {
        element: '[data-tour-id="reset-clear-popout"] #clearAllButtonPopout',
        title: 'Clear Worlds',
        content: "<span class=\"onboarding-highlight-text\">Clear</span> sets all cells to inactive (or active, if already clear). It's like sterilizing the dish before an experiment.",
        primaryAction: { text: 'Finish' },
        onBeforeShow: () => showView({ desktop: { type: 'popout', name: 'resetClear' } }),
        advanceOn: { type: 'click' }
    }];

    const saveLoad = [{
        element: () => appContext.uiManager.isMobile() ? '#mobileGearButton' : '[data-tour-id="snapshots-button"]',
        title: 'Tutorial: Save, Load & Share',
        content: () => appContext.uiManager.isMobile()
            ? 'Preserve your discoveries and share them with others. Open the highlighted <span class="onboarding-highlight-text">More</span> menu to find Save, Load, and Share.'
            : 'Preserve your discoveries and share them with others. Open the highlighted <span class="onboarding-highlight-text">Snapshots</span> panel to find Save, Load, and Share.',
        onBeforeShow: resetUIState,
        advanceOn: { type: 'click', target: 'element' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '[data-action="save"]' : '[data-tour-id="save-state-button"]',
        title: 'Save World State',
        content: "This saves the <span class=\"onboarding-highlight-text\">complete state</span> of the currently selected world—including its ruleset, cell states, and tick count—to a JSON file on your device.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'snapshots' }, mobile: { view: 'more' } }),
        advanceOn: { type: 'click' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '[for="mobileFileInput"]' : '[data-tour-id="load-state-button"]',
        title: 'Load World State',
        content: "This loads a previously saved JSON file, restoring a world to its exact saved state, allowing you to continue an experiment. The same panel holds your <span class=\"onboarding-highlight-text\">saved starts</span> library.",
        primaryAction: { text: 'Next' },
        advanceOn: { type: 'click' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '[data-action="share"]' : '[data-tour-id="share-button"]',
        title: 'Share Setup',
        content: "This copies a <span class=\"onboarding-highlight-text\">shareable URL</span> for the full nine-world setup: rulesets, starting conditions, enabled worlds, grid size, selection, and camera. It recreates the recipe, not the exact cells after they have evolved.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }];

    const appliedEvolution = [{
        element: 'body',
        title: 'Mission: Applied Evolution',
        content: "This mission will guide you through a full experiment to discover a new ruleset using the core tools of the Explorer.",
        primaryAction: { text: 'Start Mission' },
        onBeforeShow: resetUIState,
        advanceOn: { type: 'click' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="library"]' : '[data-tour-id="library-button"]',
        title: 'Step 1: Get a Baseline',
        content: "Every experiment needs a starting point. Open the <span class=\"onboarding-highlight-text\">Ruleset Library</span> to load a known ruleset. <br><br>On mobile, it's the <span class=\"onboarding-highlight-text\">Library</span> tab.",
        //primaryAction: { text: 'Open Ruleset Library' },
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === RulesetLibraryComponent }
    }, {
        element: '[data-pane="library"]',
        title: 'Step 2: Open the Library',
        content: "Select the <span class=\"onboarding-highlight-text\">Library</span> tab within the panel.",
        // Skip entirely when the Library tab is already active (it is by default
        // when the panel opens) — don't make the user click an already-selected
        // tab. When it isn't active, advance on the user actually clicking it.
        condition: () => !document.querySelector('[data-pane="library"]')?.classList.contains('active'),
        onBeforeShow: () => showView({ desktop: {type: 'panel', name: 'library'}, mobile: {view: 'library'} }),
        advanceOn: { type: 'click', target: 'element' }
    }, {
        // Target by the ruleset's stable hex (data-hex), NOT its list position —
        // a `:nth-child(N)` here breaks the moment the library is reordered.
        element: GLIDERS_LOAD_BTN,
        title: "Step 3: Load 'Spontaneous Gliders'",
        content: "This ruleset produces mobile patterns. Press its highlighted <span class=\"onboarding-highlight-text\">Load Ruleset</span> button. Loading it into the selected world is enough; the mutation step will copy that parent to all nine worlds later.",
        //primaryAction: { text: 'Load the Ruleset' },
        onBeforeShow: revealGlidersLibraryEntry,
        // Library "Paired start" legitimately uses COMMAND_APPLY_EXPLORE_FIND
        // instead of COMMAND_SET_RULESET. Gate on the shared result so either
        // user preference completes the lesson.
        advanceOn: {
            type: 'event',
            eventName: EVENTS.RULESET_CHANGED,
            condition: (hex) => hex === '12482080480080006880800180010117'
        }
    }, {
        element: () => appContext.uiManager.isMobile() ? '#mobilePlayPauseButton' : '[data-tour-id="play-pause-button"]',
        title: 'Step 4: Observe',
        content: "Start the simulation to see the 'Gliders' ruleset in action.",
        condition: (appContext) => appContext.simulationController.getIsPaused(),
        //primaryAction: { text: 'Press Play' },
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.SIMULATION_PAUSED, condition: (isPaused) => !isPaused },
        delayAfter: 2000
    }, {
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="build"]' : '[data-tour-id="setup-panel-button"]',
        title: 'Step 5: Control Your Variables',
        content: "For a good experiment, we need consistent starting conditions. Open the <span class=\"onboarding-highlight-text\">World Setup</span> panel.",
        //primaryAction: { text: 'Open World Setup' },
        onBeforeShow: () => prepareBuildLesson('worlds'),
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === WorldSetupComponent }
    }, {
        element: '#minimap-guide',
        highlightType: 'canvas',
        title: 'Step 6: Focus on Central World',
        content: "If your main view is not focused on the central world (World 4), click on the central cell in the minimap below to select it.",
        condition: (appContext) => appContext.worldManager.getSelectedWorldIndex() !== 4,
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'worldsetup' }, mobile: { view: 'build', segment: 'worlds' } }),
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED, condition: (worldIndex) => worldIndex === 4 }
    }, {
        element: () => '#world-setup-config-grid .world-config-cell:nth-child(5) [data-action="edit-state"]',
        title: "Step 7: Open World 4's Initial State",
        content: "Click <span class=\"onboarding-highlight-text\">Edit&hellip;</span> on the central world's card.",
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'worldsetup' }, mobile: { view: 'build', segment: 'worlds' } }),
        advanceOn: { type: 'click', target: 'element' }
    }, {
        element: '#initial-state-config-modal .isc-mode-toggle',
        title: 'Step 8: Choose a Balanced Random Fill',
        content: "Choose <span class=\"onboarding-highlight-text\">Random fill</span>, select the <span class=\"onboarding-highlight-text\">Balanced</span> preset (50%), then press <span class=\"onboarding-highlight-text\">Save</span>.",
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_SET_WORLD_INITIAL_STATE, condition: (data) => (data.worldIndex === 4 && data.initialState?.mode === 'density' && data.initialState?.params?.density > 0.49 && data.initialState?.params?.density < 0.51) }
    }, {
        element: () => '#world-setup-panel-actions [data-action="apply-state-all"]',
        title: 'Step 9: Copy Selected &rarr; All',
        content: "Now click <span class=\"onboarding-highlight-text\">'Copy Selected &rarr; All'</span> to set the same 50% Random fill configuration across all worlds, creating a level playing field for our mutations.",
        // Re-assert the panel so the button is present and gets highlighted.
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'worldsetup' }, mobile: { view: 'build', segment: 'worlds' } }),
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_APPLY_SELECTED_INITIAL_STATE_TO_ALL }
    }, {
        element: () => '#world-setup-panel-actions [data-action="reset-all-worlds"]',
        title: 'Step 10: Reset Worlds',
        content: "Finally, click <span class=\"onboarding-highlight-text\">'Regenerate All Worlds'</span> to re-seed all worlds with the new initial Random fill settings.",
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'worldsetup' }, mobile: { view: 'build', segment: 'worlds' } }),
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES }
    }, {
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="build"]' : '[data-tour-id="ruleset-actions-button"]',
        title: 'Step 11: Prepare for Mutation',
        content: "It's time to evolve our ruleset. Open the <span class=\"onboarding-highlight-text\">Ruleset Actions</span> panel again.",
        //primaryAction: { text: 'Open Ruleset Actions' },
        onBeforeShow: () => prepareBuildLesson('rules'),
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === RulesetActionsComponent }
    }, {
        element: '[data-pane="mutate"]',
        title: 'Step 12: Access the DNA Splicer',
        content: "Select the <span class=\"onboarding-highlight-text\">Mutate</span> tab.",
        // Same as Step 2: skip when Mutate is already the active tab, otherwise
        // advance on the user clicking the highlighted tab itself.
        condition: () => !document.querySelector('[data-pane="mutate"]')?.classList.contains('active'),
        onBeforeShow: () => showView({ desktop: {type: 'panel', name: 'rulesetactions'}, mobile: {view: 'build', segment: 'rules'} }),
        advanceOn: { type: 'click', target: 'element' }
    }, {
        // Keep the actionable Clone & Mutate row clear of the tooltip. The
        // surrounding panel/view is elevated as one surface, so the optional
        // rate and mode controls remain interactive too.
        element: () => '#ruleset-actions-mutate-pane .ruleset-secondary-actions',
        title: 'Step 13: Run the Experiment',
        content: "We've preset the recommended <span class=\"onboarding-highlight-text\">R-Sym</span> mode and a <span class=\"onboarding-highlight-text\">~10% Mutation Rate</span> &mdash; the sweet spot for evolving structured rules. Tweak them if you like, then press <span class=\"onboarding-highlight-text\">Clone &amp; Mutate</span> to copy our 'Gliders' ruleset to all nine worlds and mutate each copy uniquely.",
        onBeforeShow: () => {
            showView({ desktop: {type: 'panel', name: 'rulesetactions'}, mobile: {view: 'build', segment: 'rules'} });
            // Preset R-Sym + ~10% by driving the real inputs; each control's
            // change handler persists the choice (the operation reads it live).
            const rsym = document.getElementById('ruleset-actions-mutate-mode-r_sym');
            if (rsym && !rsym.checked) { rsym.checked = true; rsym.dispatchEvent(new Event('change', { bubbles: true })); }
            const rate = document.getElementById('ruleset-actions-mutate-rate');
            if (rate && rate.value !== '10') { rate.value = '10'; rate.dispatchEvent(new Event('change', { bubbles: true })); }
        },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_CLONE_AND_MUTATE },
        delayAfter: 1000
    }, {
        element: '#minimap-guide',
        highlightType: 'canvas',
        title: 'Step 14: Observe and Select',
        content: "The experiment is running! Each world is now a slightly different version of the original. <span class=\"onboarding-highlight-text\">Observe the minimap and select a world</span> that looks interesting to you.",
        onBeforeShow: () => { showView({ mobile: {view: 'watch'} }); },
        //primaryAction: { text: 'Select a World' },
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED },
        showMe: { text: 'Choose another world for me', action: showMeSelectWorld, after: 5000 },
        delayAfter: 800
    }, {
        element: () => appContext.uiManager.isMobile()
            ? '#mobile-fab-container-left'
            : '#ruleset-actions-mutate-pane .ruleset-secondary-actions',
        title: 'Step 15: Evolve Again!',
        content: () => appContext.uiManager.isMobile()
            ? "You've selected a promising specimen. Tap <span class=\"onboarding-highlight-text\">Clone &amp; Mutate</span> in the highlighted quick actions to make it the parent of the next generation."
            : "You've selected a promising new specimen. Press <span class=\"onboarding-highlight-text\">Clone &amp; Mutate</span> again to evolve from your new selection. <br><br>Shortcut: press <kbd>M</kbd>.",
        onBeforeShow: () => {
            if (!appContext.uiManager.isMobile()) {
                showView({ desktop: {type: 'panel', name: 'rulesetactions'} });
                document.querySelector('[data-pane="mutate"]')?.click();
            }
        },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_CLONE_AND_MUTATE },
        showMe: { text: 'Mutate again for me', action: showMeCloneAndMutate, after: 4000 },
        delayAfter: 1000
    }, {
        element: 'body',
        title: 'Mission Complete',
        content: "You just ran the full loop: <span class=\"onboarding-highlight-text\">load a baseline, control the starting conditions, mutate, observe, and select</span>. Repeat from any promising world to keep steering the next generation.",
        primaryAction: { text: 'Finish Mission' },
        advanceOn: { type: 'click' }
    },
];

    const personal_library = [{
        element: 'body',
        title: 'Mission: Chronicle Your Discoveries',
        content: "We've flipped one rule in the selected world to make a new, unsaved specimen. (Your original is still one Undo step away.) Now you'll name it, save it, and find it again.",
        primaryAction: { text: 'Begin Mission' },
        onBeforeShow: preparePersonalDiscovery,
        advanceOn: { type: 'click' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '[data-action="save-ruleset-mobile"]' : '#saveRulesetButton',
        title: 'Step 1: Save the Ruleset',
        content: "This star icon (<span class=\"inline-icon\">" + ICONS.star + "</span>) shows the status of the current ruleset. Since it's an outline, it's unsaved. Click the highlighted <span class=\"onboarding-highlight-text\">Save Ruleset</span> control to add it to your personal collection.",
        onBeforeShow: () => {
            if (appContext.uiManager.isMobile()) {
                showView({ mobile: { view: 'more' } });
            }
        },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_SHOW_SAVE_RULESET_MODAL }
    }, {
        element: '#ruleset-name-input',
        title: 'Step 2: Name Your Creation',
        content: "Give your ruleset a memorable <span class=\"onboarding-highlight-text\">name</span>, add any optional details you want, then press <span class=\"onboarding-highlight-text\">Save</span>.",
        advanceOn: { type: 'event', eventName: EVENTS.USER_RULESET_SAVED }
    }, {
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="library"]' : '[data-tour-id="library-button"]',
        title: 'Step 3: Visit Your Library',
        content: "Excellent! The star is now gold, indicating you've saved it. Let's see your collection. Open the <span class=\"onboarding-highlight-text\">Ruleset Library</span>. <br><br>On mobile, it's the <span class=\"onboarding-highlight-text\">Library</span> tab.",
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === RulesetLibraryComponent }
    }, {
        element: '[data-source-filter="personal"]',
        title: 'Step 4: View Your Rulesets',
        content: "Public and personal rules now share one list, with a source badge on every card. Click <span class=\"onboarding-highlight-text\">Mine</span> to show only your saved creations.",
        // Skip if the unified list is already filtered to Mine; otherwise advance on the source chip.
        condition: () => !document.querySelector('[data-source-filter="personal"]')?.classList.contains('active'),
        onBeforeShow: () => {
            showView({ desktop: {type: 'panel', name: 'library'}, mobile: {view: 'library'} });
            document.querySelector('[data-pane="library"]')?.click();
        },
        advanceOn: { type: 'click', target: 'element' }
    }, {
        element: '.library-card.personal [data-action="manage-personal"]',
        title: 'Step 5: Manage & Share',
        content: "From here, you can <span class=\"onboarding-highlight-text\">Load</span> your ruleset back into the simulator, or use the <span class=\"onboarding-highlight-text\">'...' menu</span> to Rename, Delete, or Share it.",
        primaryAction: { text: 'Mission Complete!' },
        advanceOn: { type: 'click' }
    }];

    /**
     * Guided experiment — the flagship "core loop" of HexLife taught by doing, not
     * by pointing at chrome. Five short steps: intro → Mutate → Observe & Select →
     * Repeat → finish. Every working step is anchored on the minimap (where the change
     * is visible) and advances on the *action's* event (COMMAND_CLONE_AND_MUTATE fires
     * for both the M shortcut and the mobile Clone & Mutate button; SELECTED_WORLD_CHANGED
     * for any minimap pick), so it is input-agnostic across desktop and mobile.
     */
    const evolutionLoop = [{
        element: 'body',
        title: 'Experiment: The Evolution Loop',
        content: "Every discovery in HexLife comes from one simple loop: <span class=\"onboarding-highlight-text\">Mutate &rarr; Observe &rarr; Select &rarr; Repeat</span>. Let's run it together &mdash; by the end you'll be steering a universe by hand.",
        primaryAction: { text: 'Start the Loop' },
        onBeforeShow: startExperiment,
        advanceOn: { type: 'click' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '#mobile-fab-container-left' : '#minimap-guide',
        highlightType: () => appContext.uiManager.isMobile() ? undefined : 'canvas',
        title: 'Step 1: Mutate',
        content: () => appContext.uiManager.isMobile()
            ? "Tap the <span class=\"inline-icon\">" + ICONS.copyPlus + "</span> <span class=\"onboarding-highlight-text\">Clone &amp; Mutate</span> quick action. The selected ruleset is copied to all nine worlds, then each copy gets a small random mutation."
            : "Press <kbd>M</kbd> to run <b>Clone &amp; Mutate</b>. The selected ruleset is copied to all nine worlds, then each copy gets a small random mutation. Watch the minimap change.",
        onBeforeShow: () => { showView({ mobile: { view: 'watch' } }); },
        // Let the freshly-mutated grid render before advancing — all nine worlds
        // change at once and that change is the whole point of the step.
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_CLONE_AND_MUTATE },
        showMe: { text: 'Mutate for me', action: showMeCloneAndMutate, after: 4000 },
        delayAfter: 1000
    }, {
        element: '#minimap-guide',
        highlightType: 'canvas',
        title: 'Step 2: Observe & Select',
        content: "Each of the nine worlds now runs a slightly different ruleset. Scan them and <span class=\"onboarding-highlight-text\">click the world that looks most alive</span> to you &mdash; the busiest, the most structured, the strangest. That choice is your selection pressure.",
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED },
        showMe: { text: 'Choose another world for me', action: showMeSelectWorld, after: 5000 },
        delayAfter: 800
    }, {
        element: () => appContext.uiManager.isMobile() ? '#mobile-fab-container-left' : '#minimap-guide',
        highlightType: () => appContext.uiManager.isMobile() ? undefined : 'canvas',
        title: 'Step 3: Repeat',
        content: () => appContext.uiManager.isMobile()
            ? "Tap <span class=\"inline-icon\">" + ICONS.copyPlus + "</span> <span class=\"onboarding-highlight-text\">Clone &amp; Mutate</span> again. Your chosen world becomes the parent of nine fresh variations."
            : "Press <kbd>M</kbd> again. Your chosen world becomes the parent of nine fresh variations.",
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_CLONE_AND_MUTATE },
        showMe: { text: 'Mutate again for me', action: showMeCloneAndMutate, after: 4000 },
        delayAfter: 1000
    }, {
        element: 'body',
        title: "That's the Whole Loop",
        content: "<span class=\"onboarding-highlight-text\">M &rarr; pick &rarr; M &rarr; pick&hellip;</span> Keep going as long as it stays interesting. When you find a ruleset you love, save it with the <span class=\"inline-icon\">" + ICONS.star + "</span> button so it's never lost. Happy hunting, Researcher.",
        primaryAction: { text: 'Finish Experiment' },
        advanceOn: { type: 'click' }
    }];

    /**
     * Guided experiment — the *other* half of the core loop: state, not rules. The
     * user clears a world to a blank canvas (done for them in onBeforeShow), seeds it
     * by hand, then starts time and watches the same ruleset bring their spark to life.
     * Mirrors the draw-mode handling of the `core` tour (desktop is already in draw
     * mode; mobile gets a switch-to-draw nudge) and advances on the brush/pause events
     * so it is input-agnostic.
     */
    const sparkOfLife = [{
        element: 'body',
        title: 'Experiment: The Spark of Life',
        content: "Where does a pattern come from? You. In this experiment you'll seed an empty world by hand, then let the rules take over. We've cleared the central world to give you a blank canvas.",
        primaryAction: { text: 'Begin' },
        onBeforeShow: () => {
            resetUIState();
            EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, Math.floor(appContext.worldManager.worlds.length / 2));
            EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, true);
            EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'selected' });
        },
        advanceOn: { type: 'click' }
    }, {
        element: '#interaction-mode-toggle',
        title: 'Switch to Draw Mode',
        condition: (appContext) => appContext.uiManager.isMobile() && appContext.interactionController.getMode() !== 'draw',
        content: "Tap the highlighted <span class=\"onboarding-highlight-text\">hand</span>. It changes to a pencil when drawing is active.",
        advanceOn: { type: 'event', eventName: EVENTS.INTERACTION_MODE_CHANGED, condition: (mode) => mode === 'draw' },
        showMe: { text: 'Switch for me', action: showMeDrawMode }
    }, {
        element: '#selected-world-guide',
        highlightType: 'canvas',
        title: 'Step 1: Seed a Spark',
        content: "<span class=\"onboarding-highlight-text\">Click and drag (or touch and drag)</span> on the main view to paint living cells onto the blank grid. A small cluster is plenty &mdash; the rules do the rest.",
        // Brush event fires on the first cell — hold so the seeded cluster is visible.
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH },
        showMe: { text: 'Draw a spark for me', action: showMeDraw },
        delayAfter: 1200
    }, {
        element: () => appContext.uiManager.isMobile() ? '#mobilePlayPauseButton' : '[data-tour-id="play-pause-button"]',
        title: 'Step 2: Start Time',
        content: () => appContext.uiManager.isMobile()
            ? 'Tap the highlighted <span class="onboarding-highlight-text">Play</span> button to start the universal clock and watch your spark evolve.'
            : 'Press <kbd>P</kbd> (or the highlighted Play button) to start the universal clock and watch your spark evolve.',
        condition: (appContext) => appContext.simulationController.getIsPaused(),
        // Linger so the spark visibly begins to evolve before the closing step.
        advanceOn: { type: 'event', eventName: EVENTS.SIMULATION_PAUSED, condition: (isPaused) => !isPaused },
        showMe: { text: 'Start time for me', action: showMePlay },
        delayAfter: 1500
    }, {
        element: 'body',
        title: 'State + Rules = Behavior',
        content: "That's the foundation: the cells you drew are the <span class=\"onboarding-highlight-text\">state</span>, and the ruleset decides how that state changes each tick. Repeat the experiment with a different starting shape &mdash; the same rules can treat it completely differently.",
        primaryAction: { text: 'Finish Experiment' },
        advanceOn: { type: 'click' }
    }];

    const tours = {
        core,
        evolutionLoop,
        sparkOfLife,
        controls,
        patterns,
        ruleset_actions,
        ruleset_library,
        editor,
        worldsetup,
        explore,
        analysis,
        rulerank,
        chromaLab,
        history,
        appliedEvolution,
        resetClear,
        saveLoad,
        personal_library
    };

    // DEV guard: the Learning Hub list (TOUR_CATALOG) and the registered tours
    // must stay in lock-step. This caught `ruleset_library` silently missing
    // from the Hub for a long time — fail loud in dev so it can't recur.
    if (import.meta.env && import.meta.env.DEV) {
        const registered = new Set(Object.keys(tours));
        const catalogued = new Set(TOUR_CATALOG.map(t => t.id));
        for (const id of registered) if (!catalogued.has(id)) console.warn(`[tours] "${id}" is registered but missing from TOUR_CATALOG (won't appear in the Learning Hub).`);
        for (const id of catalogued) if (!registered.has(id)) console.warn(`[tours] TOUR_CATALOG lists "${id}" but no such tour is registered.`);
    }

    return tours;
};

/**
 * The single source of truth for which tours appear in the Learning Hub, in
 * what order, under what section, and with what display name. Both
 * {@link getTours} (via the DEV guard above) and the LearningComponent consume
 * this, so the Hub list can no longer drift out of sync with the registry.
 *
 * `platform: 'desktopOnly'` hides the entry on mobile (those panels have no
 * mobile surface yet).
 */
export const TOUR_CATALOG = [
    // Missions — multi-step guided experiments that teach a full workflow.
    { id: 'core',             name: 'Core Orientation',          section: 'Missions' },
    { id: 'appliedEvolution', name: 'Applied Evolution',         section: 'Missions' },
    { id: 'personal_library', name: 'Chronicle Your Discoveries', section: 'Missions' },
    // Experiments — short, hands-on, learn-by-doing loops.
    { id: 'evolutionLoop',    name: 'The Evolution Loop',        section: 'Experiments' },
    { id: 'sparkOfLife',      name: 'The Spark of Life',         section: 'Experiments' },
    // Tutorials — one panel / feature each. Chroma Lab leads: with the new
    // monochrome default, learning how color maps to rules pays off early.
    { id: 'chromaLab',        name: 'Chroma Lab',                section: 'Tutorials', platform: 'desktopOnly' },
    { id: 'controls',         name: 'Simulation Controls',       section: 'Tutorials' },
    { id: 'patterns',         name: 'Patterns',                  section: 'Tutorials' },
    { id: 'ruleset_actions',  name: 'Ruleset Actions',           section: 'Tutorials' },
    { id: 'ruleset_library',  name: 'Ruleset Library',           section: 'Tutorials' },
    { id: 'editor',           name: 'The Ruleset Editor',        section: 'Tutorials' },
    { id: 'worldsetup',       name: 'World Setup',               section: 'Tutorials' },
    { id: 'explore',          name: 'Auto-Explore',              section: 'Tutorials' },
    { id: 'analysis',         name: 'Analysis Tools',            section: 'Tutorials' },
    { id: 'rulerank',         name: 'Rule Usage Ranking',        section: 'Tutorials', platform: 'desktopOnly' },
    { id: 'resetClear',       name: 'Reset & Clear',             section: 'Tutorials', platform: 'desktopOnly' },
    { id: 'saveLoad',         name: 'Save, Load & Share',        section: 'Tutorials' },
    { id: 'history',          name: 'Ruleset History',           section: 'Tutorials', platform: 'desktopOnly' },
];
