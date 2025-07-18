import { BaseComponent } from './BaseComponent.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class InitialStateConfigModal extends BaseComponent {
    constructor(mountPoint, appContext) {
        super(mountPoint);
        this.appContext = appContext;
        this.config = {};
        this.worldIndex = -1;
        this.components = [];
        this.render();
        this.hide();
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'initial-state-config-modal';
        this.element.className = 'modal-overlay hidden';
        this.element.innerHTML = `
            <div class="modal-content" role="dialog">
                <h3 id="initial-state-modal-title">Configure Initial State</h3>
                <button class="modal-close-button">&times;</button>
                <div class="form-group">
                    <label for="initial-state-mode-select">Mode</label>
                    <select id="initial-state-mode-select">
                        <option value="density">Density</option>
                        <option value="clusters">Clusters</option>
                    </select>
                </div>
                <div id="initial-state-params-container" class="params-container"></div>
                <div class="modal-actions">
                    <button class="button" id="cancel-state-config-button">Cancel</button>
                    <button class="button" id="confirm-state-config-button">Save</button>
                </div>
            </div>
        `;
        this.mountPoint.appendChild(this.element);

        this.ui = {
            title: this.element.querySelector('#initial-state-modal-title'),
            modeSelect: this.element.querySelector('#initial-state-mode-select'),
            paramsContainer: this.element.querySelector('#initial-state-params-container'),
            saveBtn: this.element.querySelector('#confirm-state-config-button'),
            cancelBtn: this.element.querySelector('#cancel-state-config-button'),
            closeBtn: this.element.querySelector('.modal-close-button'),
        };

        this._addDOMListener(this.ui.modeSelect, 'change', this._renderParams);
        this._addDOMListener(this.ui.saveBtn, 'click', this._handleSave);
        this._addDOMListener(this.ui.cancelBtn, 'click', this.hide);
        this._addDOMListener(this.ui.closeBtn, 'click', this.hide);
        this._addDOMListener(this.element, 'click', (e) => {
            if (e.target === this.element) this.hide();
        });
    }

    show = (worldIndex, config) => {
        this.worldIndex = worldIndex;
        this.config = structuredClone(config);
        this.ui.title.textContent = `Configure Initial State (World ${worldIndex})`;
        this.ui.modeSelect.value = this.config.mode;
        this._renderParams();
        this.element.classList.remove('hidden');
    }

    hide = () => {
        this.element.classList.add('hidden');
        this.components.forEach(c => c.destroy());
        this.components = [];
        this.ui.paramsContainer.innerHTML = '';
    }
    
    _handleSave = () => {
        const mode = this.ui.modeSelect.value;
        const params = {};
        this.components.forEach(c => {
            params[c.options.paramKey] = c.getValue();
        });
        
        this.config.mode = mode;
        this.config.params = params;
        
        EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_INITIAL_STATE, {
            worldIndex: this.worldIndex,
            initialState: this.config
        });
        this.hide();
    }

    _renderParams = () => {
        const mode = this.ui.modeSelect.value;
        const container = this.ui.paramsContainer;
        this.components.forEach(c => c.destroy());
        this.components = [];
        container.innerHTML = '';

        this._ensureDefaultParams(mode);
        const params = this.config.params;
        
        switch(mode) {
            case 'clusters':
                this._createSlider(container, "count", "Count", params.count, 1, 50, 1);
                this._createSlider(container, "density", "Density", params.density, 0, 1, 0.01);
                this._createSlider(container, "densityVariation", "Density Var.", params.densityVariation, 0, 1, 0.01);
                this._createSlider(container, "diameter", "Diameter", params.diameter, 5, 100, 1);
                this._createSlider(container, "diameterVariation", "Diameter Var.", params.diameterVariation, 0, 50, 1);
                this._createSlider(container, "eccentricity", "Eccentricity", params.eccentricity, 0, 1, 0.01);
                this._createSlider(container, "orientation", "Orientation", params.orientation, 0, 180, 1);
                this._createSlider(container, "orientationVariation", "Orient. Var.", params.orientationVariation, 0, 1, 0.01);
                this._createSlider(container, "gaussianStdDev", "Std. Dev.", params.gaussianStdDev, 0.5, 5, 0.1);
                break;
            case 'density':
            default:
                 this._createSlider(container, "density", "Density", params.density, 0, 1, 0.001);
                 break;
        }
    }
    
    _createSlider(parent, paramKey, label, value, min, max, step) {
        const mount = document.createElement('div');
        parent.appendChild(mount);
        const slider = new SliderComponent(mount, {
            id: `initial-state-${paramKey}-slider`,
            label: `${label}:`,
            min, max, step, value,
            showValue: true,
            paramKey: paramKey
        });
        this.components.push(slider);
    }
    
    _ensureDefaultParams(mode) {
        if (this.config.mode !== mode) {
            this.config.mode = mode;
            this.config.params = {};
        }
        
        const defaults = {
            density: { density: 0.5 },
            clusters: { count: 10, density: 0.7, densityVariation: 0.1, diameter: 40, diameterVariation: 10, eccentricity: 0, orientation: 0, orientationVariation: 0.5, distribution: 'flat', gaussianStdDev: 2.0 },
        };
        
        this.config.params = { ...defaults[mode], ...this.config.params };
    }
} 