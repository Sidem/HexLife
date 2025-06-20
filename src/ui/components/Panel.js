import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class Panel extends BaseComponent {
    constructor(mountPoint, options = {}) {
        super(mountPoint, options);
        this.panelElement = this.mountPoint;
        // Make the base class aware of the content component from its options
        this.contentComponent = options.contentComponent || null;
    }

    show() {
        if (this.panelElement && this.isHidden()) {
            this.panelElement.classList.remove('hidden');
            // Unified event dispatch
            EventBus.dispatch(EVENTS.VIEW_SHOWN, {
                view: this,
                viewType: this.options.viewType || 'panel',
                viewName: this.options.persistence?.identifier || this.panelElement.id || 'unknown',
                // Add the content component instance to the event payload
                contentComponent: this.contentComponent
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