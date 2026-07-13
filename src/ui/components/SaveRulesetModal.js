import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { rulesetName } from '../../utils/utils.js';
import { IC_SUITE } from '../../core/AutoExploreService.js';
import { CANONICAL_TAGS, tagLabel, isCanonicalTag, normalizeTag } from '../../core/tags.js';
import {
    suggestTagsFromStats,
    suggestTagsFromEmbedding,
    mergeSuggestions,
    MAX_SUGGESTIONS,
} from '../../core/analysis/tagSuggestions.js';

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
        /** Selected tag ids (canonical + custom), insertion-ordered. @type {Set<string>} */
        this.selectedTags = new Set();
        /** Currently-offered suggestion ids not already selected. @type {string[]} */
        this._suggestions = [];
        /** Token guarding the async (embedding) suggestion pass against a modal reopen. */
        this._suggestToken = 0;
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
                <div class="form-group srm-tags-section">
                    <label>Tags (Optional)</label>
                    <div class="srm-suggested-row hidden">
                        <span class="srm-suggested-label">Suggested</span>
                        <div class="srm-suggested-chips"></div>
                    </div>
                    <div class="srm-tag-chips" role="group" aria-label="Toggle tags"></div>
                    <div class="srm-custom-tag-row">
                        <input type="text" class="srm-custom-tag-input" maxlength="24" placeholder="add a custom tag" aria-label="Add a custom tag">
                        <button type="button" class="button button-subtle srm-custom-tag-add">Add</button>
                    </div>
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
            suggestedRow: this.element.querySelector('.srm-suggested-row'),
            suggestedChips: this.element.querySelector('.srm-suggested-chips'),
            tagChips: this.element.querySelector('.srm-tag-chips'),
            customTagInput: this.element.querySelector('.srm-custom-tag-input'),
            customTagAdd: this.element.querySelector('.srm-custom-tag-add'),
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
        // Tag pickers: canonical toggle chips, one-tap Suggested chips, and custom-tag add.
        this._addDOMListener(this.ui.tagChips, 'click', this._onTagChipClick);
        this._addDOMListener(this.ui.suggestedChips, 'click', this._onSuggestedChipClick);
        this._addDOMListener(this.ui.customTagAdd, 'click', this._addCustomTag);
        this._addDOMListener(this.ui.customTagInput, 'keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this._addCustomTag(); }
        });
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
        this.selectedTags = new Set(
            (Array.isArray(this.rulesetData.tags) ? this.rulesetData.tags : [])
                .map(normalizeTag).filter(Boolean)
        );
        this.ui.customTagInput.value = '';
        this._suggestions = [];
        this._renderTags();
        this._renderSuggestions();
        this._computeSuggestions();
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

    // --- Tag picker (roadmap #13 §T2) -------------------------------------------------------------

    /** Render the canonical toggle chips plus any selected custom (non-canonical) tags as chips. */
    _renderTags() {
        const canonical = CANONICAL_TAGS.map(t => this._tagChipHTML(t.id, t.label));
        // Selected free-form tags that aren't canonical get their own removable chips at the end.
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

    /** Render the "Suggested" row (hidden when there's nothing fresh to offer). */
    _renderSuggestions() {
        const fresh = this._suggestions.filter(id => !this.selectedTags.has(id));
        this.ui.suggestedRow.classList.toggle('hidden', fresh.length === 0);
        this.ui.suggestedChips.innerHTML = fresh
            .map(id => `<button type="button" class="tag-chip srm-suggested-chip" data-tag-id="${this._escapeAttr(id)}" title="Suggested — tap to add">+ ${this._escape(tagLabel(id))}</button>`)
            .join('');
    }

    _onTagChipClick = (e) => {
        const chip = e.target.closest('[data-tag-id]');
        if (!chip) return;
        this._toggleTag(chip.dataset.tagId);
    };

    _onSuggestedChipClick = (e) => {
        const chip = e.target.closest('[data-tag-id]');
        if (!chip) return;
        this.selectedTags.add(chip.dataset.tagId);
        this._renderTags();
        this._renderSuggestions();
    };

    _toggleTag(id) {
        if (!id) return;
        if (this.selectedTags.has(id)) this.selectedTags.delete(id);
        else this.selectedTags.add(id);
        this._renderTags();
        this._renderSuggestions();
    }

    _addCustomTag = () => {
        const id = normalizeTag(this.ui.customTagInput.value);
        this.ui.customTagInput.value = '';
        if (!id) return;
        this.selectedTags.add(id);
        this._renderTags();
        this._renderSuggestions();
    };

    /**
     * Compute tag suggestions for the current candidate: the always-available stats heuristic first
     * (rendered synchronously), then the optional embedding pass overlaid when CLIP is enabled + a
     * thumbnail frame is available. Both sources never throw; failures just leave fewer suggestions.
     */
    _computeSuggestions() {
        const token = ++this._suggestToken;
        const statsSug = suggestTagsFromStats(this._statsMetrics());
        this._suggestions = mergeSuggestions([], statsSug, MAX_SUGGESTIONS);
        this._renderSuggestions();

        this._embeddingSuggestions().then((embSug) => {
            if (token !== this._suggestToken || !embSug.length) return; // superseded, or nothing to add
            this._suggestions = mergeSuggestions(embSug, statsSug, MAX_SUGGESTIONS);
            this._renderSuggestions();
        }).catch(() => { /* never-throw: keep the stats suggestions */ });
    }

    /** Normalize the incoming metrics (gallery-entry `metrics` + `cyclic`) into the heuristic's shape. */
    _statsMetrics() {
        const m = this.rulesetData.metrics;
        if (!m || typeof m !== 'object') return {};
        return { ...m, cyclic: this.rulesetData.cyclic ?? m.cyclic ?? null };
    }

    /**
     * Best-effort embedding suggestions (§T3): only when the embedding model is enabled + ready and a
     * chosen/paired thumbnail exists to embed. Decodes the thumb data-URL to a frame, embeds it, embeds
     * the canonical-tag bank (cached), and cosine-ranks. Resolves [] on any miss (degrade to stats).
     * @returns {Promise<string[]>}
     */
    async _embeddingSuggestions() {
        const svc = this.appContext.worldManager?.embeddingService;
        const thumb = this.chosenIC?.thumb || this.rulesetData.thumb;
        if (!svc || !svc.isEnabled?.() || !thumb) return [];
        try {
            const frame = await this._decodeThumbToFrame(thumb);
            if (!frame) return [];
            const [embedding, tagBank] = await Promise.all([
                svc.embed(frame),
                svc.embedTags(CANONICAL_TAGS),
            ]);
            if (!embedding || !tagBank.length) return [];
            return suggestTagsFromEmbedding(embedding, tagBank);
        } catch {
            return [];
        }
    }

    /**
     * Decode a thumbnail data-URL into an ImageData-like frame ({data,width,height}) for embedding.
     * Resolves null on any failure (bad URL, canvas unavailable). Browser-only; unused in tests.
     * @param {string} dataUrl
     * @returns {Promise<{data: Uint8ClampedArray, width: number, height: number}|null>}
     */
    _decodeThumbToFrame(dataUrl) {
        return new Promise((resolve) => {
            try {
                const img = new Image();
                img.onload = () => {
                    try {
                        const size = 224;
                        const canvas = document.createElement('canvas');
                        canvas.width = size;
                        canvas.height = size;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) { resolve(null); return; }
                        ctx.drawImage(img, 0, 0, size, size);
                        resolve(ctx.getImageData(0, 0, size, size));
                    } catch {
                        resolve(null);
                    }
                };
                img.onerror = () => resolve(null);
                img.src = dataUrl;
            } catch {
                resolve(null);
            }
        });
    }

    handleSave = () => {
        const name = this.ui.nameInput.value.trim();
        if (!name) return;

        const tags = [...this.selectedTags];

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
