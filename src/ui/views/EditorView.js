import { BaseComponent } from '../components/BaseComponent.js';

export class EditorView extends BaseComponent {
    constructor(mountPoint, panelManager) {
        super(mountPoint);
        this.panelManager = panelManager;
        this.element = null;
        this.editorPanel = null;
        this.editorPanelOriginalParent = null;
        this.mobileContentArea = null;
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'editor-view';
        this.element.className = 'mobile-view hidden';
        this.element.innerHTML = `
            <div class="mobile-view-header">
                <h2 class="mobile-view-title">Ruleset Editor</h2>
                <button class="mobile-view-close-button">&times;</button>
            </div>
            <div id="mobile-editor-content" class="mobile-view-content-area">
                </div>
        `;
        this.editorPanel = this.panelManager.getPanel('rulesetEditor');
        if (this.editorPanel) {
            this.editorPanelOriginalParent = this.editorPanel.panelElement.parentElement;
        }

        this.mobileContentArea = this.element.querySelector('#mobile-editor-content');
        this.mountPoint.appendChild(this.element);
        this.attachEventListeners();
    }

    attachEventListeners() {
        this.element.querySelector('.mobile-view-close-button').addEventListener('click', () => {
            document.querySelector('.tab-bar-button[data-view="simulate"]').click();
        });
    }

    show() {
        this.element.classList.remove('hidden');
        if (this.editorPanel && this.mobileContentArea) {
            this.mobileContentArea.appendChild(this.editorPanel.panelElement);
            this.editorPanel.show(); 
            this.editorPanel.refreshViews();
        }
    }

    hide() {
        this.element.classList.add('hidden');
        if (this.editorPanel && this.editorPanelOriginalParent) {
            this.editorPanelOriginalParent.appendChild(this.editorPanel.panelElement);
            this.editorPanel.hide();
        }
    }
}