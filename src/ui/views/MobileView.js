import { Panel } from '../components/Panel.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class MobileView extends Panel {
    constructor(containerElement, options = {}) {
        // 1. Create the component's root DOM element first. This will be our panel.
        const viewElement = document.createElement('div');
        if (options.id) {
            viewElement.id = options.id;
        }
        viewElement.className = 'mobile-view hidden';

        // 2. Initialize the parent Panel class, passing OUR newly created element.
        //    This ensures the parent's `this.panelElement` is correctly set.
        super(viewElement, { ...options, viewType: 'mobile_view' });

        // 3. Append our newly created and properly initialized panel to the main container.
        containerElement.appendChild(viewElement);

        // 4. Now, populate the inner HTML of our panel.
        this.title = options.title || 'Mobile View';
        this._renderInnerContent();
        
        // 5. Set up the content container for reparenting
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

    setContentComponent(component) {
        // This method is deprecated - components are now managed by UIManager
        console.warn('MobileView.setContentComponent is deprecated. Components are now managed by UIManager.');
    }

    show() {
        super.show(); // This handles removing 'hidden' and dispatching the VIEW_SHOWN event for reparenting
    }

    // show() and hide() are now correctly inherited from Panel.js and can be removed from this file.
} 