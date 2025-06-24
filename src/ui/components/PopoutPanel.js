import { Panel } from './Panel.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class PopoutPanel extends Panel {
    constructor(popoutElement, triggerElement, options = {}) {
        super(popoutElement, options); 
        this.triggerElement = triggerElement;
        this.popoutElement = this.mountPoint; 
        this.options = {
            position: 'right', 
            alignment: 'start', 
            offset: 8, 
            closeOnOutsideClick: true,
            ...options
        };

        if (!this.popoutElement || !this.triggerElement) {
            console.error('PopoutPanel: popoutElement or triggerElement is missing.');
            return;
        }

        this.popoutElement.style.position = 'absolute';
        this.popoutElement.style.zIndex = '1050'; 
        this.hide(false); 
    }

    _reposition() {
        if (!this.popoutElement || !this.triggerElement) return;

        const triggerRect = this.triggerElement.getBoundingClientRect();
        
        let newTop, newLeft;

        const wasHidden = this.popoutElement.classList.contains('hidden');
        if (wasHidden) {
            this.popoutElement.style.visibility = 'hidden';
            this.popoutElement.classList.remove('hidden');
        }
        const actualPopoutRect = this.popoutElement.getBoundingClientRect();
         if (wasHidden) {
            this.popoutElement.classList.add('hidden');
            this.popoutElement.style.visibility = 'visible';
        }

        switch (this.options.position) {
            case 'bottom':
                newTop = triggerRect.bottom + this.options.offset;
                newLeft = triggerRect.left;
                if (this.options.alignment === 'center') {
                    newLeft += (triggerRect.width - actualPopoutRect.width) / 2;
                } else if (this.options.alignment === 'end') {
                    newLeft += triggerRect.width - actualPopoutRect.width;
                }
                break;
            case 'top':
                newTop = triggerRect.top - actualPopoutRect.height - this.options.offset;
                newLeft = triggerRect.left;
                 if (this.options.alignment === 'center') {
                    newLeft += (triggerRect.width - actualPopoutRect.width) / 2;
                } else if (this.options.alignment === 'end') {
                    newLeft += triggerRect.width - actualPopoutRect.width;
                }
                break;
            case 'left':
                newTop = triggerRect.top;
                newLeft = triggerRect.left - actualPopoutRect.width - this.options.offset;
                if (this.options.alignment === 'center') {
                    newTop += (triggerRect.height - actualPopoutRect.height) / 2;
                } else if (this.options.alignment === 'end') {
                    newTop += triggerRect.height - actualPopoutRect.height;
                }
                break;
            case 'right':
            default:
                newTop = triggerRect.top;
                newLeft = triggerRect.right + this.options.offset;
                 if (this.options.alignment === 'center') {
                    newTop += (triggerRect.height - actualPopoutRect.height) / 2;
                } else if (this.options.alignment === 'end') {
                    newTop += triggerRect.height - actualPopoutRect.height;
                }
                break;
        }

        if (newLeft + actualPopoutRect.width > window.innerWidth) {
            newLeft = window.innerWidth - actualPopoutRect.width - this.options.offset;
        }
        if (newTop + actualPopoutRect.height > window.innerHeight) {
            newTop = window.innerHeight - actualPopoutRect.height - this.options.offset;
        }
        if (newLeft < 0) newLeft = this.options.offset;
        if (newTop < 0) newTop = this.options.offset;

        this.popoutElement.style.top = `${newTop}px`;
        this.popoutElement.style.left = `${newLeft}px`;
    }

    show() {
        if (this.popoutElement) {
            this._reposition();
            super.show(); // Handles removing 'hidden' and dispatching the event
            this.triggerElement.classList.add('active');
        }
    }

    hide(propagate = true) {
        if (this.popoutElement) {
            super.hide();
            this.triggerElement.classList.remove('active');
        }
    }

    toggle() {
        if (this.popoutElement) {
            if (this.popoutElement.classList.contains('hidden')) {
                this.show();
            } else {
                this.hide();
            }
        }
    }

    destroy() {
        super.destroy(); 
    }
}