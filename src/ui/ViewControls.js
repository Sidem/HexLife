import { BaseComponent } from './components/BaseComponent.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import * as PersistenceService from '../services/PersistenceService.js';
import {
    getTorusViewSettings,
    updateTorusViewSettings,
} from '../services/TorusViewSettings.js';
import {
    getSpacetimeViewSettings,
    updateSpacetimeViewSettings,
} from '../services/SpacetimeViewSettings.js';
import { VIEW_MODES, isOrbitViewMode, normalizeViewMode } from '../rendering/viewModes.js';

const VIEW_MODE_SETTING_KEY = 'viewMode';
/** Pre-#40 boolean key, read once so an existing torus preference survives the enum migration. */
const LEGACY_TORUS_SETTING_KEY = 'torusViewEnabled';

/**
 * Every mode is restorable now. Phase 0 deliberately withheld spacetime — an unfinished projection
 * that a reload could strand you in is a trap — and #40 Phase 3 finishing it is what lifts that.
 */
const PERSISTED_VIEW_MODES = [VIEW_MODES.FLAT, VIEW_MODES.TORUS, VIEW_MODES.SPACETIME];

function _loadPersistedMode() {
    const saved = PersistenceService.loadUISetting(VIEW_MODE_SETTING_KEY, null);
    if (saved !== null) return normalizeViewMode(saved);
    return PersistenceService.loadUISetting(LEGACY_TORUS_SETTING_KEY, false)
        ? VIEW_MODES.TORUS
        : VIEW_MODES.FLAT;
}

/**
 * On-canvas controls for the selected world's flat camera and the 3D projections.
 * The flat camera is never mutated by a 3D mode, so returning to 2D restores the exact pan/zoom.
 */
export class ViewControls extends BaseComponent {
    constructor(appContext) {
        super(document.getElementById('main-content-area'));
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.canvas = document.getElementById('hexGridCanvas');
        this.layout = null;
        this.isMobile = !!appContext.uiManager?.isMobile();
        this.viewMode = this.isMobile ? VIEW_MODES.FLAT : _loadPersistedMode();
        this.torusSettings = getTorusViewSettings();
        this.autoRotate = this.torusSettings.autoRotate;
        this.spacetimeSettings = getSpacetimeViewSettings();
        this._build();
        this._wire();

        // Headless/local QA can inspect and switch the view without reaching into renderer internals.
        this.appContext.viewMode = {
            get: () => this.viewMode,
            set: (mode) => this.setViewMode(mode),
            getState: () => ({
                mode: this.viewMode,
                ...this.torusSettings,
                spacetime: { ...this.spacetimeSettings },
            }),
            setSpacetimeOpacity: (value) => updateSpacetimeViewSettings({ layerAlpha: value }),
        };
        EventBus.dispatch(EVENTS.VIEW_MODE_CHANGED, { mode: this.viewMode });
        this.render();
    }

    _build() {
        const el = document.createElement('div');
        el.id = 'view-controls';
        el.className = 'view-controls hidden';
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', 'View controls');
        el.innerHTML = `
            <span class="view-controls-mode-label">Torus</span>
            <span class="view-controls-zoom" aria-live="polite">1.0&times;</span>
            <span class="view-controls-hint"></span>
            <label class="view-controls-opacity hidden" title="How solid each recorded tick looks. Lower shows more of the history inside the object.">
                <span>Density</span>
                <input type="range" min="0" max="0.4" step="0.01" aria-label="Spacetime layer opacity">
            </label>
            <button type="button" class="view-controls-spin" title="Pause or resume the slow rotation">Pause spin</button>
            <button type="button" class="view-controls-reset" title="Show the whole grid again">Reset view</button>
            <button type="button" class="view-controls-torus" title="Wrap the live world onto a 3D torus (V)">3D torus</button>
            <button type="button" class="view-controls-spacetime" title="Stack the recorded history into a solid you can orbit">Spacetime</button>
        `;
        this.mountPoint?.appendChild(el);
        this.element = el;
        this.zoomLabel = el.querySelector('.view-controls-zoom');
        this.hint = el.querySelector('.view-controls-hint');
        this.modeLabel = el.querySelector('.view-controls-mode-label');
        this.spinButton = el.querySelector('.view-controls-spin');
        this.resetButton = el.querySelector('.view-controls-reset');
        this.torusButton = el.querySelector('.view-controls-torus');
        this.spacetimeButton = el.querySelector('.view-controls-spacetime');
        this.opacityControl = el.querySelector('.view-controls-opacity');
        this.opacitySlider = this.opacityControl.querySelector('input');
        this.opacitySlider.value = String(this.spacetimeSettings.layerAlpha);
    }

    _wire() {
        this._addDOMListener(this.resetButton, 'click', () => {
            this.worldManager.resetSelectedCamera();
        });
        this._addDOMListener(this.torusButton, 'click', () => {
            this.setViewMode(this.viewMode === VIEW_MODES.TORUS ? VIEW_MODES.FLAT : VIEW_MODES.TORUS);
        });
        this._addDOMListener(this.spacetimeButton, 'click', () => {
            this.setViewMode(
                this.viewMode === VIEW_MODES.SPACETIME ? VIEW_MODES.FLAT : VIEW_MODES.SPACETIME,
            );
        });
        this._addDOMListener(this.spinButton, 'click', () => {
            updateTorusViewSettings({ autoRotate: !this.autoRotate });
        });
        this._addDOMListener(this.opacitySlider, 'input', () => {
            updateSpacetimeViewSettings({ layerAlpha: Number(this.opacitySlider.value) });
        });
        this._subscribeToEvent(EVENTS.SPACETIME_SETTINGS_CHANGED, (settings) => {
            this.spacetimeSettings = settings;
            this.render();
        });
        this._subscribeToEvent(EVENTS.COMMAND_SET_VIEW_MODE, (mode) => {
            this.setViewMode(mode);
        });
        this._subscribeToEvent(EVENTS.CAMERA_CHANGED, () => this.render());
        this._subscribeToEvent(EVENTS.SELECTED_WORLD_CHANGED, () => this.render());
        this._subscribeToEvent(EVENTS.TORUS_SETTINGS_CHANGED, (settings) => {
            this.torusSettings = settings;
            this.autoRotate = settings.autoRotate;
            this.render();
        });
        this._subscribeToEvent(EVENTS.UI_MODE_CHANGED, () => {
            const wasMobile = this.isMobile;
            this.isMobile = !!this.appContext.uiManager?.isMobile();
            if (this.isMobile && this.viewMode !== VIEW_MODES.FLAT) {
                // Desktop-only: leave the saved desktop preference intact while dropping the live
                // 3D mode for a narrow/coarse-pointer layout.
                this.viewMode = VIEW_MODES.FLAT;
                EventBus.dispatch(EVENTS.VIEW_MODE_CHANGED, { mode: VIEW_MODES.FLAT });
            } else if (wasMobile && !this.isMobile) {
                this.viewMode = _loadPersistedMode();
                EventBus.dispatch(EVENTS.VIEW_MODE_CHANGED, { mode: this.viewMode });
            }
            this.render();
        });
        this._subscribeToEvent(EVENTS.LAYOUT_CALCULATED, (layout) => {
            this.layout = layout;
            this._position();
        });
    }

    setViewMode(mode) {
        if (this.appContext.uiManager?.isMobile()) return;
        const next = normalizeViewMode(mode);
        if (this.viewMode === next) return;
        this.viewMode = next;
        // Spacetime is reachable (headless hook / command) but deliberately not restored on reload:
        // it is an unfinished projection, and stranding a session in it would be a trap.
        if (PERSISTED_VIEW_MODES.includes(next)) {
            PersistenceService.saveUISetting(VIEW_MODE_SETTING_KEY, next);
        }
        EventBus.dispatch(EVENTS.VIEW_MODE_CHANGED, { mode: next });
        this.render();
    }

    /** Anchor inside the top-left corner of the selected view in every layout regime. */
    _position() {
        const view = this.layout?.selectedView;
        if (!view || !this.canvas) return;
        this.element.style.left = `${view.x + this.canvas.offsetLeft + 10}px`;
        this.element.style.top = `${view.y + this.canvas.offsetTop + 10}px`;
    }

    render() {
        const zoom = this.worldManager.getCurrentCameraState()?.zoom ?? 1;
        this.element.classList.toggle('hidden', this.isMobile);
        if (this.isMobile) return;

        const zoomed = zoom > 1.01;
        const isTorus = this.viewMode === VIEW_MODES.TORUS;
        const isSpacetime = this.viewMode === VIEW_MODES.SPACETIME;
        const isOrbit = isOrbitViewMode(this.viewMode);
        this.element.classList.toggle('is-torus', isOrbit);
        this.element.classList.toggle('is-flat-at-rest', !isOrbit && !zoomed);
        this.modeLabel.classList.toggle('hidden', !isOrbit);
        // Only ever named while a 3D mode is showing; flat leaves the label hidden and untouched.
        this.modeLabel.textContent = isSpacetime ? 'Spacetime' : 'Torus';
        this.zoomLabel.classList.toggle('hidden', isOrbit || !zoomed);
        this.resetButton.classList.toggle('hidden', isOrbit || !zoomed);
        // Auto-rotation is a torus setting; the spacetime object is orbited by hand.
        this.spinButton.classList.toggle('hidden', !isTorus);
        this.opacityControl.classList.toggle('hidden', !isSpacetime);
        this.opacitySlider.value = String(this.spacetimeSettings.layerAlpha);
        this.torusButton.textContent = isTorus ? 'Flat view' : '3D torus';
        this.torusButton.setAttribute('aria-pressed', String(isTorus));
        this.spacetimeButton.textContent = isSpacetime ? 'Flat view' : 'Spacetime';
        this.spacetimeButton.setAttribute('aria-pressed', String(isSpacetime));
        this.spinButton.textContent = this.autoRotate ? 'Pause spin' : 'Resume spin';
        this.spinButton.setAttribute('aria-pressed', String(this.autoRotate));
        this.zoomLabel.textContent = `${zoom.toFixed(1)}×`;
        this.hint.textContent = isSpacetime
            ? 'Drag to orbit · Scrub to slice'
            : isOrbit
                ? 'Drag to orbit · Wheel to dolly'
                : zoomed ? 'Ctrl-drag or middle-drag to pan' : '';
        this.hint.classList.toggle('hidden', !this.hint.textContent);
        this._position();
    }
}
