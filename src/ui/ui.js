// src/ui/ui.js

import { OnboardingManager } from './OnboardingManager.js';
import { tours } from './tourSteps.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { downloadFile } from '../utils/utils.js';
import { TopInfoBar } from './TopInfoBar.js';
import { Toolbar } from './Toolbar.js';
import { PanelManager } from './PanelManager.js';
import { KeyboardShortcutManager } from './KeyboardShortcutManager.js';

let panelManager, toolbar;

function getUIElements() {
    // This function now just serves as a central query for all needed DOM elements.
    return {
        rulesetDisplay: document.getElementById('rulesetDisplay'),
        statTick: document.getElementById('stat-tick'),
        statRatio: document.getElementById('stat-ratio'),
        statBrushSize: document.getElementById('stat-brush-size'),
        statFps: document.getElementById('stat-fps'),
        statActualTps: document.getElementById('stat-actual-tps'),
        statTargetTps: document.getElementById('stat-target-tps'),
        playPauseButton: document.getElementById('playPauseButton'),
        speedControlButton: document.getElementById('speedControlButton'),
        brushToolButton: document.getElementById('brushToolButton'),
        newRulesButton: document.getElementById('newRulesButton'),
        mutateButton: document.getElementById('mutateButton'),
        undoButton: document.getElementById('undoButton'),
        redoButton: document.getElementById('redoButton'),
        historyButton: document.getElementById('historyButton'),
        setRulesetButton: document.getElementById('setRulesetButton'),
        libraryButton: document.getElementById('libraryButton'),
        saveStateButton: document.getElementById('saveStateButton'),
        loadStateButton: document.getElementById('loadStateButton'),
        resetClearButton: document.getElementById('resetClearButton'),
        editRuleButton: document.getElementById('editRuleButton'),
        setupPanelButton: document.getElementById('setupPanelButton'),
        analysisPanelButton: document.getElementById('analysisPanelButton'),
        rankPanelButton: document.getElementById('rankPanelButton'),
        shareButton: document.getElementById('shareButton'),
        speedPopout: document.getElementById('speedPopout'),
        brushPopout: document.getElementById('brushPopout'),
        newRulesPopout: document.getElementById('newRulesPopout'),
        setHexPopout: document.getElementById('setHexPopout'),
        resetClearPopout: document.getElementById('resetClearPopout'),
        libraryPopout: document.getElementById('libraryPopout'),
        sharePopout: document.getElementById('sharePopout'),
        historyPopout: document.getElementById('historyPopout'),
        mutatePopout: document.getElementById('mutatePopout'),
        speedSliderMountPopout: document.getElementById('speedSliderMountPopout'),
        neighborhoodSizeSliderMountPopout: document.getElementById('neighborhoodSizeSliderMountPopout'),
        shareLinkInput: document.getElementById('shareLinkInput'),
        copyShareLinkButton: document.getElementById('copyShareLinkButton'),
        generateModeSwitchPopout: document.getElementById('generateModeSwitchPopout'),
        useCustomBiasCheckboxPopout: document.getElementById('useCustomBiasCheckboxPopout'),
        biasSliderMountPopout: document.getElementById('biasSliderMountPopout'),
        rulesetScopeSwitchPopout: document.getElementById('rulesetScopeSwitchPopout'),
        mutationRateSliderMount: document.getElementById('mutationRateSliderMount'),
        mutateModeSwitch: document.getElementById('mutateModeSwitch'),
        mutateScopeSwitch: document.getElementById('mutateScopeSwitch'),
        triggerMutationButton: document.getElementById('triggerMutationButton'),
        cloneAndMutateButton: document.getElementById('cloneAndMutateButton'),
        resetOnNewRuleCheckboxPopout: document.getElementById('resetOnNewRuleCheckboxPopout'),
        generateRulesetFromPopoutButton: document.getElementById('generateRulesetFromPopoutButton'),
        rulesetInputPopout: document.getElementById('rulesetInputPopout'),
        setRuleFromPopoutButton: document.getElementById('setRuleFromPopoutButton'),
        copyRuleFromPopoutButton: document.getElementById('copyRuleFromPopoutButton'),
        resetCurrentButtonPopout: document.getElementById('resetCurrentButtonPopout'),
        resetAllButtonPopout: document.getElementById('resetAllButtonPopout'),
        clearCurrentButtonPopout: document.getElementById('clearCurrentButtonPopout'),
        clearAllButtonPopout: document.getElementById('clearAllButtonPopout'),
        editorRulesetInput: document.getElementById('editorRulesetInput'),
        rulesetEditorPanel: document.getElementById('rulesetEditorPanel'),
        setupPanel: document.getElementById('setupPanel'),
        analysisPanel: document.getElementById('analysisPanel'),
        ruleRankPanel: document.getElementById('ruleRankPanel'),
        fileInput: document.getElementById('fileInput'),
        canvas: document.getElementById('hexGridCanvas'),
    };
}

export function initUI(worldManagerInterface, libraryData) {
    const uiElements = getUIElements();

    const topInfoBar = new TopInfoBar(worldManagerInterface);
    topInfoBar.init(uiElements);

    toolbar = new Toolbar(worldManagerInterface, libraryData);
    toolbar.init(uiElements);
    
    panelManager = new PanelManager(worldManagerInterface);
    panelManager.init(uiElements);

    const keyboardManager = new KeyboardShortcutManager(worldManagerInterface, panelManager, toolbar);
    keyboardManager.init(uiElements);

    OnboardingManager.defineTours(tours);
    document.getElementById('helpButton').addEventListener('click', () => OnboardingManager.startTour('core', true));

    EventBus.subscribe(EVENTS.TRIGGER_DOWNLOAD, (data) => downloadFile(data.filename, data.content, data.mimeType));
    
    // Initial UI state sync
    toolbar.updatePauseButtonVisual(worldManagerInterface.isSimulationPaused());

    console.log("Modular Toolbar UI Initialized.");
    return true;
}

// Export accessors for components that might be needed by other systems (like the onboarding manager)
export function getRulesetEditor() { return panelManager?.getPanel('rulesetEditor'); }
export function getSetupPanel() { return panelManager?.getPanel('setupPanel'); }
export function getAnalysisPanel() { return panelManager?.getPanel('analysisPanel'); }
export function getRuleRankPanel() { return panelManager?.getPanel('ruleRankPanel'); }
export function showPopout(panelName, shouldShow = true) {
    if (toolbar) {
        const popout = toolbar.getPopout(panelName);
        if (popout) {
            if (shouldShow) {
                toolbar.closeAllPopouts();
                popout.show();
            } else {
                popout.hide();
            }
        }
    }
}