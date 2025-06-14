import { BaseComponent } from './BaseComponent.js'; 

export class SliderComponent extends BaseComponent { 
    constructor(mountPoint, options) {
        super(mountPoint, options); 
        this.options.step = this.options.step === undefined ? 1 : parseFloat(this.options.step);
        this.options.min = this.options.min === undefined ? 0 : parseFloat(this.options.min);
        this.options.max = this.options.max === undefined ? 100 : parseFloat(this.options.max);
        this.options.value = this.options.value === undefined ? (this.options.min + this.options.max) / 2 : parseFloat(this.options.value);
        
        // NEW: State for fine-scrubbing interaction
        this.isScrubbing = false;
        this.scrubStartY = 0;
        this.scrubStartX = 0;
        this.scrubStartValue = 0;
        this.granularity = 1.0;
        this.tooltipElement = null;
        
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

        // NEW: Create tooltip element and append to body
        this.tooltipElement = document.createElement('div');
        this.tooltipElement.className = 'slider-tooltip hidden';
        document.body.appendChild(this.tooltipElement);

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
        }, { passive: false });

        // NEW: Touch event listeners for fine scrubbing
        this._addDOMListener(this.sliderElement, 'touchstart', this._handleTouchStart.bind(this), { passive: false });
    }

    // NEW: Touch handler methods
    _handleTouchStart(event) {
        event.preventDefault();
        this.isScrubbing = true;
        this.element.classList.add('is-scrubbing');

        const touch = event.touches[0];
        this.scrubStartX = touch.clientX;
        this.scrubStartY = touch.clientY;
        this.scrubStartValue = this._parseValue(this.sliderElement.value);
        this.granularity = 1.0;

        this._updateTooltip(touch, this.scrubStartValue);
        this.tooltipElement.classList.remove('hidden');

        // Add move/end listeners to the document to capture movement outside the element
        this._boundHandleTouchMove = this._handleTouchMove.bind(this);
        this._boundHandleTouchEnd = this._handleTouchEnd.bind(this);
        document.addEventListener('touchmove', this._boundHandleTouchMove, { passive: false });
        document.addEventListener('touchend', this._boundHandleTouchEnd, { passive: false });
    }

    _handleTouchMove(event) {
        if (!this.isScrubbing) return;
        event.preventDefault();

        const touch = event.touches[0];
        const deltaX = touch.clientX - this.scrubStartX;
        const deltaY = this.scrubStartY - touch.clientY; // Up is positive

        // Determine granularity based on vertical drag distance
        if (deltaY < 15)      this.granularity = 1.0;
        else if (deltaY < 70) this.granularity = 0.1;
        else                  this.granularity = 0.01;

        const sliderWidth = this.sliderElement.getBoundingClientRect().width;
        const valueRange = this.options.max - this.options.min;
        const valueChange = (deltaX / sliderWidth) * valueRange * this.granularity;
        
        let newValue = this.scrubStartValue + valueChange;
        
        // Clamp and step the new value
        newValue = Math.max(this.options.min, Math.min(this.options.max, newValue));
        const precision = this._getStepPrecision();
        newValue = parseFloat(newValue.toFixed(precision + 2)); // Keep extra precision while dragging

        this.sliderElement.value = String(newValue);
        this._updateValueDisplay(newValue);
        this._updateTooltip(touch, newValue);

        if (this.options.onInput) {
            this.options.onInput(this._parseValue(this.sliderElement.value));
        }
    }

    _handleTouchEnd(event) {
        if (!this.isScrubbing) return;
        this.isScrubbing = false;
        this.element.classList.remove('is-scrubbing');
        this.tooltipElement.classList.add('hidden');

        document.removeEventListener('touchmove', this._boundHandleTouchMove);
        document.removeEventListener('touchend', this._boundHandleTouchEnd);
        
        // Dispatch the final change event
        const finalValue = this._parseValue(this.sliderElement.value);
        this.setValue(finalValue); // Finalize value with correct stepping
        if (this.options.onChange) {
            this.options.onChange(finalValue);
        }
    }

    // NEW: Tooltip update method
    _updateTooltip(touchEvent, value) {
        const precision = this._getStepPrecision();
        const granularityText = this.granularity < 1.0 ? `<span class="slider-tooltip-granularity">${this.granularity}x speed</span>` : '';
        
        this.tooltipElement.innerHTML = `${value.toFixed(precision + 1)}${granularityText}`;
        this.tooltipElement.style.left = `${touchEvent.clientX}px`;
        this.tooltipElement.style.top = `${touchEvent.clientY - 45}px`; // Position above the finger
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
        // NEW: Ensure tooltip is removed from the DOM on destroy
        if (this.tooltipElement && this.tooltipElement.parentElement) {
            this.tooltipElement.parentElement.removeChild(this.tooltipElement);
        }
        super.destroy(); 
        
    }
} 