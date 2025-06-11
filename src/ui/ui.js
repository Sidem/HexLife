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
import * as Config from '../core/config.js';

let panelManager, toolbar, onboardingManager;;
export { onboardingManager };

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
        'generate': {
            icon: '✨', title: 'Generate', handler: () => {
                const scope = PersistenceService.loadUISetting('globalRulesetScopeAll', true) ? 'all' : 'selected';
                EventBus.dispatch(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, {
                    bias: PersistenceService.loadUISetting('biasValue', 0.33),
                    generationMode: PersistenceService.loadUISetting('rulesetGenerationMode', 'r_sym'),
                    resetScopeForThisChange: PersistenceService.loadUISetting('resetOnNewRule', true) ? scope : 'none'
                });
            }
        },
        'mutate': {
            icon: '🦠', title: 'Mutate', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_MUTATE_RULESET, {
                    mutationRate: PersistenceService.loadUISetting('mutationRate', 1) / 100.0,
                    scope: PersistenceService.loadUISetting('mutateScope', 'selected'),
                    mode: PersistenceService.loadUISetting('mutateMode', 'single')
                });
            }
        },
        'clone': {
            icon: '🧬', title: 'Clone & Mutate', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_CLONE_AND_MUTATE, {
                    mutationRate: PersistenceService.loadUISetting('mutationRate', 1) / 100.0,
                    mode: PersistenceService.loadUISetting('mutateMode', 'single')
                });
            }
        },
        'clear-one': { icon: '🧹', title: 'Clear World', command: EVENTS.COMMAND_CLEAR_WORLDS, payload: { scope: 'selected' } },
        'clear-all': { icon: '💥', title: 'Clear All', command: EVENTS.COMMAND_CLEAR_WORLDS, payload: { scope: 'all' } },
        'reset-one': { icon: '🔄', title: 'Reset World', command: EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, payload: { scope: 'selected' } },
        'reset-all': { icon: '🌍', title: 'Reset All', command: EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES, payload: {} }
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
            button.addEventListener('click', () => {
                if (action.handler) {
                    action.handler();
                } else {
                    EventBus.dispatch(action.command, action.payload);
                }
            });
            fabLeftContainer.appendChild(button);
        });
    }

    // --- Step 3: Initial Render & Event Subscriptions ---
    renderCustomFabs();
    EventBus.subscribe(EVENTS.COMMAND_UPDATE_FAB_UI, renderCustomFabs);
}

function initGuidingBoxes() {
    const canvas = document.getElementById('hexGridCanvas');
    const selectedWorldGuide = document.getElementById('selected-world-guide');
    const miniMapGuide = document.getElementById('minimap-guide');

    if (canvas && selectedWorldGuide && miniMapGuide) {
        EventBus.subscribe(EVENTS.LAYOUT_CALCULATED, (layout) => {
            if (layout && layout.selectedView && layout.miniMap) {
                // Get the canvas's position relative to its direct parent (#main-content-area)
                // This is the correct, dynamic offset that replaces your manual values.
                const canvasOffsetX = canvas.offsetLeft;
                const canvasOffsetY = canvas.offsetTop;

                // --- Position the Selected World Guide ---
                const { x, y, width, height } = layout.selectedView;
                selectedWorldGuide.style.left = `${x + canvasOffsetX}px`;
                selectedWorldGuide.style.top = `${y + canvasOffsetY}px`;
                selectedWorldGuide.style.width = `${width}px`;
                selectedWorldGuide.style.height = `${height}px`;
                selectedWorldGuide.style.display = 'block';

                // --- Position the Minimap Guide ---
                const { gridContainerX, gridContainerY, miniMapW, miniMapH, miniMapSpacing } = layout.miniMap;
                
                // Calculate total grid size dynamically using config variables
                const miniMapGridWidth = miniMapW * Config.WORLD_LAYOUT_COLS + miniMapSpacing * (Config.WORLD_LAYOUT_COLS - 1);
                const miniMapGridHeight = miniMapH * Config.WORLD_LAYOUT_ROWS + miniMapSpacing * (Config.WORLD_LAYOUT_ROWS - 1);

                miniMapGuide.style.left = `${gridContainerX + canvasOffsetX}px`;
                miniMapGuide.style.top = `${gridContainerY + canvasOffsetY}px`;
                miniMapGuide.style.width = `${miniMapGridWidth}px`;
                miniMapGuide.style.height = `${miniMapGridHeight}px`;
                miniMapGuide.style.display = 'block';
            }
        });
    }
}

export function initUI(worldManagerInterface, libraryData, isMobile) {
    const uiElements = getUIElements();
    const topInfoBar = new TopInfoBar(worldManagerInterface);
    topInfoBar.init(uiElements);

    panelManager = new PanelManager(worldManagerInterface, isMobile);
    panelManager.init(uiElements, libraryData);

    if (isMobile) {
        initMobileUI(worldManagerInterface, panelManager, uiElements);
    } else {
        toolbar = new Toolbar(worldManagerInterface, libraryData, isMobile);
        toolbar.init(uiElements);
    }
    const keyboardManager = new KeyboardShortcutManager(worldManagerInterface, panelManager, toolbar, isMobile);
    keyboardManager.init(uiElements);

    onboardingManager = new OnboardingManager({
        overlay: document.getElementById('onboarding-overlay'),
        tooltip: document.getElementById('onboarding-tooltip'),
        title: document.getElementById('onboarding-tooltip-title'),
        content: document.getElementById('onboarding-tooltip-content'),
        primaryBtn: document.getElementById('onboarding-action-primary'),
        secondaryBtn: document.getElementById('onboarding-action-secondary'),
        progressBar: document.getElementById('onboarding-progress-bar'),
    });
    onboardingManager.defineTours(tours);

    const helpButton = document.getElementById('helpButton');
    if (helpButton) {
        if (!isMobile) {
            helpButton.addEventListener('click', () => onboardingManager.startTour('core', true));
        } else {
            helpButton.classList.add('hidden');
        }
    }
    window.OnboardingManager = onboardingManager;

    document.body.addEventListener('click', (event) => {
        const helpTrigger = event.target.closest('.button-help-trigger');
        if (helpTrigger && helpTrigger.dataset.tourName) {
            event.stopPropagation();
            onboardingManager.startTour(helpTrigger.dataset.tourName, true);
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

    initGuidingBoxes();
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