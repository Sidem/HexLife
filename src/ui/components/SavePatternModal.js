import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class SavePatternModal extends BaseComponent {
    constructor(mountPoint, appContext) {
        super(mountPoint);
        this.appContext = appContext;
        this.patternData = {};
        this.render();
        this.hide();
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'save-pattern-modal';
        this.element.className = 'modal-overlay hidden';
        this.element.innerHTML = `
            <div class="modal-content" role="dialog" aria-labelledby="save-pattern-modal-title" aria-modal="true">
                <h3 id="save-pattern-modal-title">Save Pattern</h3>
                <button class="modal-close-button" aria-label="Close">&times;</button>
                <div class="form-group">
                    <label for="pattern-name-input">Name</label>
                    <input type="text" id="pattern-name-input" required maxlength="50" placeholder="e.g., 'Glider'">
                </div>
                <div class="form-group">
                    <label>Preview</label>
                    <div id="pattern-preview" class="pattern-preview"></div>
                    <p class="pattern-cell-count"><span id="pattern-cell-count">0</span> cells</p>
                </div>
                <div class="modal-actions">
                    <button class="button" id="cancel-save-pattern-button">Cancel</button>
                    <button class="button" id="confirm-save-pattern-button" disabled>Save</button>
                </div>
            </div>
        `;
        this.mountPoint.appendChild(this.element);

        this.ui = {
            nameInput: this.element.querySelector('#pattern-name-input'),
            preview: this.element.querySelector('#pattern-preview'),
            cellCount: this.element.querySelector('#pattern-cell-count'),
            saveBtn: this.element.querySelector('#confirm-save-pattern-button'),
            cancelBtn: this.element.querySelector('#cancel-save-pattern-button'),
            closeBtn: this.element.querySelector('.modal-close-button'),
        };

        this._addDOMListener(this.ui.nameInput, 'input', () => {
            this.ui.saveBtn.disabled = this.ui.nameInput.value.trim() === '';
        });
        this._addDOMListener(this.ui.saveBtn, 'click', this.handleSave);
        this._addDOMListener(this.ui.cancelBtn, 'click', this.hide);
        this._addDOMListener(this.ui.closeBtn, 'click', this.hide);
        this._addDOMListener(this.element, 'click', (e) => {
            if (e.target === this.element) this.hide();
        });
    }

    show = (data) => {
        this.patternData = { ...data };
        const cells = Array.isArray(this.patternData.cells) ? this.patternData.cells : [];
        this.ui.cellCount.textContent = String(cells.length);
        this.ui.preview.innerHTML = this._renderPreview(cells);
        this.ui.nameInput.value = this.patternData.name || '';
        this.ui.saveBtn.disabled = this.ui.nameInput.value.trim() === '';
        this.element.classList.remove('hidden');
        this.ui.nameInput.focus();
    }

    hide = () => {
        this.element.classList.add('hidden');
    }

    handleSave = () => {
        const name = this.ui.nameInput.value.trim();
        if (!name) return;

        this.appContext.libraryController.saveUserPattern({
            ...this.patternData,
            name
        });
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Pattern '${name}' saved!`, type: 'success' });
        this.hide();
    }

    /** Renders captured relative cells as a small SVG dot-grid preview. */
    _renderPreview(cells) {
        if (cells.length === 0) return '';
        let maxX = 0;
        let maxY = 0;
        for (const [x, y] of cells) {
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
        const cols = maxX + 1;
        const rows = maxY + 1;
        const cell = 8;
        const gap = 1;
        const width = cols * (cell + gap) + gap;
        const height = rows * (cell + gap) + gap;
        const rects = cells.map(([x, y]) =>
            `<rect x="${gap + x * (cell + gap)}" y="${gap + y * (cell + gap)}" width="${cell}" height="${cell}" rx="1.5" />`
        ).join('');
        return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" class="pattern-preview-svg">${rects}</svg>`;
    }
}
