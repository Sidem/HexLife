import { BaseComponent } from './components/BaseComponent.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { uiManager } from './UIManager.js';

export class BottomTabBar extends BaseComponent {
    constructor(mountPoint, panelManager) {
        super(mountPoint);
        this.panelManager = panelManager;
        this.buttons = {};
        this.activeView = 'simulate'; // Default view

        this._initButtons();
        this._setupEventListeners();
        this.updateActiveButton();

        // Set initial visibility based on the UIManager's state
        this.mountPoint.classList.toggle('hidden', !uiManager.isMobile());
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
        this._subscribeToEvent(EVENTS.MOBILE_VIEW_CHANGED, (data) => {
            this.activeView = data.activeView;
            this.updateActiveButton();
        });
        // Subscribe to UI mode changes to control visibility
        this._subscribeToEvent(EVENTS.UI_MODE_CHANGED, ({ mode }) => {
            this.mountPoint.classList.toggle('hidden', mode !== 'mobile');
        });
    }

    handleViewChange(view) {
        EventBus.dispatch(EVENTS.COMMAND_SHOW_VIEW, {
            targetView: view,
            currentView: this.activeView
        });
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