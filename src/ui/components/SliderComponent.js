// src/ui/components/SliderComponent.js
import { BaseComponent } from './BaseComponent.js'; // Import BaseComponent

export class SliderComponent extends BaseComponent { // Extend BaseComponent
    constructor(mountPoint, options) {
        super(mountPoint, options); // Call BaseComponent constructor
        // The original constructor logic of SliderComponent already uses this.options
        // and this.mountPoint which are set by BaseComponent.

        // No need to re-declare this.mountPoint or this.options
        // this.mountPoint = ... (done by super)
        // this.options = { ...options }; (done by super, merged by BaseComponent)

        this._createElement();
        this._attachEventListenersToElements(); // Renamed to avoid conflict if super had _attachEventListeners
        this.setValue(this.options.value);
        this.setDisabled(this.options.disabled);
    }

    _createElement() {
        // Create this.container as the root element for this component
        this.element = document.createElement('div'); // Standardize on 'this.element' for the component's root
        this.element.className = 'slider-component-container';
         if (this.options.id) {
             this.element.id = `${this.options.id}-container`;
         }

        if (this.options.label) {
            this.labelElement = document.createElement('label');
            this.labelElement.htmlFor = this.options.id || `slider-${Date.now()}`;
            this.labelElement.textContent = this.options.label;
            this.element.appendChild(this.labelElement);
        }

        this.sliderWrapper = document.createElement('div');
        this.sliderWrapper.className = 'slider-wrapper';

        this.sliderElement = document.createElement('input');
        this.sliderElement.type = 'range';
        if (this.options.id) this.sliderElement.id = this.options.id;
        this.sliderElement.min = this.options.min;
        this.sliderElement.max = this.options.max;
        this.sliderElement.step = this.options.step;
        this.sliderElement.value = this.options.value;
        this.sliderWrapper.appendChild(this.sliderElement);

        if (this.options.showValue) {
            this.valueDisplayElement = document.createElement('span');
            this.valueDisplayElement.className = 'value-display';
            this.sliderWrapper.appendChild(this.valueDisplayElement);
        }
        this.element.appendChild(this.sliderWrapper);

         if (this.options.unit && this.options.showValue) {
             this.unitDisplayElement = document.createElement('span');
             this.unitDisplayElement.className = 'unit-display';
             this.unitDisplayElement.textContent = this.options.unit;
             this.element.appendChild(this.unitDisplayElement);
         }

        this.mountPoint.appendChild(this.element); // Append the component's root to the mount point
    }

    _attachEventListenersToElements() { // Renamed
        // Use the _addDOMListener helper from BaseComponent for cleanup
        this._addDOMListener(this.sliderElement, 'input', (event) => {
            const value = this.options.isBias ? parseFloat(event.target.value) : parseInt(event.target.value, 10);
            this._updateValueDisplay(value);
            if (this.options.onInput) {
                this.options.onInput(value);
            }
        });

        this._addDOMListener(this.sliderElement, 'change', (event) => {
            const value = this.options.isBias ? parseFloat(event.target.value) : parseInt(event.target.value, 10);
            this._updateValueDisplay(value);
            if (this.options.onChange) {
                this.options.onChange(value);
            }
        });
        
        this._addDOMListener(this.sliderElement, 'wheel', (event) => {
             if (this.sliderElement.disabled) return;
             event.preventDefault();
             const step = parseFloat(this.sliderElement.step) || 1;
             let currentValue = parseFloat(this.sliderElement.value);

             if (event.deltaY < 0) { currentValue += step; }
             else { currentValue -= step; }

             currentValue = Math.max(parseFloat(this.sliderElement.min), Math.min(parseFloat(this.sliderElement.max), currentValue));
             
             if (!this.options.isBias) {
                 currentValue = Math.round(currentValue / step) * step;
                  currentValue = Math.max(parseFloat(this.sliderElement.min), Math.min(parseFloat(this.sliderElement.max), currentValue));
             }

             this.sliderElement.value = currentValue;
             const finalValue = this.options.isBias ? parseFloat(currentValue.toFixed(3)) : currentValue;
             this._updateValueDisplay(finalValue);

             this.sliderElement.dispatchEvent(new Event('input', { bubbles: true }));
             this.sliderElement.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    _updateValueDisplay(value) {
        if (this.valueDisplayElement) {
            const displayValue = this.options.isBias ? value.toFixed(3) : value;
            this.valueDisplayElement.textContent = displayValue;
        }
    }

    getValue() {
        return this.options.isBias ? parseFloat(this.sliderElement.value) : parseInt(this.sliderElement.value, 10);
    }

    setValue(value, dispatchEvents = false) {
        this.sliderElement.value = value;
        this._updateValueDisplay(value);
        if (dispatchEvents) {
            this.sliderElement.dispatchEvent(new Event('input', { bubbles: true }));
            this.sliderElement.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    setDisabled(disabled) {
        this.sliderElement.disabled = disabled;
        if (disabled) {
            this.element.classList.add('disabled');
        } else {
            this.element.classList.remove('disabled');
        }
    }

    destroy() {
        super.destroy(); // Call BaseComponent's destroy for cleanup
        // Any SliderComponent-specific cleanup (if any beyond DOM listeners and eventbus) would go here
    }
} 