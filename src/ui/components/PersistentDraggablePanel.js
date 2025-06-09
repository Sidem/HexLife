import { DraggablePanel } from './DraggablePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js';

export class PersistentDraggablePanel extends DraggablePanel {
    constructor(panelElement, handleSelector, panelIdentifier) {
        super(panelElement, handleSelector);
        this.panelIdentifier = panelIdentifier;
        this.onDragEnd = () => this._savePanelState();
        this._loadPanelState();
    }

    _loadPanelState() {
        if (!this.panelElement || !this.panelIdentifier) return;
        const s = PersistenceService.loadPanelState(this.panelIdentifier);
        if (s.isOpen) {
            super.show(); 
        } else {
            super.hide(); 
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

    _savePanelState() {
        if (!this.panelElement || !this.panelIdentifier) return;
        PersistenceService.savePanelState(this.panelIdentifier, {
            isOpen: !this.isHidden(),
            x: this.panelElement.style.left,
            y: this.panelElement.style.top,
        });
    }

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