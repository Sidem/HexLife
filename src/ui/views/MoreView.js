import { BaseComponent } from '../components/BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class MoreView extends BaseComponent {
    constructor(mountPoint, appContext) {
        super(mountPoint);
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.element = null;
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'more-view';
        this.element.className = 'mobile-view hidden';
        this.element.innerHTML = `
    <div class="mobile-view-header">
        <h2 class="mobile-view-title">More Options</h2>
        <button class="mobile-view-close-button" data-action="close">&times;</button>
    </div>
    <div id="more-view-content" style="padding: 20px; display: flex; flex-direction: column; gap: 15px;">
        <button class="button" data-action="save">Save World State</button>
        <label for="mobileFileInput" class="button file-input-label">Load World State</label>
        <input type="file" id="mobileFileInput" accept=".txt,.json" style="display: none;">
        <button class="button" data-action="share">Share Setup</button>
        <button class="button" data-action="help" data-tour-id="mobile-help-button">Help / Tour</button>
        <a href="https://github.com/Sidem/HexLife/" target="_blank" rel="noopener" class="button">View on GitHub</a>
    </div>
`;
        this.mountPoint.appendChild(this.element);
        this.attachEventListeners();
    }

    attachEventListeners() {
        this._addDOMListener(this.element.querySelector('[data-action="close"]'), 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'simulate' });
        });

        this._addDOMListener(this.element.querySelector('[data-action="save"]'), 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_SAVE_SELECTED_WORLD_STATE);
        });

        this._addDOMListener(this.element.querySelector('[data-action="share"]'), 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_SHARE_SETUP);
        });

        this._addDOMListener(this.element.querySelector('[data-action="help"]'), 'click', () => {
            this.appContext.onboardingManager && this.appContext.onboardingManager.startTour('coreMobile', true);
        });

        const fileInput = this.element.querySelector('#mobileFileInput');
        this._addDOMListener(fileInput, 'change', e => {
            const file = e.target.files[0];
            if (!file) return;
            EventBus.dispatch(EVENTS.TRIGGER_FILE_LOAD, { file });
            e.target.value = null;
        });
    }

    show() {
        this.element.classList.remove('hidden');
    }

    hide() {
        this.element.classList.add('hidden');
    }
}