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
    
    _saveState() {
        
    }
} 