// src/ui/components/PopoutPanel.js
import { BaseComponent } from './BaseComponent.js';

export class PopoutPanel extends BaseComponent {
    constructor(popoutElement, triggerElement, options = {}) {
        super(popoutElement, options); // popoutElement is the actual panel to show/hide
        this.triggerElement = triggerElement;
        this.popoutElement = this.mountPoint; // Renaming for clarity within this class
        this.options = {
            position: 'right', // 'right', 'bottom', 'top', 'left', or a function
            alignment: 'start', // 'start', 'center', 'end'
            offset: 8, // px
            closeOnOutsideClick: true,
            ...options
        };

        if (!this.popoutElement || !this.triggerElement) {
            console.error('PopoutPanel: popoutElement or triggerElement is missing.');
            return;
        }

        this.popoutElement.style.position = 'absolute';
        this.popoutElement.style.zIndex = '1050'; // Ensure it's above other elements
        this.hide(false); // Start hidden, without saving state (if state saving were part of BaseComponent)

        this._addDOMListener(this.triggerElement, 'click', (event) => {
            event.stopPropagation();
            this.toggle();
        });

        if (this.options.closeOnOutsideClick) {
            this.boundHandleOutsideClick = this._handleOutsideClick.bind(this);
        }
    }

    _handleOutsideClick(event) {
        if (this.popoutElement && !this.popoutElement.classList.contains('hidden')) {
            if (!this.popoutElement.contains(event.target) && event.target !== this.triggerElement && !this.triggerElement.contains(event.target)) {
                this.hide();
            }
        }
    }

    _reposition() {
        if (!this.popoutElement || !this.triggerElement) return;

        const triggerRect = this.triggerElement.getBoundingClientRect();
        const popoutRect = this.popoutElement.getBoundingClientRect(); // May need to show it briefly to get dimensions if hidden with display:none

        let top, left;

        // Temporarily show to measure if it was 'display: none'
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
                top = triggerRect.bottom + this.options.offset;
                left = triggerRect.left;
                if (this.options.alignment === 'center') {
                    left += (triggerRect.width - actualPopoutRect.width) / 2;
                } else if (this.options.alignment === 'end') {
                    left += triggerRect.width - actualPopoutRect.width;
                }
                break;
            case 'top':
                top = triggerRect.top - actualPopoutRect.height - this.options.offset;
                left = triggerRect.left;
                 if (this.options.alignment === 'center') {
                    left += (triggerRect.width - actualPopoutRect.width) / 2;
                } else if (this.options.alignment === 'end') {
                    left += triggerRect.width - actualPopoutRect.width;
                }
                break;
            case 'left':
                top = triggerRect.top;
                left = triggerRect.left - actualPopoutRect.width - this.options.offset;
                if (this.options.alignment === 'center') {
                    top += (triggerRect.height - actualPopoutRect.height) / 2;
                } else if (this.options.alignment === 'end') {
                    top += triggerRect.height - actualPopoutRect.height;
                }
                break;
            case 'right':
            default:
                top = triggerRect.top;
                left = triggerRect.right + this.options.offset;
                 if (this.options.alignment === 'center') {
                    top += (triggerRect.height - actualPopoutRect.height) / 2;
                } else if (this.options.alignment === 'end') {
                    top += triggerRect.height - actualPopoutRect.height;
                }
                break;
        }

        // Basic viewport collision detection (can be improved)
        if (left + actualPopoutRect.width > window.innerWidth) {
            left = window.innerWidth - actualPopoutRect.width - this.options.offset;
        }
        if (top + actualPopoutRect.height > window.innerHeight) {
            top = window.innerHeight - actualPopoutRect.height - this.options.offset;
        }
        if (left < 0) left = this.options.offset;
        if (top < 0) top = this.options.offset;


        this.popoutElement.style.top = `${top}px`;
        this.popoutElement.style.left = `${left}px`;
    }

    show() {
        if (this.popoutElement) {
            this._reposition();
            this.popoutElement.classList.remove('hidden');
            this.triggerElement.classList.add('active');
            if (this.options.closeOnOutsideClick) {
                // Add listener with a slight delay to prevent immediate closing if triggered by the same click
                setTimeout(() => document.addEventListener('click', this.boundHandleOutsideClick), 0);
            }
            // Dispatch an event that this popout is shown, so others can hide
            const event = new CustomEvent('popoutshown', { bubbles: true, detail: { panel: this } });
            this.triggerElement.dispatchEvent(event);
        }
    }

    hide(propagate = true) {
        if (this.popoutElement) {
            this.popoutElement.classList.add('hidden');
            this.triggerElement.classList.remove('active');
            if (this.options.closeOnOutsideClick) {
                document.removeEventListener('click', this.boundHandleOutsideClick);
            }
        }
    }

    toggle() {
        if (this.popoutElement) {
            if (this.popoutElement.classList.contains('hidden')) {
                // Before showing this one, tell others to hide
                const event = new CustomEvent('popoutinteraction', { bubbles: true, detail: { panel: this } });
                this.triggerElement.dispatchEvent(event);
                this.show();
            } else {
                this.hide();
            }
        }
    }

    isHidden() {
        return this.popoutElement ? this.popoutElement.classList.contains('hidden') : true;
    }

    destroy() {
        if (this.options.closeOnOutsideClick) {
            document.removeEventListener('click', this.boundHandleOutsideClick);
        }
        super.destroy(); // Handles removing listeners added via _addDOMListener
    }
}
