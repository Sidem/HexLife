import { BaseComponent } from '../components/BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as Config from '../../core/config.js';

export class MoreView extends BaseComponent {
    constructor(mountPoint, worldManagerInterface) {
        super(mountPoint);
        this.worldManager = worldManagerInterface;
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
        <button class="button" data-action="help">Help / Tour</button>
        <a href="https://github.com/Sidem/HexLife/" target="_blank" rel="noopener" class="button">View on GitHub</a>
    </div>
`;
        this.mountPoint.appendChild(this.element);
        this.attachEventListeners();
    }

    _generateShareLink() {
        if (!this.worldManager) return null;
        const params = new URLSearchParams();
        const rulesetHex = this.worldManager.getCurrentRulesetHex();
        if (!rulesetHex || rulesetHex === "N/A" || rulesetHex === "Error") {
            alert("Cannot share: The selected world does not have a valid ruleset.");
            return null;
        }
        params.set('r', rulesetHex);
    
        const selectedWorld = this.worldManager.getSelectedWorldIndex();
        if (selectedWorld !== Config.DEFAULT_SELECTED_WORLD_INDEX) params.set('w', selectedWorld);
    
        const speed = this.worldManager.getCurrentSimulationSpeed();
        if (speed !== Config.DEFAULT_SPEED) params.set('s', speed);
    
        const worldSettings = this.worldManager.getWorldSettingsForUI();
        let enabledBitmask = 0;
        worldSettings.forEach((ws, i) => { if (ws.enabled) enabledBitmask |= (1 << i); });
        if (enabledBitmask !== 511) params.set('e', enabledBitmask);
    
        const camera = this.worldManager.getCurrentCameraState();
        if (camera.zoom !== 1.0 || camera.x !== Config.RENDER_TEXTURE_SIZE / 2 || camera.y !== Config.RENDER_TEXTURE_SIZE / 2) {
            params.set('cam', `<span class="math-inline">\{parseFloat\(camera\.x\.toFixed\(1\)\)\},</span>{parseFloat(camera.y.toFixed(1))},${parseFloat(camera.zoom.toFixed(2))}`);
        }
    
        return `<span class="math-inline">\{window\.location\.origin\}</span>{window.location.pathname}?${params.toString()}`;
    }

    attachEventListeners() {
        this.element.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            switch (action) {
                case 'close':
                    document.querySelector('.tab-bar-button[data-view="simulate"]').click();
                    break;
                case 'save':
                    EventBus.dispatch(EVENTS.COMMAND_SAVE_SELECTED_WORLD_STATE);
                    break;
                    case 'share':
                        const url = this._generateShareLink();
                        if (!url) break;
                    
                        if (navigator.share) {
                            navigator.share({
                                title: 'HexLife Explorer Setup',
                                text: 'Check out this cellular automaton setup!',
                                url: url,
                            }).catch(err => console.error('Share failed:', err));
                        } else {
                            navigator.clipboard.writeText(url).then(() => {
                                alert('Share link copied to clipboard!');
                            }).catch(err => {
                                console.error('Failed to copy share link:', err);
                                alert('Could not copy link. Please copy it manually from the address bar on desktop.');
                            });
                        }
                        break;
                case 'help':
                    // We can trigger the onboarding tour
                    alert('Help/Tour to be implemented for mobile.');
                    break;
            }
        });

        const fileInput = this.element.querySelector('#mobileFileInput');
        fileInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            // This reuses the existing file reading logic from the main thread
            EventBus.dispatch(EVENTS.TRIGGER_FILE_LOAD, { file });
            e.target.value = null; // Reset for next use
        });
    }

    show() {
        this.element.classList.remove('hidden');
    }

    hide() {
        this.element.classList.add('hidden');
    }
}