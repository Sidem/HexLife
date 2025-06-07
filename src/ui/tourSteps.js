// src/ui/tourSteps.js

import { EventBus, EVENTS } from '../services/EventBus.js';
import { OnboardingManager } from './OnboardingManager.js';
import * as UI from './ui.js';

/**
 * The 'onBeforeShow' functions are crucial for preparing the UI for the next step.
 * They ensure panels and popouts are open when they need to be highlighted.
 */

// A helper to close all popouts before showing a new one.
const showPopout = (panelName) => {
    EventBus.dispatch(EVENTS.COMMAND_SHOW_POPOUT, { panelName, shouldShow: true });
};

// The special "glider" ruleset used in the tutorial.
const gliderRuleset = "12482080480080006880800180010117";

export const tourSteps = [
    // =========== Chapter 1: First Contact ===========
    {
        element: '#hexGridCanvas',
        content: `<h3>Welcome, Explorer!</h3>You've discovered a multiverse of digital life. These are cellular automata on hexagonal grids, and you are in control.`,
        primaryAction: { text: 'Begin Exploration' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#playPauseButton',
        content: `The universe is currently paused. Press the **Play** button to set it in motion. The \`P\` key is a handy shortcut for this.`,
        advanceOn: { type: 'event', eventName: EVENTS.COMMAND_TOGGLE_PAUSE }
    },
    {
        element: '#main-content-area',
        content: `You're observing 9 worlds at once in the mini-map. This allows you to compare how different rules or starting conditions evolve. The highlighted world is the one in the main view.`,
        primaryAction: { text: 'Got it!' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#main-content-area',
        content: `**Click on any other world** in the mini-map to select it. You can also use the number keys \`1-9\` (corresponding to the numpad layout) to switch between them.`,
        advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED }
    },
    {
        element: '#hexGridCanvas',
        content: `Now for the fun part! You can edit the world directly. **Click and drag on the main view** to draw your own patterns. The simulation will pause automatically while you draw.`,
        primaryAction: { text: 'Continue' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#brushToolButton',
        content: `Your creative tool is the **Brush**. Click 'BRS' to open the brush size controls.`,
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#brushPopout',
        content: `Adjust the slider to change your brush size. You can also hover over the main canvas and use **ctrl + mouse wheel** for quick adjustments.`,
        primaryAction: { text: 'Next' },
        advanceOn: { type: 'click' }
    },

    // =========== Chapter 2: The Genetic Code ===========
    {
        element: '#rulesetDisplay',
        content: `<h3>The Genetic Code</h3>The behavior of each universe is dictated by its **Ruleset**. It's a 32-character hex code, like the DNA of this digital world.`,
        primaryAction: { text: 'How do I change it?' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#newRulesButton',
        content: `Let's create a new universe. Click 'NEW' to open the rule generator. The \`N\` key also works.`,
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#generateRulesetFromPopoutButton',
        content: `This panel has powerful options for generating rules. For now, just click **'Generate'** to create a new random ruleset and see how the simulation changes instantly.`,
        advanceOn: { type: 'event', eventName: EVENTS.RULESET_CHANGED }
    },
    {
        element: '#setRulesetButton',
        content: `Random rules are fun, but some specific rules create amazing patterns. Click 'HEX' to set a ruleset manually.`,
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#setHexPopout',
        content: `Now, let's load a famous ruleset that creates 'gliders'. **Paste the code below** into the input box. <br><br><code style="background: #222; padding: 5px 8px; border-radius: 4px; user-select: all;">${gliderRuleset}</code><br><button id="onboarding-copy-ruleset" class="button" style="margin-top: 10px;">Copy Ruleset</button>`,
        advanceOn: { type: 'event', eventName: EVENTS.UI_RULESET_INPUT_CHANGED }
    },
    {
        element: '#setRuleFromPopoutButton',
        content: `Excellent! Now click **'Set'** to apply the new rules. After the world resets, watch for the small, moving patterns—the 'gliders'!`,
        advanceOn: { type: 'event', eventName: EVENTS.RULESET_CHANGED }
    },

    // =========== Chapter 3: The Explorer's Toolkit ===========
    {
        element: '#editRuleButton',
        content: `<h3>The Explorer's Toolkit</h3>Ready to play god? The **Ruleset Editor** ('EDT') lets you modify the DNA of a universe, rule by rule. Click to open it.`,
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#rulesetEditorPanel',
        content: `The editor lets you see and change every rule. This view groups similar rules by their rotational symmetry. **Try clicking on a rule visualization** to toggle its output!`,
        primaryAction: { text: 'Understood' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#setupPanelButton',
        content: `The **World Setup** panel ('SET') lets you configure each of the 9 worlds' starting conditions and toggle them on or off.`,
        onBeforeShow: () => UI.getRulesetEditor()?.hide(),
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#setupPanel',
        content: `The **World Setup** panel ('SET') lets you configure each of the 9 worlds' starting conditions and toggle them on or off.`,
        primaryAction: { text: 'Understood' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#analysisPanelButton',
        content: `Curious about the data behind the patterns? The **Analysis Panel** ('ANL') provides real-time visualizations of world statistics.`,
        onBeforeShow: () => UI.getSetupPanel()?.hide(),
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#analysisPanel',
        content: `Here you can see the history of the world's **Activity Ratio** and **Entropy**. These are great for understanding the complexity of a ruleset.`,
        primaryAction: { text: 'Understood' },
        advanceOn: { type: 'click' }
    },
    {
        element: '#rankPanelButton',
        content: `The **Rule Rank** panel ('RNK') is a powerful tool that shows you which rules are being used most often, helping you understand *why* a world behaves the way it does.`,
        onBeforeShow: () => UI.getAnalysisPanel()?.hide(),
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: '#ruleRankPanel',
        content: `Here you you can watch the most used rules in the currently selected world.`,
        primaryAction: { text: 'Understood' },
        advanceOn: { type: 'click' }
    },

    // =========== Chapter 4: Go Forth and Discover! ===========
    {
        element: '#shareButton',
        content: `<h3>Go Forth!</h3>Found something amazing? Click 'SHR' to generate a unique URL to share your discovery with others.`,
        onBeforeShow: () => UI.getRuleRankPanel()?.hide(),
        advanceOn: { type: 'click', target: 'element' }
    },
    {
        element: 'body',
        content: `<h3>You're Ready to Explore!</h3>You've learned the basics. The best way to learn more is to experiment. Try generating new rules, editing them, and see what you discover! You can restart this tour anytime via the 'HLP' button.`,
        primaryAction: { text: 'Start Exploring' },
        advanceOn: { type: 'click' }
    }
];