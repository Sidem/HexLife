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
import { uiManager } from './UIManager.js';

let panelManager, toolbar, onboardingManager;
export { onboardingManager };



function initMobileUI(appContext, worldManagerInterface) {
    const bottomTabBarEl = document.getElementById('bottom-tab-bar');
    if (bottomTabBarEl) {
        new BottomTabBar(bottomTabBarEl, panelManager);
    }

    const mobileControls = document.getElementById('mobile-canvas-controls');
    if (mobileControls) {
        mobileControls.classList.toggle('hidden', !uiManager.isMobile());
        EventBus.subscribe(EVENTS.UI_MODE_CHANGED, ({ mode }) => {
            mobileControls.classList.toggle('hidden', mode !== 'mobile');
        });
    }

    const fabRightContainer = document.getElementById('mobile-fab-container-right');
    const fabLeftContainer = document.getElementById('mobile-fab-container-left');
    fabRightContainer.innerHTML = `
        <button id="mobileToolsFab" class="mobile-fab secondary-fab" title="Adjust Speed & Brush"><span class="icon">🛠️</span></button>
        <button id="interaction-mode-toggle" class="mobile-fab secondary-fab" title="Toggle Pan/Draw Mode"><span class="icon">🖐️</span></button>
        <button id="mobilePlayPauseButton" class="mobile-fab primary-fab">▶</button>
    `;
    new ToolsBottomSheet('fab-tools-bottom-sheet', fabRightContainer.querySelector('#mobileToolsFab'), appContext, worldManagerInterface);// ... inside initMobileUI function
    fabRightContainer.querySelector('#mobilePlayPauseButton').addEventListener('click', () => appContext.simulationController.togglePause());
    fabRightContainer.querySelector('#interaction-mode-toggle').addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_INTERACTION_MODE));
    EventBus.subscribe(EVENTS.SIMULATION_PAUSED, (isPaused) => {
        const mobilePlayPause = fabRightContainer.querySelector('#mobilePlayPauseButton');
        if (mobilePlayPause) mobilePlayPause.textContent = isPaused ? "▶" : "❚❚";
    });
    EventBus.subscribe(EVENTS.INTERACTION_MODE_CHANGED, (mode) => {
        const toggleIcon = fabRightContainer.querySelector('#interaction-mode-toggle .icon');
        if (toggleIcon) toggleIcon.textContent = mode === 'pan' ? '🖐️' : '✏️';
    });

    const fabActionMap = {
        'generate': {
            icon: '✨', title: 'Generate', handler: () => {
                appContext.rulesetActionController.generate();
            }
        },
        'mutate': {
            icon: '🦠', title: 'Mutate', handler: () => {
                appContext.rulesetActionController.mutate();
            }
        },
        'clone': {
            icon: '🧬', title: 'Clone & Mutate', handler: () => {
                appContext.rulesetActionController.cloneAndMutate();
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
        const orderedIds = (fabSettings.order && fabSettings.order.length > 0) ? fabSettings.order : fabSettings.enabled;
        const enabledSet = new Set(fabSettings.enabled);

        orderedIds.forEach(actionId => {
            if (!enabledSet.has(actionId)) return; 
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
                const canvasOffsetX = canvas.offsetLeft;
                const canvasOffsetY = canvas.offsetTop;
                const { x, y, width, height } = layout.selectedView;
                selectedWorldGuide.style.left = `${x + canvasOffsetX}px`;
                selectedWorldGuide.style.top = `${y + canvasOffsetY}px`;
                selectedWorldGuide.style.width = `${width}px`;
                selectedWorldGuide.style.height = `${height}px`;
                selectedWorldGuide.style.display = 'block';
                const { gridContainerX, gridContainerY, miniMapW, miniMapH, miniMapSpacing } = layout.miniMap;
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

export function initUI(appContext, worldManagerInterface, libraryData) {
    const topInfoBar = new TopInfoBar(appContext, worldManagerInterface);
    topInfoBar.init(); // No longer needs uiElements

    panelManager = new PanelManager(appContext, worldManagerInterface);
    panelManager.init(libraryData); // No longer needs uiElements

    toolbar = new Toolbar(appContext, worldManagerInterface, libraryData);
    toolbar.init(); // No longer needs uiElements

    const keyboardManager = new KeyboardShortcutManager(appContext, worldManagerInterface, panelManager, toolbar);
    keyboardManager.init(); // No longer needs uiElements

    initMobileUI(appContext, worldManagerInterface);

    onboardingManager = new OnboardingManager({
        overlay: document.getElementById('onboarding-overlay'),
        tooltip: document.getElementById('onboarding-tooltip'),
        title: document.getElementById('onboarding-tooltip-title'),
        content: document.getElementById('onboarding-tooltip-content'),
        primaryBtn: document.getElementById('onboarding-action-primary'),
        secondaryBtn: document.getElementById('onboarding-action-secondary'),
        progressBar: document.getElementById('onboarding-progress-bar'),
    }, appContext);
    onboardingManager.defineTours(tours);

    // Help button is now handled by the Learning Hub panel
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

    toolbar.updatePauseButtonVisual(appContext.simulationController.getState().isPaused);
    initGuidingBoxes();
    console.log(`UI Initialized for: ${uiManager.getMode()}`);
    return true;
}


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