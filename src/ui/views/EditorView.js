import { BaseComponent } from '../components/BaseComponent.js';

export class EditorView extends BaseComponent {
    constructor(mountPoint, panelManager) {
        super(mountPoint);
        this.panelManager = panelManager;
        this.element = null;
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

        // Get the existing desktop panel and move it into our mobile view
        const editorPanel = this.panelManager.getPanel('rulesetEditor');
        if (editorPanel) {
            const contentArea = this.element.querySelector('#mobile-editor-content');
            // Move the panel element itself, which contains all its UI and logic
            contentArea.appendChild(editorPanel.panelElement);
        }

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
        const editorPanel = this.panelManager.getPanel('rulesetEditor');
        if (editorPanel) {
            editorPanel.show(false);
            editorPanel.refreshViews();
        }
    }

    hide() {
        this.element.classList.add('hidden');
    }
}