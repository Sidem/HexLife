import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { rulesetName } from '../../utils/utils.js';
import { IC_SUITE } from '../../core/AutoExploreService.js';

// Fixed seeds for the preview bakes so a candidate's thumbnail reproduces the layout that gets saved
// with it (the saved `seed` replays the exact same starting cells via "Load + IC").
const PREVIEW_BASE_SEED = 0x5EED;

export class SaveRulesetModal extends BaseComponent {
    constructor(mountPoint, appContext) {
        super(mountPoint);
        this.appContext = appContext;
        this.rulesetData = {};
        // The picked initial condition: { initialState, seed, thumb, label } | null.
        this.chosenIC = null;
        this.candidates = [];
        this.isBaking = false;
        this.render();
        this.hide();
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'save-ruleset-modal';
        this.element.className = 'modal-overlay hidden';
        this.element.innerHTML = `
            <div class="modal-content" role="dialog" aria-labelledby="save-ruleset-modal-title" aria-modal="true">
                <h3 id="save-ruleset-modal-title">Save Ruleset</h3>
                <button class="modal-close-button" aria-label="Close">&times;</button>
                <div class="form-group">
                    <label for="ruleset-name-input">Name</label>
                    <input type="text" id="ruleset-name-input" required maxlength="50" placeholder="e.g., 'Crawling Crystals'">
                </div>
                <div class="form-group">
                    <label for="ruleset-desc-input">Description (Optional)</label>
                    <textarea id="ruleset-desc-input" rows="3" maxlength="200" placeholder="e.g., 'A slow-growing pattern...'"></textarea>
                </div>
                <div class="form-group">
                    <label for="ruleset-tags-input">Tags (Optional)</label>
                    <input type="text" id="ruleset-tags-input" maxlength="120" placeholder="comma-separated, e.g. gliders, spiral">
                </div>
                <div class="form-group srm-ic-section">
                    <label>Initial condition (Optional)</label>
                    <p class="info-text srm-ic-hint">Pair a starting state &mdash; the rule then replays from it via the library's "Load + IC".</p>
                    <div class="srm-ic-grid" id="srm-ic-grid"></div>
                    <div class="srm-ic-controls">
                        <button type="button" class="button srm-bake-button">Generate previews…</button>
                        <span class="srm-ic-status info-text"></span>
                    </div>
                </div>
                <div class="form-group">
                    <label>Ruleset Hex</label>
                    <code id="ruleset-hex-display"></code>
                </div>
                <div class="modal-actions">
                    <button class="button" id="cancel-save-button">Cancel</button>
                    <button class="button" id="confirm-save-button" disabled>Save</button>
                </div>
            </div>
        `;
        this.mountPoint.appendChild(this.element);

        this.ui = {
            title: this.element.querySelector('#save-ruleset-modal-title'),
            nameInput: this.element.querySelector('#ruleset-name-input'),
            descInput: this.element.querySelector('#ruleset-desc-input'),
            tagsInput: this.element.querySelector('#ruleset-tags-input'),
            hexDisplay: this.element.querySelector('#ruleset-hex-display'),
            icGrid: this.element.querySelector('#srm-ic-grid'),
            bakeBtn: this.element.querySelector('.srm-bake-button'),
            icStatus: this.element.querySelector('.srm-ic-status'),
            saveBtn: this.element.querySelector('#confirm-save-button'),
            cancelBtn: this.element.querySelector('#cancel-save-button'),
            closeBtn: this.element.querySelector('.modal-close-button'),
            modalContent: this.element.querySelector('.modal-content'),
        };

        this._addDOMListener(this.ui.nameInput, 'input', () => {
            this.ui.saveBtn.disabled = this.ui.nameInput.value.trim() === '';
        });
        this._addDOMListener(this.ui.bakeBtn, 'click', this._bakeCandidates);
        this._addDOMListener(this.ui.icGrid, 'click', this._onGridClick);
        this._addDOMListener(this.ui.saveBtn, 'click', this.handleSave);
        this._addDOMListener(this.ui.cancelBtn, 'click', this.hide);
        this._addDOMListener(this.ui.closeBtn, 'click', this.hide);
        this._addDOMListener(this.element, 'click', (e) => {
            if (e.target === this.element) {
                this.hide();
            }
        });
    }

    show = (data) => {
        this.rulesetData = { ...data };
        this.ui.hexDisplay.textContent = this.rulesetData.hex;
        // Suggest the auto-derived mnemonic as a placeholder so the user has a
        // sensible default to accept or override (the hex stays the real identity).
        const suggested = rulesetName(this.rulesetData.hex);
        this.ui.nameInput.placeholder = suggested && suggested !== this.rulesetData.hex
            ? suggested
            : "e.g., 'Crawling Crystals'";
        this.ui.nameInput.value = this.rulesetData.name || '';
        this.ui.descInput.value = this.rulesetData.description || '';
        this.ui.tagsInput.value = Array.isArray(this.rulesetData.tags) ? this.rulesetData.tags.join(', ') : '';
        this.ui.title.textContent = this.rulesetData.id ? 'Edit Ruleset' : 'Save Ruleset';
        this.ui.saveBtn.disabled = !this.ui.nameInput.value;

        // Prefill the chooser from an already-paired IC (a rename, or a gallery "Save" that carries
        // the find's initialState/seed/thumb) so saving preserves it without re-baking.
        this.chosenIC = this.rulesetData.initialState
            ? {
                initialState: this.rulesetData.initialState,
                seed: this.rulesetData.seed ?? null,
                thumb: this.rulesetData.thumb ?? null,
                label: 'Paired',
            }
            : null;
        this.candidates = this.chosenIC ? [{ ...this.chosenIC, baked: true, selected: true }] : [];
        this.isBaking = false;
        this.ui.icStatus.textContent = '';
        this.ui.bakeBtn.disabled = false;
        this._renderCandidates();

        this.element.classList.remove('hidden');
        this.ui.nameInput.focus();
    }

    hide = () => {
        this.element.classList.add('hidden');
        this.isBaking = false;
    }

    /** Build and bake the candidate IC previews: the current world's IC plus the Auto-Explore suite. */
    _bakeCandidates = async () => {
        if (this.isBaking) return;
        const wm = this.appContext.worldManager;
        if (!wm?.bakeThumbnails) return;
        if (wm.autoExploreService?.isRunning?.()) {
            this.ui.icStatus.textContent = 'Stop Auto-Explore to generate previews.';
            return;
        }
        const hex = this.rulesetData.hex;
        if (!hex || hex === 'Error' || hex === 'N/A') return;

        // Candidate ICs: the selected world's current starting state first, then the standard suite.
        const current = this._currentWorldInitialState();
        const suite = IC_SUITE.map(ic => ({ label: ic.label, initialState: ic.initialState }));
        const all = current ? [{ label: 'current', initialState: current }, ...suite] : suite;

        this.candidates = all.map((c, i) => ({
            label: c.label,
            initialState: c.initialState,
            seed: PREVIEW_BASE_SEED + i * 101,
            thumb: null,
            baked: false,
            selected: false,
        }));
        this._renderCandidates();

        this.isBaking = true;
        this.ui.bakeBtn.disabled = true;
        let done = 0;
        const jobs = this.candidates.map((c) => ({
            hex,
            initialState: c.initialState,
            seed: c.seed,
            onResult: (thumb) => {
                c.thumb = thumb;
                c.baked = true;
                done += 1;
                this.ui.icStatus.textContent = `Baked ${done}/${this.candidates.length}…`;
                this._renderCandidates();
            },
        }));

        try {
            await wm.bakeThumbnails(jobs);
            this.ui.icStatus.textContent = 'Pick a preview to pair it, or leave unpaired.';
        } catch {
            this.ui.icStatus.textContent = 'Preview generation failed.';
        } finally {
            this.isBaking = false;
            this.ui.bakeBtn.disabled = false;
        }
    };

    _currentWorldInitialState() {
        const wm = this.appContext.worldManager;
        try {
            const settings = wm?.worldSettings?.[wm.selectedWorldIndex];
            return settings?.initialState ? structuredClone(settings.initialState) : null;
        } catch {
            return null;
        }
    }

    _onGridClick = (e) => {
        const tile = e.target.closest('[data-ic-index]');
        if (!tile) return;
        const idx = parseInt(tile.dataset.icIndex, 10);
        if (idx === -1) {
            // The "No initial condition" tile.
            this.chosenIC = null;
            this.candidates.forEach(c => { c.selected = false; });
        } else {
            const c = this.candidates[idx];
            if (!c) return;
            this.candidates.forEach((cand, i) => { cand.selected = i === idx; });
            this.chosenIC = { initialState: c.initialState, seed: c.seed, thumb: c.thumb, label: c.label };
        }
        this._renderCandidates();
    };

    _renderCandidates() {
        const grid = this.ui.icGrid;
        const noneSelected = !this.chosenIC;
        const tiles = [
            `<button type="button" class="srm-ic-tile srm-ic-none${noneSelected ? ' selected' : ''}" data-ic-index="-1" title="Save the ruleset without a paired initial condition">
                <span class="srm-ic-none-glyph">∅</span>
                <span class="srm-ic-tile-label">None</span>
            </button>`,
        ];
        this.candidates.forEach((c, i) => {
            const inner = c.thumb
                ? `<img class="srm-ic-thumb" src="${this._escapeAttr(c.thumb)}" alt="" />`
                : `<span class="srm-ic-thumb srm-ic-thumb--pending">${c.baked ? '×' : '…'}</span>`;
            tiles.push(
                `<button type="button" class="srm-ic-tile${c.selected ? ' selected' : ''}" data-ic-index="${i}" title="${this._escapeAttr(c.label)}">
                    ${inner}
                    <span class="srm-ic-tile-label">${this._escape(c.label)}</span>
                </button>`
            );
        });
        grid.innerHTML = tiles.join('');
    }

    handleSave = () => {
        const name = this.ui.nameInput.value.trim();
        if (!name) return;

        const tags = this.ui.tagsInput.value
            .split(',')
            .map(t => t.trim())
            .filter(Boolean);

        const saveData = {
            ...this.rulesetData,
            name,
            description: this.ui.descInput.value.trim(),
            tags,
        };

        // Only write IC fields when one is chosen, so a plain rename can't clobber an existing pairing.
        if (this.chosenIC) {
            saveData.initialState = this.chosenIC.initialState;
            saveData.seed = this.chosenIC.seed ?? null;
            saveData.thumb = this.chosenIC.thumb ?? null;
        }

        this.appContext.libraryController.saveUserRuleset(saveData);
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Ruleset '${name}' saved!`, type: 'success' });
        this.hide();
    }

    _escape(str) {
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    _escapeAttr(str) {
        return String(str).replace(/"/g, '&quot;');
    }
}
