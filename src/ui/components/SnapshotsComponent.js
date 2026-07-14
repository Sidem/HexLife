import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as Config from '../../core/config.js';
import { SavedStartsList, importStateFileToLibrary, entryToStateFile } from './SavedStartsList.js';
import { ICONS } from '../icons.js';

/**
 * "Snapshots" — the single home for world-state persistence: save the selected world to a file,
 * load one back, and manage the Saved Starts library (the same list the World Setup modal shows,
 * via the shared SavedStartsList).
 *
 * The two things a picked entry can do are deliberately distinct:
 *  - *Use as start* assigns it to a world's `initialState`, so every reset (R) replays those cells.
 *  - *Load now* pushes the cells (and the captured ruleset) into the live world immediately.
 */
export class SnapshotsComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options);
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.stateLibrary = appContext.stateLibraryService;
        this.selectedId = null;

        this.element = document.createElement('div');
        this.element.className = 'snapshots-component-content';
        this.render();

        this._subscribeToEvent(EVENTS.SAVED_STATES_CHANGED, () => {
            // A deleted entry must not leave a stale selection behind in the apply row.
            if (this.selectedId && !this.stateLibrary.getById(this.selectedId)) this.selectedId = null;
            this._renderList();
        });
    }

    getElement() {
        return this.element;
    }

    render() {
        this.element.innerHTML = `
            <div class="snap-section">
                <h4>Selected world</h4>
                <p class="info-text">Its cells, ruleset and tick count, as a <code>.json</code> file.</p>
                <div class="snap-actions">
                    <button type="button" class="button" data-action="save" data-tour-id="save-state-button">${ICONS.save} Save to file</button>
                    <button type="button" class="button" data-action="load" data-tour-id="load-state-button">${ICONS.folderOpen} Load from file</button>
                    <button type="button" class="button" data-action="capture" title="Freeze these cells into the saved-starts library [T]">${ICONS.upload} Capture as start</button>
                </div>
                <input type="file" class="snap-file-input" accept=".json,.txt" hidden aria-label="Load world state file" />
            </div>

            <div class="snap-section">
                <h4>Saved starts</h4>
                <p class="info-text">Frozen grids you can replay as any world's starting cells.</p>
                <div class="snap-actions">
                    <button type="button" class="button" data-action="import">${ICONS.download} Import a file as a start</button>
                </div>
                <div class="snap-list isc-saved-list" role="listbox" aria-label="Saved starts"></div>
                <div class="snap-apply hidden">
                    <span class="snap-apply-name"></span>
                    <div class="snap-apply-buttons">
                        <button type="button" class="button" data-action="use-selected">Use as start — this world</button>
                        <button type="button" class="button" data-action="use-all">Use as start — all worlds</button>
                        <button type="button" class="button" data-action="load-now" title="Replace the selected world's cells (and ruleset) with this snapshot right now">Load into world now</button>
                    </div>
                </div>
            </div>
        `;

        this.ui = {
            fileInput: this.element.querySelector('.snap-file-input'),
            list: this.element.querySelector('.snap-list'),
            applyRow: this.element.querySelector('.snap-apply'),
            applyName: this.element.querySelector('.snap-apply-name'),
        };

        this.savedStartsList = new SavedStartsList(this.ui.list, {
            stateLibrary: this.stateLibrary,
            getSelectedId: () => this.selectedId,
            onSelect: (entry) => {
                this.selectedId = entry.id;
                this._renderList();
            },
            emptyHtml: 'No saved starts yet. Capture the selected world above (or press <kbd>T</kbd>), or import a saved file.',
        });

        this._addDOMListener(this.element, 'click', this._handleClick);
        this._addDOMListener(this.ui.fileInput, 'change', this._handleLoadFile);
        this._renderList();
    }

    refresh() {
        this._renderList();
    }

    _handleClick(e) {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (!action) return;

        switch (action) {
            case 'save':
                EventBus.dispatch(EVENTS.COMMAND_SAVE_SELECTED_WORLD_STATE);
                break;
            case 'load':
            case 'import':
                this._pendingImport = action === 'import';
                this.ui.fileInput.click();
                break;
            case 'capture':
                // The WorldManager handler owns the toast (shared by every capture entry point).
                EventBus.dispatch(EVENTS.COMMAND_CAPTURE_STATE_TO_LIBRARY, { assignScope: 'selected' });
                break;
            case 'use-selected':
                this._useAsStart('selected');
                break;
            case 'use-all':
                this._useAsStart('all');
                break;
            case 'load-now':
                this._loadSelectedNow();
                break;
        }
    }

    _renderList() {
        this.savedStartsList.render();
        const entry = this.selectedId ? this.stateLibrary.getById(this.selectedId) : null;
        this.ui.applyRow.classList.toggle('hidden', !entry);
        if (entry) this.ui.applyName.textContent = entry.name || 'Untitled start';
    }

    /** Assign the picked entry as the initial state of one world or all nine. */
    _useAsStart(scope) {
        const entry = this.stateLibrary.getById(this.selectedId);
        if (!entry) return;
        const initialState = this.stateLibrary.buildInitialState(entry);
        const targets = scope === 'all'
            ? Array.from({ length: Config.NUM_WORLDS }, (_, i) => i)
            : [this.worldManager.getSelectedWorldIndex()];

        targets.forEach(worldIndex => {
            EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_INITIAL_STATE, {
                worldIndex,
                initialState: structuredClone(initialState),
            });
        });
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
            message: scope === 'all'
                ? `"${entry.name}" is now the start for all ${Config.NUM_WORLDS} worlds (R resets to it)`
                : `"${entry.name}" is now world ${targets[0] + 1}'s start (R resets to it)`,
        });
    }

    /** Push the picked entry's cells + captured ruleset into the selected world right now. */
    _loadSelectedNow() {
        const entry = this.stateLibrary.getById(this.selectedId);
        if (!entry) return;
        EventBus.dispatch(EVENTS.COMMAND_LOAD_WORLD_STATE, {
            worldIndex: this.worldManager.getSelectedWorldIndex(),
            loadedData: entryToStateFile(entry),
        });
    }

    /**
     * One hidden input serves both file buttons: "Load from file" pushes the file straight into the
     * selected world, "Import" parks it in the library instead.
     */
    _handleLoadFile(e) {
        const file = e.target.files?.[0];
        if (!file) { e.target.value = null; return; }

        if (this._pendingImport) {
            importStateFileToLibrary(file, this.stateLibrary)
                .then(({ entry, deduped }) => {
                    this.selectedId = entry.id;
                    this._renderList();
                    EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                        message: deduped ? `Already in the library as "${entry.name}"` : `Imported "${entry.name}"`,
                    });
                })
                .catch(err => EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Import failed: ${err.message}`, type: 'error' }))
                .finally(() => { e.target.value = null; });
            return;
        }

        const reader = new FileReader();
        reader.onload = (re) => {
            try {
                // WorldManager.loadWorldState re-validates the shape (and surfaces its own toast on
                // a bad file), so only the JSON parse needs guarding here.
                EventBus.dispatch(EVENTS.COMMAND_LOAD_WORLD_STATE, {
                    worldIndex: this.worldManager.getSelectedWorldIndex(),
                    loadedData: JSON.parse(re.target.result),
                });
            } catch (err) {
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Error processing file: ${err.message}`, type: 'error' });
            } finally {
                e.target.value = null;
            }
        };
        reader.onerror = () => {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Error reading file.', type: 'error' });
            e.target.value = null;
        };
        reader.readAsText(file);
    }
}
