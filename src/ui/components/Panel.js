import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class Panel extends BaseComponent {
    constructor(mountPoint, options = {}) {
        super(mountPoint, options);
        this.panelElement = this.mountPoint;
        this.contentComponentType = options.contentComponentType || null; 
        this.contentContainer = options.contentContainer || this.panelElement;
    }

    show() {
        if (this.panelElement && this.isHidden()) {
            this.panelElement.classList.remove('hidden');
            
            EventBus.dispatch(EVENTS.VIEW_SHOWN, {
                view: this, 
                contentComponentType: this.contentComponentType,
                contentContainer: this.contentContainer
            });
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