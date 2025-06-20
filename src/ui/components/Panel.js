import { BaseComponent } from './BaseComponent.js';

export class Panel extends BaseComponent {
    constructor(mountPoint, options = {}) {
        super(mountPoint, options);
        this.panelElement = this.mountPoint;
    }

    show() {
        if (this.panelElement) {
            this.panelElement.classList.remove('hidden');
        }
        if (this.options.persistence) {
            this._saveState();
        }
    }

    hide() {
        if (this.panelElement) {
            this.panelElement.classList.add('hidden');
        }
        if (this.options.persistence) {
            this._saveState();
        }
    }

    toggle() {
        if (this.isHidden()) {
            this.show();
        } else {
            this.hide();
        }
    }

    isHidden() {
        return this.panelElement ? this.panelElement.classList.contains('hidden') : true;
    }
    
    // Persistence logic can be added here if needed, or kept in subclasses.
    // For this refactor, we assume subclasses will handle their specific state saving.
    _saveState() {
        // To be implemented by subclasses that require persistence.
    }
} 