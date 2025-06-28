import { Panel } from '../components/Panel.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class MobileView extends Panel {
    constructor(containerElement, options = {}) {
        const viewElement = document.createElement('div');
        if (options.id) {
            viewElement.id = options.id;
        }
        viewElement.className = 'mobile-view hidden';
        super(viewElement, { ...options, viewType: 'mobile_view' });
        containerElement.appendChild(viewElement);
        this.title = options.title || 'Mobile View';
        this._renderInnerContent();
        
        if (options.contentComponentType) {
            this.contentComponentType = options.contentComponentType;
            this.contentContainer = this.panelElement.querySelector('.mobile-view-content');
        }
    }

    /**
     * Renders the *inner* structure of the mobile view into the main `this.element`.
     * This is called once by the constructor.
     * @private
     */
    _renderInnerContent() {
        this.panelElement.innerHTML = `
            <div class="mobile-view-header">
                <h2 class="mobile-view-title">${this.title}</h2>
                <button class="mobile-view-close-button" data-action="close">&times;</button>
            </div>
            <div class="mobile-view-content"></div>
        `;

        this.contentContainer = this.panelElement.querySelector('.mobile-view-content');
        this.attachEventListeners();
    }

    attachEventListeners() {
        this._addDOMListener(this.panelElement.querySelector('[data-action="close"]'), 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'simulate' });
        });
    }

    setContent(contentElement) {
        if (this.contentContainer && contentElement) {
            this.contentContainer.innerHTML = '';
            this.contentContainer.appendChild(contentElement);
        }
    }

    show() {
        super.show(); 
    }

    
} 