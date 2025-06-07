// src/ui/tourSteps.js

import { EventBus, EVENTS } from '../services/EventBus.js';
import * as UI from './ui.js';

/**
 * The 'onBeforeShow' functions are crucial for preparing the UI for the next step.
 * They ensure panels and popouts are open when they need to be highlighted.
 */

const showPopout = (panelName) => EventBus.dispatch(EVENTS.COMMAND_SHOW_POPOUT, { panelName, shouldShow: true });
const hidePopout = (panelName) => EventBus.dispatch(EVENTS.COMMAND_SHOW_POPOUT, { panelName, shouldShow: false });

const gliderRuleset = "12482080480080006880800180010117";

export const tourSteps = [
    // =========== ACT I: THE OBSERVATORY ===========
    {
        element: '#hexGridCanvas',
        title: 'Welcome, Researcher',
        content: `You've discovered the HexLife Explorer, a laboratory for digital life. Before you are universes where simple rules can lead to breathtaking complexity. Your exploration begins now.`,
        primaryAction: { text: 'Begin Exploration' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#playPauseButton',
        title: 'The Flow of Time',
        content: `Time is currently frozen. The <span class="onboarding-highlight-text">Play/Pause button</span> controls the flow of time in all worlds. Press it now to see what happens.`,
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_TOGGLE_PAUSE }
    },
    {
        element: '#main-content-area',
        title: 'The Main Viewfinder',
        content: `You are observing a multiverse of nine worlds in the mini-map. The large screen is your main <span class="onboarding-highlight-text">viewfinder</span>, focused on the highlighted world. <br><br>Click any other world to shift your focus.`,
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED }
    },
    {
        element: '#hexGridCanvas',
        title: 'Seeding Life',
        content: `A petri dish needs a sample. You can introduce life by "seeding" the grid. <br><br><span class="onboarding-highlight-text">Click and drag your mouse</span> on the main view. The simulation will pause automatically for precise control.`,
        primaryAction: { text: 'Continue' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#brushToolButton',
        title: 'Calibrating Instruments',
        content: `Your seeding tool is the <span class="onboarding-highlight-text">Brush</span>. Click 'BRS' to open the brush tool and change its size.`,
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#brushPopout',
        title: 'The Pipette',
        content: `Use this slider to adjust your brush size. <br><br><span class="onboarding-highlight-text">Pro-Tip:</span> Hover over the main grid and use <span class="onboarding-highlight-text">Ctrl + Mouse Wheel</span> to change the size on the fly.`,
        onBeforeShow: () => showPopout('brush'),
        primaryAction: { text: 'Next' },
        advanceOn: { type: 'click' }
    },

    // =========== ACT II: THE GENETICS LAB ===========
    {
        element: '#rulesetDisplay',
        title: 'The Genetic Code',
        content: `Every world's behavior is governed by this 32-character hex code. Think of it as the <span class="onboarding-highlight-text">digital DNA</span> for its universe. A single character change can lead to a completely different outcome.`,
        onBeforeShow: () => hidePopout('brush'),
        primaryAction: { text: 'Continue' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#newRulesButton',
        title: 'The Gene Synthesizer',
        content: `Let's synthesize a new genetic code. The 'NEW' button opens the <span class="onboarding-highlight-text">Gene Synthesizer</span> for generating new rulesets from scratch.`,
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#generateRulesetFromPopoutButton',
        title: 'Generation Methods',
        content: `This panel offers several rule generation methods. <span class="onboarding-highlight-text">R-Sym</span> (Rotational Symmetry) often creates more structured patterns. <br><br>Click <span class="onboarding-highlight-text">'Generate'</span> to create a new ruleset.`,
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
    {
        element: '#editRuleButton',
        title: 'The Gene-Splicer',
        content: `Now for the most powerful tool: the <span class="onboarding-highlight-text">Ruleset Editor</span>. This is where you perform gene-splicing, modifying the DNA rule by rule. Click 'EDT' to open it.`,
        onBeforeShow: () => hidePopout('setHex'),
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#rulesetEditorPanel',
        title: 'Editing a Gene',
        content: `This panel visualizes all 128 rules. <span class="onboarding-highlight-text">Click any rule visualization</span> to flip its outcome and instantly alter the laws of the universe.`,
        onBeforeShow: () => UI.getRulesetEditor()?.show(),
        advanceOn: { type: 'event', eventName: EVENTS.RULESET_CHANGED }
    },
    
    // =========== ACT III: THE ANALYTICS SUITE ===========
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
        content: `These charts track <span class="onboarding-highlight-text">Activity Ratio</span> (how many cells are alive) and <span class="onboarding-highlight-text">Entropy</span> (a measure of complexity). They are invaluable for comparing rulesets.`,
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