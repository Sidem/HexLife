import { EventBus, EVENTS } from '../services/EventBus.js';

/**
 * Provides the tour definitions for the application's onboarding process.
 * This unified structure uses functional steps to adapt to both desktop and mobile UI contexts.
 * @param {AppContext} appContext - The central application context.
 * @returns {object} A collection of all defined tours.
 */
export const getTours = (appContext) => {

    /**
     * A helper function to ensure a consistent state before starting any tour.
     * Hides all panels and popouts.
     */
    const resetUIState = () => {
        EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
        if (appContext.uiManager.isMobile()) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'simulate' });
        }
    };

    /**
     * Core Tour: The main introduction to the application.
     */
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
        advanceOn: { type: 'event', eventName: EVENTS.SIMULATION_PAUSED, condition: (data) => !data }
    }, {
        element: '#minimap-guide',
        highlightType: 'canvas',
        title: 'The Focal Point',
        content: "Your main viewer is focused on one universe, while the mini-map shows all nine. This is perfect for comparing experiments. <span class=\"onboarding-highlight-text\">Click on any mini-map view</span> to shift your focus.",
        primaryAction: { text: 'Select a Different World' },
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED }
    }, {
        element: () => appContext.uiManager.isMobile() ? '#interaction-mode-toggle' : 'body',
        title: 'The Spark of Creation',
        content: () => "The most direct way to influence a universe is by seeding it with life." + (appContext.uiManager.isMobile() ? " First, <span class=\"onboarding-highlight-text\">tap the hand icon</span> to switch to Draw Mode." : " The simulation will pause automatically when you begin to draw."),
        condition: () => appContext.uiManager.isMobile(),
        primaryAction: { text: 'Switch to Draw Mode' },
        advanceOn: { type: 'event', eventName: EVENTS.INTERACTION_MODE_CHANGED, condition: (mode) => mode === 'draw' }
    }, {
        element: '#selected-world-guide',
        highlightType: 'canvas',
        title: 'Draw on the Grid',
        content: "Now you're in Draw Mode. <span class=\"onboarding-highlight-text\">Click and drag (or touch and drag)</span> on the main view to bring cells to life.",
        primaryAction: { text: 'Try Drawing on the Grid' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH }
    }, {
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="learning"]' : '#helpButton',
        title: 'Your Lab Assistant',
        content: "You now have the core skills. For every other tool, look for the <span class=\"onboarding-highlight-text\">[?]</span> help icon for a specific guide. Use this main <span class=\"onboarding-highlight-text\">Help/Learn button</span> to restart this orientation at any time. Good luck.",
        primaryAction: { text: 'Begin My Research' },
        advanceOn: { type: 'click' }
    }];

    const controls = [{
        element: () => appContext.uiManager.isMobile() ? '#mobileToolsFab' : '[data-tour-id="controls-button"]',
        title: 'Simulation Controls',
        content: "This menu contains controls for simulation speed and brush size.",
        primaryAction: { text: 'Open Controls' },
        onBeforeShow: resetUIState,
        advanceOn: { type: 'click' }
    }, {
        element: () => `#${appContext.uiManager.isMobile() ? 'mobile' : 'desktop'}-speed-slider-mount`,
        title: 'Simulation Speed',
        content: "Adjust the target <span class=\"onboarding-highlight-text\">Ticks Per Second (TPS)</span> for all worlds. Higher values run the simulation faster.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => {
             if (appContext.uiManager.isMobile()) {
                EventBus.dispatch(EVENTS.BOTTOM_SHEET_SHOWN, {});
            } else {
                EventBus.dispatch(EVENTS.COMMAND_TOGGLE_POPOUT, { popoutName: 'controls', show: true });
            }
        },
        advanceOn: { type: 'click' }
    }, {
        element: () => `#${appContext.uiManager.isMobile() ? 'mobile' : 'desktop'}-brush-slider-mount`,
        title: 'Brush Size',
        content: "Adjust the size of the drawing brush. <span class=\"onboarding-highlight-text\">Desktop Pro-Tip:</span> Use `Ctrl + Mouse Wheel` on the grid to adjust size on the fly.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }];

    const ruleset_actions = [{
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="rules"]' : '[data-tour-id="ruleset-actions-button"]',
        title: 'Ruleset Actions',
        content: "This panel is your laboratory for creating and discovering new rulesets. It allows you to generate, mutate, and load pre-existing rules.",
        primaryAction: { text: 'Open Panel' },
        onBeforeShow: resetUIState,
        advanceOn: { type: 'click' }
    }, {
        element: () => `#${appContext.uiManager.isMobile() ? 'mobile' : 'desktop'}-generate-tab`,
        title: 'Generate',
        content: "Create entirely new laws of physics. <span class=\"onboarding-highlight-text\">R-Sym</span> (Rotational Symmetry) is often best for creating structured patterns.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => {
            if (appContext.uiManager.isMobile()) {
                EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'rules' });
            } else {
                EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'rulesetActions', show: true });
            }
        },
        advanceOn: { type: 'click' }
    }, {
        element: () => `#${appContext.uiManager.isMobile() ? 'mobile' : 'desktop'}-mutate-tab`,
        title: 'Mutate',
        content: "Introduce small, random changes to an existing ruleset to evolve it. The <span class=\"onboarding-highlight-text\">Clone & Mutate</span> action is a powerful way to run parallel experiments.",
        primaryAction: { text: 'Next' },
        onBeforeShow: (step) => { document.querySelector(step.element())?.click() },
        advanceOn: { type: 'click' }
    }, {
        element: () => `#${appContext.uiManager.isMobile() ? 'mobile' : 'desktop'}-library-tab`,
        title: 'Library',
        content: "Load pre-discovered rulesets or place well-known patterns (like 'Glider') onto the grid.",
        primaryAction: { text: 'Finish' },
        onBeforeShow: (step) => { document.querySelector(step.element())?.click() },
        advanceOn: { type: 'click' }
    }];

    const editor = [{
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="editor"]' : '[data-tour-id="edit-rule-button"]',
        title: 'The Ruleset Editor',
        content: "This is the most powerful tool in the lab. It lets you directly edit the 128 fundamental rules of your universe.",
        primaryAction: { text: 'Open Editor' },
        onBeforeShow: resetUIState,
        advanceOn: { type: 'click' }
    }, {
        element: () => (appContext.uiManager.isMobile() ? '#editor-mobile-view' : '#rulesetEditorPanel') + ' .r-sym-rule-viz',
        title: 'Toggling Outcomes',
        content: "The visualization shows a center cell and its six neighbors. The color of the <span class=\"onboarding-highlight-text\">inner-most hexagon</span> shows the rule's outcome. <span class=\"onboarding-highlight-text\">Simply click any rule</span> to flip its output state.",
        primaryAction: { text: 'Click any Rule' },
        onBeforeShow: () => {
            if (appContext.uiManager.isMobile()) {
                EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'editor' });
            } else {
                EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'rulesetEditor', show: true });
            }
        },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_EDITOR_SET_RULES_FOR_CANONICAL_REPRESENTATIVE }
    }, {
        element: () => `#${appContext.uiManager.isMobile() ? 'mobile' : 'desktop'}-rulesetEditorMode`,
        title: 'Analytical Lenses',
        content: "Change your 'lens' to view the rules differently. <span class=\"onboarding-highlight-text\">Rotational Symmetry</span> is great for understanding patterns, while <span class=\"onboarding-highlight-text\">Neighbor Count</span> groups rules by their local conditions.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }];

    /**
     * Applied Evolution Tour: A complete, guided workflow for discovering a new ruleset.
     */
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
        advanceOn: { type: 'click' }
    }, {
        element: () => appContext.uiManager.isMobile() ? '#mobile-library-tab' : '#desktop-library-tab',
        title: 'Step 2: Open the Library',
        content: "Now, select the <span class=\"onboarding-highlight-text\">Library</span> tab within the panel.",
        primaryAction: { text: 'Select Library Tab' },
        onBeforeShow: () => {
            // This ensures the panel is open before the step is shown
            if (!appContext.uiManager.isMobile()) {
                EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'rulesetActions', show: true });
            } else {
                 EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'rules' });
            }
        },
        advanceOn: { type: 'click' }
    }, {
        element: () => (appContext.uiManager.isMobile() ? '#mobile' : '#desktop') + '-library-rulesets-content .library-item-mobile:nth-child(10) .button',
        title: "Step 3: Load 'Spontaneous Gliders'",
        content: "This ruleset produces interesting mobile patterns. Tap <span class=\"onboarding-highlight-text\">'Load'</span>. This will apply its laws to all nine universes and reset them.",
        primaryAction: { text: 'Load the Ruleset' },
        onBeforeShow: (step) => {
            const targetElement = document.querySelector(step.element());
            targetElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_SET_RULESET }
    }, {
        element: () => appContext.uiManager.isMobile() ? '#mobilePlayPauseButton' : '[data-tour-id="play-pause-button"]',
        title: 'Step 4: Observe',
        content: "Start the simulation to see the 'Gliders' ruleset in action.",
        primaryAction: { text: 'Press Play' },
        advanceOn: { type: 'event', eventName: EVENTS.SIMULATION_PAUSED, condition: (isPaused) => !isPaused },
        delayAfter: 2000
    }, {
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="worlds"]' : '[data-tour-id="setup-panel-button"]',
        title: 'Step 5: Control Your Variables',
        content: "For a good experiment, we need consistent starting conditions. Open the <span class=\"onboarding-highlight-text\">World Setup</span> panel.",
        primaryAction: { text: 'Open World Setup' },
        advanceOn: { type: 'click' }
    }, {
        element: () => `#${appContext.uiManager.isMobile() ? 'mobile' : 'desktop'}-world-config-grid .world-config-cell:first-child .density-control`,
        title: 'Step 6: Set Initial Density',
        content: "Let's test this ruleset in a denser environment. <span class=\"onboarding-highlight-text\">Set the density for the first world to 50%.</span>",
        primaryAction: { text: 'Set Density' },
         onBeforeShow: () => {
            if (appContext.uiManager.isMobile()) {
                EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'worlds' });
            } else {
                EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'worldSetup', show: true });
            }
        },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_SET_WORLD_INITIAL_DENSITY, condition: (data) => (data.worldIndex === 0 && data.density > 0.49 && data.density < 0.51) }
    }, {
        element: () => `#${appContext.uiManager.isMobile() ? 'mobile' : 'desktop'}-panel-actions button[data-action="apply-density-all"]`,
        title: 'Step 7: Apply to All Worlds',
        content: "Now apply this 50% density to all worlds to create a level playing field for our mutations.",
        primaryAction: { text: 'Apply Density to All' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_APPLY_SELECTED_DENSITY_TO_ALL }
    },
    {
        element: () => `#${appContext.uiManager.isMobile() ? 'mobile' : 'desktop'}-panel-actions button[data-action="reset-all-worlds"]`,
        title: 'Step 8: Reset Worlds',
        content: "Finally, reset all worlds to apply the new density settings.",
        primaryAction: { text: 'Apply & Reset All Enabled Worlds' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES }
    },
     {
        element: () => appContext.uiManager.isMobile() ? '.tab-bar-button[data-view="rules"]' : '[data-tour-id="ruleset-actions-button"]',
        title: 'Step 9: Prepare for Mutation',
        content: "It's time to evolve our ruleset. Open the <span class=\"onboarding-highlight-text\">Ruleset Actions</span> panel again.",
        primaryAction: { text: 'Open Ruleset Actions' },
        advanceOn: { type: 'click' }
    }, {
        element: () => `#${appContext.uiManager.isMobile() ? 'mobile' : 'desktop'}-mutate-tab`,
        title: 'Step 10: Access the DNA Splicer',
        content: "Select the <span class=\"onboarding-highlight-text\">Mutate</span> tab.",
        primaryAction: { text: 'Select Mutate Tab' },
        onBeforeShow: () => {
            if (!appContext.uiManager.isMobile()) {
                EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'rulesetActions', show: true });
            } else {
                 EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'rules' });
            }
        },
        advanceOn: { type: 'click' }
    },
     {
        element: () => `#${appContext.uiManager.isMobile() ? 'mobile' : 'desktop'}-mutate-pane`,
        title: 'Step 11: Set Mutation Parameters',
        content: "Set the <span class=\"onboarding-highlight-text\">Mutation Rate to ~10%</span> and ensure the Mode is <span class=\"onboarding-highlight-text\">'R-Sym'</span>. This introduces small, symmetric changes, ideal for evolving complex patterns.",
        primaryAction: { text: 'Next' },
        onBeforeShow: (step) => {
             document.querySelector(step.element().replace('-pane', '-tab'))?.click();
        },
        advanceOn: { type: 'click' }
    },
    {
        element: () => `#${appContext.uiManager.isMobile() ? 'mobile' : 'desktop'}-mutate-pane button[data-action="clone-mutate"]`,
        title: 'Step 12: Run the Experiment',
        content: "This is the <span class=\"onboarding-highlight-text\">Clone & Mutate</span> command. It copies our 'Gliders' ruleset to all nine worlds and applies a unique, small mutation to each. <span class=\"onboarding-highlight-text\">Press it now.</span>",
        primaryAction: { text: 'Clone & Mutate' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_CLONE_AND_MUTATE },
        delayAfter: 2000
    }, {
        element: '#minimap-guide',
        highlightType: 'canvas',
        title: 'Step 13: Observe and Select',
        content: "The experiment is running! Each world is now a slightly different version of the original. <span class=\"onboarding-highlight-text\">Observe the minimap and select a world</span> that looks interesting to you.",
        primaryAction: { text: 'Select a World' },
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED }
    }, {
        element: () => `#${appContext.uiManager.isMobile() ? 'mobile' : 'desktop'}-mutate-pane button[data-action="clone-mutate"]`,
        title: 'Step 14: Evolve Again!',
        content: "You've selected a promising new specimen. Let's make it the basis for the next generation. Press <span class=\"onboarding-highlight-text\">Clone & Mutate</span> again to evolve from your new selection.",
        primaryAction: { text: 'Clone & Mutate Again' },
        onBeforeShow: () => {
             if (appContext.uiManager.isMobile()) {
                EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'rules' });
                setTimeout(() => document.querySelector('#mobile-mutate-tab')?.click(), 100);
            } else {
                EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'rulesetActions', show: true });
                 setTimeout(() => document.querySelector('#desktop-mutate-tab')?.click(), 100);
            }
        },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_CLONE_AND_MUTATE }
    }, {
        element: 'body',
        title: 'Mission Complete',
        content: "You have successfully run a guided evolution experiment. You now know the core workflow for discovery: <span class=\"onboarding-highlight-text\">Baseline -> Control -> Mutate -> Observe -> Select -> Repeat</span>. The universe is yours to explore.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }];

    return {
        core,
        controls,
        ruleset_actions,
        editor,
        // analysis,
        // worlds,
        // file_management,
        appliedEvolution,
    };
};