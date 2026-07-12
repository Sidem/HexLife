import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { SwitchComponent } from './SwitchComponent.js';
import { RulesetDirectInput } from './RulesetDirectInput.js';
import { ICONS } from '../icons.js';
import { rulesetName, downloadFile } from '../../utils/utils.js';
import * as InitialStateCodec from '../../services/InitialStateCodec.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { decodePack, toPublicLibraryEntry } from '../../services/LibraryPackCodec.js';

/**
 * The Ruleset Library menu: load saved rulesets (public + personal) or set one
 * directly from a hex code. Split out of RulesetActionsComponent so the library
 * lives behind its own toolbar button. A single "Apply to:" scope selector at the
 * top governs both the Library loads and the Direct hex set (shared, persisted
 * `globalRulesetScopeAll` setting via RulesetActionController).
 */
export class RulesetLibraryComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options);
        this.appContext = appContext;

        this.libraryData = options.libraryData;
        // Cross-list filter/sort state (applies to both Public and Personal lists).
        this.filterState = { query: '', tag: null, sort: 'recent' };
        // Handle for the in-flight lazy thumbnail backfill so we can cancel it on re-render/destroy.
        this._backfillHandle = null;
        // Keys of entries we've already tried to bake this pane-lifetime (success OR fail), so a save /
        // library change re-bakes only genuinely-new entries instead of sweeping the whole library again.
        this._backfillAttempted = new Set();
        this.element = document.createElement('div');
        this.element.className = 'ruleset-actions-container';

        this.render();
        this.attachEventListeners();
        this.setActivePane('library');
    }

    getElement() {
        return this.element;
    }

    render() {
        this.element.innerHTML = `
            <div class="form-group ruleset-library-scope" id="ruleset-library-scope-mount"></div>
            <div class="ruleset-actions-header">
                <button class="ruleset-actions-segment active" data-pane="library">Library</button>
                <button class="ruleset-actions-segment" data-pane="direct">Direct</button>
            </div>
            <div class="ruleset-actions-content">
                <div id="ruleset-library-library-pane" class="ruleset-pane"></div>
                <div id="ruleset-library-direct-pane" class="ruleset-pane hidden"></div>
            </div>
        `;

        this.panes = {
            library: this.element.querySelector('#ruleset-library-library-pane'),
            direct: this.element.querySelector('#ruleset-library-direct-pane'),
        };

        this.segments = {
            library: this.element.querySelector('[data-pane="library"]'),
            direct: this.element.querySelector('[data-pane="direct"]'),
        };

        this.actionsPopover = this.appContext.uiManager.actionsPopover;
        this.factory = this.appContext.rulesetDisplayFactory;

        new SwitchComponent(this.element.querySelector('#ruleset-library-scope-mount'), {
            ...this.appContext.rulesetActionController.getGenScopeSwitchConfig(),
            name: 'ruleset-library-scope',
            initialValue: this.appContext.rulesetActionController.getGenScope(),
        });

        this._renderLibraryPane();
        this._renderDirectPane();
    }

    _renderLibraryPane() {
        const pane = this.panes.library;
        pane.innerHTML = `
            <div class="library-toolbar">
                <input type="search" class="library-search" placeholder="Search name, tag or code…" aria-label="Search rulesets" />
                <select class="library-sort" aria-label="Sort rulesets">
                    <option value="recent">Recent</option>
                    <option value="name">Name A–Z</option>
                </select>
                <button class="button-icon library-pack-btn" data-action="export-pack" title="Export your rulesets as a shareable pack file" aria-label="Export rulesets to a pack file">${ICONS.download}</button>
                <button class="button-icon library-pack-btn" data-action="import-pack" title="Import rulesets from a pack file" aria-label="Import rulesets from a pack file">${ICONS.upload}</button>
                <input type="file" class="library-import-input" accept="application/json,.json" hidden aria-hidden="true" />
            </div>
            <div class="library-tag-filters" id="ruleset-library-tag-filters"></div>
            <div class="library-filter-tabs">
                <button class="sub-tab-button active" data-library-filter="public">Public</button>
                <button class="sub-tab-button" data-library-filter="personal">My Rulesets</button>
            </div>
            <div id="ruleset-library-public-content" class="library-list"></div>
            <div id="ruleset-library-personal-content" class="library-list hidden"></div>
        `;

        this._renderTagFilters();
        this._renderPublicLibrary();
        this._renderPersonalLibrary();
        this._scheduleThumbnailBackfill();
    }

    /**
     * Apply the live search query + active tag filter + sort to a list of entries. Search matches
     * name, description, derived mnemonic and tags (case-insensitive); sort is recent (default order)
     * or name. Pure-ish: returns a new array, doesn't mutate the source.
     */
    _applyFilter(entries) {
        const { query, tag, sort } = this.filterState;
        const q = query.trim().toLowerCase();
        let out = entries.filter(rule => {
            if (tag && !(Array.isArray(rule.tags) && rule.tags.includes(tag))) return false;
            if (!q) return true;
            const hay = [
                rule.name || '',
                rule.description || '',
                rulesetName(rule.hex),
                ...(Array.isArray(rule.tags) ? rule.tags : []),
            ].join(' ').toLowerCase();
            return hay.includes(q);
        });
        if (sort === 'name') {
            out = [...out].sort((a, b) => (a.name || rulesetName(a.hex)).localeCompare(b.name || rulesetName(b.hex)));
        }
        return out;
    }

    /** Build the union of all tags across public + personal entries as toggleable filter chips. */
    _renderTagFilters() {
        const mount = this.element.querySelector('#ruleset-library-tag-filters');
        if (!mount) return;
        const all = [
            ...(this.libraryData?.rulesets || []),
            ...this.appContext.libraryController.getUserLibrary(),
        ];
        const tags = [...new Set(all.flatMap(r => (Array.isArray(r.tags) ? r.tags : [])))].sort();
        mount.classList.toggle('hidden', tags.length === 0);
        mount.innerHTML = tags.map(t =>
            `<button class="tag-chip tag-filter${this.filterState.tag === t ? ' active' : ''}" data-tag-filter="${this._escapeAttr(t)}">${this._escape(t)}</button>`
        ).join('');
    }

    _renderPublicLibrary() {
        const rulesetsList = this.element.querySelector('#ruleset-library-public-content');
        rulesetsList.innerHTML = '';
        const entries = this._applyFilter(this.libraryData?.rulesets || []);
        if (entries.length === 0) {
            rulesetsList.innerHTML = `<p class="empty-state-text">No rulesets match your search.</p>`;
            return;
        }
        // Merge any cached evolved-world thumbnail (baked client-side from the entry's curated IC) so
        // public cards show a preview without bloating the committed JSON with image data.
        const cache = PersistenceService.loadPublicThumbCache();
        entries.forEach(rule => {
            const merged = cache[rule.hex] ? { ...rule, thumb: cache[rule.hex] } : rule;
            rulesetsList.appendChild(this.factory.createLibraryListItem(merged, false));
        });
    }

    _renderPersonalLibrary() {
        const personalList = this.element.querySelector('#ruleset-library-personal-content');
        personalList.innerHTML = '';
        const userRulesets = this.appContext.libraryController.getUserLibrary();

        if (userRulesets.length === 0) {
            personalList.innerHTML = `
                <div class="panel-empty-state">
                    <div class="panel-empty-state-icon">${ICONS.star}</div>
                    <p class="panel-empty-state-title">No saved rulesets yet</p>
                    <p class="panel-empty-state-desc">This is your personal collection. Find a rule you like, then click the <span class="inline-icon">${ICONS.star}</span> <strong>Save</strong> button in the top bar to keep it here.</p>
                </div>`;
            return;
        }

        const entries = this._applyFilter(userRulesets);
        if (entries.length === 0) {
            personalList.innerHTML = `<p class="empty-state-text">No saved rulesets match your search.</p>`;
        } else {
            entries.forEach(rule => personalList.appendChild(this.factory.createLibraryListItem(rule, true)));
        }
    }

    /**
     * Lazily bake evolved-world thumbnails (borrow-and-restore engine) for any library entry — personal
     * OR public — that carries a paired initial condition but has no thumbnail yet. Personal results are
     * persisted to the user library; public results go to the client-side public-thumb cache (the
     * committed JSON only stores the IC choice). Persists silently and swaps each card's image in place
     * to avoid a re-render storm. Cancels any prior run; skipped while Auto-Explore is running. Called
     * once per pane open / real library change (NOT on every search keystroke).
     */
    _scheduleThumbnailBackfill() {
        this._backfillHandle?.cancel();
        this._backfillHandle = null;
        const wm = this.appContext.worldManager;
        if (!wm?.backfillMissingThumbnails || wm.autoExploreService?.isRunning?.()) return;

        const cache = PersistenceService.loadPublicThumbCache();
        const seen = this._backfillAttempted;
        // Include entries WITHOUT a paired IC too — the bake engine falls back to the selected world's
        // current IC so favourited/plain rulesets get a preview. Skip anything already tried this pane
        // lifetime so a save doesn't re-launch a full-library sweep.
        const personal = this.appContext.libraryController.getUserLibrary()
            .filter(r => !r.thumb && !seen.has(`personal:${r.id}`))
            .map(r => ({ ...r, __scope: 'personal' }));
        const publicMissing = (this.libraryData?.rulesets || [])
            .filter(r => !cache[r.hex] && !seen.has(`public:${r.hex}`))
            .map(r => ({ ...r, __scope: 'public' }));
        const jobs = [...personal, ...publicMissing];
        if (jobs.length === 0) return;

        this._backfillHandle = wm.backfillMissingThumbnails(jobs, {
            max: 24,
            onResult: (entry, thumb) => {
                // Remember every attempt (success or fail) so later saves/re-renders skip it.
                seen.add(entry.__scope === 'personal' ? `personal:${entry.id}` : `public:${entry.hex}`);
                if (!thumb) return;
                if (entry.__scope === 'personal') {
                    this.appContext.libraryController.setUserRulesetThumb(entry.id, thumb, { silent: true });
                    this._applyThumbToCard('#ruleset-library-personal-content', entry.id, null, thumb);
                } else {
                    PersistenceService.savePublicThumb(entry.hex, thumb);
                    this._applyThumbToCard('#ruleset-library-public-content', null, entry.hex, thumb);
                }
            },
        });
    }

    /** Swap a single card's thumbnail in place (no list re-render). Match by id (personal) or hex (public). */
    _applyThumbToCard(listSelector, id, hex, thumb) {
        const list = this.element.querySelector(listSelector);
        if (!list) return;
        const sel = id ? `.library-card[data-id="${CSS.escape(id)}"]` : `.library-card[data-hex="${CSS.escape(hex)}"]`;
        const card = list.querySelector(sel);
        const box = card?.querySelector('.library-card-thumb');
        if (!box) return;
        const existing = box.querySelector('.viz-placeholder, .ruleset-viz-svg, .library-card-thumb-img');
        const img = document.createElement('img');
        img.className = 'library-card-thumb-img';
        img.alt = '';
        img.src = thumb;
        if (existing) existing.replaceWith(img); else box.prepend(img);
    }

    _escape(str) {
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    _escapeAttr(str) {
        return String(str).replace(/"/g, '&quot;');
    }

    _renderDirectPane() {
        const mountPoint = this.panes.direct;
        mountPoint.innerHTML = '';
        new RulesetDirectInput(mountPoint, this.appContext, { context: 'ruleset-library-direct' });
    }

    attachEventListeners() {
        this.element.querySelector('.ruleset-actions-header').addEventListener('click', e => {
            if (e.target.matches('.ruleset-actions-segment')) {
                this.setActivePane(e.target.dataset.pane);
            }
        });

        const libraryPane = this.panes.library;

        // Search / sort toolbar — re-render both lists on change.
        libraryPane.addEventListener('input', e => {
            if (e.target.matches('.library-search')) {
                this.filterState.query = e.target.value;
                this._renderPublicLibrary();
                this._renderPersonalLibrary();
            }
        });
        libraryPane.addEventListener('change', e => {
            if (e.target.matches('.library-sort')) {
                this.filterState.sort = e.target.value;
                this._renderPublicLibrary();
                this._renderPersonalLibrary();
            } else if (e.target.matches('.library-import-input')) {
                const file = e.target.files && e.target.files[0];
                e.target.value = ''; // allow re-importing the same file
                if (file) this._handleImportFile(file);
            }
        });

        libraryPane.addEventListener('click', e => {
            const target = e.target;
            const action = target.dataset.action;
            const rulesetActionController = this.appContext.rulesetActionController;

            // Pack export/import toolbar buttons (resolve past the inner SVG).
            const packBtn = target.closest('.library-pack-btn');
            if (packBtn) {
                if (packBtn.dataset.action === 'export-pack') this._exportPack();
                else libraryPane.querySelector('.library-import-input')?.click();
                return;
            }

            // Tag filter chip toggle.
            const tagChip = target.closest('[data-tag-filter]');
            if (tagChip) {
                const tag = tagChip.dataset.tagFilter;
                this.filterState.tag = this.filterState.tag === tag ? null : tag;
                this._renderTagFilters();
                this._renderPublicLibrary();
                this._renderPersonalLibrary();
                return;
            }

            if (target.matches('[data-library-filter]')) {
                const filter = target.dataset.libraryFilter;
                libraryPane.querySelectorAll('.sub-tab-button').forEach(b => b.classList.remove('active'));
                target.classList.add('active');

                const publicPane = libraryPane.querySelector('#ruleset-library-public-content');
                const personalPane = libraryPane.querySelector('#ruleset-library-personal-content');

                publicPane.classList.toggle('hidden', filter !== 'public');
                personalPane.classList.toggle('hidden', filter !== 'personal');
                return;
            }

            const card = target.closest('.library-card');

            if (action === 'load-rule' || action === 'load-personal') {
                this.appContext.libraryController.loadRuleset(
                    card.dataset.hex,
                    rulesetActionController.getGenScope(),
                    rulesetActionController.getGenAutoReset()
                );
                return;
            }

            // Load the ruleset together with its paired initial condition + seed — reuses the
            // proven explore-find apply path (commits ruleset, clones the IC, seed-resets the world).
            if (action === 'load-with-ic') {
                const rule = this._findCardEntry(card);
                if (!rule?.initialState) return;
                EventBus.dispatch(EVENTS.COMMAND_APPLY_EXPLORE_FIND, {
                    find: {
                        hex: rule.hex,
                        initialState: rule.initialState,
                        seed: rule.seed,
                        mnemonic: rule.name || rulesetName(rule.hex),
                        icLabel: rule.initialState.mode,
                    },
                });
                return;
            }

            if (target.closest('[data-action="manage-personal"]')) {
                const manageButton = target.closest('[data-action="manage-personal"]');
                const id = card?.dataset.id;
                const rule = this.appContext.libraryController.getUserLibrary().find(r => r.id === id);
                if (!rule) return;

                const popoverActions = [
                    {
                        label: 'Rename',
                        callback: () => EventBus.dispatch(EVENTS.COMMAND_SHOW_SAVE_RULESET_MODAL, rule)
                    },
                    {
                        label: 'Share',
                        callback: () => {
                            const url = new URL(window.location.href);
                            url.search = `?r=${rule.hex}`;
                            navigator.clipboard.writeText(url.toString()).then(() => {
                                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Share link copied!', type: 'success' });
                            });
                        }
                    },
                ];

                // Copy the paired initial condition as a portable IC code (only when one exists).
                if (rule.initialState) {
                    popoverActions.push({
                        label: 'Copy IC code',
                        callback: () => {
                            const code = InitialStateCodec.encode(rule.initialState, rule.seed);
                            if (!code) {
                                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'No initial condition to copy.', type: 'info' });
                                return;
                            }
                            navigator.clipboard.writeText(code).then(() => {
                                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Initial-condition code copied!', type: 'success' });
                            });
                        }
                    });
                }

                // One-paste path into a public-library PR: emit the committed rulesets.json shape.
                popoverActions.push({
                    label: 'Copy as public-library JSON',
                    callback: () => {
                        const json = JSON.stringify(toPublicLibraryEntry(rule), null, 2);
                        navigator.clipboard.writeText(json).then(() => {
                            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Public-library JSON copied — paste it into a rulesets.json PR.', type: 'success' });
                        }).catch(() => {
                            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Could not access the clipboard.', type: 'error' });
                        });
                    }
                });

                popoverActions.push({
                    label: 'Delete',
                    callback: () => {
                        EventBus.dispatch(EVENTS.COMMAND_SHOW_CONFIRMATION, {
                            title: 'Delete Ruleset',
                            message: `Are you sure you want to permanently delete "${rule.name}"?`,
                            confirmLabel: 'Delete',
                            onConfirm: () => {
                                this.appContext.libraryController.deleteUserRuleset(rule.id);
                                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Deleted "${rule.name}".`, type: 'info' });
                            }
                        });
                    }
                });

                this.actionsPopover.show(popoverActions, manageButton);
            }
        });

        this._subscribeToEvent(EVENTS.USER_LIBRARY_CHANGED, this._onUserLibraryChanged);
    }

    /** Resolve a card element back to its source entry (personal by id, else public/personal by hex). */
    _findCardEntry(card) {
        if (!card) return null;
        const id = card.dataset.id;
        const hex = card.dataset.hex;
        const user = this.appContext.libraryController.getUserLibrary();
        if (id) {
            const byId = user.find(r => r.id === id);
            if (byId) return byId;
        }
        return user.find(r => r.hex === hex) || (this.libraryData?.rulesets || []).find(r => r.hex === hex) || null;
    }

    _onUserLibraryChanged = () => {
        this._renderTagFilters();
        this._renderPersonalLibrary();
        this._scheduleThumbnailBackfill();
    };

    /** Download the personal library as a dated pack file (no-op with a toast when it's empty). */
    _exportPack() {
        const lc = this.appContext.libraryController;
        if (lc.getUserLibrary().length === 0) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'No saved rulesets to export yet.', type: 'info' });
            return;
        }
        const date = new Date().toISOString().slice(0, 10);
        downloadFile(`hexlife-rulesets-${date}.json`, lc.exportPackJSON(), 'application/json');
    }

    /** Read + decode a chosen pack file, then confirm-gate the merge and toast the result. */
    async _handleImportFile(file) {
        let decoded;
        try {
            decoded = decodePack(await file.text());
        } catch (err) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Import failed: ${err.message}`, type: 'error' });
            return;
        }
        const rulesets = decoded.rulesets;
        if (rulesets.length === 0) {
            const detail = decoded.finds.length > 0 ? ' (this pack only contains explore finds — import it from the Explore panel).' : '.';
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `No importable rulesets in that file${detail}`, type: 'info' });
            return;
        }
        const preview = rulesets.slice(0, 5).map(r => `• ${r.name}`).join('\n');
        const more = rulesets.length > 5 ? `\n…and ${rulesets.length - 5} more` : '';
        const warnLine = decoded.warnings.length ? `\n\n${decoded.warnings.length} item(s) were cleaned up on import.` : '';
        EventBus.dispatch(EVENTS.COMMAND_SHOW_CONFIRMATION, {
            title: 'Import rulesets',
            message: `Add ${rulesets.length} ruleset(s) to your personal library? Duplicates (same rule) are skipped.\n\n${preview}${more}${warnLine}`,
            confirmLabel: 'Import',
            onConfirm: () => {
                const { added, skipped } = this.appContext.libraryController.importRulesets(rulesets);
                const msg = added > 0
                    ? `Imported ${added} ruleset(s)${skipped ? `, skipped ${skipped} duplicate(s)` : ''}.`
                    : `Nothing new to import — all ${skipped} already in your library.`;
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: msg, type: added > 0 ? 'success' : 'info' });
            },
        });
    }

    destroy() {
        this._backfillHandle?.cancel();
        super.destroy?.();
    }

    setActivePane(paneName) {
        for (const key in this.panes) {
            this.panes[key].classList.add('hidden');
            this.segments[key].classList.remove('active');
        }
        this.panes[paneName].classList.remove('hidden');
        this.segments[paneName].classList.add('active');
    }
}
