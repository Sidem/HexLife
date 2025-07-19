import { BaseComponent } from './components/BaseComponent.js';
import { EVENTS } from '../services/EventBus.js';
import * as PersistenceService from '../services/PersistenceService.js';

export class ToastManager extends BaseComponent {
    constructor(mountPoint) {
        super(mountPoint);
        this.toasts = [];
        this._subscribeToEvent(EVENTS.COMMAND_SHOW_TOAST, this.showToast.bind(this));
    }

    showToast({ message, type = 'info', duration = 3000 }) {
        const showToasts = PersistenceService.loadUISetting('showCommandToasts', true);
        if (!showToasts) return;

        const toastElement = document.createElement('div');
        toastElement.className = `toast-notification ${type}`;
        toastElement.textContent = message;
        this.mountPoint.appendChild(toastElement);

        // Animate in
        requestAnimationFrame(() => {
            toastElement.classList.add('show');
        });

        const toast = {
            element: toastElement,
            timeoutId: setTimeout(() => {
                this.removeToast(toastElement);
            }, duration)
        };
        this.toasts.push(toast);
    }

    removeToast(toastElement) {
        toastElement.classList.remove('show');
        toastElement.classList.add('fade-out');

        // Remove from DOM after fade-out animation
        setTimeout(() => {
            if (toastElement.parentNode) {
                toastElement.parentNode.removeChild(toastElement);
            }
            this.toasts = this.toasts.filter(t => t.element !== toastElement);
        }, 300);
    }
} 