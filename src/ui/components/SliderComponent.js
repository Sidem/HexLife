// src/ui/components/SliderComponent.js
import { BaseComponent } from './BaseComponent.js'; // Import BaseComponent

export class SliderComponent extends BaseComponent { // Extend BaseComponent
    constructor(mountPoint, options) {
        super(mountPoint, options); // Call BaseComponent constructor
        // Default step if not provided, affects parsing and precision
        this.options.step = this.options.step === undefined ? 1 : parseFloat(this.options.step);
        this.options.min = this.options.min === undefined ? 0 : parseFloat(this.options.min);
        this.options.max = this.options.max === undefined ? 100 : parseFloat(this.options.max);
        this.options.value = this.options.value === undefined ? (this.options.min + this.options.max) / 2 : parseFloat(this.options.value);

        this._createElement();
        this._attachEventListenersToElements(); // Renamed to avoid conflict if super had _attachEventListeners
        this.setValue(this.options.value);
        this.setDisabled(this.options.disabled);
    }

    _getStepPrecision() {
        const stepStr = String(this.options.step);
        if (stepStr.includes('.')) {
            const parts = stepStr.split('.');
            return parts[1] ? parts[1].length : 0;
        }
        return 0; // Integer step
    }

    _parseValue(valueStr) {
        const precision = this._getStepPrecision();
        // Always parse as float initially, then format or parseInt if precision is 0 for callbacks.
        // For internal consistency when reading sliderElement.value, parseFloat is safer.
        const numValue = parseFloat(valueStr);
        // For callbacks and getValue(), we might want to return int if step is an integer
        // However, let's keep it simple: callbacks receive what parseFloat gives.
        // The display will be formatted.
        return precision > 0 ? numValue : parseInt(valueStr, 10); // Return int if step is an integer
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
        this.sliderElement.min = String(this.options.min);
        this.sliderElement.max = String(this.options.max);
        this.sliderElement.step = String(this.options.step);
        this.sliderElement.value = String(this.options.value); // Initial value
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
            const value = this._parseValue(event.target.value);
            this._updateValueDisplay(value); // value is a number
            if (this.options.onInput) {
                this.options.onInput(value); // Pass number
            }
        });

        this._addDOMListener(this.sliderElement, 'change', (event) => {
            const value = this._parseValue(event.target.value);
            this._updateValueDisplay(value); // value is a number
            if (this.options.onChange) {
                this.options.onChange(value); // Pass number
            }
        });
        
        this._addDOMListener(this.sliderElement, 'wheel', (event) => {
             if (this.sliderElement.disabled) return;
             event.preventDefault();
             
             const step = this.options.step; // this.options.step is a number
             let currentValue = parseFloat(this.sliderElement.value); // Current value from slider

             if (event.deltaY < 0) { currentValue += step; }
             else { currentValue -= step; }

             const precision = this._getStepPrecision();
             if (precision > 0) {
                // Round to the step's precision to avoid floating point inaccuracies accumulation
                currentValue = parseFloat(currentValue.toFixed(precision));
             } else { 
                 // For integer steps, effectively round to the nearest step multiple.
                 // This also handles cases where step is e.g. 2, 5, 10.
                 currentValue = Math.round(currentValue / step) * step;
             }
             
             // Clamp
             currentValue = Math.max(this.options.min, Math.min(this.options.max, currentValue));

             this.sliderElement.value = String(currentValue);
             
             this._updateValueDisplay(currentValue); // Pass the processed number

             this.sliderElement.dispatchEvent(new Event('input', { bubbles: true }));
             this.sliderElement.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    _updateValueDisplay(value) {
        if (this.valueDisplayElement) {
            const precision = this._getStepPrecision();
            const displayValue = precision > 0 ? value.toFixed(precision) : String(value);
            this.valueDisplayElement.textContent = displayValue;
        }
    }

    getValue() {
        return this._parseValue(this.sliderElement.value); // Returns a number
    }

    setValue(value, dispatchEvents = false) { // value is a number
        let valueToSet = parseFloat(value); // Ensure it's a float for calculations
        const precision = this._getStepPrecision();

        if (precision > 0) {
            valueToSet = parseFloat(valueToSet.toFixed(precision));
        } else {
            // For integer steps, ensure value is a multiple of step if possible, then round.
            // Or simply round it if direct set. Let's round to nearest integer for integer steps.
            valueToSet = Math.round(valueToSet);
        }
        
        // Clamp the value before setting
        valueToSet = Math.max(this.options.min, Math.min(this.options.max, valueToSet));
        // If integer step, ensure it's an integer after clamping.
        if (precision === 0) {
            valueToSet = Math.round(valueToSet);
        }

        this.sliderElement.value = String(valueToSet);
        this._updateValueDisplay(valueToSet); // Pass the processed number
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