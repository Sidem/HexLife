import { EventBus, EVENTS } from '../services/EventBus.js';
import { ICONS } from './icons.js';
import { ControlsComponent } from './components/ControlsComponent.js';
import { RulesetActionsComponent } from './components/RulesetActionsComponent.js';
import { RulesetLibraryComponent } from './components/RulesetLibraryComponent.js';
import { RulesetEditorComponent } from './components/RulesetEditorComponent.js';
import { WorldSetupComponent } from './components/WorldSetupComponent.js';
import { AnalysisComponent } from './components/AnalysisComponent.js';
import { RuleRankComponent } from './components/RuleRankComponent.js';
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
    // rulesets.json). The library item carries it on `.library-item-actions[data-hex]`,
    // so this selector survives reordering of the public library.
    const GLIDERS_LOAD_BTN = '#ruleset-library-public-content .library-item-actions[data-hex="12482080480080006880800180010117"] [data-action="load-rule"]';

    /**
     * A helper function to ensure a consistent state before starting any tour.
     * Hides all panels and popouts and returns to the main simulation view on mobile.
     */
    const resetUIState = () => {
        EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
        if (appContext.uiManager.isMobile()) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'simulate' });
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
     * Helper to show the correct view for a tour step.
     * @param {{desktop: {type: 'panel'|'popout', name: string}, mobile: {view: string}}} config
     */
    const showView = (config) => {
        if (appContext.uiManager.isMobile()) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: config.mobile.view });
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
            return !!config.mobile && appContext.uiManager.activeMobileViewName === config.mobile.view;
        }
        if (!config.desktop) return false;
        if (config.desktop.type === 'popout') {
            const popout = appContext.toolbar.getPopout(config.desktop.name);
            return !!popout && !popout.isHidden();
        }
        const panel = appContext.panelManager.getPanel(config.desktop.name);
        return !!panel && !panel.isHidden();
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
        delayAfter: 700
    }, {
        element: '#minimap-guide',
        highlightType: 'canvas',
        title: 'The Observation Deck',
        content: "Your main viewer is focused on one universe, while the mini-map shows all nine. This is perfect for comparing experiments. <span class=\"onboarding-highlight-text\">Click any mini-map view</span> to shift your focus.",
        //primaryAction: { text: 'Select a Different World' },
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED },
        delayAfter: 800
    }, {
        element: 'body',
        title: 'The Spark of Creation',
        condition: (appContext) => appContext.uiManager.isMobile(),
        content: "The most direct way to influence a universe is to seed it with life. In draw mode, you can toggle cells by clicking. <br><br>On desktop, you are already in draw mode. On mobile, <span class=\"onboarding-highlight-text\">tap the hand icon (🖐️)</span> to switch to draw mode.",
        primaryAction: { text: 'Continue' },
        advanceOn: { type: 'click' }
    }, {
        element: '#selected-world-guide',
        highlightType: 'canvas',
        title: 'Draw on the Grid',
        content: "Now, <span class=\"onboarding-highlight-text\">click and drag (or touch and drag)</span> on the main view to bring cells to life. The simulation pauses automatically while you draw.",
        //primaryAction: { text: 'Try Drawing on the Grid' },
        // The brush event fires on the very first painted cell — hold the step a
        // beat so the user sees their cells appear before the tooltip moves on.
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH },
        delayAfter: 1200
    }, {
        element: () => appContext.uiManager.isMobile() ? '#mobileToolsFab' : '#colorPanelButton',
        title: 'A Splash of Color',
        content: () => "Cells are <span class=\"onboarding-highlight-text\">monochrome</span> right now &mdash; calm and clear to start. But color is HexLife's secret weapon: in the <span class=\"onboarding-highlight-text\">Chroma Lab</span> (the palette icon" + (appContext.uiManager.isMobile() ? ', under the <span class="onboarding-highlight-text">Tools</span> menu' : '') +") you can color cells by <span class=\"onboarding-highlight-text\">which rule fired</span> &mdash; try the <span class=\"onboarding-highlight-text\">Symmetry Groups</span> palette to see your ruleset's hidden structure. It has its own <span class=\"onboarding-highlight-text\">[?]</span> guide when you're ready.",
        primaryAction: { text: 'Good to Know' },
        advanceOn: { type: 'click' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="learning"]' : '#helpButton',
        title: 'Your Lab Assistant',
        content: "Excellent. For every other tool, look for the <span class=\"onboarding-highlight-text\">[?]</span> help icon for a specific guide. Use this main <span class=\"onboarding-highlight-text\">Help/Learn button</span> to restart this orientation at any time. Good luck, Researcher.",
        primaryAction: { text: 'Begin My Research' },
        advanceOn: { type: 'click' }
    }];

    const controls = [{
        element: () => appContext.uiManager.isMobile() ? '#mobileToolsFab' : '[data-tour-id="controls-button"]',
        title: 'Tutorial: Simulation Controls',
        content: "This menu contains global controls for simulation speed, brush size, and interaction preferences.",
        primaryAction: { text: 'Open Controls' },
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
        content: "Set how many cells your brush paints &mdash; the preview shows the exact hex footprint and cell count. <br><br><b>Desktop Pro-Tip:</b> Use `Ctrl + Mouse Wheel` over the grid to adjust size on the fly.",
        primaryAction: { text: 'Finish' },
        onBeforeShow: () => { if (!appContext.uiManager.isMobile()) showView({ desktop: { type: 'popout', name: 'controls' } }); },
        advanceOn: { type: 'click' }
    }];

    const ruleset_actions = [{
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="rules"]' : '[data-tour-id="ruleset-actions-button"]',
        title: 'Tutorial: Ruleset Actions',
        content: "This panel is your laboratory for creating and discovering new rulesets. It allows you to generate, mutate, and load pre-existing rules.",
        primaryAction: { text: 'Open Panel' },
        condition: () => !isViewOpen({ desktop: { type: 'panel', name: 'rulesetactions' }, mobile: { view: 'rules' } }),
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === RulesetActionsComponent }
    }, {
        element: '[data-pane="generate"]',
        title: 'Generate',
        content: "Create entirely new laws of physics. <span class=\"onboarding-highlight-text\">R-Sym</span> (Rotational Symmetry) is often best for creating structured, organic patterns.",
        primaryAction: { text: 'Next' },
        onBeforeShow: (step) => { showView({ desktop: { type: 'panel', name: 'rulesetactions' }, mobile: { view: 'rules' } }); document.querySelector(step.element)?.click(); },
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
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="more"]' : '[data-tour-id="library-button"]',
        title: 'Tutorial: Ruleset Library',
        content: "Load pre-discovered rulesets from the curated <span class=\"onboarding-highlight-text\">Library</span>, your own saved rules, or paste a ruleset's hex code <span class=\"onboarding-highlight-text\">Directly</span>.",
        primaryAction: { text: 'Open Library' },
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
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="editor"]' : '[data-tour-id="edit-rule-button"]',
        title: 'Tutorial: The Ruleset Editor',
        content: "This is the most powerful tool in the lab. It lets you directly edit the 128 fundamental rules of your universe.",
        primaryAction: { text: 'Open Editor' },
        condition: () => !isViewOpen({ desktop: { type: 'panel', name: 'ruleset' }, mobile: { view: 'editor' } }),
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === RulesetEditorComponent }
    }, {
        element: () => (appContext.uiManager.isMobile() ? '#editor-mobile-view' : '#rulesetEditorPanel') + ' .r-sym-rule-viz',
        title: 'Toggling Outcomes',
        content: "The visualization shows a center cell and its six neighbors. The color of the <span class=\"onboarding-highlight-text\">inner-most hexagon</span> shows the rule's outcome. <span class=\"onboarding-highlight-text\">Simply click any rule</span> to flip its output state.",
        primaryAction: { text: 'Click any Rule' },
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'ruleset' }, mobile: { view: 'editor' } }),
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_EDITOR_SET_RULES_FOR_CANONICAL_REPRESENTATIVE }
    }, {
        element: '#ruleset-editor-mode',
        title: 'Analytical Lenses',
        content: "Change your 'lens' to view the rules differently. <span class=\"onboarding-highlight-text\">Rotational Symmetry</span> is great for understanding patterns, while <span class=\"onboarding-highlight-text\">Neighbor Count</span> groups rules by their local conditions.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }];
    
    const worldsetup = [{
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="worlds"]' : '[data-tour-id="setup-panel-button"]',
        title: 'Tutorial: World Setup',
        content: "Each of the nine universes can be configured independently. Open the <span class=\"onboarding-highlight-text\">World Setup</span> panel to manage them.",
        primaryAction: { text: 'Open Panel' },
        condition: () => !isViewOpen({ desktop: { type: 'panel', name: 'worldsetup' }, mobile: { view: 'worlds' } }),
        onBeforeShow: resetUIState,
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
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="analyze"]' : '[data-tour-id="analysis-panel-button"]',
        title: 'Tutorial: Analysis Tools',
        content: "Beyond watching patterns, you can measure them. Open the <span class=\"onboarding-highlight-text\">Analysis</span> panel to see live metrics for the selected world.",
        primaryAction: { text: 'Open Panel' },
        condition: () => !isViewOpen({ desktop: { type: 'panel', name: 'analysis' }, mobile: { view: 'analyze' } }),
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === AnalysisComponent }
    }, {
        element: '.plugins-mount-area',
        title: 'Live Metrics',
        content: "The <span class=\"onboarding-highlight-text\">Activity Ratio</span> plot tracks the share of living cells over time, and the <span class=\"onboarding-highlight-text\">Entropy</span> plot measures how ordered or chaotic the world is. Stable lines often mean the automaton has settled; oscillations hint at engines and cycles. Enable <span class=\"onboarding-highlight-text\">entropy sampling</span> inside the plot to start measuring.",
        primaryAction: { text: 'Finish' },
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'analysis' }, mobile: { view: 'analyze' } }),
        advanceOn: { type: 'click' }
    }];

    const rulerank = [{
        element: '[data-tour-id="rank-panel-button"]',
        title: 'Tutorial: Rule Usage Ranking',
        content: "Which of the 128 rules are doing the real work? Open the <span class=\"onboarding-highlight-text\">Rule Rank</span> panel to find out.",
        primaryAction: { text: 'Open Panel' },
        condition: () => !isViewOpen({ desktop: { type: 'panel', name: 'rulerank' } }),
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === RuleRankComponent }
    }, {
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
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="more"]' : '[data-tour-id="patterns-button"]',
        title: 'Tutorial: Patterns',
        content: "Copy and paste regions of cells, or capture a shape into your personal <span class=\"onboarding-highlight-text\">pattern library</span> and stamp it onto any world. <br><br>On mobile, find Patterns under the <span class=\"onboarding-highlight-text\">More</span> tab.",
        primaryAction: { text: 'Open Patterns' },
        condition: () => !isViewOpen({ desktop: { type: 'popout', name: 'patterns' }, mobile: { view: 'patterns' } }),
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === PatternsComponent }
    }, {
        element: '#patterns-copy-button',
        title: 'Copy & Paste a Region',
        content: "Click <span class=\"onboarding-highlight-text\">Copy Region</span>, then drag a box over active cells to grab them. <span class=\"onboarding-highlight-text\">Paste</span> drops the copy back onto the grid where you click. <br><br><b>Shortcuts:</b> <kbd>Ctrl</kbd>+<kbd>C</kbd> to copy a region, <kbd>Ctrl</kbd>+<kbd>V</kbd> to paste.",
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
        content: "Saved patterns live here. Hit the <span class=\"onboarding-highlight-text\">place</span> icon to stamp one onto the grid &mdash; you can keep stamping repeatedly, and press <kbd>R</kbd> to rotate the stamp by 60°. The trash icon deletes a pattern.",
        primaryAction: { text: 'Finish' },
        onBeforeShow: () => showView({ desktop: { type: 'popout', name: 'patterns' }, mobile: { view: 'patterns' } }),
        advanceOn: { type: 'click' }
    }];

    const explore = [{
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="more"]' : '[data-tour-id="explore-button"]',
        title: 'Tutorial: Auto-Explore',
        content: "Let the Explorer hunt for you. Auto-Explore searches all nine worlds for <span class=\"onboarding-highlight-text\">interesting rulesets</span> near the edge of chaos, scoring and breeding the best automatically. <br><br>On mobile, find it under the <span class=\"onboarding-highlight-text\">More</span> tab.",
        primaryAction: { text: 'Open Auto-Explore' },
        condition: () => !isViewOpen({ desktop: { type: 'panel', name: 'explore' }, mobile: { view: 'explore' } }),
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === ExploreComponent }
    }, {
        element: '.explore-run-buttons',
        title: 'Run the Search',
        content: "<span class=\"onboarding-highlight-text\">Start</span> begins the search; <span class=\"onboarding-highlight-text\">Pause</span>, <span class=\"onboarding-highlight-text\">Stop</span>, and <span class=\"onboarding-highlight-text\">Stop &amp; Keep</span> (which adopts the current champion into your selected world) end it. The status line above tracks the generation and best score.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'explore' }, mobile: { view: 'explore' } }),
        advanceOn: { type: 'click' }
    }, {
        element: '#explore-settings',
        title: 'Tune the Search',
        content: "Control the <span class=\"onboarding-highlight-text\">mutation rate &amp; mode</span>, ticks per evaluation, which <span class=\"onboarding-highlight-text\">initial conditions</span> each candidate is tested on, and a generation budget. The optional <span class=\"onboarding-highlight-text\">Perceptual novelty (CLIP)</span> toggle also scores finds on how they <i>look</i>.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'explore' }, mobile: { view: 'explore' } }),
        advanceOn: { type: 'click' }
    }, {
        element: '.explore-gallery-group',
        title: 'The Gallery',
        content: "Every interesting find collects here, best-first, with a per-component score breakdown. Use the per-find actions to <span class=\"onboarding-highlight-text\">apply</span> it to the selected world, re-test, <span class=\"onboarding-highlight-text\">save</span> it to your library, or <span class=\"onboarding-highlight-text\">share</span> a link.",
        primaryAction: { text: 'Finish' },
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'explore' }, mobile: { view: 'explore' } }),
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
        content: "New worlds start in calm <span class=\"onboarding-highlight-text\">Monochrome</span> &mdash; just on/off cells, nothing to overwhelm you. But color is HexLife's most powerful lens: it can reveal <span class=\"onboarding-highlight-text\">which of the 128 rules fired</span> in every cell. The <span class=\"onboarding-highlight-text\">Chroma Lab</span> is where you turn that lens on.",
        primaryAction: { text: 'Open Chroma Lab' },
        condition: () => !isViewOpen({ desktop: { type: 'panel', name: 'chromalab' } }),
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === ChromaLabComponent }
    }, {
        element: '#chroma-mode-select',
        title: 'Three Ways to Color',
        content: "This picks <i>what the color means</i>. <span class=\"onboarding-highlight-text\">Preset Palettes</span> are ready-made looks; <span class=\"onboarding-highlight-text\">Neighbor Count</span> colors each cell by how many living neighbors triggered it; <span class=\"onboarding-highlight-text\">Symmetry Groups</span> colors by the <i>shape</i> of rule that fired. We'll look at presets, then the powerful Symmetry view.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => { showView({ desktop: { type: 'panel', name: 'chromalab' } }); setChromaMode('preset'); },
        advanceOn: { type: 'click' }
    }, {
        element: '#chroma-preset-section',
        title: 'Preset Palettes',
        content: "Ready-made looks. <span class=\"onboarding-highlight-text\">Monochrome</span> (the default) keeps things quiet; <span class=\"onboarding-highlight-text\">Default Spectrum</span> gives every rule its own hue so structure pops. The <span class=\"onboarding-highlight-text\">Symmetry Groups</span> and <span class=\"onboarding-highlight-text\">Neighbor Counts</span> entries here are one-click shortcuts into the modes below. Keep <span class=\"onboarding-highlight-text\">flicker-proof presets</span> on for busy rulesets &mdash; your choice is saved automatically.",
        primaryAction: { text: 'Show me Symmetry Groups' },
        onBeforeShow: () => { showView({ desktop: { type: 'panel', name: 'chromalab' } }); setChromaMode('preset'); },
        advanceOn: { type: 'click' }
    }, {
        element: '#chroma-symmetry-section',
        title: 'Symmetry Groups &mdash; the big idea',
        content: "A cell has six neighbors, so many of the 128 rules are really the <i>same pattern rotated</i>. HexLife bundles each pattern with all its rotations into a <span class=\"onboarding-highlight-text\">symmetry group</span> &mdash; the little hex diagram shows the pattern and <span class=\"onboarding-highlight-text\">Orbit</span> is how many rotations belong to it. Color a group once and <i>every</i> rotation of it lights up the same, so the grid <span class=\"onboarding-highlight-text\">visually reveals which rule families your ruleset actually uses</span>. The <span class=\"onboarding-highlight-text\">Cell OFF / Cell ON</span> columns set the color for a dead vs. living center cell &mdash; click any swatch to recolor that whole family.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => { showView({ desktop: { type: 'panel', name: 'chromalab' } }); setChromaMode('symmetry'); },
        advanceOn: { type: 'click' }
    }, {
        element: '#chroma-mode-select',
        title: "You're in control of the lens",
        content: "That's the whole idea: color is a <i>lens</i> on the rules, not just decoration. We've set you back to the calm <span class=\"onboarding-highlight-text\">Monochrome</span> default &mdash; switch to <span class=\"onboarding-highlight-text\">Symmetry Groups</span> or <span class=\"onboarding-highlight-text\">Default Spectrum</span> from here whenever you want to see the machinery underneath.",
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
        element: '#undoButton',
        title: 'Undo & Redo',
        content: "These buttons step backward and forward through the history. <br><br><b>Shortcuts:</b> <span class=\"onboarding-highlight-text\">Ctrl+Z</span> to undo, <span class=\"onboarding-highlight-text\">Ctrl+Shift+Z</span> to redo.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }];

    const resetClear = [{
        element: '[data-tour-id="reset-clear-popout"]',
        title: 'Tutorial: Reset & Clear',
        content: 'These actions manage the state of the cells on the grid.',
        primaryAction: { text: 'Next' },
        onBeforeShow: () => { resetUIState(); showView({ desktop: {type: 'popout', name: 'resetClear'}, mobile: {view: 'simulate' /* No mobile equivalent yet */} }) },
        advanceOn: { type: 'click' }
    }, {
        element: '[data-tour-id="reset-clear-popout"] #resetAllButtonPopout',
        title: 'Reset Worlds',
        content: "<span class=\"onboarding-highlight-text\">Reset</span> re-seeds the grid with new random cells according to each world's configured density. It's like starting a new petri dish culture.",
        primaryAction: { text: 'Next' },
        advanceOn: { type: 'click' }
    }, {
        element: '[data-tour-id="reset-clear-popout"] #clearAllButtonPopout',
        title: 'Clear Worlds',
        content: "<span class=\"onboarding-highlight-text\">Clear</span> sets all cells to inactive (or active, if already clear). It's like sterilizing the dish before an experiment.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }];

    const saveLoad = [{
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="more"]' : '[data-tour-id="save-state-button"]',
        title: 'Tutorial: Save, Load & Share',
        content: 'Preserve your discoveries and share them with others.',
        primaryAction: { text: 'Next' },
        onBeforeShow: resetUIState,
        advanceOn: { type: 'click' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '[data-action="save"]' : '[data-tour-id="save-state-button"]',
        title: 'Save World State',
        content: "This saves the <span class=\"onboarding-highlight-text\">complete state</span> of the currently selected world—including its ruleset, cell states, and tick count—to a JSON file on your device.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'none' }, mobile: { view: 'more' } }),
        advanceOn: { type: 'click' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '[for="mobileFileInput"]' : '[data-tour-id="load-state-button"]',
        title: 'Load World State',
        content: "This loads a previously saved JSON file, restoring a world to its exact saved state, allowing you to continue an experiment.",
        primaryAction: { text: 'Next' },
        advanceOn: { type: 'click' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '[data-action="share"]' : '[data-tour-id="share-button"]',
        title: 'Share Setup',
        content: "This generates a <span class=\"onboarding-highlight-text\">unique URL</span> that encodes your current ruleset and camera position, perfect for sharing a cool discovery with others.",
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
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="more"]' : '[data-tour-id="library-button"]',
        title: 'Step 1: Get a Baseline',
        content: "Every experiment needs a starting point. Open the <span class=\"onboarding-highlight-text\">Ruleset Library</span> to load a known ruleset. <br><br>On mobile, find it under the <span class=\"onboarding-highlight-text\">More</span> tab.",
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
        content: "This ruleset produces interesting mobile patterns. Find it in the list and press <span class=\"onboarding-highlight-text\">'Load Ruleset'</span>. This will apply its laws to all nine universes and reset them.",
        //primaryAction: { text: 'Load the Ruleset' },
        onBeforeShow: (_step) => { document.querySelector(GLIDERS_LOAD_BTN)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_SET_RULESET }
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
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="worlds"]' : '[data-tour-id="setup-panel-button"]',
        title: 'Step 5: Control Your Variables',
        content: "For a good experiment, we need consistent starting conditions. Open the <span class=\"onboarding-highlight-text\">World Setup</span> panel.",
        //primaryAction: { text: 'Open World Setup' },
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === WorldSetupComponent }
    }, {
        element: '#minimap-guide',
        highlightType: 'canvas',
        title: 'Step 6: Focus on Central World',
        content: "If your main view is not focused on the central world (World 4), click on the central cell in the minimap below to select it.",
        condition: (appContext) => appContext.worldManager.getSelectedWorldIndex() !== 4,
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'worldsetup' }, mobile: { view: 'worlds' } }),
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED, condition: (worldIndex) => worldIndex === 4 }
    }, {
        element: () => '#world-setup-config-grid .world-config-cell:nth-child(5) [data-action="edit-state"]',
        title: "Step 7: Configure Central World's Random Fill",
        content: "Now click 'Edit...' for the central world (World 4) to open the initial state modal. In the modal, ensure <span class=\"onboarding-highlight-text\">'Random fill'</span> mode is selected and set the <span class=\"onboarding-highlight-text\">Fill amount</span> slider to 50% (or pick the <span class=\"onboarding-highlight-text\">'Balanced'</span> preset). Then save the changes.",
        //primaryAction: { text: 'Configure Density' },
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'worldsetup' }, mobile: { view: 'worlds' } }),
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_SET_WORLD_INITIAL_STATE, condition: (data) => (data.worldIndex === 4 && data.initialState?.mode === 'density' && data.initialState?.params?.density > 0.49 && data.initialState?.params?.density < 0.51) }
    }, {
        element: () => '#world-setup-panel-actions [data-action="apply-state-all"]',
        title: 'Step 8: Copy Selected &rarr; All',
        content: "Now click <span class=\"onboarding-highlight-text\">'Copy Selected &rarr; All'</span> to set the same 50% Random fill configuration across all worlds, creating a level playing field for our mutations.",
        // Re-assert the panel so the button is present and gets highlighted.
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'worldsetup' }, mobile: { view: 'worlds' } }),
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_APPLY_SELECTED_INITIAL_STATE_TO_ALL }
    }, {
        element: () => '#world-setup-panel-actions [data-action="reset-all-worlds"]',
        title: 'Step 9: Reset Worlds',
        content: "Finally, click <span class=\"onboarding-highlight-text\">'Regenerate All Worlds'</span> to re-seed all worlds with the new initial Random fill settings.",
        onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'worldsetup' }, mobile: { view: 'worlds' } }),
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES }
    }, {
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="rules"]' : '[data-tour-id="ruleset-actions-button"]',
        title: 'Step 10: Prepare for Mutation',
        content: "It's time to evolve our ruleset. Open the <span class=\"onboarding-highlight-text\">Ruleset Actions</span> panel again.",
        //primaryAction: { text: 'Open Ruleset Actions' },
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === RulesetActionsComponent }
    }, {
        element: '[data-pane="mutate"]',
        title: 'Step 11: Access the DNA Splicer',
        content: "Select the <span class=\"onboarding-highlight-text\">Mutate</span> tab.",
        // Same as Step 2: skip when Mutate is already the active tab, otherwise
        // advance on the user clicking the highlighted tab itself.
        condition: () => !document.querySelector('[data-pane="mutate"]')?.classList.contains('active'),
        onBeforeShow: () => showView({ desktop: {type: 'panel', name: 'rulesetactions'}, mobile: {view: 'rules'} }),
        advanceOn: { type: 'click', target: 'element' }
    }, {
        // Highlight the whole mutate pane (not just the button) so the rate
        // slider and mode radios are inside the interactive hole — the spotlight
        // is modal, so a button-only highlight blocked the user from adjusting them.
        element: () => '#ruleset-actions-mutate-pane',
        title: 'Step 12: Run the Experiment',
        content: "We've preset the recommended <span class=\"onboarding-highlight-text\">R-Sym</span> mode and a <span class=\"onboarding-highlight-text\">~10% Mutation Rate</span> &mdash; the sweet spot for evolving structured rules. Tweak them if you like, then press <span class=\"onboarding-highlight-text\">Clone &amp; Mutate</span> to copy our 'Gliders' ruleset to all nine worlds and mutate each copy uniquely.",
        onBeforeShow: () => {
            showView({ desktop: {type: 'panel', name: 'rulesetactions'}, mobile: {view: 'rules'} });
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
        title: 'Step 13: Observe and Select',
        content: "The experiment is running! Each world is now a slightly different version of the original. <span class=\"onboarding-highlight-text\">Observe the minimap and select a world</span> that looks interesting to you.",
        onBeforeShow: () => { showView({ mobile: {view: 'simulate'} }); },
        //primaryAction: { text: 'Select a World' },
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED },
        delayAfter: 800
    }, {
        element: '[data-tour-id="ruleset-actions-button"]',
        title: 'Step 14: Evolve Again!',
        condition: (appContext) => !appContext.uiManager.isMobile(),
        content: "You've selected a promising new specimen. Let's make it the basis for the next generation. Open the <span class=\"onboarding-highlight-text\">Ruleset Actions</span> panel and press <span class=\"onboarding-highlight-text\">Clone & Mutate</span> again to evolve from your new selection. <br><br>Pro-tip: Press <span class=\"onboarding-highlight-text\">'M'</span> to quickly Clone & Mutate again.",
        primaryAction: { text: 'Finish Mission' },
        advanceOn: { type: 'click' }
    }, {
        element: '[title="Clone & Mutate"]',
        title: 'Step 14: Evolve Again!',
        condition: (appContext) => appContext.uiManager.isMobile(),
        content: "You've selected a promising new specimen. Let's make it the basis for the next generation. Use this <span class=\"onboarding-highlight-text\">Quick Action Button</span> to quickly <span class=\"onboarding-highlight-text\">Clone & Mutate</span> again.",
        primaryAction: { text: 'Finish Mission' },
        advanceOn: { type: 'click' }
    },
];

    const personal_library = [{
        element: 'body',
        title: 'Mission: Chronicle Your Discoveries',
        content: "You've created a unique universe! This mission teaches you how to save its ruleset to your personal library so you never lose it.",
        primaryAction: { text: 'Begin Mission' },
        onBeforeShow: resetUIState,
        advanceOn: { type: 'click' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '[data-action="save-ruleset-mobile"]' : '#saveRulesetButton',
        title: 'Step 1: Save the Ruleset',
        content: "This star icon (<span class=\"inline-icon\">" + ICONS.star + "</span>) shows the status of the current ruleset. Since it's an outline, it's unsaved. Click the <span class=\"onboarding-highlight-text\">Save button</span> to add it to your personal collection.",
        primaryAction: { text: 'Click the Star' },
        onBeforeShow: () => {
            if (appContext.uiManager.isMobile()) {
                showView({ mobile: { view: 'more' } });
            }
        },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_SHOW_SAVE_RULESET_MODAL }
    }, {
        element: '#save-ruleset-modal',
        title: 'Step 2: Name Your Creation',
        content: "Every great discovery deserves a name. Give your ruleset a memorable <span class=\"onboarding-highlight-text\">Name</span> and an optional description.",
        primaryAction: { text: 'Save It!' },
        advanceOn: { type: 'event', eventName: EVENTS.USER_RULESET_SAVED }
    }, {
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="more"]' : '[data-tour-id="library-button"]',
        title: 'Step 3: Visit Your Library',
        content: "Excellent! The star is now gold, indicating you've saved it. Let's see your collection. Open the <span class=\"onboarding-highlight-text\">Ruleset Library</span>. <br><br>On mobile, find it under the <span class=\"onboarding-highlight-text\">More</span> tab.",
        primaryAction: { text: 'Open Library' },
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType === RulesetLibraryComponent }
    }, {
        element: '[data-library-filter="personal"]',
        title: 'Step 4: View Your Rulesets',
        content: "The library contains both public and personal rules. <span class=\"onboarding-highlight-text\">Click on 'My Rulesets'</span> to see your saved creations.",
        // Skip if already on the personal filter; otherwise advance on the user
        // clicking the highlighted 'My Rulesets' sub-tab itself (not a separate
        // button), so the step's instruction matches what actually advances it.
        condition: () => !document.querySelector('[data-library-filter="personal"]')?.classList.contains('active'),
        onBeforeShow: () => {
            showView({ desktop: {type: 'panel', name: 'library'}, mobile: {view: 'library'} });
            document.querySelector('[data-pane="library"]')?.click();
        },
        advanceOn: { type: 'click', target: 'element' }
    }, {
        element: '.library-item.personal [data-action="manage-personal"]',
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
        element: '#minimap-guide',
        highlightType: 'canvas',
        title: 'Step 1: Mutate',
        content: "Press <span class=\"onboarding-highlight-text\">M</span> to run <b>Clone &amp; Mutate</b>: the selected world's ruleset is copied into all nine worlds, then each copy is nudged by a small random mutation. <br><br>On mobile, tap the <span class=\"onboarding-highlight-text\">Clone &amp; Mutate</span> quick-action button. Watch the minimap &mdash; all nine worlds change at once.",
        onBeforeShow: () => { showView({ mobile: { view: 'simulate' } }); },
        // Let the freshly-mutated grid render before advancing — all nine worlds
        // change at once and that change is the whole point of the step.
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_CLONE_AND_MUTATE },
        delayAfter: 1000
    }, {
        element: '#minimap-guide',
        highlightType: 'canvas',
        title: 'Step 2: Observe & Select',
        content: "Each of the nine worlds now runs a slightly different ruleset. Scan them and <span class=\"onboarding-highlight-text\">click the world that looks most alive</span> to you &mdash; the busiest, the most structured, the strangest. That choice is your selection pressure.",
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED },
        delayAfter: 800
    }, {
        element: '#minimap-guide',
        highlightType: 'canvas',
        title: 'Step 3: Repeat',
        content: "Now press <span class=\"onboarding-highlight-text\">M</span> again. Your chosen world becomes the new parent, and nine fresh mutations of <i>it</i> fill the grid. Do this a few times and you're breeding rulesets &mdash; each generation drifts toward whatever you keep picking.",
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_CLONE_AND_MUTATE },
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
        element: 'body',
        title: 'Switch to Draw Mode',
        condition: (appContext) => appContext.uiManager.isMobile(),
        content: "On mobile you paint cells in draw mode. <span class=\"onboarding-highlight-text\">Tap the hand icon (&#128075;)</span> to switch to draw mode, then continue. <br><br>On desktop you're already in draw mode.",
        primaryAction: { text: 'Continue' },
        advanceOn: { type: 'click' }
    }, {
        element: '#selected-world-guide',
        highlightType: 'canvas',
        title: 'Step 1: Seed a Spark',
        content: "<span class=\"onboarding-highlight-text\">Click and drag (or touch and drag)</span> on the main view to paint living cells onto the blank grid. A small cluster is plenty &mdash; the rules do the rest.",
        // Brush event fires on the first cell — hold so the seeded cluster is visible.
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH },
        delayAfter: 1200
    }, {
        element: () => appContext.uiManager.isMobile() ? '#mobilePlayPauseButton' : '[data-tour-id="play-pause-button"]',
        title: 'Step 2: Start Time',
        content: "Now press <span class=\"onboarding-highlight-text\">P</span> (or the Play button) to start the universal clock and watch your spark evolve under the current ruleset.",
        condition: (appContext) => appContext.simulationController.getIsPaused(),
        // Linger so the spark visibly begins to evolve before the closing step.
        advanceOn: { type: 'event', eventName: EVENTS.SIMULATION_PAUSED, condition: (isPaused) => !isPaused },
        delayAfter: 1500
    }, {
        element: 'body',
        title: 'State + Rules = Behavior',
        content: "That's the foundation: the cells you drew are the <span class=\"onboarding-highlight-text\">state</span>, and the ruleset decides how that state changes each tick. Try clearing again (<span class=\"onboarding-highlight-text\">C</span>) and seeding a different shape &mdash; the same rules can treat it completely differently.",
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