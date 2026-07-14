import * as Config from '../../core/config.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { renderInitialStatePreview } from './initialStatePreview.js';
import { cellsToBase64 } from '../../utils/utils.js';
import { parseStateFile } from '../../utils/stateFile.js';
import { ICONS } from '../icons.js';

/** "3m ago" / "2h ago" / "5d ago" — coarse is fine; this is a recency hint, not a timestamp. */
export function formatAge(createdAt) {
    if (!Number.isFinite(createdAt)) return '';
    const secs = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
    if (secs < 60) return 'just now';
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
}

/**
 * The `hex_state_*.json` shape the Save-to-file path writes, built from a library entry — so an
 * exported start round-trips back through Load, and so an entry can be handed straight to
 * `COMMAND_LOAD_WORLD_STATE`.
 */
export function entryToStateFile(entry) {
    return {
        rows: entry.rows,
        cols: entry.cols,
        rulesetHex: entry.rulesetHex || '0'.repeat(32),
        format: 'b64',
        stateB64: entry.stateB64,
        worldTick: entry.capturedTick || 0,
    };
}

/**
 * Read a user-picked world-state file and add it to the saved-starts library.
 * @returns {Promise<{entry: object, deduped: boolean}>} rejects with an Error carrying the reason.
 */
export function importStateFileToLibrary(file, stateLibrary) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (re) => {
            try {
                const parsed = parseStateFile(JSON.parse(re.target.result));
                if (parsed.error) throw new Error(parsed.error);

                let live = 0;
                for (let i = 0; i < parsed.cells.length; i++) live += parsed.cells[i] ? 1 : 0;
                const { entry, deduped, error } = stateLibrary.add({
                    id: (globalThis.crypto?.randomUUID?.() ?? `ss-${Date.now()}-${Math.floor(Math.random() * 1e9)}`),
                    name: file.name.replace(/\.(json|txt)$/i, '').slice(0, 60) || 'Imported start',
                    rows: parsed.rows,
                    cols: parsed.cols,
                    stateB64: cellsToBase64(parsed.cells),
                    density: live / (parsed.cells.length || 1),
                    rulesetHex: parsed.rulesetHex,
                    capturedTick: parsed.worldTick,
                    createdAt: Date.now(),
                });
                if (!entry) throw new Error(error);
                resolve({ entry, deduped });
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Error reading file.'));
        reader.readAsText(file);
    });
}

/**
 * The saved-starts library rendered as a selectable list of rows (thumbnail, name, meta, and the
 * rename / export / delete actions). Shared by the World Setup modal's "Saved" tab and the
 * Snapshots panel so both surfaces stay identical; the owner supplies selection and gets a callback.
 */
export class SavedStartsList {
    /**
     * @param {HTMLElement} container Rows are rendered into (and cleared from) this element.
     * @param {object} options
     * @param {import('../../services/StateLibraryService.js').StateLibraryService} options.stateLibrary
     * @param {() => (string|undefined)} [options.getSelectedId] Which entry renders as selected.
     * @param {(entry: object) => void} [options.onSelect] Row clicked (outside the action buttons).
     * @param {(id: string, name: string) => void} [options.onRename] Fired after a rename lands.
     * @param {string} [options.emptyHtml] Markup for the empty-library placeholder.
     */
    constructor(container, options = {}) {
        this.container = container;
        this.stateLibrary = options.stateLibrary;
        this.options = options;
        this.renamingId = null;
        this.pendingDeleteId = null;
    }

    /** Clears any in-flight rename/delete confirmation (e.g. when the host surface reopens). */
    resetRowStates() {
        this.renamingId = null;
        this.pendingDeleteId = null;
    }

    render() {
        const list = this.container;
        list.innerHTML = '';
        const entries = this.stateLibrary.getAll();

        if (entries.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'info-text isc-saved-empty';
            empty.innerHTML = this.options.emptyHtml
                ?? 'No saved starts yet. Press <kbd>T</kbd> to capture the selected world.';
            list.appendChild(empty);
            return;
        }

        const selectedId = this.options.getSelectedId?.();
        entries.forEach(entry => list.appendChild(this._renderEntry(entry, entry.id === selectedId)));
    }

    _renderEntry(entry, isSelected) {
        const scaled = entry.rows !== Config.GRID_ROWS || entry.cols !== Config.GRID_COLS;
        const row = document.createElement('div');
        row.className = 'isc-entry' + (isSelected ? ' is-selected' : '') + (scaled ? ' is-scaled' : '');
        row.dataset.id = entry.id;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', isSelected ? 'true' : 'false');

        const thumb = document.createElement('canvas');
        thumb.className = 'isc-entry-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        renderInitialStatePreview(thumb, this.stateLibrary.buildInitialState(entry), { maxDim: 48 });
        row.appendChild(thumb);

        const info = document.createElement('div');
        info.className = 'isc-entry-info';

        if (this.renamingId === entry.id) {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'isc-entry-rename';
            input.value = entry.name || '';
            input.setAttribute('aria-label', 'New name');
            // Rows are rebuilt on every list render, so their listeners live and die with the nodes
            // (registering them on the component would pile up stale element refs).
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); this._commitRename(entry.id, input.value); }
                if (e.key === 'Escape') { e.preventDefault(); this.renamingId = null; this.render(); }
            });
            input.addEventListener('blur', () => this._commitRename(entry.id, input.value));
            info.appendChild(input);
            requestAnimationFrame(() => { input.focus(); input.select(); });
        } else {
            const name = document.createElement('span');
            name.className = 'isc-entry-name';
            name.textContent = entry.name || 'Untitled start';
            name.title = entry.name || 'Untitled start';
            info.appendChild(name);
        }

        const meta = document.createElement('span');
        meta.className = 'isc-entry-meta';
        const bits = [`tick ${entry.capturedTick ?? 0}`, formatAge(entry.createdAt)].filter(Boolean);
        meta.textContent = bits.join(' · ');
        if (scaled) {
            const badge = document.createElement('span');
            badge.className = 'isc-entry-badge';
            badge.textContent = `⚠ scaled from ${entry.cols}×${entry.rows}`;
            badge.title = `Captured on a ${entry.cols}×${entry.rows} grid; it will be resampled onto the current ${Config.GRID_COLS}×${Config.GRID_ROWS} grid.`;
            meta.appendChild(document.createTextNode(' '));
            meta.appendChild(badge);
        }
        info.appendChild(meta);
        row.appendChild(info);

        row.appendChild(this._renderActions(entry));

        // Clicking anywhere else on the row selects the entry.
        row.addEventListener('click', (e) => {
            if (e.target.closest('.isc-entry-actions') || e.target.closest('.isc-entry-rename')) return;
            this.pendingDeleteId = null;
            this.renamingId = null;
            this.options.onSelect?.(entry);
        });

        return row;
    }

    _renderActions(entry) {
        const actions = document.createElement('div');
        actions.className = 'isc-entry-actions';

        if (this.pendingDeleteId === entry.id) {
            actions.classList.add('is-confirming');
            const label = document.createElement('span');
            label.className = 'isc-entry-confirm-label';
            label.textContent = 'Delete?';
            const yes = this._iconButton('Delete', 'Yes', () => {
                this.pendingDeleteId = null;
                this.stateLibrary.remove(entry.id);
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Deleted saved start "${entry.name}"` });
                this.render();
            });
            yes.classList.add('isc-entry-danger');
            const no = this._iconButton('Keep', 'No', () => { this.pendingDeleteId = null; this.render(); });
            actions.append(label, yes, no);
            return actions;
        }

        actions.appendChild(this._iconButton('Rename', ICONS.pencil, () => {
            this.renamingId = entry.id;
            this.render();
        }));
        actions.appendChild(this._iconButton('Export as a world-state file', ICONS.download, () => this._exportEntry(entry)));
        actions.appendChild(this._iconButton('Delete', ICONS.trash, () => {
            this.pendingDeleteId = entry.id;
            this.render();
        }));
        return actions;
    }

    _iconButton(title, html, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'isc-entry-button';
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.innerHTML = html;
        btn.addEventListener('click', onClick);
        return btn;
    }

    _commitRename(id, name) {
        if (this.renamingId !== id) return;
        this.renamingId = null;
        const trimmed = (name || '').trim();
        if (trimmed) {
            this.stateLibrary.rename(id, trimmed);
            this.options.onRename?.(id, trimmed);
        }
        this.render();
    }

    /** Export as the same `hex_state_*.json` shape Save-to-file writes, so it round-trips. */
    _exportEntry(entry) {
        const slug = (entry.name || 'saved-start').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
        EventBus.dispatch(EVENTS.TRIGGER_DOWNLOAD, {
            filename: `hex_state_${slug}.json`,
            content: JSON.stringify(entryToStateFile(entry), null, 2),
            mimeType: 'application/json',
        });
    }
}
