import { BaseComponent } from './BaseComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { ToggleSwitch } from './ToggleSwitch.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import * as Config from '../../core/config.js';
import { APP_VERSION } from '../../version.js';

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
        this.render();
    }

    getElement() {
        return this.element;
    }

    render() {
        this.element.innerHTML = `
            <section class="settings-section">
                <h5 class="settings-section-title">Display</h5>
                <div class="settings-field">
                    <span class="settings-field-label">Cell coloring</span>
                    <div id="settings-ruleset-viz-mount"></div>
                </div>
                <div class="settings-toggle-list">
                    <div id="settings-show-minimap-overlay-mount"></div>
                    <div id="settings-show-status-badges-mount"></div>
                    <div id="settings-show-command-toasts-mount"></div>
                    <div id="settings-show-performance-mount"></div>
                </div>
            </section>

            <section class="settings-section">
                <h5 class="settings-section-title">Simulation</h5>
                <div class="settings-field">
                    <span class="settings-field-label">Grid size <span class="settings-field-hint">(restarts the simulation)</span></span>
                    <div id="settings-grid-size-mount"></div>
                </div>
                <div class="settings-toggle-list">
                    <div id="settings-deterministic-mount"></div>
                </div>
            </section>

            <section class="settings-section">
                <h5 class="settings-section-title">Behaviour</h5>
                <div class="settings-toggle-list">
                    <div id="settings-confirm-destructive-mount"></div>
                </div>
            </section>

            <section class="settings-section">
                <h5 class="settings-section-title">Appearance</h5>
                <p class="settings-coming-soon">Colorblind-safe palettes (Viridis &amp; Cividis) live in <strong>Chroma Lab &rarr; Palettes</strong>. A light theme is coming soon.</p>
            </section>

            <footer class="settings-version" title="Git commit this build was made from — compare against the latest commit on GitHub to spot a stale cached page">
                Build <code id="settings-version-code"></code>
            </footer>
        `;
        // textContent (not template interpolation): the injected build string must never be parsed as HTML.
        this.element.querySelector('#settings-version-code').textContent = APP_VERSION;

        const vizController = this.appContext.visualizationController;

        new SwitchComponent(this.element.querySelector('#settings-ruleset-viz-mount'), {
            type: 'radio',
            name: 'settings-ruleset-viz',
            initialValue: vizController.getVizType(),
            items: vizController.getVisualizationOptions(),
            onChange: (type) => EventBus.dispatch(EVENTS.COMMAND_SET_VISUALIZATION_TYPE, type),
        });

        new ToggleSwitch(this.element.querySelector('#settings-show-minimap-overlay-mount'), {
            id: 'settings-show-minimap-overlay',
            label: 'Minimap overlays',
            description: 'Draw each minimap’s ruleset glyph over the 3×3 grid.',
            initialValue: vizController.getShowMinimapOverlay(),
            onChange: (v) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_MINIMAP_OVERLAY, v),
        });

        new ToggleSwitch(this.element.querySelector('#settings-show-status-badges-mount'), {
            id: 'settings-show-status-badges',
            label: 'Status badges',
            description: 'Flag extinct / saturated / cycling worlds on the minimaps.',
            initialValue: vizController.getShowStatusBadges(),
            onChange: (v) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_STATUS_BADGES, v),
        });

        new ToggleSwitch(this.element.querySelector('#settings-show-command-toasts-mount'), {
            id: 'settings-show-command-toasts',
            label: 'Action toasts',
            description: 'Show a brief confirmation when an action runs.',
            initialValue: vizController.getShowCommandToasts(),
            onChange: (v) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_COMMAND_TOASTS, v),
        });

        new ToggleSwitch(this.element.querySelector('#settings-show-performance-mount'), {
            id: 'settings-show-performance',
            label: 'Show performance (FPS / TPS)',
            description: 'Display engineering telemetry in the top bar.',
            initialValue: vizController.getShowPerformance(),
            onChange: (v) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_PERFORMANCE, v),
        });

        new ToggleSwitch(this.element.querySelector('#settings-confirm-destructive-mount'), {
            id: 'settings-confirm-destructive',
            label: 'Confirm destructive actions',
            description: 'Ask before Clear All / Reset All (these affect all 9 worlds and can’t be undone).',
            initialValue: PersistenceService.loadUISetting('confirmDestructiveActions', true),
            onChange: (v) => PersistenceService.saveUISetting('confirmDestructiveActions', !!v),
        });

        new ToggleSwitch(this.element.querySelector('#settings-deterministic-mount'), {
            id: 'settings-deterministic',
            label: 'Deterministic resets',
            description: 'Worlds sharing a starting density reset to identical grids.',
            initialValue: PersistenceService.loadUISetting('deterministic', true),
            onChange: (v) => EventBus.dispatch(EVENTS.COMMAND_SET_DETERMINISTIC_RESET, !!v),
        });

        this._createGridSizeControl();
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
        if (this.gridSizeSwitch) this.gridSizeSwitch.destroy();
        super.destroy?.();
    }
}
