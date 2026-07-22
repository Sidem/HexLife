import { BaseComponent } from '../components/BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { ICONS } from '../icons.js';

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
        <button class="button" data-action="capture-studio" title="Capture Studio — screenshots & recording" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px;">${ICONS.camera} Capture Studio</button>
        <button class="button" data-action="record-webm" title="Record video of the canvas" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px;">${ICONS.video} <span data-record-label>Record Video</span></button>
        <button class="button" data-action="share">Share Setup</button>
        <button class="button" data-action="save-ruleset-mobile" title="Save current ruleset" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px;">${ICONS.star} Save Ruleset</button>
        <button class="button" data-action="patterns" title="Patterns" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px;">${ICONS.shapes} Patterns</button>
        <button class="button" data-action="analyze" title="Full Analysis" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px;">${ICONS.chartBars} Full Analysis</button>
        <button class="button" data-action="settings" title="Settings &amp; preferences" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px;">${ICONS.cog} Settings</button>
        <button class="button" data-action="learning" data-tour-id="mobile-help-button" title="Tutorials, tours and help — replay the orientation any time" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px;">${ICONS.graduationCap} Learning Hub · Tours &amp; Help</button>
        <a href="https://github.com/Sidem/HexLife/" target="_blank" rel="noopener" class="button">View on GitHub</a>
        <a href="https://www.reddit.com/r/hexlife/" target="_blank" rel="noopener" class="button">Community · r/hexlife</a>
    </div>
`;
        this.mountPoint.appendChild(this.element);
        this.attachEventListeners();
    }

    attachEventListeners() {
        this._addDOMListener(this.element.querySelector('[data-action="close"]'), 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'watch' });
        });

        this._addDOMListener(this.element.querySelector('[data-action="save"]'), 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_SAVE_SELECTED_WORLD_STATE);
        });

        this._addDOMListener(this.element.querySelector('[data-action="capture-studio"]'), 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_CAPTURE_STUDIO, { tab: 'screenshot' });
        });

        this._addDOMListener(this.element.querySelector('[data-action="record-webm"]'), 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_TOGGLE_WORLD_RECORDING);
        });

        this._subscribeToEvent(EVENTS.WORLD_RECORDING_STATE_CHANGED, ({ recording }) => {
            const button = this.element.querySelector('[data-action="record-webm"]');
            if (button) {
                button.innerHTML = `${recording ? ICONS.stopCircle : ICONS.video} <span data-record-label>${recording ? 'Stop & Save' : 'Record Video'}</span>`;
                button.classList.toggle('is-recording', !!recording);
            }
        });

        this._addDOMListener(this.element.querySelector('[data-action="share"]'), 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_SHARE_SETUP);
        });

        this._addDOMListener(this.element.querySelector('[data-action="patterns"]'), 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'patterns' });
        });

        this._addDOMListener(this.element.querySelector('[data-action="analyze"]'), 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'analyze' });
        });

        this._addDOMListener(this.element.querySelector('[data-action="learning"]'), 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'learning' });
        });

        this._addDOMListener(this.element.querySelector('[data-action="settings"]'), 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'settings' });
        });

        this._addDOMListener(this.element.querySelector('[data-action="save-ruleset-mobile"]'), 'click', () => {
            const hex = this.worldManager.getCurrentRulesetHex();
            const status = this.appContext.libraryController.getRulesetStatus(hex);
            if (status.isPersonal) {
                const rule = this.appContext.libraryController.getUserLibrary().find(r => r.hex === hex);
                if (rule) EventBus.dispatch(EVENTS.COMMAND_SHOW_SAVE_RULESET_MODAL, rule);
            } else if (!status.isPublic) {
                if (hex && hex !== 'N/A' && hex !== 'Error') {
                    EventBus.dispatch(EVENTS.COMMAND_SHOW_SAVE_RULESET_MODAL, { hex });
                }
            } else {
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: "This is a public ruleset from the library and cannot be edited.", type: 'info' });
            }
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