import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { ICONS } from '../icons.js';
import { patternToHexSVG } from '../../utils/utils.js';
import { tagLabel } from '../../core/tags.js';

/**
 * The Patterns menu: copy/paste a region of cells, capture a region to the
 * personal pattern library, and place saved patterns onto the grid. Split out of
 * ControlsComponent so patterns live behind their own toolbar button.
 */
export class PatternsComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options);
        this.appContext = appContext;
        this.element = document.createElement('div');
        this.element.className = 'patterns-component-content';
        this.render();
    }

    render() {
        this.element.innerHTML = `
            <div class="tool-group">
                <div class="pattern-buttons">
                    <button class="button" id="patterns-copy-button" title="Copy a region of cells to the clipboard (Ctrl+C)">
                        <span class="inline-icon">${ICONS.copy ?? ICONS.crop}</span> Copy Region
                    </button>
                    <button class="button" id="patterns-paste-button" title="Paste the copied pattern (Ctrl+V)">
                        <span class="inline-icon">${ICONS.target}</span> Paste
                    </button>
                </div>
                <button class="button" id="patterns-capture-button" title="Capture a region and save it to your library">
                    <span class="inline-icon">${ICONS.crop}</span> Capture &amp; Save…
                </button>
                <p class="pattern-hotkey-hint"><kbd>Ctrl</kbd>+<kbd>C</kbd> copy region · <kbd>Ctrl</kbd>+<kbd>V</kbd> paste</p>
                <div id="patterns-list" class="patterns-list"></div>
            </div>
        `;

        this._setupPatterns();
    }

    _setupPatterns() {
        const captureBtn = this.element.querySelector('#patterns-capture-button');
        const copyBtn = this.element.querySelector('#patterns-copy-button');
        const pasteBtn = this.element.querySelector('#patterns-paste-button');
        this.patternsList = this.element.querySelector('#patterns-list');

        this._addDOMListener(captureBtn, 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
            EventBus.dispatch(EVENTS.COMMAND_START_PATTERN_CAPTURE, { mode: 'save' });
        });

        this._addDOMListener(copyBtn, 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_COPY_PATTERN);
        });

        this._addDOMListener(pasteBtn, 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_PASTE_PATTERN);
        });

        this._addDOMListener(this.patternsList, 'click', (e) => {
            const item = e.target.closest('[data-pattern-id]');
            if (!item) return;
            const id = item.dataset.patternId;
            const libraryController = this.appContext.libraryController;
            if (e.target.closest('[data-action="load-pattern-ruleset"]')) {
                const pattern = libraryController.getUserPatterns().find(p => p.id === id);
                if (pattern?.rulesetHex) {
                    const { name } = libraryController.getDisplayName(pattern.rulesetHex);
                    libraryController.loadRuleset(pattern.rulesetHex);
                    EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Loaded ruleset "${name}" — the pattern's home turf.`, type: 'success' });
                }
            } else if (e.target.closest('[data-action="place-pattern"]')) {
                libraryController.placeUserPattern(id);
                EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
            } else if (e.target.closest('[data-action="delete-pattern"]')) {
                const pattern = libraryController.getUserPatterns().find(p => p.id === id);
                EventBus.dispatch(EVENTS.COMMAND_SHOW_CONFIRMATION, {
                    title: 'Delete Pattern',
                    message: `Are you sure you want to permanently delete "${pattern?.name ?? 'this pattern'}"?`,
                    confirmLabel: 'Delete',
                    onConfirm: () => {
                        libraryController.deleteUserPattern(id);
                        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Deleted "${pattern?.name ?? 'pattern'}".`, type: 'info' });
                    }
                });
            }
        });

        this._renderPatternsList();
        this._subscribeToEvent(EVENTS.USER_PATTERNS_CHANGED, this._renderPatternsList);
        // Ruleset chips resolve their display name from the libraries at render time, so a later
        // save/rename of the linked ruleset should refresh the list too.
        this._subscribeToEvent(EVENTS.USER_LIBRARY_CHANGED, this._renderPatternsList);
    }

    _renderPatternsList() {
        if (!this.patternsList) return;
        const patterns = this.appContext.libraryController.getUserPatterns();
        if (patterns.length === 0) {
            this.patternsList.innerHTML = `<p class="empty-state-text">No saved patterns yet. Click "Capture &amp; Save", then drag a box over active cells.</p>`;
            return;
        }
        this.patternsList.innerHTML = patterns.map(p => `
            <div class="pattern-list-item" data-pattern-id="${p.id}">
                <span class="pattern-list-thumb">${this._renderThumb(p)}</span>
                <div class="pattern-list-body">
                    <span class="pattern-list-name" title="${this._escape(p.name)}">${this._escape(p.name)}</span>
                    ${this._renderMeta(p)}
                </div>
                <div class="pattern-list-actions">
                    <button class="button-icon" data-action="place-pattern" title="Place this pattern">${ICONS.target}</button>
                    <button class="button-icon" data-action="delete-pattern" title="Delete this pattern">${ICONS.trash}</button>
                </div>
            </div>
        `).join('');
    }

    /**
     * Chip row under the name: the linked source ruleset (click to load it) and the pattern's tags.
     * Empty string when the pattern has neither, keeping legacy entries on a single line.
     */
    _renderMeta(pattern) {
        const chips = [];
        if (typeof pattern.rulesetHex === 'string' && pattern.rulesetHex.length === 32) {
            const { name } = this.appContext.libraryController.getDisplayName(pattern.rulesetHex);
            chips.push(`<button class="tag-chip pattern-ruleset-chip" data-action="load-pattern-ruleset"
                title="Captured under ruleset &quot;${this._escape(name)}&quot; — click to load it">${this._escape(name)}</button>`);
        }
        for (const tag of Array.isArray(pattern.tags) ? pattern.tags : []) {
            chips.push(`<span class="tag-chip">${this._escape(tagLabel(tag))}</span>`);
        }
        return chips.length ? `<div class="pattern-list-meta">${chips.join('')}</div>` : '';
    }

    /** Renders a small hexagon thumbnail for a saved pattern. */
    _renderThumb(pattern) {
        const cells = Array.isArray(pattern.cells) ? pattern.cells : [];
        if (cells.length === 0) return '';
        return patternToHexSVG(cells, { originParity: pattern.originParity ?? 0, size: 4, className: 'pattern-thumb-svg' });
    }

    _escape(str) {
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    getElement() {
        return this.element;
    }
}
