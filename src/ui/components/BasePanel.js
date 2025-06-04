import { DraggablePanel } from './DraggablePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js';

export class BasePanel extends DraggablePanel {
    constructor(panelElement, handleSelector, panelIdentifier) {
        // Call the DraggablePanel constructor
        super(panelElement, handleSelector);

        this.panelIdentifier = panelIdentifier;

        // The onDragEnd callback will save the panel's state after being moved.
        this.onDragEnd = () => this._savePanelState();

        // Load the initial state when the panel is created.
        this._loadPanelState();
    }

    _loadPanelState() {
        if (!this.panelElement || !this.panelIdentifier) return;

        const s = PersistenceService.loadPanelState(this.panelIdentifier);

        // Set visibility based on saved state
        if (s.isOpen) {
            super.show(); // Use the parent DraggablePanel's show method
        } else {
            super.hide(); // Use the parent DraggablePanel's hide method
        }

        // Set position based on saved state
        if (s.x && s.x.endsWith('px')) this.panelElement.style.left = s.x;
        if (s.y && s.y.endsWith('px')) this.panelElement.style.top = s.y;

        const hasPosition = (s.x && s.x.endsWith('px')) || (s.y && s.y.endsWith('px'));
        
        // Remove transform if a specific pixel position is set
        if (hasPosition) {
            this.panelElement.style.transform = 'none';
        } else if (s.isOpen) {
            // Center the panel if no position is saved
            this.panelElement.style.left = '50%';
            this.panelElement.style.top = '50%';
            this.panelElement.style.transform = 'translate(-50%, -50%)';
        }
    }

    _savePanelState() {
        if (!this.panelElement || !this.panelIdentifier) return;
        PersistenceService.savePanelState(this.panelIdentifier, {
            isOpen: !this.isHidden(),
            x: this.panelElement.style.left,
            y: this.panelElement.style.top,
        });
    }

    // Override DraggablePanel methods to include state saving.
    show(save = true) {
        super.show();
        if (save) this._savePanelState();
    }

    hide(save = true) {
        super.hide();
        if (save) this._savePanelState();
    }

    toggle() {
        const isVisible = super.toggle();
        this._savePanelState();
        return isVisible;
    }
} 