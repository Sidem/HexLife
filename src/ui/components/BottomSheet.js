import { Panel } from './Panel.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class BottomSheet extends Panel {
    constructor(id, triggerElement, options = {}) {
        const mountPoint = document.createElement('div');
        mountPoint.id = id;
        document.body.appendChild(mountPoint);

        super(mountPoint, options);

        this.triggerElement = triggerElement;
        this.isVisible = false;
        
        this._createElement();
        this._attachEventListeners();
    }

    _createElement() {
        this.mountPoint.className = 'bottom-sheet-overlay hidden';
        this.sheetPanel = document.createElement('div');
        this.sheetPanel.className = 'bottom-sheet-panel';

        this.sheetHeader = document.createElement('div');
        this.sheetHeader.className = 'bottom-sheet-header';
        
        this.sheetTitle = document.createElement('h4');
        this.sheetTitle.className = 'bottom-sheet-title';
        this.sheetTitle.textContent = this.options.title || '';

        this.closeButton = document.createElement('button');
        this.closeButton.className = 'bottom-sheet-close-button';
        this.closeButton.innerHTML = '&times;';
        this.closeButton.setAttribute('aria-label', 'Close');

        this.sheetHeader.appendChild(this.sheetTitle);
        this.sheetHeader.appendChild(this.closeButton);
        
        this.sheetContent = document.createElement('div');
        this.sheetContent.className = 'bottom-sheet-content';

        this.sheetPanel.appendChild(this.sheetHeader);
        this.sheetPanel.appendChild(this.sheetContent);
        this.mountPoint.appendChild(this.sheetPanel);
    }

    _attachEventListeners() {
        this._addDOMListener(this.mountPoint, 'click', (event) => {
            if (event.target === this.mountPoint) {
                this.hide();
            }
        });

        this._addDOMListener(this.closeButton, 'click', () => this.hide());
        
        if(this.triggerElement) {
            this._addDOMListener(this.triggerElement, 'click', () => this.show());
        }
    }

    show() {
        if (this.isVisible) return;
        this.isVisible = true;
        super.show();
        setTimeout(() => {
            this.sheetPanel.classList.add('visible');
        }, 10);
        EventBus.dispatch(EVENTS.BOTTOM_SHEET_SHOWN, { sheet: this });
    }

    hide() {
        if (!this.isVisible) return;
        this.isVisible = false;
        this.sheetPanel.classList.remove('visible');
        setTimeout(() => {
            super.hide();
        }, 300); 
    }
    
    
    setContent(element) {
        this.sheetContent.innerHTML = '';
        this.sheetContent.appendChild(element);
    }
    
    setTitle(title) {
        this.sheetTitle.textContent = title;
    }

    destroy() {
        if (this.mountPoint && this.mountPoint.parentElement) {
            this.mountPoint.parentElement.removeChild(this.mountPoint);
        }
        super.destroy();
    }
}