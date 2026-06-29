import { EventBus, EVENTS } from '../services/EventBus.js';
import { PopoutPanel } from './components/PopoutPanel.js';
import { ControlsComponent } from './components/ControlsComponent.js';
import { PatternsComponent } from './components/PatternsComponent.js';
import * as PersistenceService from '../services/PersistenceService.js';
import { ICONS } from './icons.js';

// Short, plain-language labels shown beside each icon when the rail is expanded.
// They double as the `aria-label` for every icon-only control (closing the a11y
// gap where the name was previously only on `title`).
const TOOLBAR_BUTTON_LABELS = {
    playPauseButton: 'Play / Pause',
    controlsButton: 'Speed & Brush',
    resetClearButton: 'Reset / Clear',
    patternsButton: 'Patterns',
    rulesetActionsButton: 'Generate & Mutate',
    libraryButton: 'Library',
    editRuleButton: 'Edit Ruleset',
    setupPanelButton: 'World Setup',
    exploreButton: 'Auto-Explore',
    analysisPanelButton: 'Analysis',
    rankPanelButton: 'Rule Usage',
    saveStateButton: 'Save State',
    loadStateButton: 'Load State',
    exportPngButton: 'Export PNG',
    recordWebmButton: 'Record Video',
    shareButton: 'Share',
    colorPanelButton: 'Colors',
    settingsButton: 'Settings',
    shortcutsButton: 'Shortcuts',
    helpButton: 'Learning Hub',
};

// A header is injected before the first button of each group; shown only when the
// rail is expanded (the hairline separators serve the collapsed icon rail).
const TOOLBAR_GROUP_HEADERS = {
    controlsButton: 'Simulate',
    rulesetActionsButton: 'Rules',
    exploreButton: 'Discover',
    saveStateButton: 'Capture',
    colorPanelButton: 'Settings',
};

const TOOLBAR_BUTTON_ICONS = {
    controlsButton: ICONS.sliders,
    patternsButton: ICONS.shapes,
    rulesetActionsButton: ICONS.sparkles,
    libraryButton: ICONS.library,
    resetClearButton: ICONS.rotateCcw,
    editRuleButton: ICONS.pencil,
    setupPanelButton: ICONS.globe,
    exploreButton: ICONS.compass,
    analysisPanelButton: ICONS.chartLine,
    rankPanelButton: ICONS.trophy,
    saveStateButton: ICONS.save,
    loadStateButton: ICONS.folderOpen,
    exportPngButton: ICONS.camera,
    recordWebmButton: ICONS.video,
    shareButton: ICONS.share,
    colorPanelButton: ICONS.palette,
    settingsButton: ICONS.cog,
    shortcutsButton: ICONS.keyboard,
    helpButton: ICONS.graduationCap,
};

export class Toolbar {
    constructor(appContext, libraryData) {
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.libraryData = libraryData;
        
        this.uiElements = null;
        this.sliderComponents = {};
        this.switchComponents = {};
        this.popoutPanels = {};
        this.activePopouts = [];
        this.toolbarElement = document.getElementById('vertical-toolbar');
        this.popoutConfig = [
            { name: 'controls', buttonId: 'controlsButton', popoutId: 'controlsPopout', options: { position: 'right', alignment: 'start' } },
            { name: 'patterns', buttonId: 'patternsButton', popoutId: 'patternsPopout', options: { position: 'right', alignment: 'start' } },
            { name: 'resetClear', buttonId: 'resetClearButton', popoutId: 'resetClearPopout', options: { position: 'right', alignment: 'start', offset: 5 } },
            { name: 'share', buttonId: 'shareButton', popoutId: 'sharePopout', options: { position: 'right', alignment: 'start' } }
        ];
    }

    init() {
        this.uiElements = {
            playPauseButton: document.getElementById('playPauseButton'),
            controlsButton: document.getElementById('controlsButton'),
            patternsButton: document.getElementById('patternsButton'),
            rulesetActionsButton: document.getElementById('rulesetActionsButton'),
            libraryButton: document.getElementById('libraryButton'),
            resetClearButton: document.getElementById('resetClearButton'),
            shareButton: document.getElementById('shareButton'),
            controlsPopout: document.getElementById('controlsPopout'),
            patternsPopout: document.getElementById('patternsPopout'),
            resetClearPopout: document.getElementById('resetClearPopout'),
            sharePopout: document.getElementById('sharePopout'),
            resetCurrentButtonPopout: document.getElementById('resetCurrentButtonPopout'),
            resetAllButtonPopout: document.getElementById('resetAllButtonPopout'),
            clearCurrentButtonPopout: document.getElementById('clearCurrentButtonPopout'),
            clearAllButtonPopout: document.getElementById('clearAllButtonPopout'),
            shareLinkInput: document.getElementById('shareLinkInput'),
            shareIncludeStateCheckbox: document.getElementById('shareIncludeStateCheckbox'),
            copyShareLinkButton: document.getElementById('copyShareLinkButton'),
            saveStateButton: document.getElementById('saveStateButton'),
            loadStateButton: document.getElementById('loadStateButton'),
            exportPngButton: document.getElementById('exportPngButton'),
            recordWebmButton: document.getElementById('recordWebmButton'),
            fileInput: document.getElementById('fileInput'),
            editRuleButton: document.getElementById('editRuleButton'),
            setupPanelButton: document.getElementById('setupPanelButton'),
            exploreButton: document.getElementById('exploreButton'),
            analysisPanelButton: document.getElementById('analysisPanelButton'),
            rankPanelButton: document.getElementById('rankPanelButton'),
            colorPanelButton: document.getElementById('colorPanelButton'),
            settingsButton: document.getElementById('settingsButton'),
            shortcutsButton: document.getElementById('shortcutsButton'),
            helpButton: document.getElementById('helpButton'),
        };
        for (const [elementId, svg] of Object.entries(TOOLBAR_BUTTON_ICONS)) {
            this._decorateButton(elementId, svg);
        }
        // Play/Pause carries a dynamic glyph; decorate it once so it gains a label +
        // aria-label, then updatePauseButtonVisual only swaps the inner icon.
        this._decorateButton('playPauseButton', ICONS.play);
        this.updatePauseButtonVisual(this.appContext.simulationController?.getIsPaused() ?? true);
        this._buildToolbarChrome();
        this._initPopoutPanels();
        this._initPopoutControls();
        this._setupToolbarButtonListeners();
        this._setupStateListeners();

    }
    
    /**
     * Wraps a toolbar button's glyph in a `.toolbar-icon` span and appends a
     * `.toolbar-label` (revealed only in the expanded rail). The label is also set
     * as the button's `aria-label` so the control has a robust accessible name.
     * @private
     */
    _decorateButton(elementId, svg) {
        const el = this.uiElements[elementId];
        if (!el) return;
        const label = TOOLBAR_BUTTON_LABELS[elementId] || el.title || '';
        el.innerHTML = `<span class="toolbar-icon">${svg}</span><span class="toolbar-label">${label}</span>`;
        if (label) el.setAttribute('aria-label', label);
    }

    /** Swaps only the inner glyph of a decorated button, preserving its label. @private */
    _setButtonIcon(el, svg) {
        if (!el) return;
        const iconSpan = el.querySelector('.toolbar-icon');
        if (iconSpan) iconSpan.innerHTML = svg;
        else el.innerHTML = svg;
    }

    /**
     * Injects the group headers and the expand/collapse toggle, then restores the
     * persisted rail state. Collapsed (default) is byte-identical to the icon rail.
     * @private
     */
    _buildToolbarChrome() {
        if (!this.toolbarElement) return;

        for (const [elementId, text] of Object.entries(TOOLBAR_GROUP_HEADERS)) {
            const el = this.uiElements[elementId];
            if (!el || !el.parentNode) continue;
            const header = document.createElement('div');
            header.className = 'toolbar-group-header';
            header.setAttribute('aria-hidden', 'true');
            header.textContent = text;
            el.parentNode.insertBefore(header, el);
        }

        const toggle = document.createElement('button');
        toggle.id = 'toolbarExpandToggle';
        toggle.className = 'toolbar-button toolbar-expand-toggle';
        toggle.innerHTML = `<span class="toolbar-icon">${ICONS.panelRight}</span><span class="toolbar-label">Collapse</span>`;
        this.toolbarElement.insertBefore(toggle, this.toolbarElement.firstChild);
        this._expandToggle = toggle;
        toggle.addEventListener('click', () =>
            this._setToolbarExpanded(!this.toolbarElement.classList.contains('is-expanded')));

        this._setToolbarExpanded(
            PersistenceService.loadUISetting('toolbarExpanded', false),
            { persist: false, resize: false }
        );
    }

    /**
     * Toggles the labelled rail. Changing the rail width reflows the canvas flex
     * slot, so a synthetic resize lets the WebGL renderer recompute its layout.
     * @private
     */
    _setToolbarExpanded(expanded, { persist = true, resize = true } = {}) {
        if (!this.toolbarElement) return;
        this.toolbarElement.classList.toggle('is-expanded', expanded);
        if (this._expandToggle) {
            this._expandToggle.setAttribute('aria-label', expanded ? 'Collapse toolbar' : 'Expand toolbar');
            this._expandToggle.title = expanded ? 'Collapse toolbar' : 'Expand toolbar labels';
        }
        if (persist) PersistenceService.saveUISetting('toolbarExpanded', expanded);
        if (resize) window.dispatchEvent(new Event('resize'));
    }

    _initPopoutPanels() {
        this.popoutConfig.forEach(config => {
            const buttonElement = this.uiElements[config.buttonId];
            const popoutElement = this.uiElements[config.popoutId];
            if (buttonElement && popoutElement) {
                const options = { ...config.options };
                if (config.name === 'controls') {
                    const controlsMount = popoutElement.querySelector('#desktopControlsMount');
                    if (controlsMount) {
                        options.contentContainer = controlsMount;
                        options.contentComponentType = ControlsComponent;
                    }
                } else if (config.name === 'patterns') {
                    const patternsMount = popoutElement.querySelector('#desktopPatternsMount');
                    if (patternsMount) {
                        options.contentContainer = patternsMount;
                        options.contentComponentType = PatternsComponent;
                    }
                }

                this.popoutPanels[config.name] = new PopoutPanel(popoutElement, buttonElement, options);
            }
        });
        // Append rather than reassign: other components (e.g. TopInfoBar) may
        // have registered their popouts before init() runs.
        this.activePopouts.push(...Object.values(this.popoutPanels));
    }

    /**
     * Registers an externally-owned popout so it participates in shared
     * close-on-outside-click and Escape handling.
     */
    registerPopout(popout) {
        if (popout && !this.activePopouts.includes(popout)) {
            this.activePopouts.push(popout);
        }
    }

    _initPopoutControls() {
        this.uiElements.resetCurrentButtonPopout.addEventListener('click', () => { EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, { scope: 'selected' }); this.popoutPanels.resetClear.hide(); });
        this.uiElements.resetAllButtonPopout.addEventListener('click', () => { EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES); this.popoutPanels.resetClear.hide(); });
        this.uiElements.clearCurrentButtonPopout.addEventListener('click', () => { EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'selected' }); this.popoutPanels.resetClear.hide(); });
        this.uiElements.clearAllButtonPopout.addEventListener('click', () => { EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'all' }); this.popoutPanels.resetClear.hide(); });
    }

    _setupToolbarButtonListeners() {
        const buttonToActionMap = {
            playPauseButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE),
            controlsButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_POPOUT, { popoutName: 'controls' }),
            patternsButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_POPOUT, { popoutName: 'patterns' }),
            rulesetActionsButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'rulesetactions' }),
            libraryButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'library' }),
            resetClearButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_POPOUT, { popoutName: 'resetClear' }),
            editRuleButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'ruleset' }),
            analysisPanelButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'analysis' }),
            rankPanelButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'rulerank' }),
            setupPanelButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'worldsetup' }),
            exploreButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'explore' }),
            colorPanelButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'chromalab' }),
            settingsButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'settings' }),
            shortcutsButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'shortcuts' }),
            helpButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'learning' }),
            shareButton: () => { EventBus.dispatch(EVENTS.COMMAND_TOGGLE_POPOUT, { popoutName: 'share' }); EventBus.dispatch(EVENTS.COMMAND_SHARE_SETUP); },
            saveStateButton: () => EventBus.dispatch(EVENTS.COMMAND_SAVE_SELECTED_WORLD_STATE),
            exportPngButton: () => EventBus.dispatch(EVENTS.COMMAND_EXPORT_WORLD_PNG),
            recordWebmButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_WORLD_RECORDING),
            loadStateButton: () => {
                this.uiElements.fileInput.accept = ".txt,.json";
                this.uiElements.fileInput.click();
            },
            copyShareLinkButton: this._copyShareLink.bind(this)
        };

        for (const [elementId, action] of Object.entries(buttonToActionMap)) {
            if (this.uiElements[elementId]) {
                this.uiElements[elementId].addEventListener('click', action);
            }
        }
    }

    _setupStateListeners() {
        this.uiElements.fileInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) { e.target.value = null; return; }
            const reader = new FileReader();
            reader.onload = re => {
                try {
                    const data = JSON.parse(re.target.result);
                    if (!data?.rows || !data?.cols || !Array.isArray(data.state) || !data.rulesetHex) throw new Error("Invalid format or missing rulesetHex.");
                    EventBus.dispatch(EVENTS.COMMAND_LOAD_WORLD_STATE, { worldIndex: this.worldManager.getSelectedWorldIndex(), loadedData: data });
                } catch (err) { EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Error processing file: ${err.message}`, type: 'error' }); }
                finally { e.target.value = null; }
            };
            reader.onerror = () => { EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Error reading file.', type: 'error' }); e.target.value = null; };
            reader.readAsText(file);
        });

        // Toggling "include full world state" regenerates the link in place.
        this.uiElements.shareIncludeStateCheckbox?.addEventListener('change', () => {
            EventBus.dispatch(EVENTS.COMMAND_SHARE_SETUP);
        });

        EventBus.subscribe(EVENTS.SIMULATION_PAUSED, (isPaused) => this.updatePauseButtonVisual(isPaused));
        EventBus.subscribe(EVENTS.WORLD_RECORDING_STATE_CHANGED, ({ recording }) => this.updateRecordButtonVisual(recording));
    }

    updateRecordButtonVisual(isRecording) {
        const button = this.uiElements?.recordWebmButton;
        if (!button) return;
        this._setButtonIcon(button, isRecording ? ICONS.stopCircle : ICONS.video);
        button.title = isRecording ? 'Stop recording & save WebM' : 'Record WebM video of the canvas';
        button.classList.toggle('is-recording', !!isRecording);
    }

    _copyShareLink() {
        if (this.uiElements.shareLinkInput.value) {
            this.uiElements.shareLinkInput.select();
            navigator.clipboard.writeText(this.uiElements.shareLinkInput.value).then(() => {
                this.uiElements.copyShareLinkButton.textContent = "Copied!";
                setTimeout(() => this.uiElements.copyShareLinkButton.textContent = "Copy to Clipboard", 1500);
            }).catch(_err => EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Failed to copy link.', type: 'error' }));
        }
    }

    updatePauseButtonVisual(isPaused) {
        if (this.uiElements?.playPauseButton) {
            this._setButtonIcon(this.uiElements.playPauseButton, isPaused ? ICONS.play : ICONS.pause);
            this.uiElements.playPauseButton.title = isPaused ? "[P]lay Simulation" : "[P]ause Simulation";
        }
    }

    getPopout(panelName) { 
        return this.popoutPanels[panelName]; 
    }

    closeAllPopouts(excludePopout = null) {
        let wasOpen = false;
        this.activePopouts.forEach(p => {
            if (p !== excludePopout && !p.isHidden()) {
                p.hide();
                wasOpen = true;
            }
        });
        return wasOpen;
    }
}