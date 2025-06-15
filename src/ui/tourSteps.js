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


// --- DESKTOP TOURS (Unchanged) ---
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
        advanceOn: { type: 'event', eventName: EVENTS.SIMULATION_PAUSED, condition: (data) => {return !data;} }
    },
    {
        element: '#minimap-guide',
        highlightType: 'canvas',
        title: 'The Focal Point',
        content: "Your main viewer is focused on one universe, while the mini-map shows all nine. This is perfect for comparing experiments. <span class=\"onboarding-highlight-text\">Click on any mini-map view</span> to shift your focus.",
        primaryAction: { text: 'Select a Different World' },
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED }
    },
    {
        element: '#selected-world-guide',
        highlightType: 'canvas',
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
    }
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


// --- MOBILE TOURS ---

const coreMobileTour = [
    {
        element: 'body',
        title: 'Welcome to the HexLife Explorer',
        content: "You've arrived at the HexLife Observatory. Before you lie nine parallel universes, each waiting for a spark of life. Your mission: to discover the rules that govern them.",
        primaryAction: { text: 'Begin Orientation' },
        onBeforeShow: () => {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_VIEW, { targetView: 'simulate' });
        },
        advanceOn: { type: 'click' }
    },
    {
        element: '#mobilePlayPauseButton',
        title: 'The Universal Clock',
        content: "Time in all universes is controlled by this button. A single tap starts or stops the flow of every 'tick'.",
        primaryAction: { text: 'Click the Play Button' },
        advanceOn: { type: 'event', eventName: EVENTS.SIMULATION_PAUSED, condition: (isPaused) => !isPaused }
    },
    {
        element: '#minimap-guide',
        highlightType: 'canvas',
        title: 'The Observatory',
        content: "This provides an overview of all nine universes. Your main screen shows the selected world, but you can tap any world here to focus on it.",
        primaryAction: { text: 'Select a Different World' },
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED }
    },
    {
        element: '#interaction-mode-toggle',
        title: 'Critical Tool: The Interactor',
        content: "This is your most important tool. The <span class=\"onboarding-highlight-text\">Hand (🖐️)</span> lets you pan and zoom the view. The <span class=\"onboarding-highlight-text\">Pencil (✏️)</span> lets you draw cells directly onto the grid.",
        primaryAction: { text: 'Tap the Hand to Switch to Draw Mode' },
        advanceOn: { type: 'event', eventName: EVENTS.INTERACTION_MODE_CHANGED, condition: (mode) => mode === 'draw' }
    },
    {
        element: '#selected-world-guide',
        highlightType: 'canvas',
        title: 'The Spark of Creation',
        content: "Now that your Brush is active, you can directly influence a universe. The simulation will pause automatically when you draw. Touch and drag on the grid to bring new cells to life.",
        primaryAction: null,
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH },
        delayAfter: 2000 // Let user see the result
    },
    {
        element: '.tab-bar-button[data-view="learning"]',
        title: 'Your Learning Hub',
        content: "This Learning Hub teaches you how to use the HexLife Explorer. If you ever need a refresher, feel free to revisit each tutorial. Your research awaits.",
        primaryAction: { text: 'Begin My Research' },
        advanceOn: { type: 'click' }
    }
];

const commandDeckTour = [
    {
        element: '#mobile-fab-container-right',
        title: 'The Command FABs',
        content: "These are your primary controls. You've already used <span class=\"onboarding-highlight-text\">Play/Pause</span> and the <span class=\"onboarding-highlight-text\">Pan/Draw</span> toggle. The <span class=\"onboarding-highlight-text\">Tools (🛠️)</span> button is your gateway to adjusting core simulation parameters.",
        primaryAction: { text: `Let's See` },
        onBeforeShow: () => EventBus.dispatch(EVENTS.COMMAND_SHOW_VIEW, { targetView: 'simulate' }),
        advanceOn: { type: 'click' }
    },
    {
        element: '#mobileToolsFab',
        title: 'The Tools Menu',
        content: "Tapping the Tools FAB brings up a menu for adjusting simulation <span class=\"onboarding-highlight-text\">Speed</span> and your drawing <span class=\"onboarding-highlight-text\">Brush Size</span>. It also allows you to customize the Quick Action FABs on the left. Tap it now to see.",
        primaryAction: { text: 'Open the Tools Menu' },
        advanceOn: { type: 'event', eventName: EVENTS.BOTTOM_SHEET_SHOWN }
    },
    {
        element: '.tools-bottom-sheet-content',
        title: 'Adjusting Parameters',
        content: "Simple and direct. From here you can fine-tune the simulation. You can close this menu by tapping the overlay or the close button.",
        primaryAction: { text: 'Got It' },
        advanceOn: { type: 'click' }
    },
    {
        element: '[data-tab="customize-fabs"]',
        title: 'Quick Actions',
        content: "These are your customizable shortcuts for advanced ruleset commands. They let you run complex experiments, like evolving a ruleset, with a single tap. Let's learn how to use them in the next tour.",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }
];

const editorTourMobile = [
    {
        element: '#editor-view',
        title: 'The Ruleset Editor',
        content: 'This is the most powerful tool in the lab, letting you directly edit the DNA of your universe. Let\'s explore its three modes.',
        primaryAction: { text: 'Next' },
        onBeforeShow: () => EventBus.dispatch(EVENTS.COMMAND_SHOW_VIEW, { targetView: 'editor' }),
        advanceOn: { type: 'click' }
    },
    {
        element: '#rulesetEditorMode',
        title: 'Three Editing Lenses',
        content: 'You can view the 128 rules in different ways. <span class="onboarding-highlight-text">Rotational Symmetry</span> is the default and groups visually similar rules. <span class="onboarding-highlight-text">Neighbor Count</span> groups them by the number of active neighbors. <span class="onboarding-highlight-text">Detailed</span> shows every single rule.',
        primaryAction: { text: 'Got it' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#rotationalSymmetryRulesetEditorGrid',
        title: 'Editing a Rule',
        content: 'The color of the inner-most hexagon shows the rule\'s outcome (what the center cell will become). <span class="onboarding-highlight-text">Tap any rule visualization</span> to flip its output between active (bright color) and inactive (dark color).',
        primaryAction: { text: 'Click any Rule' },
        onBeforeShow: () => { 
            document.getElementById('rulesetEditorMode').value = 'rotationalSymmetry'; 
            const editor = UI.getRulesetEditor();
            if (editor) editor.refreshViews(); 
        },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_EDITOR_SET_RULES_FOR_CANONICAL_REPRESENTATIVE },
        delayAfter: 1000
    },
    {
        element: '#editorScopeSwitchMount',
        title: 'Applying Changes',
        content: 'Your edits can be applied to just the <span class="onboarding-highlight-text">Selected</span> world or to <span class="onboarding-highlight-text">All</span> worlds at once. Be careful with "All"—it will overwrite the rulesets in your other experiments!',
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }
];

const analysisTourMobile = [
    {
        element: '#analyze-view',
        title: 'The Analysis Dashboard',
        content: 'This view helps you understand *why* a simulation behaves the way it does by visualizing its data.',
        primaryAction: { text: 'Next' },
        onBeforeShow: () => EventBus.dispatch(EVENTS.COMMAND_SHOW_VIEW, { targetView: 'analyze' }),
        advanceOn: { type: 'click' }
    },
    {
        element: '#plots-pane',
        title: 'Data Plots',
        content: 'These charts show the world\'s history. <span class="onboarding-highlight-text">Activity Ratio</span> is the percentage of active cells. <span class="onboarding-highlight-text">Entropy</span> is a measure of complexity. A flat line means the world is stable or in a simple loop.',
        primaryAction: { text: 'Next' },
        onBeforeShow: () => {
            const plotsButton = document.querySelector('.analyze-view-segment[data-pane="plots"]');
            if (plotsButton) plotsButton.click();
        },
        advanceOn: { type: 'click' }
    },
    {
        element: '.analyze-view-segment[data-pane="ranks"]',
        title: 'Rule Ranks',
        content: 'Tap here to see which rules are being used the most.',
        primaryAction: { text: 'Show Ranks' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#ranks-pane',
        title: 'Creation vs. Destruction',
        content: 'This screen ranks rules by usage. <span class="onboarding-highlight-text">Activation</span> rules create life and drive growth. <span class="onboarding-highlight-text">Deactivation</span> rules cause decay. A balance is often key to complex behavior.',
        primaryAction: { text: 'Finish' },
        onBeforeShow: () => {
            const ranksButton = document.querySelector('.analyze-view-segment[data-pane="ranks"]');
            if (ranksButton) ranksButton.click();
        },
        advanceOn: { type: 'click' }
    }
];

const worldsTourMobile = [
    {
        element: '#worlds-view',
        title: 'The World Setup Panel',
        content: 'Here you can configure each of the 9 worlds individually before starting a simulation.',
        primaryAction: { text: 'Next' },
        onBeforeShow: () => EventBus.dispatch(EVENTS.COMMAND_SHOW_VIEW, { targetView: 'worlds' }),
        advanceOn: { type: 'click' }
    },
    {
        element: '.world-card:first-child .density-control',
        title: 'Initial Density',
        content: 'This slider sets the initial percentage of active ("alive") cells when a world is reset. This is perfect for testing how a ruleset behaves in sparse vs. crowded environments.',
        primaryAction: { text: 'Next' },
        advanceOn: { type: 'click' }
    },
    {
        element: '.world-card:first-child .enable-control',
        title: 'Enable or Disable',
        content: 'You can disable a world to exclude it from the simulation entirely. This is useful for focusing on a smaller set of experiments.',
        primaryAction: { text: 'Next' },
        advanceOn: { type: 'click' }
    },
    {
        element: '.worlds-view-actions',
        title: 'Global Actions',
        content: 'These buttons at the bottom let you apply settings (like density) or reset all worlds at once, saving you time.',
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }
];

const appliedEvolutionTour = [
    {
        element: '.tab-bar-button[data-view="rules"]',
        title: 'Mission: Applied Evolution',
        content: "Let's run a full experiment to discover a new ruleset. First, tap the <span class=\"onboarding-highlight-text\">Rules</span> tab.",
        primaryAction: { text: 'Open the Rules Tab' },
        onBeforeShow: () => {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_VIEW, { targetView: 'simulate' });
        },
        advanceOn: { type: 'event', eventName: EVENTS.MOBILE_VIEW_CHANGED, condition: (data) => data.activeView === 'rules' }
    },
    {
        element: '.rules-view-segment[data-pane="library-rulesets"]',
        title: 'Step 1: Find a Specimen',
        content: "Go to the <span class=\"onboarding-highlight-text\">Rulesets Library</span> to find a stable starting point for our experiment.",
        primaryAction: { text: 'Next' },
        onBeforeShow: () => document.querySelector('.rules-view-segment[data-pane="library-rulesets"]').click(),
        advanceOn: { type: 'click' }
    },
    {
        element: '.library-item-mobile:nth-child(10)',
        title: "Select 'Spontaneous Gliders'",
        content: "This ruleset produces interesting mobile patterns. Tap <span class=\"onboarding-highlight-text\">'Load Ruleset'</span>. This will apply its laws to all nine universes and reset them.",
        primaryAction: { text: 'Load the Ruleset' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_SET_RULESET }
    },
    {
        element: '#mobilePlayPauseButton',
        title: 'Start the Simulation',
        content: "The simulation is currently paused. Press the play button to see it come to life.",
        primaryAction: { text: 'Press Play' },
        condition: (appContext) => appContext.simulationController.getState().isPaused,
        advanceOn: { type: 'event', eventName: EVENTS.SIMULATION_PAUSED, condition: (isPaused) => !isPaused },
        delayAfter: 2500
    },
    {
        element: '#undoButton',
        title: 'Your Safety Net',
        content: "Excellent. Before we continue, note these buttons. Every ruleset change is tracked. You can always <span class=\"onboarding-highlight-text\">Undo (↶)</span> and <span class=\"onboarding-highlight-text\">Redo (↷)</span>. Don't be afraid to experiment!",
        primaryAction: { text: 'Got it' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#minimap-guide',
        highlightType: 'canvas',
        title: 'Select the First World',
        content: "Select the first world to prepare the experiment.",
        primaryAction: { text: 'Select the First World' },
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED, condition: (data) => data == 0 }
    },
    {
        element: '.tab-bar-button[data-view="worlds"]',
        title: 'Open the Worlds View',
        content: "For a controlled experiment, we need to set equal conditions for all worlds. Open the worlds view to do so.",
        primaryAction: { text: 'Open the Worlds View' },
        advanceOn: { type: 'event', eventName: EVENTS.MOBILE_VIEW_CHANGED, condition: (data) => data.activeView === 'worlds' }
    },
    {
        element: '.world-card:first-child .density-control',
        title: 'Set Density',
        content: "Set the density for the first world to 50%.",
        primaryAction: { text: 'Set Density' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_SET_WORLD_INITIAL_DENSITY, condition: (data) => (data.worldIndex === 0 && data.density > 0.49 && data.density < 0.51) }
    },
    {
        element: '.worlds-view-actions button[data-action="apply-density-all"]',
        title: 'Apply Density to All Worlds',
        content: "Apply the density to all worlds to ensure controlled conditions for the experiment.",
        primaryAction: { text: 'Apply Density to All Worlds' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_APPLY_SELECTED_DENSITY_TO_ALL }
    },
    {
        element: '.tab-bar-button[data-view="rules"]',
        title: 'Prepare for Mutation',
        content: "Now, let's evolve these gliders. Go to the <span class=\"onboarding-highlight-text\">Mutate</span> tab under <span class=\"onboarding-highlight-text\">Rules</span> to access the DNA splicer.",
        primaryAction: { text: 'Open the Mutate Pane' },
        onBeforeShow: () => document.querySelector('.rules-view-segment[data-pane="mutate"]').click(),
        advanceOn: { type: 'click' }
    },
    {
        element: '#mobileMutateSliderMount',
        title: 'Set Mutation Parameters',
        content: "Set the <span class=\"onboarding-highlight-text\">Mutation Rate to 10%</span> and ensure the <span class=\"onboarding-highlight-text\">Mode is 'R-Sym'</span>. This will introduce small, structured changes, which is ideal for evolving complex patterns.",
        primaryAction: { text: 'Next' },
        advanceOn: { type: 'click' }
    },
    {
        element: 'button[data-action="clone-mutate"]',
        title: 'Run the Experiment',
        content: "This is the <span class=\"onboarding-highlight-text\">Clone & Mutate</span> command. It will copy our 'Gliders' ruleset to all nine worlds and apply a unique, small mutation to each. <span class=\"onboarding-highlight-text\">Press it now.</span>",
        primaryAction: { text: 'Clone & Mutate' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_CLONE_AND_MUTATE },
        delayAfter: 2000
    },
    {
        element: 'body',
        title: 'Observe',
        content: "The experiment is running! In the minimap you can see how each parallel world differs from the others. Pick one that looks interesting and press 'Continue'.",
        primaryAction: { text: 'Continue' },
        advanceOn: { type: 'click' }
    },
    {
        element: '[data-action-id="clone"]',
        highlightType: 'canvas',
        title: 'Repeat!',
        content: "This Quick Action allows you to quickly <span class=\"onboarding-highlight-text\">Clone & Mutate</span> again with your defined parameters. Your selected world remains unaffected as your baseline.",
        primaryAction: { text: 'Clone & Mutate again!' },
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_CLONE_AND_MUTATE }
    },
    {
        element: 'body',
        title: 'Mission Complete',
        content: "You have successfully run a guided evolution experiment. You now know the core workflow for discovery!",
        primaryAction: { text: 'Finish' },
        advanceOn: { type: 'click' }
    }
];

export const tours = {
    // Desktop Tours
    core: coreTour,
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
    // Mobile Tours
    coreMobile: coreMobileTour,
    commandDeck: commandDeckTour,
    appliedEvolution: appliedEvolutionTour,
    editorTour: editorTourMobile,
    analysisTour: analysisTourMobile,
    worldsTour: worldsTourMobile,
};