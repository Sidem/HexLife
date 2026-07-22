import { BaseComponent } from './components/BaseComponent.js';
import { EVENTS } from '../services/EventBus.js';

/**
 * On-canvas view chip: the visible affordance for panning and for getting back out of a zoom
 * (roadmap #31 / UX audit fix 4).
 *
 * The audit found *pan* is the one core verb with no affordance on desktop — left-drag on the
 * selected view draws, and panning is ctrl+drag or middle-drag, advertised nowhere in the 18-icon
 * rail. It also found the app opens on dense static, which #34 answers by opening a first-time
 * visitor already zoomed in — which makes an escape hatch mandatory rather than nice to have.
 *
 * Both are answered by one chip anchored to the top-left of the selected view: it names the gesture
 * for the current input mode and offers "Reset view". It is *contextual*, not another resting
 * control: at zoom 1 there is nothing to pan and nothing to reset, so it hides itself and the
 * control count is unchanged from before.
 */
export class ViewControls extends BaseComponent {
    constructor(appContext) {
        super(document.getElementById('main-content-area'));
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.canvas = document.getElementById('hexGridCanvas');
        this.layout = null;
        this._build();
        this._wire();
        this.render();
    }

    _build() {
        const el = document.createElement('div');
        el.id = 'view-controls';
        el.className = 'view-controls hidden';
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', 'View controls');
        el.innerHTML = `
            <span class="view-controls-zoom" aria-live="polite">1.0&times;</span>
            <span class="view-controls-hint"></span>
            <button type="button" class="view-controls-reset" title="Show the whole grid again">Reset view</button>
        `;
        this.mountPoint?.appendChild(el);
        this.element = el;
        this.zoomLabel = el.querySelector('.view-controls-zoom');
        this.hint = el.querySelector('.view-controls-hint');
    }

    _wire() {
        this._addDOMListener(this.element.querySelector('.view-controls-reset'), 'click', () => {
            this.worldManager.resetSelectedCamera();
        });
        this._subscribeToEvent(EVENTS.CAMERA_CHANGED, () => this.render());
        this._subscribeToEvent(EVENTS.SELECTED_WORLD_CHANGED, () => this.render());
        this._subscribeToEvent(EVENTS.UI_MODE_CHANGED, () => this.render());
        // Each world keeps its own camera, so paging worlds can change the zoom without a
        // CAMERA_CHANGED (the camera object isn't touched — a different one becomes current).
        this._subscribeToEvent(EVENTS.LAYOUT_CALCULATED, (layout) => {
            this.layout = layout;
            this._position();
        });
    }

    /** Anchor inside the top-left corner of the selected view, wherever the layout regime put it. */
    _position() {
        const view = this.layout?.selectedView;
        if (!view || !this.canvas) return;
        this.element.style.left = `${view.x + this.canvas.offsetLeft + 10}px`;
        this.element.style.top = `${view.y + this.canvas.offsetTop + 10}px`;
    }

    render() {
        const zoom = this.worldManager.getCurrentCameraState()?.zoom ?? 1;
        // Zoom is clamped to a 1.0 floor, so "> 1.01" means the user (or the first-run framing) is
        // actually looking at part of a world rather than all of it.
        const relevant = zoom > 1.01;
        this.element.classList.toggle('hidden', !relevant);
        if (!relevant) return;
        this.zoomLabel.textContent = `${zoom.toFixed(1)}×`;
        // Desktop: after a stroke DrawStrategy hands the mode back to `pan`, so ctrl-drag /
        // middle-drag really is always available. Mobile: dragging pans only in pan mode (the
        // Pan/Draw FAB already teaches that), so the chip only claims what is unconditionally true.
        this.hint.textContent = this.appContext.uiManager?.isMobile()
            ? 'Pinch to zoom'
            : 'Ctrl-drag or middle-drag to pan';
        this._position();
    }
}
