import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class ConfirmationDialog extends BaseComponent {
    constructor(mountPoint) {
        super(mountPoint);
        this.render();
        this.hide();
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'confirmation-dialog';
        this.element.className = 'modal-overlay hidden';
        this.element.innerHTML = `
            <div class="modal-content" role="alertdialog" aria-modal="true">
                <h4 id="confirmation-title"></h4>
                <p id="confirmation-message"></p>
                <div class="modal-actions">
                    <button class="button" id="confirmation-cancel-btn">Cancel</button>
                    <button class="button" id="confirmation-confirm-btn">Confirm</button>
                </div>
            </div>
        `;
        this.mountPoint.appendChild(this.element);

        this.ui = {
            title: this.element.querySelector('#confirmation-title'),
            message: this.element.querySelector('#confirmation-message'),
            confirmBtn: this.element.querySelector('#confirmation-confirm-btn'),
            cancelBtn: this.element.querySelector('#confirmation-cancel-btn'),
        };

        this._addDOMListener(this.ui.cancelBtn, 'click', this.hide);
        this._addDOMListener(this.element, 'click', (e) => {
            if (e.target === this.element) this.hide();
        });
    }

    show = ({ title, message, confirmLabel = 'Confirm', onConfirm }) => {
        this.ui.title.textContent = title;
        this.ui.message.textContent = message;
        this.ui.confirmBtn.textContent = confirmLabel;

        // Clone and replace the button to remove old listeners before adding a new one
        const newConfirmBtn = this.ui.confirmBtn.cloneNode(true);
        this.ui.confirmBtn.parentNode.replaceChild(newConfirmBtn, this.ui.confirmBtn);
        this.ui.confirmBtn = newConfirmBtn;
        
        this.ui.confirmBtn.addEventListener('click', () => {
            onConfirm();
            this.hide();
        }, { once: true });

        this.element.classList.remove('hidden');
    }

    hide = () => {
        this.element.classList.add('hidden');
    }
} 