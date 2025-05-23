
import { BaseComponent } from './BaseComponent.js';

export class PopoutPanel extends BaseComponent {
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
        const popoutRect = this.popoutElement.getBoundingClientRect(); 

        let top, left;

        
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
                
                setTimeout(() => document.addEventListener('click', this.boundHandleOutsideClick), 0);
            }
            
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
        super.destroy(); 
    }
}
