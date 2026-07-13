import { Panel } from './Panel.js';

/**
 * Mobile bottom sheet (mobile redesign M2). Generalized from the tools-only sheet
 * into a reusable, draggable sheet with three snap points — peek / half / full —
 * and swipe-down-to-dismiss.
 *
 * P1 (never hide the simulation): the backdrop is non-blocking (transparent,
 * pointer-events:none) so the live canvas above the sheet stays fully interactive.
 * Only the panel itself captures pointer events. Dismiss via drag-down or the close
 * button — there is deliberately no tap-outside-to-close (that would require a
 * blocking backdrop).
 */
const SNAP_ORDER = ['peek', 'half', 'full'];

export class BottomSheet extends Panel {
    constructor(id, triggerElement, options = {}) {
        const mountPoint = document.createElement('div');
        mountPoint.id = id;
        document.body.appendChild(mountPoint);

        super(mountPoint, options);

        this.triggerElement = triggerElement;
        this.isVisible = false;
        this.currentSnap = 'half';
        this._drag = null;

        this._createElement();
        this._attachEventListeners();
    }

    _createElement() {
        this.mountPoint.className = 'bottom-sheet-overlay hidden';
        this.sheetPanel = document.createElement('div');
        this.sheetPanel.className = 'bottom-sheet-panel';

        this.dragHandle = document.createElement('div');
        this.dragHandle.className = 'bottom-sheet-drag-handle';
        this.dragHandle.setAttribute('aria-hidden', 'true');
        this.dragHandle.innerHTML = '<span class="bottom-sheet-grabber"></span>';

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

        this.sheetPanel.appendChild(this.dragHandle);
        this.sheetPanel.appendChild(this.sheetHeader);
        this.sheetPanel.appendChild(this.sheetContent);
        this.mountPoint.appendChild(this.sheetPanel);
    }

    _attachEventListeners() {
        this._addDOMListener(this.closeButton, 'click', () => this.hide());

        if (this.triggerElement) {
            this._addDOMListener(this.triggerElement, 'click', () => this.toggle());
        }

        // Drag from the handle or header (not the close button / content).
        const onDown = (e) => this._onDragStart(e);
        this._addDOMListener(this.dragHandle, 'pointerdown', onDown);
        this._addDOMListener(this.sheetHeader, 'pointerdown', (e) => {
            if (e.target.closest('.bottom-sheet-close-button')) return;
            this._onDragStart(e);
        });
    }

    /** Height of the fully-expanded panel in px, clamped to its CSS max-height. */
    _panelHeight() {
        return this.sheetPanel.getBoundingClientRect().height || Math.round(window.innerHeight * 0.85);
    }

    /** translateY (px) that leaves the given snap state's target height visible. */
    _offsetForSnap(snap) {
        const h = this._panelHeight();
        const vh = window.innerHeight;
        const visible = {
            full: h,
            half: Math.min(h, Math.round(vh * 0.45)),
            peek: Math.min(h, 132),
        }[snap] ?? h;
        return Math.max(0, h - visible);
    }

    _applyOffset(px, animate = true) {
        this.sheetPanel.style.transition = animate ? 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
        this.sheetPanel.style.transform = `translateY(${px}px)`;
    }

    snapTo(snap) {
        if (!SNAP_ORDER.includes(snap)) snap = 'half';
        this.currentSnap = snap;
        this._applyOffset(this._offsetForSnap(snap));
    }

    _onDragStart(e) {
        if (!this.isVisible) return;
        this._drag = {
            startY: e.clientY,
            startOffset: this._offsetForSnap(this.currentSnap),
            pointerId: e.pointerId,
        };
        this.sheetPanel.setPointerCapture?.(e.pointerId);
        this._moveHandler = (ev) => this._onDragMove(ev);
        this._upHandler = (ev) => this._onDragEnd(ev);
        window.addEventListener('pointermove', this._moveHandler);
        window.addEventListener('pointerup', this._upHandler);
        window.addEventListener('pointercancel', this._upHandler);
    }

    _onDragMove(e) {
        if (!this._drag) return;
        const h = this._panelHeight();
        const delta = e.clientY - this._drag.startY;
        const next = Math.max(0, Math.min(h, this._drag.startOffset + delta));
        this._applyOffset(next, false);
        this._drag.lastOffset = next;
    }

    _onDragEnd() {
        if (!this._drag) return;
        window.removeEventListener('pointermove', this._moveHandler);
        window.removeEventListener('pointerup', this._upHandler);
        window.removeEventListener('pointercancel', this._upHandler);

        const h = this._panelHeight();
        const offset = this._drag.lastOffset ?? this._drag.startOffset;
        this._drag = null;

        // Dragged down past the peek threshold → dismiss.
        if (offset > h - 90) {
            this.hide();
            return;
        }
        // Snap to the nearest of the three states.
        let nearest = 'full';
        let best = Infinity;
        for (const snap of SNAP_ORDER) {
            const d = Math.abs(this._offsetForSnap(snap) - offset);
            if (d < best) { best = d; nearest = snap; }
        }
        this.snapTo(nearest);
    }

    toggle() {
        if (this.isVisible) this.hide();
        else this.show();
    }

    show(snap = 'half') {
        if (this.isVisible) {
            this.snapTo(snap);
            return;
        }
        this.isVisible = true;
        super.show();
        this.currentSnap = snap;

        // Start off-screen, then animate to the requested snap after layout.
        this._applyOffset(this._panelHeight(), false);
        requestAnimationFrame(() => {
            this.sheetPanel.classList.add('visible');
            this._applyOffset(this._offsetForSnap(snap));
        });
    }

    hide() {
        if (!this.isVisible) return;
        this.isVisible = false;
        this.sheetPanel.classList.remove('visible');
        this._applyOffset(this._panelHeight());
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
