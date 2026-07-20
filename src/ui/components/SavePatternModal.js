import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { patternToHexSVG } from '../../utils/utils.js';
import { CANONICAL_TAGS, tagLabel, isCanonicalTag, normalizeTag } from '../../core/tags.js';

const HEX_32_RE = /^[0-9a-fA-F]{32}$/;

export class SavePatternModal extends BaseComponent {
    constructor(mountPoint, appContext) {
        super(mountPoint);
        this.appContext = appContext;
        this.patternData = {};
        /** The 32-char hex of the world the pattern was captured from, if valid. @type {string|null} */
        this.sourceRulesetHex = null;
        /** Selected tag ids (canonical + custom), insertion-ordered. @type {Set<string>} */
        this.selectedTags = new Set();
        this.render();
        this.hide();
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'save-pattern-modal';
        this.element.className = 'modal-overlay hidden';
        // The tag picker reuses the SaveRulesetModal chip classes (srm-*) so both modals share one
        // look; the shared styles live in RulesetActionsComponent.css.
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
                <div class="form-group spm-ruleset-section hidden">
                    <label>Source Ruleset</label>
                    <label class="spm-ruleset-row">
                        <input type="checkbox" id="pattern-associate-ruleset" checked>
                        <span>Link to <strong class="spm-ruleset-name"></strong></span>
                    </label>
                    <p class="info-text spm-ruleset-hint">Remembers which ruleset this pattern worked in.</p>
                </div>
                <div class="form-group spm-tags-section">
                    <label>Tags (Optional)</label>
                    <div class="srm-tag-chips spm-tag-chips" role="group" aria-label="Toggle tags"></div>
                    <div class="srm-custom-tag-row">
                        <input type="text" class="srm-custom-tag-input" maxlength="24" placeholder="add a custom tag" aria-label="Add a custom tag">
                        <button type="button" class="button button-subtle spm-custom-tag-add">Add</button>
                    </div>
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
            rulesetSection: this.element.querySelector('.spm-ruleset-section'),
            associateCheckbox: this.element.querySelector('#pattern-associate-ruleset'),
            rulesetName: this.element.querySelector('.spm-ruleset-name'),
            tagChips: this.element.querySelector('.spm-tag-chips'),
            customTagInput: this.element.querySelector('.srm-custom-tag-input'),
            customTagAdd: this.element.querySelector('.spm-custom-tag-add'),
            saveBtn: this.element.querySelector('#confirm-save-pattern-button'),
            cancelBtn: this.element.querySelector('#cancel-save-pattern-button'),
            closeBtn: this.element.querySelector('.modal-close-button'),
        };

        this._addDOMListener(this.ui.nameInput, 'input', () => {
            this.ui.saveBtn.disabled = this.ui.nameInput.value.trim() === '';
        });
        this._addDOMListener(this.ui.tagChips, 'click', this._onTagChipClick);
        this._addDOMListener(this.ui.customTagAdd, 'click', this._addCustomTag);
        this._addDOMListener(this.ui.customTagInput, 'keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this._addCustomTag(); }
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

        // Source-ruleset association: offered whenever the capture (or an existing entry being
        // edited) carries a valid hex; linked by default — unticking saves the pattern unlinked.
        const rawHex = this.patternData.sourceRulesetHex ?? this.patternData.rulesetHex;
        this.sourceRulesetHex = typeof rawHex === 'string' && HEX_32_RE.test(rawHex) ? rawHex : null;
        this.ui.rulesetSection.classList.toggle('hidden', !this.sourceRulesetHex);
        if (this.sourceRulesetHex) {
            const { name } = this.appContext.libraryController.getDisplayName(this.sourceRulesetHex);
            this.ui.rulesetName.textContent = name;
            this.ui.rulesetName.title = this.sourceRulesetHex;
            this.ui.associateCheckbox.checked = true;
        }

        this.selectedTags = new Set(
            (Array.isArray(this.patternData.tags) ? this.patternData.tags : [])
                .map(normalizeTag).filter(Boolean)
        );
        this.ui.customTagInput.value = '';
        this._renderTags();

        this.element.classList.remove('hidden');
        this.ui.nameInput.focus();
    }

    hide = () => {
        this.element.classList.add('hidden');
    }

    handleSave = () => {
        const name = this.ui.nameInput.value.trim();
        if (!name) return;

        const tags = [...this.selectedTags];
        const associate = !!this.sourceRulesetHex && this.ui.associateCheckbox.checked;
        const saveData = {
            ...this.patternData,
            name,
            tags,
            rulesetHex: associate ? this.sourceRulesetHex : null,
        };
        delete saveData.sourceRulesetHex;

        this.appContext.libraryController.saveUserPattern(saveData);
        // Make the just-saved pattern the active clipboard entry so Ctrl+V pastes it.
        this.appContext.libraryController.patternClipboard = {
            cells: Array.isArray(this.patternData.cells) ? this.patternData.cells : [],
            originParity: this.patternData.originParity ?? 0
        };
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Pattern '${name}' saved! Ctrl+V to place it.`, type: 'success' });
        this.hide();

        if (associate) this._offerRulesetFollowUp(this.sourceRulesetHex, tags);
    }

    /**
     * After a linked save, keep the ruleset side of the association useful: if the ruleset is a
     * personal entry missing some of the pattern's tags, offer to copy them over; if it isn't saved
     * anywhere yet, offer to save it (pre-filled with the pattern's tags) so the link has a library
     * entry to point at. Public-library rulesets are curated and stay untouched.
     * @param {string} hex
     * @param {string[]} tags
     */
    _offerRulesetFollowUp(hex, tags) {
        const lc = this.appContext.libraryController;
        const status = lc.getRulesetStatus(hex);

        if (status.isPersonal) {
            const entry = lc.getUserLibrary().find(r => r.hex === hex);
            if (!entry) return;
            const existing = Array.isArray(entry.tags) ? entry.tags : [];
            const missing = tags.filter(t => !existing.includes(t));
            if (missing.length === 0) return;
            EventBus.dispatch(EVENTS.COMMAND_SHOW_CONFIRMATION, {
                title: 'Tag Ruleset Too?',
                message: `Add ${missing.map(tagLabel).join(', ')} to your saved ruleset "${entry.name}" as well?`,
                confirmLabel: 'Add Tags',
                onConfirm: () => {
                    lc.saveUserRuleset({ id: entry.id, tags: [...existing, ...missing] });
                    EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Ruleset "${entry.name}" tagged.`, type: 'success' });
                }
            });
        } else if (!status.isPublic) {
            const { name } = lc.getDisplayName(hex);
            EventBus.dispatch(EVENTS.COMMAND_SHOW_CONFIRMATION, {
                title: 'Save Ruleset Too?',
                message: `The ruleset this pattern came from ("${name}") isn't in your library yet. Save it so the link points at a library entry?`,
                confirmLabel: 'Save Ruleset…',
                onConfirm: () => {
                    EventBus.dispatch(EVENTS.COMMAND_SHOW_SAVE_RULESET_MODAL, { hex, tags });
                }
            });
        }
    }

    // --- Tag picker (shared vocabulary with the ruleset library, core/tags.js) --------------------

    /** Render the canonical toggle chips plus any selected custom (non-canonical) tags as chips. */
    _renderTags() {
        const canonical = CANONICAL_TAGS.map(t => this._tagChipHTML(t.id, t.label));
        const custom = [...this.selectedTags]
            .filter(id => !isCanonicalTag(id))
            .map(id => this._tagChipHTML(id, tagLabel(id), true));
        this.ui.tagChips.innerHTML = [...canonical, ...custom].join('');
    }

    /** One toggle chip. `isCustom` chips show a removal affordance (they're not in the fixed vocab). */
    _tagChipHTML(id, label, isCustom = false) {
        const active = this.selectedTags.has(id);
        return `<button type="button" class="tag-chip srm-tag-chip${active ? ' active' : ''}${isCustom ? ' srm-tag-chip--custom' : ''}"
            data-tag-id="${this._escapeAttr(id)}" aria-pressed="${active}">${this._escape(label)}${isCustom ? '<span class="srm-tag-remove" aria-hidden="true">×</span>' : ''}</button>`;
    }

    _onTagChipClick = (e) => {
        const chip = e.target.closest('[data-tag-id]');
        if (!chip) return;
        const id = chip.dataset.tagId;
        if (this.selectedTags.has(id)) this.selectedTags.delete(id);
        else this.selectedTags.add(id);
        this._renderTags();
    };

    _addCustomTag = () => {
        const id = normalizeTag(this.ui.customTagInput.value);
        this.ui.customTagInput.value = '';
        if (!id) return;
        this.selectedTags.add(id);
        this._renderTags();
    };

    /** Renders captured relative cells as a small flat-top hexagon preview. */
    _renderPreview(cells) {
        return patternToHexSVG(cells, { originParity: this.patternData.originParity ?? 0, size: 8 });
    }

    _escape(str) {
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    _escapeAttr(str) {
        return String(str).replace(/"/g, '&quot;');
    }
}
