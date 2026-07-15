import { EventBus, EVENTS } from '../../services/EventBus.js';
import { ICONS } from '../icons.js';

/**
 * A fuzzy, keyboard-driven action launcher (Ctrl/⌘-K).
 *
 * Serves both audiences: experts get speed, beginners get a "type what you want"
 * surface that is gentler than decoding the icon rail. Every command maps to an
 * existing `COMMAND_*` dispatch, so the palette stays in lockstep with the app's
 * command bus rather than re-implementing behaviour.
 *
 * Desktop-only: panel/popout toggles no-op on mobile (see UIManager), and mobile
 * already has the bottom tab bar, so the palette refuses to open there.
 */
export class CommandPalette {
    constructor(appContext) {
        this.appContext = appContext;
        this.isOpen = false;
        this.activeIndex = 0;
        this.filtered = [];
        this.commands = this._buildCommands();
        this._buildDOM();
        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_COMMAND_PALETTE, () => this.toggle());
    }

    _isMobile() {
        return this.appContext.uiManager?.isMobile?.() ?? false;
    }

    _openPanel(panelName) {
        EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName, show: true });
    }

    _openPopout(popoutName) {
        EventBus.dispatch(EVENTS.COMMAND_TOGGLE_POPOUT, { popoutName, show: true });
    }

    /**
     * The curated command registry. `hint` mirrors the matching keyboard shortcut
     * (documentation only — the shortcut itself lives in KeyboardShortcutManager).
     * @private
     */
    _buildCommands() {
        const dispatch = (name, payload) => () => EventBus.dispatch(name, payload);
        const toast = (msg) => EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: msg });

        return [
            // ---- Create ----
            { title: 'Surprise me', subtitle: 'New random rule on all worlds, then play', category: 'Create', icon: ICONS.wand, run: () => {
                EventBus.dispatch(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, { bias: Math.random(), generationMode: 'r_sym', applyScope: 'all', shouldReset: true });
                EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, false);
                toast('✨ Surprise! New random rule on all worlds.');
            } },
            { title: 'Generate ruleset', category: 'Create', hint: 'G', icon: ICONS.sparkles, run: () => { dispatch(EVENTS.COMMAND_EXECUTE_GENERATE_RULESET)(); toast('Generated new ruleset'); } },
            { title: 'Mutate ruleset', category: 'Create', hint: 'Shift+M', icon: ICONS.shuffle, run: () => { dispatch(EVENTS.COMMAND_EXECUTE_MUTATE_RULESET)(); toast('Mutated ruleset'); } },
            { title: 'Clone ruleset to all worlds', category: 'Create', hint: 'O', icon: ICONS.copy, run: () => { dispatch(EVENTS.COMMAND_CLONE_RULESET)(); toast('Cloned ruleset to all worlds'); } },
            { title: 'Clone & mutate others', category: 'Create', hint: 'M', icon: ICONS.copyPlus, run: () => { dispatch(EVENTS.COMMAND_EXECUTE_CLONE_AND_MUTATE)(); toast('Cloned & mutated others'); } },
            { title: 'Invert ruleset', category: 'Create', hint: 'I', icon: ICONS.refreshCw, run: () => { dispatch(EVENTS.COMMAND_INVERT_RULESET)(); toast('Ruleset inverted'); } },
            { title: 'Breed offspring from parents', category: 'Create', hint: 'Shift+B', icon: ICONS.sparkles, run: dispatch(EVENTS.COMMAND_EXECUTE_BREED_WORLDS) },

            // ---- Simulate ----
            { title: 'Play / Pause', category: 'Simulate', hint: 'Space', icon: ICONS.play, run: dispatch(EVENTS.COMMAND_TOGGLE_PAUSE) },
            { title: 'Reset all worlds', category: 'Simulate', hint: 'R', icon: ICONS.refreshCw, run: () => { dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES)(); toast('Reset all worlds'); } },
            { title: 'Reset selected world', category: 'Simulate', hint: 'Shift+R', icon: ICONS.rotateCcw, run: () => { dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, { scope: 'selected' })(); toast('Reset selected world'); } },
            { title: 'Clear all worlds', category: 'Simulate', hint: 'C', icon: ICONS.trash, run: () => { dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'all' })(); toast('Cleared all worlds'); } },
            { title: 'Clear selected world', category: 'Simulate', hint: 'Shift+C', icon: ICONS.eraser, run: () => { dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'selected' })(); toast('Cleared selected world'); } },

            // ---- Saved starts ---- (the handler owns the toast, so these just dispatch)
            { title: 'Capture saved start', subtitle: "Freeze these cells and use them for this world's resets", category: 'Simulate', hint: 'T', icon: ICONS.save, run: dispatch(EVENTS.COMMAND_CAPTURE_STATE_TO_LIBRARY, { assignScope: 'selected' }) },
            { title: 'Capture saved start → all worlds', subtitle: 'Same starting cells everywhere — then press R to compare rulesets', category: 'Simulate', hint: 'Shift+T', icon: ICONS.save, run: dispatch(EVENTS.COMMAND_CAPTURE_STATE_TO_LIBRARY, { assignScope: 'all' }) },
            { title: 'Manage saved starts', subtitle: "Browse, rename, import or export the start library", category: 'Simulate', icon: ICONS.library, run: () => {
                const wm = this.appContext.worldManager;
                const worldIndex = wm.getSelectedWorldIndex();
                const current = wm.getWorldSettingsForUI()[worldIndex]?.initialState;
                // Open on the Saved tab: keep the world's own entry selected if it already uses one.
                EventBus.dispatch(EVENTS.COMMAND_SHOW_INITIAL_STATE_MODAL, {
                    worldIndex,
                    config: current?.mode === 'saved' ? current : { mode: 'saved', params: {} },
                });
            } },

            // ---- Open ----
            { title: 'Generate & Mutate panel', category: 'Open', hint: 'N', icon: ICONS.sparkles, run: () => this._openPanel('rulesetactions') },
            { title: 'Ruleset Library', category: 'Open', icon: ICONS.library, run: () => this._openPanel('library') },
            { title: 'Ruleset Editor', category: 'Open', hint: 'E', icon: ICONS.pencil, run: () => this._openPanel('ruleset') },
            { title: 'World Setup', category: 'Open', hint: 'S', icon: ICONS.globe, run: () => this._openPanel('worldsetup') },
            { title: 'Auto-Explore', category: 'Open', icon: ICONS.compass, run: () => this._openPanel('explore') },
            { title: 'Analysis', category: 'Open', hint: 'A', icon: ICONS.chartLine, run: () => this._openPanel('analysis') },
            { title: 'Rule Usage ranking', category: 'Open', icon: ICONS.trophy, run: () => this._openPanel('rulerank') },
            { title: 'Patterns', category: 'Open', icon: ICONS.shapes, run: () => this._openPopout('patterns') },
            { title: 'Speed & Brush controls', category: 'Open', icon: ICONS.sliders, run: () => this._openPopout('controls') },
            { title: 'Reset / Clear', category: 'Open', icon: ICONS.rotateCcw, run: () => this._openPopout('resetClear') },

            // ---- Capture & app ----
            { title: 'Save world state', category: 'Capture', icon: ICONS.save, run: dispatch(EVENTS.COMMAND_SAVE_SELECTED_WORLD_STATE) },
            { title: 'Snapshots panel', subtitle: 'Save, load & manage saved starts', category: 'Capture', icon: ICONS.folderOpen, run: () => this._openPanel('snapshots') },
            { title: 'Open Capture Studio', category: 'Capture', icon: ICONS.camera, run: dispatch(EVENTS.COMMAND_SHOW_CAPTURE_STUDIO, { tab: 'screenshot' }) },
            { title: 'Quick screenshot (PNG, selected world)', category: 'Capture', icon: ICONS.camera, run: dispatch(EVENTS.COMMAND_EXPORT_WORLD_PNG) },
            { title: 'Record / stop video', category: 'Capture', icon: ICONS.video, run: dispatch(EVENTS.COMMAND_TOGGLE_WORLD_RECORDING) },
            { title: 'Share setup link', category: 'Capture', icon: ICONS.share, run: () => { this._openPopout('share'); EventBus.dispatch(EVENTS.COMMAND_SHARE_SETUP); } },
            { title: 'Copy world code', subtitle: 'Exact grid, ruleset, cells & colors — the Reddit post payload', category: 'Capture', icon: ICONS.share, run: dispatch(EVENTS.COMMAND_COPY_WORLD_CODE) },
            { title: 'Post to r/hexlife', subtitle: 'Open Reddit submit with this world (must be logged in)', category: 'Capture', icon: ICONS.share, run: dispatch(EVENTS.COMMAND_POST_TO_REDDIT) },
            { title: 'Colors (Chroma Lab)', category: 'Capture', icon: ICONS.palette, run: () => this._openPanel('chromalab') },
            { title: 'Settings / preferences', category: 'Capture', icon: ICONS.cog, run: () => this._openPanel('settings') },
            { title: 'Keyboard shortcuts', category: 'Capture', icon: ICONS.keyboard, run: () => this._openPanel('shortcuts') },
            { title: 'Learning Hub', category: 'Capture', icon: ICONS.graduationCap, run: () => this._openPanel('learning') },
        ];
    }

    _buildDOM() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'command-palette-overlay hidden';
        this.overlay.setAttribute('role', 'dialog');
        this.overlay.setAttribute('aria-modal', 'true');
        this.overlay.setAttribute('aria-label', 'Command palette');
        this.overlay.innerHTML = `
            <div class="command-palette-box">
                <div class="command-palette-input-row">
                    <span class="command-palette-leading" aria-hidden="true">${ICONS.command}</span>
                    <input type="text" class="command-palette-input" placeholder="Type a command… (e.g. generate, explore, clear)" aria-label="Search commands" autocomplete="off" spellcheck="false" />
                </div>
                <ul class="command-palette-list" role="listbox"></ul>
                <div class="command-palette-footer">
                    <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
                    <span><kbd>↵</kbd> run</span>
                    <span><kbd>esc</kbd> close</span>
                </div>
            </div>`;
        document.body.appendChild(this.overlay);

        this.input = this.overlay.querySelector('.command-palette-input');
        this.list = this.overlay.querySelector('.command-palette-list');

        this.overlay.addEventListener('mousedown', (e) => {
            if (e.target === this.overlay) this.hide();
        });
        this.input.addEventListener('input', () => { this.activeIndex = 0; this._renderList(); });
        this.input.addEventListener('keydown', (e) => this._onKeydown(e));
        // Clicks on rows are wired during render.
    }

    toggle() { this.isOpen ? this.hide() : this.show(); }

    show() {
        if (this.isOpen || this._isMobile()) return;
        this.isOpen = true;
        this.activeIndex = 0;
        this.input.value = '';
        this.overlay.classList.remove('hidden');
        this._renderList();
        // Focus after the paint so the caret lands reliably.
        requestAnimationFrame(() => this.input.focus());
    }

    hide() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.overlay.classList.add('hidden');
    }

    _filter(query) {
        const q = query.trim().toLowerCase();
        if (!q) return this.commands;
        // Ordered-subsequence match over "title category subtitle" — forgiving of typos
        // and word order, the usual command-palette feel.
        const matches = (cmd) => {
            const hay = `${cmd.title} ${cmd.category} ${cmd.subtitle || ''}`.toLowerCase();
            let i = 0;
            for (const ch of q) {
                i = hay.indexOf(ch, i);
                if (i === -1) return false;
                i += 1;
            }
            return true;
        };
        return this.commands.filter(matches);
    }

    _renderList() {
        this.filtered = this._filter(this.input.value);
        if (this.activeIndex >= this.filtered.length) this.activeIndex = Math.max(0, this.filtered.length - 1);

        this.list.innerHTML = '';
        if (this.filtered.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'command-palette-empty';
            empty.textContent = 'No matching commands';
            this.list.appendChild(empty);
            return;
        }

        this.filtered.forEach((cmd, i) => {
            const li = document.createElement('li');
            li.className = 'command-palette-item' + (i === this.activeIndex ? ' is-active' : '');
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', i === this.activeIndex ? 'true' : 'false');
            li.innerHTML = `
                <span class="cp-icon" aria-hidden="true">${cmd.icon || ''}</span>
                <span class="cp-text">
                    <span class="cp-title">${cmd.title}</span>
                    ${cmd.subtitle ? `<span class="cp-sub">${cmd.subtitle}</span>` : ''}
                </span>
                <span class="cp-meta">
                    <span class="cp-cat">${cmd.category}</span>
                    ${cmd.hint ? `<kbd class="cp-hint">${cmd.hint}</kbd>` : ''}
                </span>`;
            li.addEventListener('mousemove', () => { if (this.activeIndex !== i) { this.activeIndex = i; this._syncActive(); } });
            li.addEventListener('click', () => { this.activeIndex = i; this._runActive(); });
            this.list.appendChild(li);
        });
    }

    _syncActive() {
        const items = this.list.querySelectorAll('.command-palette-item');
        items.forEach((el, i) => {
            const on = i === this.activeIndex;
            el.classList.toggle('is-active', on);
            el.setAttribute('aria-selected', on ? 'true' : 'false');
            if (on) el.scrollIntoView({ block: 'nearest' });
        });
    }

    _move(delta) {
        if (this.filtered.length === 0) return;
        this.activeIndex = (this.activeIndex + delta + this.filtered.length) % this.filtered.length;
        this._syncActive();
    }

    _runActive() {
        const cmd = this.filtered[this.activeIndex];
        if (!cmd) return;
        this.hide();
        // Defer so the palette is fully torn down before a command opens a panel
        // (avoids the just-closed palette swallowing the new view's focus).
        requestAnimationFrame(() => { try { cmd.run(); } catch (err) { console.error('Command palette action failed:', err); } });
    }

    _onKeydown(e) {
        if (e.key === 'Escape') { e.preventDefault(); this.hide(); return; }
        if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.hide(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); this._move(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); this._move(-1); return; }
        if (e.key === 'Enter') { e.preventDefault(); this._runActive(); return; }
    }

    destroy() {
        this.overlay?.remove();
    }
}
