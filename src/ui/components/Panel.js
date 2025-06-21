import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class Panel extends BaseComponent {
    constructor(mountPoint, options = {}) {
        super(mountPoint, options);
        this.panelElement = this.mountPoint;
        this.contentComponentType = options.contentComponentType || null; // Store the type identifier
        // This will be set by subclasses that have a specific content area
        this.contentContainer = options.contentContainer || this.panelElement;
    }

    show() {
        if (this.panelElement && this.isHidden()) {
            this.panelElement.classList.remove('hidden');
            // Dispatch a richer event for the UIManager
            EventBus.dispatch(EVENTS.VIEW_SHOWN, {
                view: this, // The Panel instance itself
                // The UIManager will use this to know WHAT component to place
                contentComponentType: this.contentComponentType,
                // The UIManager will use this to know WHERE to place the component
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