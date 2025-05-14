// src/ui/components/BaseComponent.js
import { EventBus } from '../../services/EventBus.js';

export class BaseComponent {
    constructor(mountPoint, options = {}) {
        if (mountPoint) {
            this.mountPoint = typeof mountPoint === 'string' ? document.getElementById(mountPoint) : mountPoint;
            if (!this.mountPoint && this.constructor.name !== "BaseComponent") { // Allow BaseComponent to be instantiated without mountPoint for non-DOM uses
                console.warn(`${this.constructor.name}: mountPoint element not found or not provided.`);
            }
        }
        this.options = options;
        this.eventSubscriptions = []; // To keep track of EventBus subscriptions
        this.eventListeners = []; // To keep track of DOM event listeners for cleanup
    }

    // Helper to add a DOM event listener and track it
    _addDOMListener(element, eventType, handler) {
        const boundHandler = handler.bind(this);
        element.addEventListener(eventType, boundHandler);
        this.eventListeners.push({ element, eventType, handler: boundHandler });
    }

    // Helper to subscribe to the global EventBus and track subscription
    _subscribeToEvent(eventType, handler) {
        const boundHandler = handler.bind(this);
        const unsubscribe = EventBus.subscribe(eventType, boundHandler);
        this.eventSubscriptions.push(unsubscribe);
    }

    render() {
        // To be implemented by subclasses for creating/updating their DOM
        // console.warn(`${this.constructor.name} should implement a render() method.`);
    }

    // Common destroy method to clean up
    destroy() {
        // Unsubscribe from all EventBus events
        this.eventSubscriptions.forEach(unsubscribe => unsubscribe());
        this.eventSubscriptions = [];

        // Remove all DOM event listeners
        this.eventListeners.forEach(({ element, eventType, handler }) => {
            element.removeEventListener(eventType, handler);
        });
        this.eventListeners = [];

        // Clear the component's DOM content if it has a mount point
        if (this.mountPoint && this.mountPoint.parentNode) { // Check parentNode to ensure it's still in DOM
             // More robustly clear content if the component "owns" the content of mountPoint
             // This depends on how components are structured.
             // If components always create their own root element within mountPoint:
             // if (this.element && this.element.parentNode === this.mountPoint) {
             //     this.mountPoint.removeChild(this.element);
             // } else {
             // For now, a simple clear, assuming component fills mountPoint directly.
             // Subclasses might need more specific cleanup.
             // this.mountPoint.innerHTML = ''; // This can be too aggressive if mountPoint is shared
        }
         if (this.element && this.element.parentNode) { // if component has a this.element property as its root
             this.element.parentNode.removeChild(this.element);
         }
         
        console.log(`${this.constructor.name} destroyed.`);
    }

    // Placeholder for future common methods
    // show() { if (this.element) this.element.classList.remove('hidden'); }
    // hide() { if (this.element) this.element.classList.add('hidden'); }
} 