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
import * as PersistenceService from '../services/PersistenceService.js';

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
    console.log("Mobile UI Initialized with corrected FAB logic");

    const bottomTabBarEl = document.getElementById('bottom-tab-bar');
    if (bottomTabBarEl) {
        new BottomTabBar(bottomTabBarEl, panelManager);
        bottomTabBarEl.classList.remove('hidden');
    }

    document.getElementById('mobile-canvas-controls')?.classList.remove('hidden');
    const fabRightContainer = document.getElementById('mobile-fab-container-right');
    const fabLeftContainer = document.getElementById('mobile-fab-container-left');
    
    // --- Step 1: Render the STATIC Right-side FABs ---
    // These buttons are permanent and not part of the customization system.
    fabRightContainer.innerHTML = `
        <button id="mobileToolsFab" class="mobile-fab secondary-fab" title="Adjust Speed & Brush"><span class="icon">🛠️</span></button>
        <button id="interaction-mode-toggle" class="mobile-fab secondary-fab" title="Toggle Pan/Draw Mode"><span class="icon">🖐️</span></button>
        <button id="mobilePlayPauseButton" class="mobile-fab primary-fab">▶</button>
    `;

    // Connect listeners to the permanent right-side FABs
    new ToolsBottomSheet('fab-tools-bottom-sheet', fabRightContainer.querySelector('#mobileToolsFab'), worldManagerInterface);
    fabRightContainer.querySelector('#mobilePlayPauseButton').addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE));
    fabRightContainer.querySelector('#interaction-mode-toggle').addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_INTERACTION_MODE));
    EventBus.subscribe(EVENTS.SIMULATION_PAUSED, (isPaused) => {
        fabRightContainer.querySelector('#mobilePlayPauseButton').textContent = isPaused ? "▶" : "❚❚";
    });
    EventBus.subscribe(EVENTS.INTERACTION_MODE_CHANGED, (mode) => {
        fabRightContainer.querySelector('#interaction-mode-toggle .icon').textContent = mode === 'pan' ? '🖐️' : '✏️';
    });


    // --- Step 2: Render the DYNAMIC Left-side FABs ---
    // This logic is completely separate from the right side.
    const fabActionMap = {
        'generate': { icon: '✨', title: 'Generate', command: EVENTS.COMMAND_GENERATE_RANDOM_RULESET, payload: { bias: 0.5, generationMode: 'r_sym', resetScopeForThisChange: 'all' } },
        'mutate':   { icon: '🦠', title: 'Mutate', command: EVENTS.COMMAND_MUTATE_RULESET, payload: { mutationRate: 0.05, scope: 'selected', mode: 'single' } },
        'clone':    { icon: '🧬', title: 'Clone & Mutate', command: EVENTS.COMMAND_CLONE_AND_MUTATE, payload: { mutationRate: 0.05, mode: 'single' } },
        'clear-one':{ icon: '🧹', title: 'Clear World', command: EVENTS.COMMAND_CLEAR_WORLDS, payload: { scope: 'selected' } },
        'clear-all':{ icon: '💥', title: 'Clear All', command: EVENTS.COMMAND_CLEAR_WORLDS, payload: { scope: 'all' } },
        'reset-one':{ icon: '🔄', title: 'Reset World', command: EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, payload: { scope: 'selected' } },
        'reset-all':{ icon: '🌍', title: 'Reset All', command: EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES, payload: {} }
    };
    
    function renderCustomFabs() {
        fabLeftContainer.innerHTML = '';
        const fabSettings = PersistenceService.loadUISetting('fabSettings', { enabled: ['generate', 'clone', 'reset-all'], locked: true, order: [] });

        // Use saved order, or default to the order they were enabled in
        const orderedIds = (fabSettings.order && fabSettings.order.length > 0) ? fabSettings.order : fabSettings.enabled;
        const enabledSet = new Set(fabSettings.enabled);
        
        orderedIds.forEach(actionId => {
            if (!enabledSet.has(actionId)) return; // Only render enabled buttons

            const action = fabActionMap[actionId];
            if (!action) return;

            const button = document.createElement('button');
            button.className = 'mobile-fab secondary-fab';
            button.innerHTML = `<span class="icon">${action.icon}</span>`;
            button.title = action.title;
            button.dataset.actionId = actionId;
            button.draggable = !fabSettings.locked;
            if (!fabSettings.locked) {
                button.classList.add('draggable');
            }
            button.addEventListener('click', () => EventBus.dispatch(action.command, action.payload));
            fabLeftContainer.appendChild(button);
        });
    }

    // --- Step 3: Initial Render & Event Subscriptions ---
    renderCustomFabs();
    EventBus.subscribe(EVENTS.COMMAND_UPDATE_FAB_UI, renderCustomFabs);
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