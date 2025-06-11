// src/ui/tourSteps.js

import { EventBus, EVENTS } from '../services/EventBus.js';
import * as UI from './ui.js';

// --- Helper functions to manage UI state during tours ---
const showPopout = (panelName) => EventBus.dispatch(EVENTS.COMMAND_SHOW_POPOUT, { panelName, shouldShow: true });
const hidePopouts = () => ['speed', 'brush', 'newRules', 'setHex', 'resetClear', 'share', 'mutate', 'library', 'history'].forEach(name => UI.showPopout(name, false));
const hidePanels = () => {
    UI.getRulesetEditor()?.hide();
    UI.getSetupPanel()?.hide();
    UI.getAnalysisPanel()?.hide();
    UI.getRuleRankPanel()?.hide();
};

// --- Tour Definitions ---

const coreTour = [
    {
        element: '[data-tour-id="hex-grid-canvas"]',
        title: 'Welcome to the HexLife Explorer',
        content: "You've arrived at the HexLife Observatory. Before you lie nine parallel universes, each waiting for a spark of life. Your mission: to discover the rules that govern them.",
        primaryAction: { text: 'Begin Orientation' },
        onBeforeShow: () => { hidePopouts(); hidePanels(); },
        advanceOn: { type: 'click' }
    },
    {
        element: '[data-tour-id="play-pause-button"]',
        title: 'The Flow of Time',
        content: "Time is currently frozen. Use the <span class=\"onboarding-highlight-text\">Play/Pause button</span> (or press `P`) to start and stop the universal clock. Let's see what these worlds are currently doing.",
        primaryAction: { text: 'Click the Play Button' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_TOGGLE_PAUSE }
    },
    {
        element: '[data-tour-id="main-content-area"]',
        title: 'The Focal Point',
        content: "Your main viewer is focused on one universe, while the mini-map shows all nine. This is perfect for comparing experiments. <span class=\"onboarding-highlight-text\">Click on any mini-map view</span> to shift your focus.",
        primaryAction: { text: 'Select a Different World' },
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED }
    },
    {
        element: '[data-tour-id="hex-grid-canvas"]',
        title: 'The Spark of Creation',
        content: "The most direct way to influence a universe is by seeding it with life. The simulation will pause automatically when you draw. <span class=\"onboarding-highlight-text\">Click and drag your mouse on the main view.</span>",
        primaryAction: { text: 'Try Drawing on the Grid' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH }
    },
    {
        element: '#helpButton',
        title: 'Your Lab Assistant',
        content: "You now have the core skills. For every other tool in this lab, look for the <span class=\"onboarding-highlight-text\">[?]</span> help icon to launch a specific guide. Use this main <span class=\"onboarding-highlight-text\">Help button</span> to restart this orientation at any time. The rest is up to you. Good luck.",
        primaryAction: { text: 'Begin My Research' },
        advanceOn: { type: 'click' }
    }
];

const coreTourMobile = [
    {
        element: 'body',
        title: 'Welcome to the HexLife Explorer',
        content: "You've arrived at the HexLife Observatory. Before you lie nine parallel universes, each waiting for a spark of life. Your mission: to discover the rules that govern them.",
        primaryAction: { text: 'Begin Orientation' },
        onBeforeShow: () => { document.querySelector('[data-view="more"]').click(); },
        advanceOn: { type: 'click' }
    },
    {
        element: '#mobilePlayPauseButton',
        title: 'The Flow of Time',
        content: "Time is currently frozen. Use the <span class=\"onboarding-highlight-text\">Play/Pause button</span> (or press `P`) to start and stop the universal clock. Let's see what these worlds are currently doing.",
        primaryAction: { text: 'Click the Play Button' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_TOGGLE_PAUSE }
    },
    {
        element: '#hexGridCanvas',
        title: 'The Focal Point',
        content: "Your main viewer is focused on one universe, while the mini-map shows all nine. This is perfect for comparing experiments. <span class=\"onboarding-highlight-text\">Click on any mini-map view</span> to shift your focus.",
        primaryAction: { text: 'Select a Different World' },
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED }
    },
    {
        element: '#interaction-mode-toggle',
        title: 'Wielding the Brush',
        content: "The most direct way to influence a universe is by seeding it with life. <span class=\"onboarding-highlight-text\">Switch to Draw mode</span>",
        primaryAction: null,
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_TOGGLE_INTERACTION_MODE }
    },
    {
        element: '#hexGridCanvas',
        title: 'The Spark of Creation',
        content: "Now with your Brush in hand start painting. <span class=\"onboarding-highlight-text\">Touch and move across the main view on top</span>",
        primaryAction: null,
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH }
    },
    {
        element: '[data-tour-id="mobile-help-button"]',
        title: 'Your Lab Assistant',
        content: "You now have the core skills. For every other tool in this lab, look for the <span class=\"onboarding-highlight-text\">[?]</span> help icon to launch a specific guide. Use this main <span class=\"onboarding-highlight-text\">Help button</span> to restart this orientation at any time. The rest is up to you. Good luck.",
        onBeforeShow: () => { document.querySelector('[data-view="more"]').click(); },
        primaryAction: { text: 'Begin My Research' },
        advanceOn: { type: 'click' }
    }
];


const speedAndBrushTour = [
    {
        element: '[data-tour-id="speed-popout"]',
        title: 'Controlling Time',
        content: "The <span class=\"onboarding-highlight-text\">SPD</span> button opens the controls for the simulation's target Ticks Per Second (TPS). <span class=\"onboarding-highlight-text\">Move the slider to change the speed.</span>",
        onBeforeShow: () => { showPopout('speed'); },
        primaryAction: { text: 'Change Speed' },
        advanceOn: { type: 'event', eventName: EVENTS.SIMULATION_SPEED_CHANGED }
    },
    {
        element: '[data-tour-id="brush-popout"]',
        title: 'Wielding the Brush',
        content: "Excellent. The <span class=\"onboarding-highlight-text\">BRS</span> button opens the controls for the size of your drawing brush. <br><span class=\"onboarding-highlight-text\">Move the slider to change the size.</span> <br><span class=\"onboarding-highlight-text\">Pro-Tip:</span> For faster workflow, hover over the grid and use <span class=\"onboarding-highlight-text\">Ctrl + Mouse Wheel</span> to adjust the brush size on the fly.",
        onBeforeShow: () => { showPopout('brush'); },
        primaryAction: { text: 'Got it' },
        advanceOn: { type: 'click' }
    }
];

const rulesetGenerationTour = [
    {
        element: '[data-tour-id="new-rules-popout"]',
        title: 'The Genesis Chamber',
        content: "This is where you create entirely new laws of physics. Each mode generates a 128-bit 'ruleset'—the DNA for a universe.",
        onBeforeShow: () => { showPopout('newRules'); },
        primaryAction: { text: 'Tell Me About the Modes' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#generateModeSwitchPopout',
        title: 'Synthesis Modes',
        content: "<span class=\"onboarding-highlight-text\">R-Sym</span> (Rotational Symmetry) is often best, creating structured patterns. <span class=\"onboarding-highlight-text\">N-Count</span> bases rules on the number of active neighbors. <span class=\"onboarding-highlight-text\">Random</span> is pure chaos.",
        primaryAction: { text: 'How Do I Use It?' },
        advanceOn: { type: 'click' }
    },
    {
        element: '[data-tour-id="generate-ruleset-button"]',
        title: 'Create a Universe',
        content: "After choosing a mode, you can apply it to the <span class=\"onboarding-highlight-text\">Selected</span> world or to <span class=\"onboarding-highlight-text\">All</span> of them. When you're ready, <span class=\"onboarding-highlight-text\">click 'Generate'</span> and watch the simulation instantly change.",
        primaryAction: { text: "Click 'Generate'" },
        advanceOn: { type: 'event', eventName: EVENTS.RULESET_CHANGED }
    }
];

const mutationTour = [
    {
        element: '[data-tour-id="mutatePopout"]',
        title: 'The DNA Splicer',
        content: "Evolution requires mutation. This tool introduces small, random changes to an existing ruleset. A low <span class=\"onboarding-highlight-text\">Mutation Rate</span> (5-10%) is often best for finding interesting variations.",
        onBeforeShow: () => { showPopout('mutate'); },
        primaryAction: { text: 'What About Cloning?' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#cloneAndMutateButton',
        title: 'The Cloning Vats',
        content: "This is a powerful research tool. It takes the ruleset from your selected world, <span class=\"onboarding-highlight-text\">clones it onto all other worlds, and gives each clone a unique mutation</span>. It's the fastest way to run parallel evolutionary experiments.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }
];

const directInputTour = [
    {
        element: '[data-tour-id="set-hex-popout"]',
        title: 'The Ruleset Archive',
        content: "Every ruleset can be encoded as a 32-character hex string. If another researcher gives you a code, you can input it here to replicate their findings. <span class=\"onboarding-highlight-text\">Try copying and pasting this code in the input field.</span> <code>01000109C0140044A2009A8023228048</code>",
        onBeforeShow: () => { showPopout('setHex'); },
        primaryAction: { text: 'Enter a Hex Code' },
        advanceOn: { type: 'event', eventName: EVENTS.UI_RULESET_INPUT_CHANGED }
    },
    {
        element: '#setRuleFromPopoutButton',
        title: 'Applying the Code',
        content: "Once you have a valid 32-character code, <span class=\"onboarding-highlight-text\">click 'Set'</span> to apply it to the simulation.",
        primaryAction: { text: "Click 'Set'" },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_SET_RULESET }
    }
];

const libraryTour = [
    {
        element: '[data-tour-id="libraryPopout"]',
        title: 'The Specimen Library',
        content: "We've cataloged some interesting specimens. The <span class=\"onboarding-highlight-text\">Rulesets</span> tab contains entire sets of universal laws, while the <span class=\"onboarding-highlight-text\">Patterns</span> tab contains specific starting configurations of cells.",
        onBeforeShow: () => { showPopout('library'); },
        primaryAction: { text: 'Got It' },
        advanceOn: { type: 'click' }
    },
    {
        element: '.library-item .load-rule-btn',
        title: 'Loading a Ruleset',
        content: "Loading a <span class=\"onboarding-highlight-text\">Ruleset</span> changes the fundamental physics of a world. <span class=\"onboarding-highlight-text\">Click 'Load'</span> to try one out.",
        onBeforeShow: () => { document.querySelector('[data-tab="rulesets"]').click(); },
        primaryAction: { text: 'Click \'Load\'' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_SET_RULESET }
    }//,
    //{
    //    element: '.library-item .place-pattern-btn',
    //    title: 'Placing a Pattern',
    //    content: "Placing a <span class=\"onboarding-highlight-text\">Pattern</span> seeds the grid with a specific shape, like the famous 'Glider', using the current ruleset. <span class=\"onboarding-highlight-text\">Click 'Place' to enter placing mode.</span>",
    //    onBeforeShow: () => { document.querySelector('[data-tab="patterns"]').click(); },
    //    primaryAction: { text: 'Click \'Place\'' },
    //    advanceOn: { type: 'event', eventName: EVENTS.COMMAND_ENTER_PLACING_MODE }
    //}
];

const historyTour = [
    {
        element: '#undoButton',
        title: 'Stepping Back in Time',
        content: "Time travel is possible... for rulesets. Every change you make is tracked. Use <span class=\"onboarding-highlight-text\">Undo (↶)</span> to step back. You can also use `Ctrl+Z`.",
        primaryAction: { text: 'Click Undo' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_UNDO_RULESET }
    },
    {
        element: '#redoButton',
        title: 'Moving Forward',
        content: "Use <span class=\"onboarding-highlight-text\">Redo (↷)</span> to move forward again. You can also use `Ctrl+Y`.",
        primaryAction: { text: 'Click Redo' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_REDO_RULESET }
    },
    {
        element: '#historyButton',
        title: 'Viewing the Full Timeline',
        content: "Click the <span class=\"onboarding-highlight-text\">History (🕒)</span> button to open a list of all rulesets you've used. You can click any entry to instantly revert the world to that point in its history.",
        primaryAction: { text: 'Finish' },
        onBeforeShow: () => { showPopout('history'); },
        advanceOn: { type: 'click' }
    }
];

const saveLoadTour = [
    {
        element: '[data-tour-id="save-state-button"]',
        title: 'Archiving a Discovery',
        content: "When you find a truly unique state, use the <span class=\"onboarding-highlight-text\">SAV</span> button to save the selected world's *entire state*—all cell positions and the active ruleset—to a JSON file on your computer.",
        primaryAction: { text: 'How Do I Load It?' },
        advanceOn: { type: 'click' }
    },
    {
        element: '[data-tour-id="load-state-button"]',
        title: 'Restoring an Experiment',
        content: "The <span class=\"onboarding-highlight-text\">LOD</span> button lets you load a previously saved file, perfectly restoring your experiment to continue your research later or share it with others.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }
];

const resetClearTour = [
     {
        element: '[data-tour-id="reset-clear-popout"]',
        title: 'Wiping the Slate Clean',
        content: "<span class=\"onboarding-highlight-text\">Reset</span> re-seeds a world with random cells. <span class=\"onboarding-highlight-text\">Clear</span> sets all cells to a single state (clicking again flips it). You can apply these to the selected world or all of them.",
        onBeforeShow: () => { showPopout('resetClear'); },
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }
];

const editorTour = [
    {
        element: '[data-tour-id="ruleset-editor-panel"]',
        title: 'The Gene Editor',
        content: "This is the most powerful tool in the lab. It lets you directly edit the 128 fundamental rules of your universe. The visualization shows a center cell (large hex) and its six neighbors.",
        onBeforeShow: () => { hidePanels(); UI.getRulesetEditor()?.show(); },
        primaryAction: { text: 'How Do I Edit?' },
        advanceOn: { type: 'click' }
    },
    {
        element: '.r-sym-rule-viz',
        title: 'Toggling Outcomes',
        content: "The color of the <span class=\"onboarding-highlight-text\">inner-most hexagon</span> shows the rule's outcome. <span class=\"onboarding-highlight-text\">Simply click any rule visualization</span> to flip its output between active (bright color) and inactive (dark color).",
        onBeforeShow: () => { document.getElementById('rulesetEditorMode').value = 'rotationalSymmetry'; UI.getRulesetEditor()?.refreshViews(); },
        primaryAction: { text: 'Click any Rule' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_EDITOR_SET_RULES_FOR_CANONICAL_REPRESENTATIVE }
    },
    {
        element: '#rulesetEditorMode',
        title: 'Analytical Lenses',
        content: "Change your 'lens' to view the rules differently. <span class=\"onboarding-highlight-text\">Rotational Symmetry</span> is great for understanding patterns, while <span class=\"onboarding-highlight-text\">Neighbor Count</span> groups rules by their local conditions. This helps you make broad changes quickly.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }
];

const setupTour = [
    {
        element: '[data-tour-id="setup-panel"]',
        title: 'The Control Panel',
        content: "Good science requires a control group. Here, you can define the starting <span class=\"onboarding-highlight-text\">Density</span> for each universe or <span class=\"onboarding-highlight-text\">Enable/Disable</span> it entirely. This is essential for comparative analysis.",
         onBeforeShow: () => { hidePanels(); UI.getSetupPanel()?.show(); },
         primaryAction: { text: "What's This Button?" },
         advanceOn: { type: 'click' }
    },
    {
        element: '.set-ruleset-button',
        title: 'Propagating Rules',
        content: "To test the same ruleset under different starting conditions, <span class=\"onboarding-highlight-text\">click 'Use Main Ruleset'</span>. This will copy the rules from your main viewer to this specific world and reset it.",
        primaryAction: { text: 'Click the Button' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET }
    }
];

const analysisTour = [
    {
        element: '[data-tour-id="analysis-panel"]',
        title: 'The Macroscope',
        content: "This tool gives you the big picture. It charts the universe's overall <span class=\"onboarding-highlight-text\">Activity Ratio</span> and <span class=\"onboarding-highlight-text\">Entropy</span> (a measure of complexity) over time, allowing you to quantify the behavior of a ruleset.",
        onBeforeShow: () => { hidePanels(); UI.getAnalysisPanel()?.show(); },
        primaryAction: { text: 'How Do I Read the Charts?' },
        advanceOn: { type: 'click' }
    },
    {
        element: '.plugin-canvas',
        title: 'Interpreting Data',
        content: "A flat line in the history means the world is stable or in a perfect loop. A chaotic line indicates complexity. Comparing these charts between worlds is key to finding interesting rulesets.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }
];

const ruleRankTour = [
    {
        element: '[data-tour-id="rule-rank-panel"]',
        title: 'The Microscope',
        content: "This panel answers *why* a universe behaves as it does. It shows you exactly which rules are being used most frequently, updated in real-time.",
        onBeforeShow: () => { hidePanels(); UI.getRuleRankPanel()?.show(); },
        primaryAction: { text: 'How Is It Organized?' },
        advanceOn: { type: 'click' }
    },
    {
        element: '.dual-rank-container',
        title: 'Creation and Destruction',
        content: "The list is split into two columns. <span class=\"onboarding-highlight-text\">Activation</span> shows rules that are creating life, driving growth. <span class=\"onboarding-highlight-text\">Deactivation</span> shows rules that are removing life, causing decay. A balance between them often leads to the most complex behavior.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }
];

export const tours = {
    core: coreTour,
    coreMobile: coreTourMobile,
    speedAndBrush: speedAndBrushTour,
    rulesetGeneration: rulesetGenerationTour,
    mutation: mutationTour,
    directInput: directInputTour,
    library: libraryTour,
    history: historyTour,
    saveLoad: saveLoadTour,
    resetClear: resetClearTour,
    editor: editorTour,
    setup: setupTour,
    analysis: analysisTour,
    ruleRank: ruleRankTour,
};