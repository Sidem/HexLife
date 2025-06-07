import { EventBus, EVENTS } from '../services/EventBus.js';
import * as UI from './ui.js';

const showPopout = (panelName) => EventBus.dispatch(EVENTS.COMMAND_SHOW_POPOUT, { panelName, shouldShow: true });
const hidePopout = (panelName) => EventBus.dispatch(EVENTS.COMMAND_SHOW_POPOUT, { panelName, shouldShow: false });
const hideAllPopouts = () => ['speed', 'brush', 'newRules', 'setHex', 'resetClear', 'share'].forEach(name => hidePopout(name));
const hideAllPanels = () => {
    UI.getRulesetEditor()?.hide();
    UI.getSetupPanel()?.hide();
    UI.getAnalysisPanel()?.hide();
    UI.getRuleRankPanel()?.hide();
};

const gliderRuleset = "12482080480080006880800180010117";

export const tourSteps = [
    // =========== ACT I: THE OBSERVATORY ===========
    {
        element: '#hexGridCanvas',
        title: 'Welcome, Researcher',
        content: `You've discovered the HexLife Explorer, a laboratory for digital life. Your exploration begins now.`,
        primaryAction: { text: 'Begin Exploration' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#playPauseButton',
        title: 'The Flow of Time',
        content: `Time is frozen. The <span class="onboarding-highlight-text">Play/Pause button</span> starts and stops the simulation. Press it now.`,
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_TOGGLE_PAUSE }
    },
    {
        element: '#statsDisplayContainer',
        title: 'Reading the Vitals',
        content: `This is your main data feed. It shows the current <span class="onboarding-highlight-text">Tick</span>, <span class="onboarding-highlight-text">Ratio</span> of active cells, and performance stats like <span class="onboarding-highlight-text">TPS</span> (Ticks Per Second).`,
        primaryAction: { text: 'Got it' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#speedControlButton',
        title: `Adjusting Time's Pace`,
        content: `You can change the simulation speed. Click 'SPD' to open the speed controls.`,
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#speedPopout',
        title: 'Speed Control',
        content: `Use this slider to set the target Ticks Per Second. Faster speeds allow you to observe long-term evolution quickly.`,
        onBeforeShow: () => showPopout('speed'),
        primaryAction: { text: 'Next' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#main-content-area',
        title: 'The Multiverse',
        content: `You are observing nine worlds at once in the mini-map. This allows for parallel experiments. <br><br>Click any other world in the mini-map to shift your focus.`,
        onBeforeShow: () => hidePopout('speed'),
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED }
    },
    {
        element: '#hexGridCanvas',
        title: 'Seeding Life',
        content: `You can introduce life by "seeding" the grid. <span class="onboarding-highlight-text">Click and drag your mouse</span> on the main view. The simulation will pause automatically.`,
        primaryAction: { text: 'Continue' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#brushToolButton',
        title: 'Calibrating Instruments',
        content: `Your seeding tool is the <span class="onboarding-highlight-text">Brush</span>. Click 'BRS' to change its size.`,
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#brushPopout',
        title: 'The Pipette',
        content: `Use this slider to adjust your brush size. <br><br><span class="onboarding-highlight-text">Pro-Tip:</span> Hover over the main grid and use <span class="onboarding-highlight-text">Ctrl + Mouse Wheel</span> for quick adjustments.`,
        onBeforeShow: () => showPopout('brush'),
        primaryAction: { text: 'Next' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#resetClearButton',
        title: 'Wiping the Slate Clean',
        content: `Sometimes you need to start a fresh experiment. The 'R/C' button gives you options to <span class="onboarding-highlight-text">Reset</span> or <span class="onboarding-highlight-text">Clear</span> your worlds.`,
        onBeforeShow: () => hidePopout('brush'),
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#resetClearPopout',
        title: 'Reset & Clear Options',
        content: `You can reset the <span class="onboarding-highlight-text">Selected</span> world or <span class="onboarding-highlight-text">All</span> of them at once. Clearing sets all cells to a single state.`,
        onBeforeShow: () => showPopout('resetClear'),
        primaryAction: { text: 'Got it' },
        advanceOn: { type: 'click' }
    },
    
    // =========== ACT II: THE GENETICS LAB ===========
    {
        element: '#rulesetDisplayContainer',
        title: 'The Genetic Code',
        content: `Now for the most important part. Every world's behavior is governed by its <span class="onboarding-highlight-text">Ruleset</span>—its digital DNA.`,
        onBeforeShow: () => hidePopout('resetClear'),
        primaryAction: { text: 'How do I change it?' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#newRulesButton',
        title: 'The Gene Synthesizer',
        content: `The 'NEW' button opens the <span class="onboarding-highlight-text">Gene Synthesizer</span> for generating new rulesets from scratch.`,
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#newRulesPopout',
        title: 'Synthesis Methods',
        content: `<span class="onboarding-highlight-text">R-Sym</span> (Rotational Symmetry) often creates structured patterns. <span class="onboarding-highlight-text">N-Count</span> bases rules on neighbor counts. <span class="onboarding-highlight-text">Random</span> is pure chaos.`,
        onBeforeShow: () => showPopout('newRules'),
        primaryAction: { text: 'More Options?' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#newRulesPopout',
        title: 'Controlling the Synthesis',
        content: `Use <span class="onboarding-highlight-text">Custom Bias</span> to control the tendency towards life. Use <span class="onboarding-highlight-text">Apply to</span> to target the selected world or all of them at once.`,
        onBeforeShow: () => showPopout('newRules'),
        primaryAction: { text: 'Lets Generate!' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#generateRulesetFromPopoutButton',
        title: 'Create a New World',
        content: `Click <span class="onboarding-highlight-text">'Generate'</span> to create a new ruleset and see how the simulation changes instantly.`,
        onBeforeShow: () => showPopout('newRules'),
        advanceOn: { type: 'event', eventName: EVENTS.RULESET_CHANGED }
    },
    {
        element: '#setRulesetButton',
        title: 'Loading a Known Specimen',
        content: `Some lifeforms are already catalogued. Let's load <span class="onboarding-highlight-text">"Gliders"</span>. Click 'HEX' to open the manual input panel.`,
        onBeforeShow: () => hidePopout('newRules'),
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#setHexPopout',
        title: 'Manual Input',
        content: `Paste this code into the input box: <br><code style="background: #222; padding: 5px 8px; border-radius: 4px; user-select: all;">${gliderRuleset}</code><br><button id="onboarding-copy-ruleset" class="button" style="margin-top: 10px;">Copy Ruleset</button>`,
        onBeforeShow: () => showPopout('setHex'),
        advanceOn: { type: 'event', eventName: EVENTS.UI_RULESET_INPUT_CHANGED }
    },
    {
        element: '#setRuleFromPopoutButton',
        title: 'Apply the Code',
        content: `Excellent! Now click <span class="onboarding-highlight-text">'Set'</span> to apply the new rules. After the world resets, watch for the small, moving patterns—the 'gliders'!`,
        advanceOn: { type: 'event', eventName: EVENTS.RULESET_CHANGED }
    },

    // =========== ACT III: THE LAB NOTEBOOK & ADVANCED ANALYSIS ===========
    {
        element: '#saveStateButton',
        title: 'The Lab Notebook',
        content: `Found a fascinating state you want to preserve? The 'SAV' button saves the selected world's <span class="onboarding-highlight-text">entire state</span>—all cells and the ruleset—to a file.`,
        onBeforeShow: () => hideAllPopouts(),
        primaryAction: { text: 'How do I load it?' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#loadStateButton',
        title: 'Opening an Old Entry',
        content: `The 'LOD' button lets you load a previously saved file, restoring your experiment exactly as it was.`,
        primaryAction: { text: 'Got it' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#editRuleButton',
        title: 'The Gene-Splicer',
        content: `Now for the most powerful tool: the <span class="onboarding-highlight-text">Ruleset Editor</span> ('EDT'). This is where you modify the DNA rule by rule.`,
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#rulesetEditorPanel',
        title: 'Editing a Gene',
        content: `This panel visualizes all 128 rules. <span class="onboarding-highlight-text">Click any rule visualization</span> to flip its outcome and instantly alter the laws of the universe.`,
        onBeforeShow: () => UI.getRulesetEditor()?.show(),
        advanceOn: { type: 'event', eventName: EVENTS.RULESET_CHANGED }
    },
    {
        element: '#setupPanelButton',
        title: 'The Analytics Suite',
        content: `Good science requires controlled experiments. The <span class="onboarding-highlight-text">World Setup</span> panel ('SET') lets you define the starting conditions for all nine worlds.`,
        onBeforeShow: () => UI.getRulesetEditor()?.hide(),
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#setupPanel',
        title: 'Controlling The Experiment',
        content: `Here you can change the initial <span class="onboarding-highlight-text">Density</span> of active cells for each world, or disable them entirely.`,
        onBeforeShow: () => UI.getSetupPanel()?.show(),
        primaryAction: { text: 'Understood' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#analysisPanelButton',
        title: 'Macroscopic Data',
        content: `How do you measure a universe? The <span class="onboarding-highlight-text">Analysis Panel</span> ('ANL') provides real-time data on the world's overall state and complexity.`,
        onBeforeShow: () => UI.getSetupPanel()?.hide(),
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#analysisPanel',
        title: 'Complexity Over Time',
        content: `These charts track <span class="onboarding-highlight-text">Activity Ratio</span> and <span class="onboarding-highlight-text">Entropy</span> (a measure of complexity). They are invaluable for comparing rulesets.`,
        onBeforeShow: () => UI.getAnalysisPanel()?.show(),
        primaryAction: { text: 'Next' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#rankPanelButton',
        title: 'Microscopic Data',
        content: `But *why* does a world behave a certain way? The <span class="onboarding-highlight-text">Rule Rank</span> panel ('RNK') shows exactly which "genes" are most active.`,
        onBeforeShow: () => UI.getAnalysisPanel()?.hide(),
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#ruleRankPanel',
        title: 'Activation vs. Deactivation',
        content: `This tool shows which rules are creating life (Activation) versus which are removing it (Deactivation). It's essential for deep analysis.`,
        onBeforeShow: () => UI.getRuleRankPanel()?.show(),
        primaryAction: { text: 'Got it' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#shareButton',
        title: 'Go Forth and Discover!',
        content: `You have mastered the lab. When you find something amazing, use the <span class="onboarding-highlight-text">Share</span> ('SHR') button to get a link to your discovery. Use <span class="onboarding-highlight-text">Help</span> ('HLP') to replay this tour.`,
        onBeforeShow: () => UI.getRuleRankPanel()?.hide(),
        primaryAction: { text: 'Begin Your Research' },
        advanceOn: { type: 'click' }
    }
];