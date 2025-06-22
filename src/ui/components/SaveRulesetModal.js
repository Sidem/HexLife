import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class SaveRulesetModal extends BaseComponent {
    constructor(mountPoint, appContext) {
        super(mountPoint);
        this.appContext = appContext;
        this.rulesetData = {};
        this.render();
        this.hide();
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'save-ruleset-modal';
        this.element.className = 'modal-overlay hidden';
        this.element.innerHTML = `
            <div class="modal-content" role="dialog" aria-labelledby="save-ruleset-modal-title" aria-modal="true">
                <h3 id="save-ruleset-modal-title">Save Ruleset</h3>
                <button class="modal-close-button" aria-label="Close">&times;</button>
                <div class="form-group">
                    <label for="ruleset-name-input">Name</label>
                    <input type="text" id="ruleset-name-input" required maxlength="50" placeholder="e.g., 'Crawling Crystals'">
                </div>
                <div class="form-group">
                    <label for="ruleset-desc-input">Description (Optional)</label>
                    <textarea id="ruleset-desc-input" rows="3" maxlength="200" placeholder="e.g., 'A slow-growing pattern...'"></textarea>
                </div>
                <div class="form-group">
                    <label>Ruleset Hex</label>
                    <code id="ruleset-hex-display"></code>
                </div>
                <div class="modal-actions">
                    <button class="button" id="cancel-save-button">Cancel</button>
                    <button class="button" id="confirm-save-button" disabled>Save</button>
                </div>
            </div>
        `;
        this.mountPoint.appendChild(this.element);

        this.ui = {
            title: this.element.querySelector('#save-ruleset-modal-title'),
            nameInput: this.element.querySelector('#ruleset-name-input'),
            descInput: this.element.querySelector('#ruleset-desc-input'),
            hexDisplay: this.element.querySelector('#ruleset-hex-display'),
            saveBtn: this.element.querySelector('#confirm-save-button'),
            cancelBtn: this.element.querySelector('#cancel-save-button'),
            closeBtn: this.element.querySelector('.modal-close-button'),
            modalContent: this.element.querySelector('.modal-content'),
        };

        this._addDOMListener(this.ui.nameInput, 'input', () => {
            this.ui.saveBtn.disabled = this.ui.nameInput.value.trim() === '';
        });
        this._addDOMListener(this.ui.saveBtn, 'click', this.handleSave);
        this._addDOMListener(this.ui.cancelBtn, 'click', this.hide);
        this._addDOMListener(this.ui.closeBtn, 'click', this.hide);
        // Close on overlay click
        this._addDOMListener(this.element, 'click', (e) => {
            if (e.target === this.element) {
                this.hide();
            }
        });
    }

    show = (data) => {
        this.rulesetData = { ...data };
        this.ui.hexDisplay.textContent = this.rulesetData.hex;
        this.ui.nameInput.value = this.rulesetData.name || '';
        this.ui.descInput.value = this.rulesetData.description || '';
        this.ui.title.textContent = this.rulesetData.id ? 'Edit Ruleset' : 'Save Ruleset';
        this.ui.saveBtn.disabled = !this.ui.nameInput.value;
        this.element.classList.remove('hidden');
        this.ui.nameInput.focus();
    }

    hide = () => {
        this.element.classList.add('hidden');
    }

    handleSave = () => {
        const name = this.ui.nameInput.value.trim();
        if (!name) return;

        const saveData = {
            ...this.rulesetData,
            name: name,
            description: this.ui.descInput.value.trim(),
        };

        this.appContext.libraryController.saveUserRuleset(saveData);
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Ruleset '${name}' saved!`, type: 'success' });
        this.hide();
    }
} 