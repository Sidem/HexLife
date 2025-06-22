import { EventBus, EVENTS } from '../services/EventBus.js';

// Import component classes for content-aware tour logic, a robust pattern.
import { RulesetActionsComponent } from './components/RulesetActionsComponent.js';
import { AnalysisComponent } from './components/AnalysisComponent.js';
import { RulesetEditorComponent } from './components/RulesetEditorComponent.js';
import { WorldSetupComponent } from './components/WorldSetupComponent.js';
import { ControlsComponent } from './components/ControlsComponent.js';

/**
 * Provides the tour definitions for the application's onboarding process.
 * This unified structure uses functional steps to adapt to both desktop and mobile UI contexts.
 * @param {AppContext} appContext - The central application context.
 * @returns {object} A collection of all defined tours.
 */
export const getTours = (appContext) => {

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
     * Helper to show the correct view for a tour step.
     * @param {{desktop: {type: 'panel'|'popout', name: string}, mobile: {view: string}}} config
     */
    const showView = (config) => {
        if (appContext.uiManager.isMobile()) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: config.mobile.view });
            if(!config.desktop) return;
        } else {
            const event = config.desktop.type === 'panel' ? EVENTS.COMMAND_TOGGLE_PANEL : EVENTS.COMMAND_TOGGLE_POPOUT;
            const key = config.desktop.type === 'panel' ? 'panelName' : 'popoutName';
            EventBus.dispatch(event, { [key]: config.desktop.name, show: true });
        }
    };
    
    // ==========================================================================================
    // == CORE TOUR
    // ==========================================================================================
    const core = [{
        element: 'body',
        title: 'Welcome to the HexLife Explorer',
        content: "You've arrived at the HexLife Observatory. Before you lie nine parallel universes, each waiting for a spark of life. Your mission: to discover the rules that govern them.",
        primaryAction: { text: 'Begin Orientation' },
        onBeforeShow: resetUIState,
        advanceOn: { type: 'click' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '#mobilePlayPauseButton' : '[data-tour-id="play-pause-button"]',
        title: 'The Flow of Time',
        content: "Time is currently frozen. Use the <span class=\"onboarding-highlight-text\">Play/Pause button</span> to start and stop the universal clock. Let's see what these worlds are currently doing.",
        primaryAction: { text: 'Click the Play Button' },
        advanceOn: { type: 'event', eventName: EVENTS.SIMULATION_PAUSED, condition: (isPaused) => !isPaused }
    }, {
        element: '#minimap-guide',
        highlightType: 'canvas',
        title: 'The Observation Deck',
        content: "Your main viewer is focused on one universe, while the mini-map shows all nine. This is perfect for comparing experiments. <span class=\"onboarding-highlight-text\">Click any mini-map view</span> to shift your focus.",
        primaryAction: { text: 'Select a Different World' },
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED }
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
        primaryAction: { text: 'Try Drawing on the Grid' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH }
    }, {
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="learning"]' : '#helpButton',
        title: 'Your Lab Assistant',
        content: "Excellent. For every other tool, look for the <span class=\"onboarding-highlight-text\">[?]</span> help icon for a specific guide. Use this main <span class=\"onboarding-highlight-text\">Help/Learn button</span> to restart this orientation at any time. Good luck, Researcher.",
        primaryAction: { text: 'Begin My Research' },
        advanceOn: { type: 'click' }
    }];

    // ==========================================================================================
    // == CONTROLS TOUR
    // ==========================================================================================
    const controls = [{
        element: () => appContext.uiManager.isMobile() ? '#mobileToolsFab' : '[data-tour-id="controls-button"]',
        title: 'Tutorial: Simulation Controls',
        content: "This menu contains global controls for simulation speed, brush size, and interaction preferences.",
        primaryAction: { text: 'Open Controls' },
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType.name === "ControlsComponent" }
    }, {
        element: '[id*="controls-speed-slider"]',
        title: 'Simulation Speed',
        content: "Adjust the target <span class=\"onboarding-highlight-text\">Ticks Per Second (TPS)</span> for all worlds. Higher values run the simulation faster.",
        primaryAction: { text: 'Next' },
        advanceOn: { type: 'click' }
    }, {
        element: '[id*="controls-brush-slider"]',
        title: 'Brush Size',
        content: "Adjust the size of your drawing brush. <br><br><b>Desktop Pro-Tip:</b> Use `Ctrl + Mouse Wheel` over the grid to adjust size on the fly.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }];

    // ==========================================================================================
    // == RULESET ACTIONS TOUR
    // ==========================================================================================
    const ruleset_actions = [{
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="rules"]' : '[data-tour-id="ruleset-actions-button"]',
        title: 'Tutorial: Ruleset Actions',
        content: "This panel is your laboratory for creating and discovering new rulesets. It allows you to generate, mutate, and load pre-existing rules.",
        primaryAction: { text: 'Open Panel' },
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType.name === "RulesetActionsComponent" }
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
        primaryAction: { text: 'Next' },
        onBeforeShow: (step) => { document.querySelector(step.element)?.click(); },
        advanceOn: { type: 'click' }
    }, {
        element: '[data-pane="library"]',
        title: 'Library',
        content: "Load pre-discovered rulesets or place well-known patterns (like a 'Glider') onto the grid.",
        primaryAction: { text: 'Finish' },
        onBeforeShow: (step) => { document.querySelector(step.element)?.click(); },
        advanceOn: { type: 'click' }
    }];

    // ==========================================================================================
    // == EDITOR TOUR
    // ==========================================================================================
    const editor = [{
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="editor"]' : '[data-tour-id="edit-rule-button"]',
        title: 'Tutorial: The Ruleset Editor',
        content: "This is the most powerful tool in the lab. It lets you directly edit the 128 fundamental rules of your universe.",
        primaryAction: { text: 'Open Editor' },
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType.name === "RulesetEditorComponent" }
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
    
    // ==========================================================================================
    // == NEW: RESET / CLEAR TOUR
    // ==========================================================================================
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

    // ==========================================================================================
    // == NEW: SAVE / LOAD TOUR
    // ==========================================================================================
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

    // ==========================================================================================
    // == REVISED: APPLIED EVOLUTION
    // ==========================================================================================
    const appliedEvolution = [{
        element: 'body',
        title: 'Mission: Applied Evolution',
        content: "This mission will guide you through a full experiment to discover a new ruleset using the core tools of the Explorer.",
        primaryAction: { text: 'Start Mission' },
        onBeforeShow: resetUIState,
        advanceOn: { type: 'click' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="rules"]' : '[data-tour-id="ruleset-actions-button"]',
        title: 'Step 1: Get a Baseline',
        content: "Every experiment needs a starting point. Open the <span class=\"onboarding-highlight-text\">Ruleset Actions</span> panel to access the library.",
        primaryAction: { text: 'Open Ruleset Actions' },
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType.name === "RulesetActionsComponent" }
    }, {
        element: '[data-pane="library"]',
        title: 'Step 2: Open the Library',
        content: "Now, select the <span class=\"onboarding-highlight-text\">Library</span> tab within the panel.",
        primaryAction: { text: 'Select Library Tab' },
        onBeforeShow: (step) => { showView({ desktop: {type: 'panel', name: 'rulesetactions'}, mobile: {view: 'rules'} }); setTimeout(() => document.querySelector(step.element)?.click(), 100) },
        advanceOn: { type: 'click' }
    }, {
        element: '#ruleset-actions-library-rulesets-content .library-item-mobile:nth-child(10) .button',
        title: "Step 3: Load 'Spontaneous Gliders'",
        content: "This ruleset produces interesting mobile patterns. Find it in the list and press <span class=\"onboarding-highlight-text\">'Load Ruleset'</span>. This will apply its laws to all nine universes and reset them.",
        primaryAction: { text: 'Load the Ruleset' },
        onBeforeShow: (step) => { document.querySelector(step.element)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_SET_RULESET }
    }, {
        element: () => appContext.uiManager.isMobile() ? '#mobilePlayPauseButton' : '[data-tour-id="play-pause-button"]',
        title: 'Step 4: Observe',
        content: "Start the simulation to see the 'Gliders' ruleset in action.",
        condition: (appContext) => appContext.simulationController.getState().isPaused,
        primaryAction: { text: 'Press Play' },
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.SIMULATION_PAUSED, condition: (isPaused) => !isPaused },
        delayAfter: 2000
    }, {
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="worlds"]' : '[data-tour-id="setup-panel-button"]',
        title: 'Step 5: Control Your Variables',
        content: "For a good experiment, we need consistent starting conditions. Open the <span class=\"onboarding-highlight-text\">World Setup</span> panel.",
        primaryAction: { text: 'Open World Setup' },
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType.name === "WorldSetupComponent" }
    }, {
        element: () => '#world-setup-config-grid .world-config-cell:nth-child(5) .density-control',
        title: 'Step 6: Set Initial Density',
        content: "Let's test this ruleset in a denser environment. <span class=\"onboarding-highlight-text\">Set the density for the central world to 50%.</span>",
        primaryAction: { text: 'Set Density' },
         onBeforeShow: () => showView({ desktop: { type: 'panel', name: 'worldsetup' }, mobile: { view: 'worlds' } }),
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_SET_WORLD_INITIAL_DENSITY, condition: (data) => (data.worldIndex === 4 && data.density > 0.49 && data.density < 0.51) }
    }, {
        element: () => '#world-setup-panel-actions [data-action="apply-density-all"]',
        title: 'Step 7: Apply to All Worlds',
        content: "Now apply this 50% density to all worlds to create a level playing field for our mutations.",
        primaryAction: { text: 'Apply Density to All' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_APPLY_SELECTED_DENSITY_TO_ALL }
    }, {
        element: () => '#world-setup-panel-actions [data-action="reset-all-worlds"]',
        title: 'Step 8: Reset Worlds',
        content: "Finally, reset all worlds to apply the new density settings.",
        primaryAction: { text: 'Apply & Reset All' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES }
    }, {
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="rules"]' : '[data-tour-id="ruleset-actions-button"]',
        title: 'Step 9: Prepare for Mutation',
        content: "It's time to evolve our ruleset. Open the <span class=\"onboarding-highlight-text\">Ruleset Actions</span> panel again.",
        primaryAction: { text: 'Open Ruleset Actions' },
        onBeforeShow: resetUIState,
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType.name === "RulesetActionsComponent" }
    }, {
        element: '[data-pane="mutate"]',
        title: 'Step 10: Access the DNA Splicer',
        content: "Select the <span class=\"onboarding-highlight-text\">Mutate</span> tab.",
        primaryAction: { text: 'Select Mutate Tab' },
        onBeforeShow: (step) => { showView({ desktop: {type: 'panel', name: 'rulesetactions'}, mobile: {view: 'rules'} }); setTimeout(() => document.querySelector(step.element)?.click(), 100) },
        advanceOn: { type: 'click' }
    }, {
        element: () => '#ruleset-actions-mutate-pane button[data-action="clone-mutate"]',
        title: 'Step 11: Run the Experiment',
        content: "Press <span class=\"onboarding-highlight-text\">Clone & Mutate</span>. This copies our 'Gliders' ruleset to all nine worlds and applies a unique, small mutation to each. Make sure the <span class=\"onboarding-highlight-text\">Mutation Rate is ~10%</span> and <span class=\"onboarding-highlight-text\">Mode is R-Sym</span> for best results.",
        primaryAction: { text: 'Clone & Mutate' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_CLONE_AND_MUTATE }
    }, {
        element: '#minimap-guide',
        highlightType: 'canvas',
        title: 'Step 12: Observe and Select',
        content: "The experiment is running! Each world is now a slightly different version of the original. <span class=\"onboarding-highlight-text\">Observe the minimap and select a world</span> that looks interesting to you.",
        onBeforeShow: () => { showView({ mobile: {view: 'simulate'} }); },
        primaryAction: { text: 'Select a World' },
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED }
    }, {
        element: '[data-tour-id="ruleset-actions-button"]',
        title: 'Step 13: Evolve Again!',
        condition: (appContext) => !appContext.uiManager.isMobile(),
        content: "You've selected a promising new specimen. Let's make it the basis for the next generation. Open the <span class=\"onboarding-highlight-text\">Ruleset Actions</span> panel and press <span class=\"onboarding-highlight-text\">Clone & Mutate</span> again to evolve from your new selection. <br><br>Pro-tip: Press <span class=\"onboarding-highlight-text\">'M'</span> to quickly Clone & Mutate again.",
        primaryAction: { text: 'Finish Mission' },
        advanceOn: { type: 'click' }
    }, {
        element: '[title="Clone & Mutate"]',
        title: 'Step 13: Evolve Again!',
        condition: (appContext) => appContext.uiManager.isMobile(),
        content: "You've selected a promising new specimen. Let's make it the basis for the next generation. Use this <span class=\"onboarding-highlight-text\">Quick Action Button</span> to quickly <span class=\"onboarding-highlight-text\">Clone & Mutate</span> again.",
        primaryAction: { text: 'Finish Mission' },
        advanceOn: { type: 'click' }
    },
];

    // ==========================================================================================
    // == PERSONAL LIBRARY TOUR
    // ==========================================================================================
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
        content: "This star icon (⭐) shows the status of the current ruleset. Since it's dim, it's unsaved. Click the <span class=\"onboarding-highlight-text\">Save button</span> to add it to your personal collection.",
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
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="rules"]' : '[data-tour-id="ruleset-actions-button"]',
        title: 'Step 3: Visit Your Library',
        content: "Excellent! The star is now gold, indicating you've saved it. Let's see your collection. Open the <span class=\"onboarding-highlight-text\">Ruleset Actions</span> panel.",
        primaryAction: { text: 'Open Panel' },
        advanceOn: { type: 'event', eventName: EVENTS.VIEW_SHOWN, condition: (data) => data.contentComponentType.name === "RulesetActionsComponent" }
    }, {
        element: '[data-library-filter="personal"]',
        title: 'Step 4: View Your Rulesets',
        content: "The library contains both public and personal rules. <span class=\"onboarding-highlight-text\">Click on 'My Rulesets'</span> to see your saved creations.",
        primaryAction: { text: 'Click My Rulesets' },
        onBeforeShow: (step) => {
            showView({ desktop: {type: 'panel', name: 'rulesetactions'}, mobile: {view: 'rules'} });
            setTimeout(() => { document.querySelector('[data-pane="library"]')?.click(); }, 150);
        },
        advanceOn: { type: 'click' }
    }, {
        element: '.library-item.personal [data-action="manage-personal"]',
        title: 'Step 5: Manage & Share',
        content: "From here, you can <span class=\"onboarding-highlight-text\">Load</span> your ruleset back into the simulator, or use the <span class=\"onboarding-highlight-text\">'...' menu</span> to Rename, Delete, or Share it.",
        primaryAction: { text: 'Mission Complete!' },
        advanceOn: { type: 'click' }
    }];


    return {
        core,
        controls,
        ruleset_actions,
        editor,
        appliedEvolution,
        resetClear,
        saveLoad,
        personal_library
    };
};