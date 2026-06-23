import { BaseComponent } from './BaseComponent.js';

/**
 * Renders the keyboard-shortcuts panel as an interactive, color-coded keyboard overlay
 * (desktop/tablet) that falls back to a compact categorized list on narrow mobile.
 *
 * The keyboard is generated entirely from the live shortcut registry
 * (`KeyboardShortcutManager.getShortcuts()`) so it never drifts out of sync: each registered
 * shortcut is mapped onto a physical key by its `key`/`code`, bucketed by modifier
 * (base / Shift / Ctrl / Ctrl+Shift), and colored by its category. Hovering or focusing a key
 * fills the detail strip with every binding that key carries; the Base/Shift/Ctrl layer toggle
 * re-highlights only the keys that have that combo; the search box spotlights matching keys.
 */
export class KeyboardShortcutsComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options);
        this.appContext = appContext;
        this.element = document.createElement('div');
        this.element.className = 'keyboard-shortcuts-component-content';
        this.layer = 'base';
        this.render();
    }

    getElement() {
        return this.element;
    }

    /** Physical keyboard layout. `id` is the registry key (lowercased); `w` is a flex weight. */
    static get ROWS() {
        return [
            [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'], ['0', '0']],
            [['Q', 'q'], ['W', 'w'], ['E', 'e'], ['R', 'r'], ['T', 't'], ['Y', 'y'], ['U', 'u'], ['I', 'i'], ['O', 'o'], ['P', 'p']],
            [['A', 'a'], ['S', 's'], ['D', 'd'], ['F', 'f'], ['G', 'g'], ['H', 'h'], ['J', 'j'], ['K', 'k'], ['L', 'l']],
            [['Shift', 'shift', 1.7], ['Z', 'z'], ['X', 'x'], ['C', 'c'], ['V', 'v'], ['B', 'b'], ['N', 'n'], ['M', 'm']],
            [['Ctrl', 'ctrl', 1.7], ['Esc', 'esc', 1.4], ['Space', 'space', 3], ['◄', '←', 1.2], ['▲', '↑', 1.2], ['▼', '↓', 1.2], ['►', '→', 1.2]],
        ];
    }

    /** Curated legend: registry categories collapse onto these six color groups. */
    static get LEGEND() {
        return [
            { key: 'panels', rgb: '55,138,221', name: 'Panels' },
            { key: 'control', rgb: '29,158,117', name: 'Controls' },
            { key: 'action', rgb: '127,119,221', name: 'Ruleset actions' },
            { key: 'reset', rgb: '216,90,48', name: 'Reset & clear' },
            { key: 'pattern', rgb: '239,159,39', name: 'Patterns' },
            { key: 'history', rgb: '212,83,126', name: 'History' },
        ];
    }

    /** Maps a registry `category` string onto a legend color group. */
    _categoryColor(category) {
        switch (category) {
            case 'Panels': return { key: 'panels', rgb: '55,138,221' };
            case 'Global':
            case 'Global Controls': return { key: 'control', rgb: '29,158,117' };
            case 'Actions & Panels': return { key: 'action', rgb: '127,119,221' };
            case 'Reset & Clear': return { key: 'reset', rgb: '216,90,48' };
            case 'Patterns':
            case 'Patterns (while placing)': return { key: 'pattern', rgb: '239,159,39' };
            case 'History': return { key: 'history', rgb: '212,83,126' };
            default: return { key: 'misc', rgb: '95,94,90' };
        }
    }

    /** The physical key id a shortcut lives on, or `null` if it belongs in the numpad cluster. */
    _physicalId(s) {
        if (s.code && /^Numpad[1-9]$/.test(s.code)) return null;
        const k = (s.key || '').toLowerCase();
        if (k === 'arrowleft') return '←';
        if (k === 'arrowright') return '→';
        if (k === 'arrowup') return '↑';
        if (k === 'arrowdown') return '↓';
        if (k === ' ') return 'space';
        if (k === 'escape') return 'esc';
        return k;
    }

    _modifier(s) {
        if (s.ctrlKey && s.shiftKey) return 'ctrlShift';
        if (s.ctrlKey) return 'ctrl';
        if (s.shiftKey) return 'shift';
        return 'base';
    }

    /**
     * Buckets every registry shortcut by physical key + modifier.
     * @returns {{ byKey: Record<string, object>, numpad: Array<object> }}
     */
    _buildBindings(shortcuts) {
        const byKey = {};
        const numpad = [];
        shortcuts.forEach(s => {
            const id = this._physicalId(s);
            const color = this._categoryColor(s.category);
            const entry = {
                desc: s.description,
                category: s.category,
                colorKey: color.key,
                rgb: color.rgb,
                contextual: s.category === 'Patterns (while placing)',
            };
            if (id === null) {
                numpad.push({ ...entry, n: Number(s.code.replace('Numpad', '')) });
                return;
            }
            if (!byKey[id]) byKey[id] = { base: [], shift: [], ctrl: [], ctrlShift: [] };
            byKey[id][this._modifier(s)].push(entry);
        });
        numpad.sort((a, b) => a.n - b.n);
        return { byKey, numpad };
    }

    /** The binding shown on a key's face for the active layer (non-contextual preferred). */
    _faceBinding(bucket) {
        if (!bucket) return null;
        let list;
        if (this.layer === 'base') list = bucket.base;
        else if (this.layer === 'shift') list = bucket.shift;
        else list = bucket.ctrl.length ? bucket.ctrl : bucket.ctrlShift;
        if (!list || !list.length) return null;
        return list.find(b => !b.contextual) || list[0];
    }

    render() {
        const shortcuts = this.appContext.keyboardShortcutManager.getShortcuts();
        this.bindings = this._buildBindings(shortcuts);

        this.element.innerHTML = '';

        // ---- Keyboard view (desktop/tablet) ----
        const board = document.createElement('div');
        board.className = 'kb-board-view';

        const controls = document.createElement('div');
        controls.className = 'kb-controls';
        controls.innerHTML = `
            <input type="text" class="kb-search" placeholder="Search actions…" aria-label="Search shortcut actions" />
            <div class="kb-layers" role="group" aria-label="Modifier layer">
                <button type="button" class="kb-layer kb-on" data-layer="base">Base</button>
                <button type="button" class="kb-layer" data-layer="shift">⇧ Shift</button>
                <button type="button" class="kb-layer" data-layer="ctrl">⌃ Ctrl</button>
            </div>`;
        board.appendChild(controls);

        const keys = document.createElement('div');
        keys.className = 'kb-keys';
        KeyboardShortcutsComponent.ROWS.forEach(row => {
            const rowEl = document.createElement('div');
            rowEl.className = 'kb-row';
            row.forEach(([cap, id, w]) => rowEl.appendChild(this._makeKey(cap, id, w)));
            keys.appendChild(rowEl);
        });
        board.appendChild(keys);

        const lower = document.createElement('div');
        lower.className = 'kb-lower';
        lower.appendChild(this._makeNumpad());
        const detail = document.createElement('div');
        detail.className = 'kb-detail';
        detail.innerHTML = `<div class="kb-detail-hint">Hover or focus a key to see what it does.</div>`;
        this._detailEl = detail;
        lower.appendChild(detail);
        board.appendChild(lower);

        const legend = document.createElement('div');
        legend.className = 'kb-legend';
        KeyboardShortcutsComponent.LEGEND.forEach(c => {
            const span = document.createElement('span');
            span.innerHTML = `<i style="background:rgb(${c.rgb})"></i>${c.name}`;
            legend.appendChild(span);
        });
        board.appendChild(legend);

        this.element.appendChild(board);

        // ---- List view (mobile fallback) ----
        this.element.appendChild(this._makeListView(shortcuts));

        this._wireBoard(board);
        this._paint();
    }

    _makeKey(cap, id, w) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'kb-key';
        el.dataset.id = id;
        if (w) el.style.flexGrow = String(w);
        el.innerHTML = `<span class="kb-cap">${cap}</span><span class="kb-act"></span>`;

        const show = () => this._showDetail(id);
        el.addEventListener('mouseenter', () => { el.classList.add('kb-active'); show(); });
        el.addEventListener('mouseleave', () => el.classList.remove('kb-active'));
        el.addEventListener('focus', show);
        el.addEventListener('click', show);
        return el;
    }

    _makeNumpad() {
        const wrap = document.createElement('div');
        wrap.className = 'kb-numpad';
        wrap.innerHTML = `<div class="kb-numpad-label"><kbd>Ctrl</kbd> + Numpad → copy world state</div>`;
        const grid = document.createElement('div');
        grid.className = 'kb-numpad-grid';
        const byN = new Map(this.bindings.numpad.map(b => [b.n, b]));
        [7, 8, 9, 4, 5, 6, 1, 2, 3].forEach(n => {
            const b = byN.get(n);
            const cell = document.createElement('div');
            cell.className = 'kb-key kb-np';
            cell.style.background = 'rgba(239,159,39,0.16)';
            cell.style.borderBottomColor = 'rgb(239,159,39)';
            cell.innerHTML = `<span class="kb-cap">${n}</span>`;
            if (b) cell.title = b.desc;
            grid.appendChild(cell);
        });
        wrap.appendChild(grid);
        return wrap;
    }

    _makeListView(shortcuts) {
        const view = document.createElement('div');
        view.className = 'kb-list-view';
        const grouped = this.groupShortcuts(shortcuts);
        let html = '';
        for (const category in grouped) {
            html += `<div class="shortcut-category"><h4>${category}</h4><ul>`;
            grouped[category].forEach(shortcut => {
                const keysHtml = shortcut.displayKey
                    ? shortcut.displayKey.split(' + ').map(k => `<kbd>${k}</kbd>`).join(' + ')
                    : `${shortcut.ctrlKey ? '<kbd>Ctrl</kbd> + ' : ''}${shortcut.shiftKey ? '<kbd>Shift</kbd> + ' : ''}<kbd>${(shortcut.key || '').toUpperCase()}</kbd>`;
                html += `<li><div class="keys">${keysHtml}</div><div class="description">${shortcut.description}</div></li>`;
            });
            html += `</ul></div>`;
        }
        view.innerHTML = html;
        return view;
    }

    _wireBoard(board) {
        board.querySelectorAll('.kb-layer').forEach(btn => {
            btn.addEventListener('click', () => {
                this.layer = btn.dataset.layer;
                this._paint();
            });
        });
        const search = board.querySelector('.kb-search');
        search.addEventListener('input', () => this._applySearch(search.value.trim().toLowerCase()));
    }

    /** Re-color every key face for the active modifier layer. */
    _paint() {
        const layerActive = { base: false, shift: this.layer === 'shift', ctrl: this.layer === 'ctrl' };
        this.element.querySelectorAll('.kb-board-view .kb-row .kb-key').forEach(el => {
            const id = el.dataset.id;
            const act = el.querySelector('.kb-act');
            el.classList.remove('kb-bound', 'kb-dim');
            el.style.background = '';
            el.style.borderBottomColor = '';

            if (id === 'shift' || id === 'ctrl') {
                act.textContent = '';
                el.classList.toggle('kb-mod-on', layerActive[id]); // mod keys never bind to an action
                return;
            }

            const bind = this._faceBinding(this.bindings.byKey[id]);
            if (bind) {
                el.classList.add('kb-bound');
                el.style.background = `rgba(${bind.rgb},0.16)`;
                el.style.borderBottomColor = `rgb(${bind.rgb})`;
                act.textContent = bind.desc;
            } else {
                act.textContent = '';
                el.classList.add('kb-dim');
            }
        });
        this.element.querySelectorAll('.kb-layer').forEach(b => b.classList.toggle('kb-on', b.dataset.layer === this.layer));
    }

    _showDetail(id) {
        const cap = id === 'shift' ? 'Shift' : id === 'ctrl' ? 'Ctrl' : id === 'esc' ? 'Esc' : id === 'space' ? 'Space' : id.toUpperCase();
        if (id === 'shift' || id === 'ctrl') {
            this._detailEl.innerHTML = `<div class="kb-detail-hint"><kbd>${cap}</kbd> is a modifier — switch the layer above to see its combos.</div>`;
            return;
        }
        const bucket = this.bindings.byKey[id];
        if (!bucket) {
            this._detailEl.innerHTML = `<div class="kb-detail-hint">No shortcut on <kbd>${cap}</kbd>.</div>`;
            return;
        }
        const rows = [];
        const push = (prefix, list) => list.forEach(b => rows.push({ combo: prefix + cap, ...b }));
        push('', bucket.base);
        push('⇧ ', bucket.shift);
        push('⌃ ', bucket.ctrl);
        push('⌃⇧ ', bucket.ctrlShift);

        this._detailEl.innerHTML = rows.map(r => `
            <div class="kb-detail-row${r.contextual ? ' kb-ctx' : ''}">
                <span class="kb-detail-dot" style="background:rgb(${r.rgb})"></span>
                <span class="kb-detail-combo">${r.combo}</span>
                <span class="kb-detail-desc">${r.desc}</span>
            </div>`).join('');
    }

    _applySearch(q) {
        this.element.querySelectorAll('.kb-board-view .kb-row .kb-key').forEach(el => {
            const bucket = this.bindings.byKey[el.dataset.id];
            let hit = !q;
            if (q && bucket) {
                hit = [...bucket.base, ...bucket.shift, ...bucket.ctrl, ...bucket.ctrlShift]
                    .some(b => b.desc.toLowerCase().includes(q));
            }
            el.classList.toggle('kb-search-miss', !hit);
        });
    }

    groupShortcuts(shortcuts) {
        return shortcuts.reduce((acc, shortcut) => {
            const category = shortcut.category || 'Misc';
            if (!acc[category]) acc[category] = [];
            acc[category].push(shortcut);
            return acc;
        }, {});
    }

    refresh() {
        this.render();
    }
}
