import { BaseComponent } from './components/BaseComponent.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { ICONS } from './icons.js';

/**
 * Transport bar for state-history scrub-back. Appears over the canvas when the simulation is paused
 * and the selected world has recorded history, letting the user step backward (and forward) a few
 * hundred ticks to review "what just happened?". It is a thin view over the WorldManager scrub state:
 * it dispatches COMMAND_SCRUB_HISTORY / COMMAND_STATE_STEP / COMMAND_EXIT_SCRUB and reflects the
 * STATE_HISTORY_CHANGED + WORLD_STATS_UPDATED events the manager/worker emit back.
 */
export class ScrubBar extends BaseComponent {
    constructor(appContext) {
        super(document.getElementById('main-content-area'));
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        // View state mirrored from events.
        this.paused = appContext.simulationController?.getIsPaused() ?? true;
        this.exploreActive = false;
        this.length = 0;   // frames available on the selected world
        this.offset = 0;   // ticks back from the live tip currently viewed (0 = present)
        this.tick = 0;     // tick number of the viewed frame (for the label)
        this._build();
        this._wire();
        this.render();
    }

    _build() {
        const el = document.createElement('div');
        el.id = 'scrub-bar';
        el.className = 'scrub-bar hidden';
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', 'State history scrub-back');
        el.innerHTML = `
            <button type="button" class="scrub-btn" data-action="back10" title="Step back 10 ticks">${ICONS.skipBack}</button>
            <button type="button" class="scrub-btn" data-action="back1" title="Step back 1 tick (←)">${ICONS.chevronLeft}</button>
            <input type="range" class="scrub-slider" min="0" max="0" value="0" step="1" aria-label="Scrub through recent history">
            <button type="button" class="scrub-btn" data-action="fwd1" title="Step forward 1 tick (→)">${ICONS.chevronRight}</button>
            <button type="button" class="scrub-btn" data-action="fwd10" title="Step forward 10 ticks">${ICONS.skipForward}</button>
            <span class="scrub-label" aria-live="polite">--</span>
            <button type="button" class="scrub-btn scrub-live" data-action="live" title="Return to the live present">Live</button>
        `;
        this.mountPoint?.appendChild(el);
        this.element = el;
        this.slider = el.querySelector('.scrub-slider');
        this.label = el.querySelector('.scrub-label');
    }

    _wire() {
        // Slider drag → absolute scrub. The slider runs left=oldest → right=present, so the scrub
        // offset (ticks back from the tip) is the mirror of the slider value.
        this._addDOMListener(this.slider, 'input', () => {
            const max = Number(this.slider.max) || 0;
            const offset = max - Number(this.slider.value);
            EventBus.dispatch(EVENTS.COMMAND_SCRUB_HISTORY, { offset });
        });
        const stepDeltas = { back10: 10, back1: 1, fwd1: -1, fwd10: -10 };
        this.element.querySelectorAll('.scrub-btn').forEach((btn) => {
            this._addDOMListener(btn, 'click', () => {
                const action = btn.dataset.action;
                if (action === 'live') {
                    EventBus.dispatch(EVENTS.COMMAND_EXIT_SCRUB);
                } else if (action in stepDeltas) {
                    EventBus.dispatch(EVENTS.COMMAND_STATE_STEP, { delta: stepDeltas[action] });
                }
            });
        });

        this._subscribeToEvent(EVENTS.SIMULATION_PAUSED, (isPaused) => {
            this.paused = isPaused;
            this.render();
        });
        this._subscribeToEvent(EVENTS.STATE_HISTORY_CHANGED, (data) => {
            this.length = data.length ?? 0;
            this.offset = data.offset ?? 0;
            this.render();
        });
        this._subscribeToEvent(EVENTS.WORLD_STATS_UPDATED, (stats) => {
            if (stats.worldIndex !== this.worldManager.getSelectedWorldIndex()) return;
            if (typeof stats.historyLength === 'number') this.length = stats.historyLength;
            if (typeof stats.tick === 'number') this.tick = stats.tick;
            // Only the length/tick changed; cheap to re-render and keeps the label/slider live.
            if (!this.element.classList.contains('hidden')) this.render();
        });
        this._subscribeToEvent(EVENTS.SELECTED_WORLD_CHANGED, () => {
            this.offset = 0;
            this.render();
        });
        this._subscribeToEvent(EVENTS.EXPLORE_PROGRESS, (data) => {
            this.exploreActive = data?.state && data.state !== 'idle';
            this.render();
        });
    }

    render() {
        if (!this.element) return;
        const visible = this.paused && !this.exploreActive && this.length > 1;
        this.element.classList.toggle('hidden', !visible);
        if (!visible) return;

        const max = this.length - 1;
        this.slider.max = String(max);
        const clampedOffset = Math.max(0, Math.min(max, this.offset));
        const sliderValue = max - clampedOffset;
        if (Number(this.slider.value) !== sliderValue) this.slider.value = String(sliderValue);

        const atLive = clampedOffset === 0;
        this.label.textContent = atLive ? `t${this.tick} · live` : `t${this.tick} · −${clampedOffset}`;
        this.element.classList.toggle('is-scrubbing', !atLive);
    }
}
