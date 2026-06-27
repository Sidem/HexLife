import { BaseComponent } from './BaseComponent.js';
import { ICONS } from '../icons.js';

/**
 * A compact numeric stepper: a decrement button, an editable value readout, and an
 * increment button, with an optional row of one-tap preset chips. Designed as a more
 * precise, discoverable alternative to a `<input type="range">` slider for bounded
 * integer settings (simulation speed, brush size) where the exact number matters.
 *
 * UX affordances:
 *   - Click ± to step; press-and-hold to auto-repeat (with a short ramp-up delay).
 *   - Type an exact value into the readout (commits on Enter / blur, clamped & snapped).
 *   - Scroll the wheel over the control to nudge the value.
 *   - ↑/↓ arrows while the readout is focused step by one.
 *   - Preset chips jump straight to a named value and highlight when the value matches.
 *
 * options: { id?, min, max, step, value, unit?, presets?: [{label, value, title?}],
 *            ariaLabel?, format?: (v)=>string, onInput?: (v)=>void, onChange?: (v)=>void }
 */
export class StepperComponent extends BaseComponent {
    constructor(mountPoint, options = {}) {
        super(mountPoint, options);
        this.min = options.min ?? 0;
        this.max = options.max ?? 100;
        this.step = options.step ?? 1;
        this.unit = options.unit ?? '';
        this.presets = Array.isArray(options.presets) ? options.presets : [];
        this.format = typeof options.format === 'function' ? options.format : (v) => String(v);
        this.ariaLabel = options.ariaLabel || options.label || 'Value';
        this._value = this._clamp(options.value ?? this.min);
        this._repeatTimeout = null;
        this._repeatInterval = null;

        this._create();
        this._update();
        if (mountPoint) mountPoint.appendChild(this.element);
    }

    _clamp(v) {
        let n = Number(v);
        if (!Number.isFinite(n)) n = this.min;
        // Snap to the nearest step from `min`, then clamp into range.
        n = Math.round((n - this.min) / this.step) * this.step + this.min;
        return Math.max(this.min, Math.min(this.max, n));
    }

    _create() {
        this.element = document.createElement('div');
        this.element.className = 'stepper-component';
        if (this.options.id) this.element.id = `${this.options.id}-container`;

        this.element.innerHTML = `
            <div class="stepper-control">
                <button type="button" class="stepper-btn stepper-dec" tabindex="-1" aria-label="Decrease ${this.ariaLabel}">${ICONS.minus}</button>
                <div class="stepper-readout">
                    <input class="stepper-input" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="${this.ariaLabel}" />
                    ${this.unit ? `<span class="stepper-unit">${this.unit}</span>` : ''}
                </div>
                <button type="button" class="stepper-btn stepper-inc" tabindex="-1" aria-label="Increase ${this.ariaLabel}">${ICONS.plus}</button>
            </div>
        `;

        this.decBtn = this.element.querySelector('.stepper-dec');
        this.incBtn = this.element.querySelector('.stepper-inc');
        this.input = this.element.querySelector('.stepper-input');
        if (this.options.id) this.input.id = this.options.id;

        if (this.presets.length) {
            this.presetRow = document.createElement('div');
            this.presetRow.className = 'stepper-presets';
            this.presets.forEach(p => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'stepper-preset';
                chip.textContent = p.label;
                chip.dataset.value = String(p.value);
                chip.title = p.title || `${p.label} — ${this.format(p.value)}${this.unit ? ' ' + this.unit : ''}`;
                this._addDOMListener(chip, 'click', () => this._commit(p.value));
                this.presetRow.appendChild(chip);
            });
            this.element.appendChild(this.presetRow);
        }

        this._bindHold(this.decBtn, -1);
        this._bindHold(this.incBtn, +1);

        this._addDOMListener(this.element.querySelector('.stepper-control'), 'wheel', (e) => {
            e.preventDefault();
            this._commit(this._value + (e.deltaY < 0 ? this.step : -this.step));
        }, { passive: false });

        this._addDOMListener(this.input, 'keydown', (e) => {
            if (e.key === 'ArrowUp') { e.preventDefault(); this._commit(this._value + this.step); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); this._commit(this._value - this.step); }
            else if (e.key === 'Enter') { e.preventDefault(); this.input.blur(); }
        });
        this._addDOMListener(this.input, 'change', () => this._commitFromInput());
        this._addDOMListener(this.input, 'blur', () => this._commitFromInput());
        this._addDOMListener(this.input, 'focus', () => this.input.select());
    }

    // Single step on press, then auto-repeat after a short delay while held.
    _bindHold(btn, dir) {
        this._addDOMListener(btn, 'pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            this._commit(this._value + dir * this.step);
            try { btn.setPointerCapture?.(e.pointerId); } catch { /* synthetic/invalid pointer */ }
            this._clearHold();
            this._repeatTimeout = setTimeout(() => {
                this._repeatInterval = setInterval(() => this._commit(this._value + dir * this.step), 70);
            }, 350);
        });
        const stop = () => this._clearHold();
        this._addDOMListener(btn, 'pointerup', stop);
        this._addDOMListener(btn, 'pointerleave', stop);
        this._addDOMListener(btn, 'pointercancel', stop);
    }

    _clearHold() {
        if (this._repeatTimeout) { clearTimeout(this._repeatTimeout); this._repeatTimeout = null; }
        if (this._repeatInterval) { clearInterval(this._repeatInterval); this._repeatInterval = null; }
    }

    _commitFromInput() {
        const raw = parseFloat(this.input.value);
        if (Number.isNaN(raw)) { this._update(); return; } // revert to last good value
        this._commit(raw);
    }

    _commit(v) {
        const clamped = this._clamp(v);
        const changed = clamped !== this._value;
        this._value = clamped;
        this._update();
        if (this.options.onInput) this.options.onInput(clamped);
        if (changed && this.options.onChange) this.options.onChange(clamped);
    }

    _update() {
        this.input.value = this.format(this._value);
        this.decBtn.disabled = this._value <= this.min;
        this.incBtn.disabled = this._value >= this.max;
        if (this.presetRow) {
            this.presetRow.querySelectorAll('.stepper-preset').forEach(chip => {
                chip.classList.toggle('active', Number(chip.dataset.value) === this._value);
            });
        }
    }

    getValue() { return this._value; }

    // Programmatic update without firing onChange (mirrors SliderComponent.setValue default).
    setValue(value) {
        this._value = this._clamp(value);
        this._update();
    }

    setDisabled(disabled) {
        this.element.classList.toggle('disabled', !!disabled);
        this.decBtn.disabled = !!disabled || this._value <= this.min;
        this.incBtn.disabled = !!disabled || this._value >= this.max;
        this.input.disabled = !!disabled;
    }

    destroy() {
        this._clearHold();
        super.destroy();
    }
}
