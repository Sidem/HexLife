// src/ui/ui.js

import { OnboardingManager } from './OnboardingManager.js';
import { tours } from './tourSteps.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { downloadFile } from '../utils/utils.js';
import { TopInfoBar } from './TopInfoBar.js';
import { Toolbar } from './Toolbar.js';
import { PanelManager } from './PanelManager.js';
import { KeyboardShortcutManager } from './KeyboardShortcutManager.js';
import { BottomTabBar } from './BottomTabBar.js';
import { ToolsBottomSheet } from './components/ToolsBottomSheet.js';

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
        mobileViewsContainer: document.getElementById('mobile-views-container'),
        mobileToolsButton: document.getElementById('mobileToolsButton'),
    };
}

function initMobileUI(worldManagerInterface, panelManager, uiElements) {
    console.log("Mobile UI Initialized");

    const bottomTabBarEl = document.getElementById('bottom-tab-bar');
    if (bottomTabBarEl) {
        const tabBar = new BottomTabBar(bottomTabBarEl, panelManager);
        bottomTabBarEl.classList.remove('hidden');
    }

    const fabContainer = document.createElement('div');
    fabContainer.id = 'mobile-fab-container';
    fabContainer.innerHTML = `
        <button id="mobileToolsFab" class="mobile-fab secondary-fab" title="Adjust Speed & Brush">
            <span class="icon">🛠️</span>
        </button>
        <button id="interaction-mode-toggle" class="mobile-fab secondary-fab" title="Toggle Pan/Draw Mode">
            <span class="icon">🖐️</span>
        </button>
        <button id="mobilePlayPauseButton" class="mobile-fab primary-fab">▶</button>
    `;
    uiElements.canvas.parentElement.appendChild(fabContainer);

    const toolsTabButton = document.querySelector('.tab-bar-button[data-view="tools"]');
    if (toolsTabButton) {
        new ToolsBottomSheet('tools-bottom-sheet', toolsTabButton, worldManagerInterface);
    }

    const mobileToolsFab = fabContainer.querySelector('#mobileToolsFab');
    if (mobileToolsFab) {
        new ToolsBottomSheet('fab-tools-bottom-sheet', mobileToolsFab, worldManagerInterface);
    }

    const mobileToolsButton = document.querySelector('.tab-bar-button[data-view="tools"]');
    if (mobileToolsButton) {
        const toolsSheet = new ToolsBottomSheet('tools-bottom-sheet', mobileToolsButton, worldManagerInterface);
    }

    const mobilePlayPauseButton = fabContainer.querySelector('#mobilePlayPauseButton');
    mobilePlayPauseButton.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE));

    const interactionModeButton = fabContainer.querySelector('#interaction-mode-toggle');
    interactionModeButton.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_INTERACTION_MODE));

    EventBus.subscribe(EVENTS.SIMULATION_PAUSED, (isPaused) => {
        mobilePlayPauseButton.textContent = isPaused ? "▶" : "❚❚";
    });

    EventBus.subscribe(EVENTS.INTERACTION_MODE_CHANGED, (mode) => {
        const icon = interactionModeButton.querySelector('.icon');
        if (icon) {
            icon.textContent = mode === 'pan' ? '🖐️' : '✏️';
        }
    });
}

export function initUI(worldManagerInterface, libraryData, isMobile) {
    const uiElements = getUIElements();

    // --- SHARED INITIALIZATION ---
    // TopInfoBar is used by both layouts, so it must be initialized first.
    const topInfoBar = new TopInfoBar(worldManagerInterface);
    topInfoBar.init(uiElements);

    // PanelManager is also shared, managing panel state for both layouts.
    panelManager = new PanelManager(worldManagerInterface, isMobile);
    panelManager.init(uiElements, libraryData);

    // --- LAYOUT-SPECIFIC INITIALIZATION ---
    if (isMobile) {
        initMobileUI(worldManagerInterface, panelManager, uiElements);
    } else {
        // Desktop-only components
        toolbar = new Toolbar(worldManagerInterface, libraryData, isMobile);
        toolbar.init(uiElements);
    }

    // --- GLOBAL INITIALIZATION ---
    // Keyboard shortcuts are mostly for desktop, but Escape key can be global.
    const keyboardManager = new KeyboardShortcutManager(worldManagerInterface, panelManager, toolbar, isMobile);
    keyboardManager.init(uiElements);

    OnboardingManager.defineTours(tours);
    const helpButton = document.getElementById('helpButton');
    if (helpButton) {
        if (!isMobile) {
            helpButton.addEventListener('click', () => OnboardingManager.startTour('core', true));
        } else {
            helpButton.classList.add('hidden');
        }
    }

    document.body.addEventListener('click', (event) => {
        const helpTrigger = event.target.closest('.button-help-trigger');
        if (helpTrigger && helpTrigger.dataset.tourName) {
            event.stopPropagation();
            OnboardingManager.startTour(helpTrigger.dataset.tourName, true);
        }
    });

    EventBus.subscribe(EVENTS.TRIGGER_DOWNLOAD, (data) => downloadFile(data.filename, data.content, data.mimeType));

    EventBus.subscribe(EVENTS.TRIGGER_FILE_LOAD, (data) => {
        const reader = new FileReader();
        reader.onload = re => {
            try {
                const loadedData = JSON.parse(re.target.result);
                EventBus.dispatch(EVENTS.COMMAND_LOAD_WORLD_STATE, { worldIndex: worldManagerInterface.getSelectedWorldIndex(), loadedData });
            } catch (err) { alert(`Error processing file: ${err.message}`); }
        };
        reader.onerror = () => { alert(`Error reading file.`); };
        reader.readAsText(data.file);
    });

    // Initial UI state sync
    if (!isMobile && toolbar) {
        toolbar.updatePauseButtonVisual(worldManagerInterface.isSimulationPaused());
    } else if (isMobile) {
        const playPauseButton = uiElements.playPauseButton;
        if (playPauseButton) playPauseButton.textContent = worldManagerInterface.isSimulationPaused() ? "▶" : "❚❚";
    }

    console.log(`UI Initialized for: ${isMobile ? 'Mobile' : 'Desktop'}`);
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