import { BaseComponent } from './components/BaseComponent.js';
import { EventBus, EVENTS } from '../services/EventBus.js';

export class BottomTabBar extends BaseComponent {
    constructor(mountPoint, panelManager) {
        super(mountPoint);
        this.panelManager = panelManager;
        this.buttons = {};
        this.activeView = 'simulate'; // Default view

        this._initButtons();
        this._setupEventListeners();
        this.updateActiveButton();
    }

    _initButtons() {
        this.mountPoint.querySelectorAll('.tab-bar-button').forEach(button => {
            const view = button.dataset.view;
            this.buttons[view] = button;
        });
    }

    _setupEventListeners() {
        Object.entries(this.buttons).forEach(([view, button]) => {
            this._addDOMListener(button, 'click', () => this.handleViewChange(view));
        });
    }

    handleViewChange(view) {
        const currentlyActive = this.activeView;
        Object.values(this.panelManager.getMobileViews()).forEach(v => v.hide());

        if (view === currentlyActive && view !== 'simulate') {
             this.activeView = 'simulate';
        } else {
            const targetView = this.panelManager.getMobileView(view);
            if (targetView) {
                targetView.show();
                this.activeView = view;
            } else {
                this.activeView = 'simulate';
            }
        }
        
        this.updateActiveButton();
    }

    updateActiveButton() {
        Object.entries(this.buttons).forEach(([view, button]) => {
            if (view === this.activeView) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }
}