import { EventBus } from '../../services/EventBus.js';

export class BaseComponent {
    constructor(mountPoint, options = {}) {
        if (mountPoint) {
            this.mountPoint = typeof mountPoint === 'string' ? document.getElementById(mountPoint) : mountPoint;
            if (!this.mountPoint && this.constructor.name !== "BaseComponent") { 
                console.warn(`${this.constructor.name}: mountPoint element not found or not provided.`);
            }
        }
        this.options = options;
        this.eventSubscriptions = []; 
        this.eventListeners = []; 
    }

    _addDOMListener(element, eventType, handler, options = {}) {
        const boundHandler = handler.bind(this);
        element.addEventListener(eventType, boundHandler, options);
        this.eventListeners.push({ element, eventType, handler: boundHandler, options });
    }

    _subscribeToEvent(eventType, handler) {
        const boundHandler = handler.bind(this);
        const unsubscribe = EventBus.subscribe(eventType, boundHandler);
        this.eventSubscriptions.push(unsubscribe);
    }

    render() {
    }

    destroy() {
        this.eventSubscriptions.forEach(unsubscribe => unsubscribe());
        this.eventSubscriptions = [];
        this.eventListeners.forEach(({ element, eventType, handler }) => {
            element.removeEventListener(eventType, handler);
        });
        this.eventListeners = [];
        if (this.mountPoint && this.mountPoint.parentNode) {
        }
         if (this.element && this.element.parentNode) { 
             this.element.parentNode.removeChild(this.element);
         }
        //console.log(`${this.constructor.name} destroyed.`);
    }
} 