import { BaseComponent } from '../components/BaseComponent.js';
import { SliderComponent } from '../components/SliderComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class WorldsView extends BaseComponent {
    constructor(mountPoint, worldManagerInterface) {
        super(mountPoint);
        this.worldManager = worldManagerInterface;
        this.element = null;
        this.worldSliders = [];
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'worlds-view';
        this.element.className = 'mobile-view hidden';
        this.element.innerHTML = `
            <div class="mobile-view-header">
                <h2 class="mobile-view-title">Manage Worlds</h2>
                <button class="mobile-view-close-button" data-action="close">&times;</button>
            </div>
            <div class="worlds-list" style="padding: 15px;"></div>
        `;
        this.mountPoint.appendChild(this.element);

        this.listElement = this.element.querySelector('.worlds-list');
        
        this.refresh();
        this.attachEventListeners();
        EventBus.subscribe(EVENTS.WORLD_SETTINGS_CHANGED, () => this.refresh());
    }
    
    attachEventListeners() {
        this.element.addEventListener('click', (e) => {
            if (e.target.matches('.mobile-view-close-button')) {
                document.querySelector('.tab-bar-button[data-view="simulate"]').click();
                return;
            }
        });
    }

    refresh() {
        this.listElement.innerHTML = '';
        this.worldSliders.forEach(s => s.destroy());
        this.worldSliders = [];

        const settings = this.worldManager.getWorldSettingsForUI();

        settings.forEach((world, index) => {
            const card = document.createElement('div');
            card.className = 'world-card';
            card.innerHTML = `
                <div class="world-card-header">
                    <span class="title">World ${index}</span>
                    <span class="ruleset-hex">${world.rulesetHex.substring(0, 8)}...</span>
                </div>
                <div class="density-control">
                    <div id="world_density_${index}"></div>
                </div>
                <div class="enable-control">
                    <input type="checkbox" id="world_enable_${index}" class="checkbox-input" ${world.enabled ? 'checked' : ''}>
                    <label for="world_enable_${index}" class="checkbox-label" style="width:100%; text-align:center;">${world.enabled ? 'Enabled' : 'Disabled'}</label>
                </div>
            `;
            this.listElement.appendChild(card);

            const slider = new SliderComponent(card.querySelector(`#world_density_${index}`), {
                id: `densitySlider_${index}`, label: 'Density:', min: 0, max: 1, step: 0.01,
                value: world.initialDensity, showValue: true,
                onChange: (newDensity) => {
                    EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_INITIAL_DENSITY, { worldIndex: index, density: newDensity });
                }
            });
            this.worldSliders.push(slider);

            const toggle = card.querySelector(`#world_enable_${index}`);
            toggle.addEventListener('change', (e) => {
                EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_ENABLED, { worldIndex: index, isEnabled: e.target.checked });
            });
        });
    }

    show() {
        this.element.classList.remove('hidden');
        this.refresh();
    }

    hide() {
        this.element.classList.add('hidden');
    }
}