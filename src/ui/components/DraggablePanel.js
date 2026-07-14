import { Panel } from './Panel.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class DraggablePanel extends Panel {
    constructor(panelElement, options = {}) {
        const contentContainer = panelElement.querySelector('.panel-content-area');
        if (contentContainer) {
            options.contentContainer = contentContainer;
        }

        super(panelElement, options);
        this.panelElement = panelElement;
        
        
        const handleSelector = options.handleSelector || 'h3';
        this.handleElement = panelElement.querySelector(handleSelector);
        this.options = { constrainToViewport: true, ...options };
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
        this._initResizing();
        if (this.options.persistence) {
            this._loadState();
        }
        EventBus.subscribe(EVENTS.UI_MODE_CHANGED, ({ mode }) => {
            this._setDraggable(mode === 'desktop');
        });

        // A shrinking viewport (or a panel that outgrew it) can otherwise strand the title bar
        // off-screen, where there is nothing left to grab.
        this.boundOnWindowResize = () => this._clampIntoViewport();
        window.addEventListener('resize', this.boundOnWindowResize);

        // Any interaction with the panel surfaces it above its siblings.
        this.panelElement.addEventListener('pointerdown', () => {
            this.options.onFocus?.(this);
        }, true);

        
        this.closeButton = this.panelElement.querySelector('.close-panel-button');
        if (this.closeButton) {
            this.closeButton.addEventListener('click', () => this.hide());
        }
    }

    _initDragging() {
        this.handleElement.classList.add('panel-drag-handle');
        this.handleElement.title = 'Drag to move — double-click to reset size';
        this.boundOnMouseDown = this._onMouseDown.bind(this);
        this.boundOnTouchStart = this._onTouchStart.bind(this);
        this.handleElement.addEventListener('dblclick', (event) => {
            if (event.target.closest('button, a')) return;
            this._resetSize();
        });
    }

    /**
     * Adds the right / bottom / corner grips. Resizing writes an explicit px width+height on the
     * panel (and drops the CSS max-* caps) so a panel can be shrunk for space or grown for content;
     * min-width/min-height come from CSS, so each panel can raise the floor its content needs.
     */
    _initResizing() {
        if (this.options.resizable === false) return;
        this.boundResizeMove = this._onResizeMove.bind(this);
        this.boundResizeEnd = this._onResizeEnd.bind(this);
        this.resizeHandles = ['e', 's', 'se'].map(dir => {
            const handle = document.createElement('div');
            handle.className = `panel-resize-handle panel-resize-${dir}`;
            handle.addEventListener('pointerdown', (event) => this._onResizeStart(event, dir));
            this.panelElement.appendChild(handle);
            return handle;
        });
    }

    _onResizeStart(event, dir) {
        if (event.button !== 0 || this.panelElement.classList.contains('is-mobile-panel')) return;
        event.preventDefault();
        event.stopPropagation();

        const rect = this.panelElement.getBoundingClientRect();
        const styles = window.getComputedStyle(this.panelElement);
        // Pin the panel where it is: growing a fixed element that was centred by a transform would
        // otherwise make it drift.
        this.panelElement.style.left = `${rect.left}px`;
        this.panelElement.style.top = `${rect.top}px`;
        this.panelElement.style.transform = 'none';
        this.panelElement.style.maxWidth = 'none';
        this.panelElement.style.maxHeight = 'none';
        this.panelElement.classList.add('is-resizing');

        this.resizeState = {
            dir,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: rect.width,
            startHeight: rect.height,
            minWidth: parseFloat(styles.minWidth) || 240,
            minHeight: parseFloat(styles.minHeight) || 120,
            maxWidth: window.innerWidth - rect.left - 4,
            maxHeight: window.innerHeight - rect.top - 4,
        };
        event.target.setPointerCapture?.(event.pointerId);
        document.addEventListener('pointermove', this.boundResizeMove);
        document.addEventListener('pointerup', this.boundResizeEnd);
    }

    _onResizeMove(event) {
        const s = this.resizeState;
        if (!s) return;
        const clamp = (v, min, max) => Math.max(min, Math.min(v, Math.max(min, max)));
        if (s.dir !== 's') {
            const width = clamp(s.startWidth + (event.clientX - s.startX), s.minWidth, s.maxWidth);
            this.panelElement.style.width = `${Math.round(width)}px`;
        }
        if (s.dir !== 'e') {
            const height = clamp(s.startHeight + (event.clientY - s.startY), s.minHeight, s.maxHeight);
            this.panelElement.style.height = `${Math.round(height)}px`;
        }
    }

    _onResizeEnd() {
        if (!this.resizeState) return;
        this.resizeState = null;
        this.panelElement.classList.remove('is-resizing');
        document.removeEventListener('pointermove', this.boundResizeMove);
        document.removeEventListener('pointerup', this.boundResizeEnd);
        this._clampIntoViewport();
        this._saveState();
    }

    /** Double-clicking the title bar drops any manual size and lets the panel fit its content again. */
    _resetSize() {
        this.panelElement.style.width = '';
        this.panelElement.style.height = '';
        this.panelElement.style.maxWidth = '';
        this.panelElement.style.maxHeight = '';
        this._saveState();
    }

    /**
     * Keeps the panel reachable: the top edge clamp is applied LAST, so a panel taller than the
     * viewport overflows off the bottom (still draggable) rather than off the top (unreachable).
     */
    _clampPosition(left, top) {
        if (!this.options.constrainToViewport) return { left, top };
        const maxLeft = window.innerWidth - this.panelElement.offsetWidth;
        const maxTop = window.innerHeight - this.panelElement.offsetHeight;
        return {
            left: Math.max(0, Math.min(left, Math.max(0, maxLeft))),
            top: Math.max(0, Math.min(top, Math.max(0, maxTop))),
        };
    }

    /** Re-applies the clamp to the panel's current position (after a load, show, or window resize). */
    _clampIntoViewport() {
        if (this.isHidden() || this.panelElement.classList.contains('is-mobile-panel')) return;
        const rect = this.panelElement.getBoundingClientRect();
        const { left, top } = this._clampPosition(rect.left, rect.top);
        if (left === rect.left && top === rect.top) return;
        this.panelElement.style.left = `${Math.round(left)}px`;
        this.panelElement.style.top = `${Math.round(top)}px`;
        this.panelElement.style.transform = 'none';
        this._saveState();
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
    
        if (s.w && s.h) {
            this.panelElement.style.width = s.w;
            this.panelElement.style.height = s.h;
            this.panelElement.style.maxWidth = 'none';
            this.panelElement.style.maxHeight = 'none';
        }

        const hasSavedPosition = s.x && s.x.endsWith('px') && s.y && s.y.endsWith('px');

        if (hasSavedPosition) {
            this.panelElement.style.left = s.x;
            this.panelElement.style.top = s.y;
            this.panelElement.style.transform = 'none';
        } else {
            const defaultPos = this.options.defaultPosition || { x: 100, y: 100 };
            this.panelElement.style.left = `${defaultPos.x}px`;
            this.panelElement.style.top = `${defaultPos.y}px`;
            this.panelElement.style.transform = 'none';
        }
    }

    _saveState() {
        if (!this.panelElement || !this.options.persistence?.identifier) return;
        PersistenceService.savePanelState(this.options.persistence.identifier, {
            isOpen: !this.isHidden(),
            x: this.panelElement.style.left,
            y: this.panelElement.style.top,
            w: this.panelElement.style.width,
            h: this.panelElement.style.height,
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
        super.show();
        this.options.onFocus?.(this);

        if (window.matchMedia('(max-width: 768px), (pointer: coarse) and (hover: none)').matches) {
            this._setDraggable(false);
        } else {
            this._setDraggable(true);
            // A position saved under a larger window (or a since-grown panel) can land off-screen.
            this._clampIntoViewport();
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
        this._moveTo(event.clientX - this.offsetX, event.clientY - this.offsetY);
    }

    _dragTouchMove(event) {
        if (event.touches.length !== 1) return;
        event.preventDefault();
        const touch = event.touches[0];
        this._moveTo(touch.clientX - this.offsetX, touch.clientY - this.offsetY);
    }

    _moveTo(rawLeft, rawTop) {
        const { left, top } = this._clampPosition(rawLeft, rawTop);
        this.panelElement.style.left = `${left}px`;
        this.panelElement.style.top = `${top}px`;
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
        document.removeEventListener('pointermove', this.boundResizeMove);
        document.removeEventListener('pointerup', this.boundResizeEnd);
        window.removeEventListener('resize', this.boundOnWindowResize);
    }
}