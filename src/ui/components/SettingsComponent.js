import { BaseComponent } from './BaseComponent.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { ToggleSwitch } from './ToggleSwitch.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import * as Config from '../../core/config.js';
import { APP_VERSION } from '../../version.js';
import {
    getTorusViewSettings,
    updateTorusViewSettings,
} from '../../services/TorusViewSettings.js';

export const SETTINGS_TAB_IDS = Object.freeze(['display', 'simulation', 'torus']);

export function normalizeSettingsTab(value) {
    return SETTINGS_TAB_IDS.includes(value) ? value : 'display';
}

let nextSettingsInstanceId = 0;

/**
 * The global Settings / Preferences panel. A single home for cross-cutting preferences
 * that were previously scattered (display toggles lived under "Controls") or had no home
 * at all (confirm-destructive-actions). Contextual settings stay where they belong — brush
 * mode in Controls, search params in Explore — so this panel is intentionally not a catch-all.
 *
 * Every toggle is backed by the existing persisted UI-settings store via the same COMMAND_*
 * events the old surfaces used, so behaviour and persistence are unchanged; only the location
 * moves. Built as a shared component (one instance, mounted into the desktop draggable panel
 * or the mobile view), matching the Controls/Explore pattern.
 */
export class SettingsComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options);
        this.appContext = appContext;
        this.element = document.createElement('div');
        this.element.className = 'settings-component-content';
        this.instanceId = ++nextSettingsInstanceId;
        this.controls = [];
        this.render();
        this._subscribeToEvent(EVENTS.TORUS_SETTINGS_CHANGED, (settings) => {
            this._syncTorusControls(settings);
        });
    }

    getElement() {
        return this.element;
    }

    render() {
        this.activeTab = normalizeSettingsTab(
            PersistenceService.loadUISetting('settingsActiveTab', 'display'),
        );
        const panelId = (tabId) => `settings-tab-panel-${tabId}-${this.instanceId}`;
        const tabId = (id) => `settings-tab-${id}-${this.instanceId}`;

        this.element.innerHTML = `
            <nav class="settings-tabs" role="tablist" aria-label="Settings categories">
                <button id="${tabId('display')}" class="settings-tab" type="button" role="tab"
                        data-settings-tab="display" aria-controls="${panelId('display')}">
                    <span class="settings-tab-label">Display</span>
                    <span class="settings-tab-meta">Visuals &amp; interface</span>
                </button>
                <button id="${tabId('simulation')}" class="settings-tab" type="button" role="tab"
                        data-settings-tab="simulation" aria-controls="${panelId('simulation')}">
                    <span class="settings-tab-label">Simulation</span>
                    <span class="settings-tab-meta">Grid &amp; safeguards</span>
                </button>
                <button id="${tabId('torus')}" class="settings-tab" type="button" role="tab"
                        data-settings-tab="torus" aria-controls="${panelId('torus')}">
                    <span class="settings-tab-label">3D Torus</span>
                    <span class="settings-tab-meta">Shape &amp; motion</span>
                </button>
            </nav>

            <div id="${panelId('display')}" class="settings-tab-panel" role="tabpanel"
                 aria-labelledby="${tabId('display')}" data-settings-panel="display">
                <header class="settings-tab-intro">
                    <h4>Display</h4>
                    <p>Choose how worlds and interface feedback are presented.</p>
                </header>

                <section class="settings-group">
                    <div class="settings-group-heading">
                        <h5>Cell rendering</h5>
                        <p>Choose whether cell color represents only state or the rule that fired.</p>
                    </div>
                    <div class="settings-field">
                        <span class="settings-field-label">Color mode</span>
                        <div id="settings-ruleset-viz-mount"></div>
                    </div>
                </section>

                <section class="settings-group">
                    <div class="settings-group-heading">
                        <h5>World overlays</h5>
                        <p>Extra context drawn over the 3×3 world grid.</p>
                    </div>
                    <div class="settings-toggle-list">
                        <div id="settings-show-minimap-overlay-mount"></div>
                        <div id="settings-show-status-badges-mount"></div>
                    </div>
                </section>

                <section class="settings-group">
                    <div class="settings-group-heading">
                        <h5>Interface feedback</h5>
                        <p>Control confirmations and technical readouts around the simulation.</p>
                    </div>
                    <div class="settings-toggle-list">
                        <div id="settings-show-command-toasts-mount"></div>
                        <div id="settings-show-performance-mount"></div>
                    </div>
                </section>

                <aside class="settings-callout">
                    <span class="settings-callout-label">Color palettes</span>
                    <span>Viridis, Cividis, and custom palettes are managed in <strong>Chroma Lab → Palettes</strong>.</span>
                </aside>
            </div>

            <div id="${panelId('simulation')}" class="settings-tab-panel" role="tabpanel"
                 aria-labelledby="${tabId('simulation')}" data-settings-panel="simulation">
                <header class="settings-tab-intro">
                    <h4>Simulation</h4>
                    <p>Configure world scale, reproducibility, and safeguards.</p>
                </header>

                <section class="settings-group settings-grid-size-group">
                    <div class="settings-group-heading">
                        <h5>World size</h5>
                        <p>Larger grids reveal more structure but require more processing.</p>
                    </div>
                    <div class="settings-field">
                        <span class="settings-field-label">Grid preset</span>
                        <div id="settings-grid-size-mount"></div>
                    </div>
                    <p class="settings-warning-note">Changing size restarts all nine worlds. Rulesets and starting settings are kept.</p>
                </section>

                <section class="settings-group">
                    <div class="settings-group-heading">
                        <h5>Reset behavior</h5>
                        <p>Control whether resets can be reproduced across worlds.</p>
                    </div>
                    <div class="settings-toggle-list">
                        <div id="settings-deterministic-mount"></div>
                    </div>
                </section>

                <section class="settings-group">
                    <div class="settings-group-heading">
                        <h5>Safeguards</h5>
                        <p>Protect live work from broad actions that cannot be undone.</p>
                    </div>
                    <div class="settings-toggle-list">
                        <div id="settings-confirm-destructive-mount"></div>
                    </div>
                </section>
            </div>

            <div id="${panelId('torus')}" class="settings-tab-panel" role="tabpanel"
                 aria-labelledby="${tabId('torus')}" data-settings-panel="torus">
                <header class="settings-tab-intro">
                    <div>
                        <h4>3D Torus</h4>
                        <p>Shape the selected world’s 3D surface and camera motion.</p>
                    </div>
                    <span class="settings-context-badge">Desktop view</span>
                </header>

                <section class="settings-group">
                    <div class="settings-group-heading">
                        <h5>Motion</h5>
                        <p>Set whether the torus moves on its own and how quickly it turns.</p>
                    </div>
                    <div class="settings-toggle-list">
                        <div id="settings-torus-auto-rotate-mount"></div>
                    </div>
                    <div class="settings-slider-stack">
                        <div id="settings-torus-speed-mount"></div>
                    </div>
                </section>

                <section class="settings-group">
                    <div class="settings-group-heading">
                        <h5>Surface</h5>
                        <p>Adjust the ring profile and how much of the far side shows through.</p>
                    </div>
                    <div class="settings-slider-stack">
                        <div id="settings-torus-shape-mount"></div>
                        <p class="settings-slider-hint">Move toward a compact, nearly closed form or a wider open ring.</p>
                        <div id="settings-torus-opacity-mount"></div>
                        <p class="settings-slider-hint">Lower opacity reveals live cells on the far side.</p>
                    </div>
                </section>

                <p class="settings-live-note">Torus adjustments apply immediately and are saved for your next visit.</p>
            </div>

            <footer class="settings-version" title="Git commit this build was made from — compare against the latest commit on GitHub to spot a stale cached page">
                Build <code id="settings-version-code"></code>
            </footer>
        `;
        // textContent (not template interpolation): the injected build string must never be parsed as HTML.
        this.element.querySelector('#settings-version-code').textContent = APP_VERSION;

        const vizController = this.appContext.visualizationController;

        this.controls.push(new SwitchComponent(this.element.querySelector('#settings-ruleset-viz-mount'), {
            type: 'radio',
            name: 'settings-ruleset-viz',
            initialValue: vizController.getVizType(),
            items: vizController.getVisualizationOptions(),
            onChange: (type) => EventBus.dispatch(EVENTS.COMMAND_SET_VISUALIZATION_TYPE, type),
        }));

        this.controls.push(new ToggleSwitch(this.element.querySelector('#settings-show-minimap-overlay-mount'), {
            id: 'settings-show-minimap-overlay',
            label: 'Minimap overlays',
            description: 'Draw each minimap’s ruleset glyph over the 3×3 grid.',
            initialValue: vizController.getShowMinimapOverlay(),
            onChange: (v) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_MINIMAP_OVERLAY, v),
        }));

        this.controls.push(new ToggleSwitch(this.element.querySelector('#settings-show-status-badges-mount'), {
            id: 'settings-show-status-badges',
            label: 'Status badges',
            description: 'Flag extinct / saturated / cycling worlds on the minimaps.',
            initialValue: vizController.getShowStatusBadges(),
            onChange: (v) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_STATUS_BADGES, v),
        }));

        this.controls.push(new ToggleSwitch(this.element.querySelector('#settings-show-command-toasts-mount'), {
            id: 'settings-show-command-toasts',
            label: 'Action toasts',
            description: 'Show a brief confirmation when an action runs.',
            initialValue: vizController.getShowCommandToasts(),
            onChange: (v) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_COMMAND_TOASTS, v),
        }));

        this.controls.push(new ToggleSwitch(this.element.querySelector('#settings-show-performance-mount'), {
            id: 'settings-show-performance',
            label: 'Show performance (FPS / TPS)',
            description: 'Display engineering telemetry in the top bar.',
            initialValue: vizController.getShowPerformance(),
            onChange: (v) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_PERFORMANCE, v),
        }));

        this.controls.push(new ToggleSwitch(this.element.querySelector('#settings-confirm-destructive-mount'), {
            id: 'settings-confirm-destructive',
            label: 'Confirm destructive actions',
            description: 'Ask before Clear All / Reset All (these affect all 9 worlds and can’t be undone).',
            initialValue: PersistenceService.loadUISetting('confirmDestructiveActions', true),
            onChange: (v) => PersistenceService.saveUISetting('confirmDestructiveActions', !!v),
        }));

        this.controls.push(new ToggleSwitch(this.element.querySelector('#settings-deterministic-mount'), {
            id: 'settings-deterministic',
            label: 'Deterministic resets',
            description: 'Worlds sharing a starting density reset to identical grids.',
            initialValue: PersistenceService.loadUISetting('deterministic', true),
            onChange: (v) => EventBus.dispatch(EVENTS.COMMAND_SET_DETERMINISTIC_RESET, !!v),
        }));

        this._createGridSizeControl();
        this._createTorusControls();
        this._setupTabs();
    }

    _setupTabs() {
        this.tabButtons = Array.from(this.element.querySelectorAll('[data-settings-tab]'));
        this.tabPanels = Array.from(this.element.querySelectorAll('[data-settings-panel]'));

        this.tabButtons.forEach((button) => {
            this._addDOMListener(button, 'click', () => {
                this._setActiveTab(button.dataset.settingsTab, true);
            });
            this._addDOMListener(button, 'keydown', (event) => {
                const currentIndex = SETTINGS_TAB_IDS.indexOf(button.dataset.settingsTab);
                let nextIndex = currentIndex;
                if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % SETTINGS_TAB_IDS.length;
                else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + SETTINGS_TAB_IDS.length) % SETTINGS_TAB_IDS.length;
                else if (event.key === 'Home') nextIndex = 0;
                else if (event.key === 'End') nextIndex = SETTINGS_TAB_IDS.length - 1;
                else return;

                event.preventDefault();
                this._setActiveTab(SETTINGS_TAB_IDS[nextIndex], true);
                this.tabButtons[nextIndex].focus();
            });
        });

        this._setActiveTab(this.activeTab, false);
    }

    _setActiveTab(tabId, persist = true) {
        const normalized = normalizeSettingsTab(tabId);
        this.activeTab = normalized;

        this.tabButtons.forEach((button) => {
            const isActive = button.dataset.settingsTab === normalized;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', String(isActive));
            button.tabIndex = isActive ? 0 : -1;
        });
        this.tabPanels.forEach((panel) => {
            panel.hidden = panel.dataset.settingsPanel !== normalized;
        });

        if (persist) PersistenceService.saveUISetting('settingsActiveTab', normalized);
    }

    _createTorusControls() {
        const settings = getTorusViewSettings();
        this.torusAutoRotate = new ToggleSwitch(
            this.element.querySelector('#settings-torus-auto-rotate-mount'),
            {
                id: 'settings-torus-auto-rotate',
                label: 'Continuous rotation',
                description: 'Keep the torus turning until paused.',
                initialValue: settings.autoRotate,
                onChange: (autoRotate) => updateTorusViewSettings({ autoRotate }),
            },
        );

        this.torusOpacitySlider = new SliderComponent(
            this.element.querySelector('#settings-torus-opacity-mount'),
            {
                id: 'settings-torus-opacity',
                label: 'Off-cell opacity',
                min: 1,
                max: 100,
                step: 1,
                value: settings.offOpacity * 100,
                showValue: true,
                unit: '%',
                onInput: (value) => updateTorusViewSettings({ offOpacity: value / 100 }),
                onChange: (value) => updateTorusViewSettings({ offOpacity: value / 100 }),
            },
        );

        this.torusShapeSlider = new SliderComponent(
            this.element.querySelector('#settings-torus-shape-mount'),
            {
                id: 'settings-torus-shape',
                label: 'Ring openness',
                min: 1.05,
                max: 3,
                step: 0.05,
                value: settings.radiusRatio,
                showValue: true,
                unit: '×',
                onInput: (radiusRatio) => updateTorusViewSettings({ radiusRatio }),
                onChange: (radiusRatio) => updateTorusViewSettings({ radiusRatio }),
            },
        );

        this.torusSpeedSlider = new SliderComponent(
            this.element.querySelector('#settings-torus-speed-mount'),
            {
                id: 'settings-torus-speed',
                label: 'Rotation speed',
                min: 1,
                max: 45,
                step: 1,
                value: settings.rotationSpeed,
                showValue: true,
                unit: '°/s',
                onInput: (rotationSpeed) => updateTorusViewSettings({ rotationSpeed }),
                onChange: (rotationSpeed) => updateTorusViewSettings({ rotationSpeed }),
            },
        );
    }

    _syncTorusControls(settings) {
        this.torusAutoRotate?.setValue(settings.autoRotate);
        this.torusOpacitySlider?.setValue(settings.offOpacity * 100);
        this.torusShapeSlider?.setValue(settings.radiusRatio);
        this.torusSpeedSlider?.setValue(settings.rotationSpeed);
    }

    /**
     * Grid-size selector. Changing it resizes the torus and restarts the simulation via a
     * full page reload (the clean way to rebuild renderer buffers + all 9 workers), so the
     * change is confirmed first and the visible selection reverts until the user commits.
     * Moved here from World Setup so all global preferences live in one place.
     */
    _createGridSizeControl() {
        const mount = this.element.querySelector('#settings-grid-size-mount');
        if (!mount) return;

        const presets = Config.GRID_SIZE_PRESETS;
        const items = Object.entries(presets).map(([key, rows]) => {
            const { cols } = Config.deriveGridDimensions(rows);
            const label = key.charAt(0).toUpperCase() + key.slice(1);
            return { value: key, text: `${label} (${rows}×${cols})` };
        });

        // Match the current live size to a preset (null if a custom size came in via share URL).
        this._currentGridSizeKey = Object.keys(presets).find(k => presets[k] === Config.GRID_ROWS) || null;

        this.gridSizeSwitch = new SwitchComponent(mount, {
            type: 'radio',
            name: 'settings-grid-size-switch',
            initialValue: this._currentGridSizeKey,
            items,
            onChange: (value) => this._handleGridSizeChange(value),
        });
    }

    _handleGridSizeChange(presetKey) {
        const rows = Config.GRID_SIZE_PRESETS[presetKey];
        if (!rows || rows === Config.GRID_ROWS) return;

        const { rows: r, cols: c } = Config.deriveGridDimensions(rows);

        // Revert the visible selection immediately; the change is only committed (with a page
        // reload, which cleanly rebuilds the renderer buffers and all workers) if the user confirms.
        this.gridSizeSwitch.setValue(this._currentGridSizeKey);

        EventBus.dispatch(EVENTS.COMMAND_SHOW_CONFIRMATION, {
            title: 'Change grid size?',
            message: `Resize the grid to ${r} × ${c} (${(r * c).toLocaleString()} cells) and restart the simulation? Rulesets and initial-state settings are kept; the current live evolution is not.`,
            confirmLabel: 'Resize & Restart',
            onConfirm: () => {
                PersistenceService.saveUISetting('gridRows', rows);
                window.location.reload();
            },
        });
    }

    destroy() {
        this.controls.forEach((control) => control.destroy());
        this.controls = [];
        if (this.gridSizeSwitch) this.gridSizeSwitch.destroy();
        this.torusAutoRotate?.destroy();
        this.torusOpacitySlider?.destroy();
        this.torusShapeSlider?.destroy();
        this.torusSpeedSlider?.destroy();
        super.destroy?.();
    }
}
