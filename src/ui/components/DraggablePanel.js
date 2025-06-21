import { Panel } from './Panel.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class DraggablePanel extends Panel {
    constructor(panelElement, options = {}) {
        // Find the content container within the panel element
        const contentContainer = panelElement.querySelector('.panel-content-area');
        // Pass it up to the Panel's options
        if (contentContainer) {
            options.contentContainer = contentContainer;
        }

        // Pass all options up to the Panel constructor
        super(panelElement, options);
        this.panelElement = panelElement;
        
        
        const handleSelector = options.handleSelector || 'h3';
        this.handleElement = panelElement.querySelector(handleSelector);
        this.options = { constrainToViewport: true, ...options };
        // this.contentComponent is now handled by the parent Panel class
        this.offsetX = 0;
        this.offsetY = 0;

        if (!this.panelElement) {
            console.error('DraggablePanel: panelElement is null or undefined.');
            return;
        }

        if (!this.handleElement) {
            console.warn('DraggablePanel: Handle element not found with selector:', handleSelector, 'in panel:', panelElement);
            this.handleElement = this.panelElement;
            console.warn('DraggablePanel: Using the panel element itself as the drag handle.');
        }
        
        this._initDragging();
        if (this.options.persistence) {
            this._loadState();
        }
        EventBus.subscribe(EVENTS.UI_MODE_CHANGED, ({ mode }) => {
            this._setDraggable(mode === 'desktop');
        });

        
        this.closeButton = this.panelElement.querySelector('.close-panel-button');
        if (this.closeButton) {
            this.closeButton.addEventListener('click', () => this.hide());
        }
    }

    _initDragging() {
        this.handleElement.style.cursor = 'move';
        this.boundOnMouseDown = this._onMouseDown.bind(this);
        this.boundOnTouchStart = this._onTouchStart.bind(this);
        
    }

    _setDraggable(isDraggable) {
        if (isDraggable) {
            this.handleElement.addEventListener('mousedown', this.boundOnMouseDown);
            this.handleElement.addEventListener('touchstart', this.boundOnTouchStart, { passive: false });
            this.panelElement.classList.remove('is-mobile-panel');
        } else {
            this.handleElement.removeEventListener('mousedown', this.boundOnMouseDown);
            this.handleElement.removeEventListener('touchstart', this.boundOnTouchStart);
            this.panelElement.classList.add('is-mobile-panel');
        }
    }

    _loadState() {
        if (!this.panelElement || !this.options.persistence?.identifier) return;
        const s = PersistenceService.loadPanelState(this.options.persistence.identifier);
        if (s.isOpen) {
            this.panelElement.classList.remove('hidden');
        } else {
            this.panelElement.classList.add('hidden');
        }
        if (s.x && s.x.endsWith('px')) this.panelElement.style.left = s.x;
        if (s.y && s.y.endsWith('px')) this.panelElement.style.top = s.y;

        const hasPosition = (s.x && s.x.endsWith('px')) || (s.y && s.y.endsWith('px'));
        
        if (hasPosition) {
            this.panelElement.style.transform = 'none';
        } else if (s.isOpen) {
            this.panelElement.style.left = '50%';
            this.panelElement.style.top = '50%';
            this.panelElement.style.transform = 'translate(-50%, -50%)';
        }
    }

    _saveState() {
        if (!this.panelElement || !this.options.persistence?.identifier) return;
        
        PersistenceService.savePanelState(this.options.persistence.identifier, {
            isOpen: !this.isHidden(),
            x: this.panelElement.style.left,
            y: this.panelElement.style.top,
        });
    }

    _onMouseDown(event) {
        if (event.target.closest('input, button, select, textarea, .rule-viz, .neighbor-count-rule-viz, a')) {
            return;
        }
        event.preventDefault();
        const rect = this.panelElement.getBoundingClientRect();
        this.offsetX = event.clientX - rect.left;
        this.offsetY = event.clientY - rect.top;
        const computedStyle = window.getComputedStyle(this.panelElement);
        if (computedStyle.transform !== 'none' && computedStyle.position === 'fixed') { 
            this.panelElement.style.left = `${rect.left}px`;
            this.panelElement.style.top = `${rect.top}px`;
            this.panelElement.style.transform = 'none';
        } else if (computedStyle.position === 'absolute' && computedStyle.transform !== 'none') {
            this.panelElement.style.left = `${this.panelElement.offsetLeft}px`;
            this.panelElement.style.top = `${this.panelElement.offsetTop}px`;
            this.panelElement.style.transform = 'none';
        }
        this.boundDragMouseMove = this._dragMouseMove.bind(this);
        this.boundDragMouseUp = this._dragMouseUp.bind(this);
        document.addEventListener('mousemove', this.boundDragMouseMove);
        document.addEventListener('mouseup', this.boundDragMouseUp);
    }
    
    _dragMouseUp() {
        document.removeEventListener('mousemove', this.boundDragMouseMove);
        document.removeEventListener('mouseup', this.boundDragMouseUp);
        
        this._saveState();
        if (this.options.onDragEnd && typeof this.options.onDragEnd === 'function') {
            this.options.onDragEnd();
        }
    }

    _dragTouchEnd(event) {
        event.preventDefault();
        document.removeEventListener('touchmove', this.boundDragTouchMove);
        document.removeEventListener('touchend', this.boundDragTouchEnd);
        
        this._saveState();
        if (this.options.onDragEnd && typeof this.options.onDragEnd === 'function') {
            this.options.onDragEnd();
        }
    }

    show() {
        super.show(); // This now handles removing 'hidden' and dispatching the event
        
        const computedStyle = window.getComputedStyle(this.panelElement);
        if (computedStyle.transform.includes('translate') &&
            (computedStyle.left === '50%' || computedStyle.top === '50%')) {
        } else if ( (computedStyle.left === '0px' || computedStyle.left === '') &&
                    (computedStyle.top === '0px' || computedStyle.top === '') &&
                     this.panelElement.style.transform !== 'none') {
            
            this.panelElement.style.left = '50%';
            this.panelElement.style.top = '50%';
        }
        
        
        if (window.matchMedia('(max-width: 768px), (pointer: coarse) and (hover: none)').matches) {
            this._setDraggable(false);
        } else {
            this._setDraggable(true);
        }

        
        if (this.contentComponent && typeof this.contentComponent.refresh === 'function') {
            this.contentComponent.refresh();
        }
    }
    
    _onTouchStart(event) {
        if (event.target.closest('input, button, select, textarea, .rule-viz, .neighbor-count-rule-viz, a')) {
            return;
        }
        if (event.touches.length !== 1) return;
        event.preventDefault();
        const touch = event.touches[0];
        const rect = this.panelElement.getBoundingClientRect();
        this.offsetX = touch.clientX - rect.left;
        this.offsetY = touch.clientY - rect.top;
        const computedStyle = window.getComputedStyle(this.panelElement);
        if (computedStyle.transform !== 'none' && computedStyle.position === 'fixed') { 
            this.panelElement.style.left = `${rect.left}px`;
            this.panelElement.style.top = `${rect.top}px`;
            this.panelElement.style.transform = 'none';
        } else if (computedStyle.position === 'absolute' && computedStyle.transform !== 'none') {
            this.panelElement.style.left = `${this.panelElement.offsetLeft}px`;
            this.panelElement.style.top = `${this.panelElement.offsetTop}px`;
            this.panelElement.style.transform = 'none';
        }
        this.boundDragTouchMove = this._dragTouchMove.bind(this);
        this.boundDragTouchEnd = this._dragTouchEnd.bind(this);
        document.addEventListener('touchmove', this.boundDragTouchMove, { passive: false });
        document.addEventListener('touchend', this.boundDragTouchEnd, { passive: false });
    }

    _dragMouseMove(event) {
        let newLeft = event.clientX - this.offsetX;
        let newTop = event.clientY - this.offsetY;
        if (this.options.constrainToViewport) {
            const panelWidth = this.panelElement.offsetWidth;
            const panelHeight = this.panelElement.offsetHeight;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            if (newLeft < 0) newLeft = 0;
            if (newTop < 0) newTop = 0;
            if (newLeft + panelWidth > viewportWidth) newLeft = viewportWidth - panelWidth;
            if (newTop + panelHeight > viewportHeight) newTop = viewportHeight - panelHeight;
        }
        this.panelElement.style.left = `${newLeft}px`;
        this.panelElement.style.top = `${newTop}px`;
    }
    
    _dragTouchMove(event) {
        if (event.touches.length !== 1) return;
        event.preventDefault();
        const touch = event.touches[0];
        let newLeft = touch.clientX - this.offsetX;
        let newTop = touch.clientY - this.offsetY;
        if (this.options.constrainToViewport) {
            const panelWidth = this.panelElement.offsetWidth;
            const panelHeight = this.panelElement.offsetHeight;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            if (newLeft < 0) newLeft = 0;
            if (newTop < 0) newTop = 0;
            if (newLeft + panelWidth > viewportWidth) newLeft = viewportWidth - panelWidth;
            if (newTop + panelHeight > viewportHeight) newTop = viewportHeight - panelHeight;
        }
        this.panelElement.style.left = `${newLeft}px`;
        this.panelElement.style.top = `${newTop}px`;
    }

    _saveState() {
        if (!this.panelElement || !this.options.persistence?.identifier) return;
        PersistenceService.savePanelState(this.options.persistence.identifier, {
            isOpen: !this.isHidden(),
            x: this.panelElement.style.left,
            y: this.panelElement.style.top,
        });
    }

    destroy() {
        if (this.handleElement && this.boundOnMouseDown) {
            this.handleElement.removeEventListener('mousedown', this.boundOnMouseDown);
        }
        if (this.handleElement && this.boundOnTouchStart) {
            this.handleElement.removeEventListener('touchstart', this.boundOnTouchStart);
        }
        document.removeEventListener('mousemove', this.boundDragMouseMove);
        document.removeEventListener('mouseup', this.boundDragMouseUp);
        document.removeEventListener('touchmove', this.boundDragTouchMove);
        document.removeEventListener('touchend', this.boundDragTouchEnd);
    }
}