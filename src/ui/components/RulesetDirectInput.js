import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class RulesetDirectInput extends BaseComponent {
    constructor(mountPoint, appContext, options = {}) {
        super(mountPoint, options);
        this.appContext = appContext;
        this.context = options.context || 'shared';
        this.render();
    }

    render() {
        this.element = document.createElement('div');
        this.element.className = 'ruleset-direct-input-container';

        const inputId = `${this.context}-ruleset-input`;
        this.element.innerHTML = `
            <div class="form-group">
                <label for="${inputId}">Paste 32-character Hex Code</label>
                <input type="text" id="${inputId}" class="hex-input" placeholder="0100...8048" maxlength="32" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
            </div>
            <div class="form-group-buttons">
                 <button class="button" data-action="set-hex">Set</button>
                 <button class="button" data-action="copy-hex">Copy Current</button>
            </div>
        `;
        this.mountPoint.appendChild(this.element);

        this.inputElement = this.element.querySelector(`#${inputId}`);
        this.setButton = this.element.querySelector('[data-action="set-hex"]');
        this.copyButton = this.element.querySelector('[data-action="copy-hex"]');

        this._attachEventListeners();
    }

    _attachEventListeners() {
        this._addDOMListener(this.setButton, 'click', this._handleSetHex);
        this._addDOMListener(this.copyButton, 'click', this._handleCopyHex);
        this._addDOMListener(this.inputElement, 'keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this._handleSetHex();
            }
        });
    }

    _handleSetHex = () => {
        const hex = this.inputElement.value.trim().toUpperCase();
        if (!hex || !/^[0-9A-F]{32}$/.test(hex)) {
            alert("Invalid Hex: Must be 32 hex chars.");
            this.inputElement.select();
            return;
        }
        // Assuming 'all' scope and 'reset' is a sensible default for direct input
        EventBus.dispatch(EVENTS.COMMAND_SET_RULESET, {
            hexString: hex,
            scope: 'all',
            resetOnNewRule: true
        });
        this.inputElement.value = '';
        EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS); // Hide popout/view on success
    }

    _handleCopyHex = () => {
        const hex = this.appContext.worldManager.getCurrentRulesetHex();
        if (!hex || hex === "N/A" || hex === "Error") {
            alert("No ruleset for selected world to copy.");
            return;
        }
        navigator.clipboard.writeText(hex).then(() => {
            const oldTxt = this.copyButton.textContent;
            this.copyButton.textContent = "Copied!";
            setTimeout(() => { this.copyButton.textContent = oldTxt; }, 1500);
        }).catch(err => alert('Failed to copy ruleset hex.'));
    }
} 