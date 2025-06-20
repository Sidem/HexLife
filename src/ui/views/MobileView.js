import { BaseComponent } from '../components/BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class MobileView extends BaseComponent {
    constructor(mountPoint, options = {}) {
        super(mountPoint);
        this.options = options;
        this.title = options.title || 'Mobile View';
        this.element = null;
        this.contentComponent = null;
    }

    render() {
        this.element = document.createElement('div');
        if (this.options.id) {
            this.element.id = this.options.id;
        }
        this.element.className = 'mobile-view hidden';
        this.element.innerHTML = `
            <div class="mobile-view-header">
                <h2 class="mobile-view-title">${this.title}</h2>
                <button class="mobile-view-close-button" data-action="close">&times;</button>
            </div>
            <div class="mobile-view-content"></div>
        `;
        this.mountPoint.appendChild(this.element);

        this.contentContainer = this.element.querySelector('.mobile-view-content');
        
        this.attachEventListeners();
    }
    
    attachEventListeners() {
        this._addDOMListener(this.element.querySelector('[data-action="close"]'), 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'simulate' });
        });
    }

    setContent(contentElement) {
        if (this.contentContainer && contentElement) {
            this.contentContainer.innerHTML = '';
            this.contentContainer.appendChild(contentElement);
        }
    }

    setContentComponent(component) {
        this.contentComponent = component;
        if (component && component.getElement) {
            this.setContent(component.getElement());
        }
    }

    show() {
        if (!this.element) {
            this.render();
        }
        this.element.classList.remove('hidden');
        
        if (this.contentComponent && this.contentComponent.refresh) {
            this.contentComponent.refresh();
        }
    }

    hide() {
        if (this.element) {
            this.element.classList.add('hidden');
        }
    }
} 