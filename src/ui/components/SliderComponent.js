
import { BaseComponent } from './BaseComponent.js'; 

export class SliderComponent extends BaseComponent { 
    constructor(mountPoint, options) {
        super(mountPoint, options); 
        this.options.step = this.options.step === undefined ? 1 : parseFloat(this.options.step);
        this.options.min = this.options.min === undefined ? 0 : parseFloat(this.options.min);
        this.options.max = this.options.max === undefined ? 100 : parseFloat(this.options.max);
        this.options.value = this.options.value === undefined ? (this.options.min + this.options.max) / 2 : parseFloat(this.options.value);
        this._createElement();
        this._attachEventListenersToElements(); 
        this.setValue(this.options.value);
        this.setDisabled(this.options.disabled);
    }

    _getStepPrecision() {
        const stepStr = String(this.options.step);
        if (stepStr.includes('.')) {
            const parts = stepStr.split('.');
            return parts[1] ? parts[1].length : 0;
        }
        return 0; 
    }

    _parseValue(valueStr) {
        const precision = this._getStepPrecision();
        const numValue = parseFloat(valueStr);
        return precision > 0 ? numValue : parseInt(valueStr, 10); 
    }

    _createElement() {
        
        this.element = document.createElement('div'); 
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
        this.sliderElement.value = String(this.options.value); 
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

        this.mountPoint.appendChild(this.element); 
    }

    _attachEventListenersToElements() { 
        
        this._addDOMListener(this.sliderElement, 'input', (event) => {
            const value = this._parseValue(event.target.value);
            this._updateValueDisplay(value); 
            if (this.options.onInput) {
                this.options.onInput(value); 
            }
        });

        this._addDOMListener(this.sliderElement, 'change', (event) => {
            const value = this._parseValue(event.target.value);
            this._updateValueDisplay(value); 
            if (this.options.onChange) {
                this.options.onChange(value); 
            }
        });
        
        this._addDOMListener(this.sliderElement, 'wheel', (event) => {
             if (this.sliderElement.disabled) return;
             event.preventDefault();
             const step = this.options.step; 
             let currentValue = parseFloat(this.sliderElement.value); 
             if (event.deltaY < 0) { currentValue += step; }
             else { currentValue -= step; }
             const precision = this._getStepPrecision();
             if (precision > 0) {
                
                currentValue = parseFloat(currentValue.toFixed(precision));
             } else { 
                 currentValue = Math.round(currentValue / step) * step;
             }
             currentValue = Math.max(this.options.min, Math.min(this.options.max, currentValue));
             this.sliderElement.value = String(currentValue);
             this._updateValueDisplay(currentValue);
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
        return this._parseValue(this.sliderElement.value); 
    }

    setValue(value, dispatchEvents = false) { 
        let valueToSet = parseFloat(value); 
        const precision = this._getStepPrecision();

        if (precision > 0) {
            valueToSet = parseFloat(valueToSet.toFixed(precision));
        } else {
            valueToSet = Math.round(valueToSet);
        }
        valueToSet = Math.max(this.options.min, Math.min(this.options.max, valueToSet));
        if (precision === 0) {
            valueToSet = Math.round(valueToSet);
        }
        this.sliderElement.value = String(valueToSet);
        this._updateValueDisplay(valueToSet); 
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
        super.destroy(); 
        
    }
} 