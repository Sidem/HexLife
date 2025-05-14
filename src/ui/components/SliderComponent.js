// src/ui/components/SliderComponent.js
export class SliderComponent {
    constructor(mountPoint, options) {
        if (!mountPoint) {
            console.error("SliderComponent: mountPoint is required.");
            return;
        }
        this.mountPoint = typeof mountPoint === 'string' ? document.getElementById(mountPoint) : mountPoint;
        if (!this.mountPoint) {
            console.error("SliderComponent: mountPoint element not found.");
            return;
        }

        this.options = {
            id: '',
            label: '',
            min: 0,
            max: 100,
            step: 1,
            value: 50,
            unit: '', // e.g., 'tps', '%', or empty
            showValue: true, // Whether to display the value span
            isBias: false, // Special formatting for bias slider
            onChange: () => {}, // Callback when value changes
            onInput: () => {},  // Callback during sliding
            disabled: false,
            ...options
        };

        this._createElement();
        this._attachEventListeners();
        this.setValue(this.options.value); // Initialize display
        this.setDisabled(this.options.disabled);
    }

    _createElement() {
        this.mountPoint.innerHTML = ''; // Clear the mount point

        this.container = document.createElement('div');
        this.container.className = 'slider-component-container';
         if (this.options.id) {
             this.container.id = `${this.options.id}-container`;
         }

        if (this.options.label) {
            this.labelElement = document.createElement('label');
            this.labelElement.htmlFor = this.options.id || `slider-${Date.now()}`;
            this.labelElement.textContent = this.options.label;
            this.container.appendChild(this.labelElement);
        }

        this.sliderWrapper = document.createElement('div');
        this.sliderWrapper.className = 'slider-wrapper'; // For positioning value span correctly

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
         this.container.appendChild(this.sliderWrapper);

         if (this.options.unit && this.options.showValue) {
             this.unitDisplayElement = document.createElement('span');
             this.unitDisplayElement.className = 'unit-display';
             this.unitDisplayElement.textContent = this.options.unit;
             this.container.appendChild(this.unitDisplayElement);
         }
        this.mountPoint.appendChild(this.container);
    }

    _attachEventListeners() {
        this.sliderElement.addEventListener('input', (event) => {
            const value = this.options.isBias ? parseFloat(event.target.value) : parseInt(event.target.value, 10);
            this._updateValueDisplay(value);
            if (this.options.onInput) {
                this.options.onInput(value);
            }
        });

        this.sliderElement.addEventListener('change', (event) => {
            const value = this.options.isBias ? parseFloat(event.target.value) : parseInt(event.target.value, 10);
            this._updateValueDisplay(value); // Ensure display is correct on final change
            if (this.options.onChange) {
                this.options.onChange(value);
            }
        });

        // Optional: Add wheel event listener if desired for all sliders globally
         this.sliderElement.addEventListener('wheel', (event) => {
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
             this._updateValueDisplay(this.options.isBias ? parseFloat(currentValue.toFixed(3)) : currentValue);

             // Dispatch input and change events to trigger callbacks
             this.sliderElement.dispatchEvent(new Event('input', { bubbles: true }));
             this.sliderElement.dispatchEvent(new Event('change', { bubbles: true }));

         }, { passive: false });
    }

    _updateValueDisplay(value) {
        if (this.options.showValue && this.valueDisplayElement) {
            if (this.options.isBias) {
                this.valueDisplayElement.textContent = value.toFixed(3);
            } else {
                this.valueDisplayElement.textContent = value;
            }
        }
    }

    getValue() {
        return this.options.isBias ? parseFloat(this.sliderElement.value) : parseInt(this.sliderElement.value, 10);
    }

    setValue(value, triggerCallbacks = false) {
        const processedValue = this.options.isBias ? parseFloat(value) : parseInt(value, 10);
        this.sliderElement.value = processedValue;
        this._updateValueDisplay(processedValue);
        if (triggerCallbacks) {
             if (this.options.onInput) this.options.onInput(processedValue);
             if (this.options.onChange) this.options.onChange(processedValue);
        }
    }

    setDisabled(isDisabled) {
         this.options.disabled = isDisabled;
         this.sliderElement.disabled = isDisabled;
         if (this.valueDisplayElement) {
             this.valueDisplayElement.style.opacity = isDisabled ? '0.5' : '1';
         }
         if (this.unitDisplayElement) {
             this.unitDisplayElement.style.opacity = isDisabled ? '0.5' : '1';
         }
         if (this.labelElement) {
             this.labelElement.style.opacity = isDisabled ? '0.5' : '1';
         }
    }

    destroy() {
        // Remove event listeners if any were attached directly to document or window
        // For now, listeners are on elements, so clearing innerHTML of mountPoint should suffice.
        this.mountPoint.innerHTML = '';
    }
} 