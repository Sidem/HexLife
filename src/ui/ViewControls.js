import { BaseComponent } from './components/BaseComponent.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import * as PersistenceService from '../services/PersistenceService.js';
import {
    getTorusViewSettings,
    updateTorusViewSettings,
} from '../services/TorusViewSettings.js';

/**
 * On-canvas controls for the selected world's flat camera and the optional 3D torus view.
 * The flat camera is never mutated by torus mode, so returning to 2D restores the exact pan/zoom.
 */
export class ViewControls extends BaseComponent {
    constructor(appContext) {
        super(document.getElementById('main-content-area'));
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.canvas = document.getElementById('hexGridCanvas');
        this.layout = null;
        this.isMobile = !!appContext.uiManager?.isMobile();
        this.torusEnabled = !this.isMobile &&
            PersistenceService.loadUISetting('torusViewEnabled', false);
        this.torusSettings = getTorusViewSettings();
        this.autoRotate = this.torusSettings.autoRotate;
        this._build();
        this._wire();

        // Headless/local QA can inspect and switch the view without reaching into renderer internals.
        this.appContext.torusView = {
            getState: () => ({
                enabled: this.torusEnabled,
                ...this.torusSettings,
            }),
            setEnabled: (enabled) => this.setTorusEnabled(enabled),
        };
        EventBus.dispatch(EVENTS.TORUS_VIEW_CHANGED, { enabled: this.torusEnabled });
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
            <button type="button" class="view-controls-spin" title="Pause or resume the slow rotation">Pause spin</button>
            <button type="button" class="view-controls-reset" title="Show the whole grid again">Reset view</button>
            <button type="button" class="view-controls-torus" title="Wrap the live world onto a 3D torus (V)">3D torus</button>
        `;
        this.mountPoint?.appendChild(el);
        this.element = el;
        this.zoomLabel = el.querySelector('.view-controls-zoom');
        this.hint = el.querySelector('.view-controls-hint');
        this.modeLabel = el.querySelector('.view-controls-mode-label');
        this.spinButton = el.querySelector('.view-controls-spin');
        this.resetButton = el.querySelector('.view-controls-reset');
        this.torusButton = el.querySelector('.view-controls-torus');
    }

    _wire() {
        this._addDOMListener(this.resetButton, 'click', () => {
            this.worldManager.resetSelectedCamera();
        });
        this._addDOMListener(this.torusButton, 'click', () => {
            this.setTorusEnabled(!this.torusEnabled);
        });
        this._addDOMListener(this.spinButton, 'click', () => {
            updateTorusViewSettings({ autoRotate: !this.autoRotate });
        });
        this._subscribeToEvent(EVENTS.COMMAND_TOGGLE_TORUS_VIEW, () => {
            this.setTorusEnabled(!this.torusEnabled);
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
            if (this.isMobile && this.torusEnabled) {
                // Desktop-only Phase 1: leave the saved desktop preference intact while disabling
                // the live mode for a narrow/coarse-pointer layout.
                this.torusEnabled = false;
                EventBus.dispatch(EVENTS.TORUS_VIEW_CHANGED, { enabled: false });
            } else if (wasMobile && !this.isMobile) {
                this.torusEnabled = PersistenceService.loadUISetting('torusViewEnabled', false);
                EventBus.dispatch(EVENTS.TORUS_VIEW_CHANGED, { enabled: this.torusEnabled });
            }
            this.render();
        });
        this._subscribeToEvent(EVENTS.LAYOUT_CALCULATED, (layout) => {
            this.layout = layout;
            this._position();
        });
    }

    setTorusEnabled(enabled) {
        if (this.appContext.uiManager?.isMobile()) return;
        const next = !!enabled;
        if (this.torusEnabled === next) return;
        this.torusEnabled = next;
        PersistenceService.saveUISetting('torusViewEnabled', next);
        EventBus.dispatch(EVENTS.TORUS_VIEW_CHANGED, { enabled: next });
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
        this.element.classList.toggle('is-torus', this.torusEnabled);
        this.element.classList.toggle('is-flat-at-rest', !this.torusEnabled && !zoomed);
        this.modeLabel.classList.toggle('hidden', !this.torusEnabled);
        this.zoomLabel.classList.toggle('hidden', this.torusEnabled || !zoomed);
        this.resetButton.classList.toggle('hidden', this.torusEnabled || !zoomed);
        this.spinButton.classList.toggle('hidden', !this.torusEnabled);
        this.torusButton.textContent = this.torusEnabled ? 'Flat view' : '3D torus';
        this.torusButton.setAttribute('aria-pressed', String(this.torusEnabled));
        this.spinButton.textContent = this.autoRotate ? 'Pause spin' : 'Resume spin';
        this.spinButton.setAttribute('aria-pressed', String(this.autoRotate));
        this.zoomLabel.textContent = `${zoom.toFixed(1)}×`;
        this.hint.textContent = this.torusEnabled
            ? 'Drag to orbit · Wheel to dolly'
            : zoomed ? 'Ctrl-drag or middle-drag to pan' : '';
        this.hint.classList.toggle('hidden', !this.hint.textContent);
        this._position();
    }
}
