import { BaseComponent } from './BaseComponent.js';

/**
 * A labelled on/off toggle rendered as a row: text on the left, an iOS-style
 * switch on the right. Replaces the old "checkbox-as-full-width-button" pattern
 * whose on/off state was hard to read at a glance.
 *
 * Options:
 *   id            – stable id for the input (and `${id}-row` on the wrapper)
 *   label         – primary text
 *   description   – optional muted sub-line explaining the setting
 *   initialValue  – boolean
 *   onChange(bool)
 */
export class ToggleSwitch extends BaseComponent {
    constructor(mountPoint, options = {}) {
        super(mountPoint, options);
        this.options = {
            id: `toggle-${Date.now()}`,
            label: '',
            description: '',
            initialValue: false,
            onChange: () => {},
            ...this.options
        };
        this.render();
        this._attachEventListeners();
    }

    render() {
        const { id, label, description, initialValue } = this.options;
        this.element = document.createElement('label');
        this.element.className = 'toggle-switch-row';
        this.element.id = `${id}-row`;
        this.element.htmlFor = id;

        const descHtml = description
            ? `<span class="toggle-switch-desc">${description}</span>`
            : '';

        this.element.innerHTML = `
            <span class="toggle-switch-text">
                <span class="toggle-switch-label">${label}</span>
                ${descHtml}
            </span>
            <span class="toggle-switch-control">
                <input type="checkbox" id="${id}" class="toggle-switch-input" role="switch" ${initialValue ? 'checked' : ''}>
                <span class="toggle-switch-track"><span class="toggle-switch-thumb"></span></span>
            </span>
        `;

        this.inputElement = this.element.querySelector('.toggle-switch-input');
        if (this.mountPoint) this.mountPoint.appendChild(this.element);
    }

    _attachEventListeners() {
        this._addDOMListener(this.inputElement, 'change', (e) => {
            this.options.onChange(e.target.checked);
        });
    }

    getValue() {
        return this.inputElement.checked;
    }

    setValue(value) {
        this.inputElement.checked = !!value;
    }

    setDisabled(disabled) {
        this.inputElement.disabled = !!disabled;
        this.element.classList.toggle('disabled', !!disabled);
    }

    getElement() {
        return this.element;
    }
}
