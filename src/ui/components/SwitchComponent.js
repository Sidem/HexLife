import { BaseComponent } from './BaseComponent.js';

export class SwitchComponent extends BaseComponent {
    constructor(mountPoint, options) {
        super(mountPoint, options);
        
        this.options = {
            type: 'radio', 
            label: '',
            name: `switch-${Date.now()}`,
            items: [], 
            initialValue: null,
            onChange: () => {},
            ...this.options
        };
        this.render();
        this._attachEventListeners();
    }

    render() {
        this.element = document.createElement('div');
        this.element.className = `switch-component-container type-${this.options.type}`;

        let labelHtml = this.options.label ? `<label class="switch-component-label">${this.options.label}</label>` : '';
        let itemsHtml = this.options.items.map(item => {
            const isChecked = this.options.type === 'checkbox'
                ? this.options.initialValue
                : this.options.initialValue === item.value;
            
            
            
            const inputId = this.options.type === 'checkbox' ? this.options.name : `${this.options.name}-${item.value}`;

            return `
                <div class="switch-item">
                    <input type="${this.options.type}" id="${inputId}" name="${this.options.name}" value="${item.value}" class="switch-input" ${isChecked ? 'checked' : ''}>
                    <label for="${inputId}" class="switch-label">${item.text}</label>
                </div>
            `;
        }).join('');

        this.element.innerHTML = `${labelHtml}<div class="switch-group">${itemsHtml}</div>`;
        this.mountPoint.appendChild(this.element);
    }

    _attachEventListeners() {
        this._addDOMListener(this.element, 'change', (event) => {
            if (event.target.classList.contains('switch-input')) {
                const value = this.options.type === 'checkbox' ? event.target.checked : event.target.value;
                this.options.onChange(value);
            }
        });
    }

    setValue(newValue) {
        const inputs = this.element.querySelectorAll('.switch-input');
        inputs.forEach(input => {
            if (this.options.type === 'checkbox') {
                input.checked = !!newValue;
            } else {
                input.checked = (input.value === newValue);
            }
        });
    }

    getValue() {
        const checkedInput = this.element.querySelector('.switch-input:checked');
        if (this.options.type === 'checkbox') {
            return checkedInput ? checkedInput.checked : false;
        }
        return checkedInput ? checkedInput.value : null;
    }
} 