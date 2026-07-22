import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { constraintBadge } from '../RulesetDisplayFactory.js';

/**
 * DEV-ONLY library curation tool, mounted when the app is opened with `?curate=1`.
 *
 * Many public rulesets only look interesting from a specific starting state. This overlay walks the
 * public library one ruleset at a time, bakes a few candidate initial-condition previews (the same
 * borrow-and-restore engine the live library uses), and lets the author click the one that best shows
 * the rule off. Each pick records the chosen `initialState` + `seed` for that hex; "Copy ruleset JSON"
 * emits the merged `src/core/library/rulesets.json` to paste back into the repo. Picks also pre-warm
 * the public-thumbnail cache so the chosen preview shows up immediately in the normal library.
 *
 * Choices persist in localStorage so curation is resumable across reloads.
 */

const CHOICES_KEY = 'hexLifeExplorer_curationChoices';
const CURATION_TICKS = 160;

// Candidate ICs offered per ruleset. Each carries a fixed seed so the saved seed reproduces the exact
// previewed layout via "Load + IC". Kept deliberately small + diverse (density spread + structured).
const CANDIDATE_ICS = [
    { label: 'chaos', seed: 10001, initialState: { mode: 'density', params: { density: 0.5 } } },
    { label: 'medium', seed: 10002, initialState: { mode: 'density', params: { density: 0.3 } } },
    { label: 'sparse', seed: 10003, initialState: { mode: 'density', params: { density: 0.05 } } },
    { label: 'dense', seed: 10004, initialState: { mode: 'density', params: { density: 0.85 } } },
    {
        label: 'seed', seed: 10005,
        initialState: {
            mode: 'clusters',
            params: {
                count: 1, density: 1.0, densityVariation: 0, diameter: 6, diameterVariation: 0,
                eccentricity: 0, orientation: 0, orientationVariation: 0, gaussianStdDev: 2.0,
            },
        },
    },
    {
        label: 'clusters', seed: 10006,
        initialState: {
            mode: 'clusters',
            params: {
                count: 5, density: 1.0, densityVariation: 0.1, diameter: 8, diameterVariation: 3,
                eccentricity: 0.2, orientation: 0, orientationVariation: 1, gaussianStdDev: 2.0,
            },
        },
    },
    // Inverted seed: a saturated grid with one empty centre cell (DensityStrategy special-cases density 1.0).
    { label: 'inverted', seed: 10007, initialState: { mode: 'density', params: { density: 1.0 } } },
    {
        label: 'scatter', seed: 10008,
        initialState: {
            mode: 'clusters',
            params: {
                count: 30, density: 0.75, densityVariation: 0.2, diameter: 5, diameterVariation: 2,
                eccentricity: 0.2, orientation: 0, orientationVariation: 1.0, gaussianStdDev: 2.5,
            },
        },
    },
    {
        label: 'streaks', seed: 10009,
        initialState: {
            mode: 'clusters',
            params: {
                count: 6, density: 0.8, densityVariation: 0.15, diameter: 22, diameterVariation: 6,
                eccentricity: 0.82, orientation: 30, orientationVariation: 0.6, gaussianStdDev: 2.6,
            },
        },
    },
];

export class LibraryCurationOverlay {
    constructor(appContext) {
        this.appContext = appContext;
        this.wm = appContext.worldManager;
        this.rulesets = (appContext.libraryController.getLibraryData()?.rulesets || []);
        this.choices = this._loadChoices();
        this.index = 0;
        this.bakeToken = 0;
        // In-session memo of baked thumbs: `${hex}|${label}` → dataURL (avoids re-baking on revisit).
        this.thumbMemo = new Map();
        this._render();
        this._show(this.index);
    }

    _loadChoices() {
        try { return JSON.parse(localStorage.getItem(CHOICES_KEY)) || {}; } catch { return {}; }
    }

    _saveChoices() {
        try { localStorage.setItem(CHOICES_KEY, JSON.stringify(this.choices)); } catch { /* ignore */ }
    }

    _render() {
        this.el = document.createElement('div');
        this.el.className = 'curate-overlay';
        this.el.innerHTML = `
            <div class="curate-panel">
                <header class="curate-head">
                    <h2>IC Curation <span class="curate-progress"></span></h2>
                    <button class="curate-close" title="Close">&times;</button>
                </header>
                <div class="curate-entry-head">
                    <span class="curate-pos"></span>
                    <span class="curate-name"></span>
                    <span class="curate-class"></span>
                    <code class="curate-hex"></code>
                </div>
                <div class="curate-candidates"></div>
                <div class="curate-controls">
                    <button class="button" data-curate="prev">&larr; Prev</button>
                    <button class="button" data-curate="rebake">Re-bake</button>
                    <button class="button" data-curate="none">No IC</button>
                    <button class="button" data-curate="next">Next &rarr;</button>
                </div>
                <footer class="curate-foot">
                    <button class="button curate-export" data-curate="export">Copy ruleset JSON</button>
                    <a class="button curate-download" download="rulesets.json">Download JSON</a>
                    <button class="button" data-curate="clear-all">Reset all picks</button>
                    <span class="curate-status info-text"></span>
                </footer>
                <textarea class="curate-json" readonly></textarea>
            </div>
        `;
        document.body.appendChild(this.el);

        this.ui = {
            progress: this.el.querySelector('.curate-progress'),
            pos: this.el.querySelector('.curate-pos'),
            name: this.el.querySelector('.curate-name'),
            cls: this.el.querySelector('.curate-class'),
            hex: this.el.querySelector('.curate-hex'),
            candidates: this.el.querySelector('.curate-candidates'),
            status: this.el.querySelector('.curate-status'),
            json: this.el.querySelector('.curate-json'),
            download: this.el.querySelector('.curate-download'),
        };

        this.el.addEventListener('click', (e) => this._onClick(e));
        this._keyHandler = (e) => this._onKey(e);
        window.addEventListener('keydown', this._keyHandler);
    }

    _onClick(e) {
        const tile = e.target.closest('[data-cand-index]');
        if (tile) { this._pick(parseInt(tile.dataset.candIndex, 10)); return; }
        const btn = e.target.closest('[data-curate]');
        if (e.target.closest('.curate-close')) { this.destroy(); return; }
        if (!btn) return;
        switch (btn.dataset.curate) {
            case 'prev': this._show(this.index - 1); break;
            case 'next': this._show(this.index + 1); break;
            case 'rebake': this._bake(true); break;
            case 'none': this._pickNone(); break;
            case 'export': this._export(); break;
            case 'clear-all': this._clearAll(); break;
            default: break;
        }
    }

    _onKey(e) {
        if (e.key === 'ArrowRight') this._show(this.index + 1);
        else if (e.key === 'ArrowLeft') this._show(this.index - 1);
        else if (e.key === 'Escape') this.destroy();
        else if (/^[1-9]$/.test(e.key)) this._pick(parseInt(e.key, 10) - 1);
    }

    _show(i) {
        if (i < 0 || i >= this.rulesets.length) return;
        this.index = i;
        this.bakeToken++; // cancel any in-flight bake for the previous entry
        const rule = this.rulesets[i];
        this.ui.pos.textContent = `${i + 1} / ${this.rulesets.length}`;
        this.ui.name.textContent = rule.name || '(unnamed)';
        // Structural class (roadmap #38), derived from the hex on the fly — never written into the
        // exported JSON. Curation is where the library's class mix is actually shaped, so the curator
        // should see which class they are picking an IC for.
        const badge = constraintBadge(rule.hex);
        this.ui.cls.className = badge ? `curate-class constraint-badge constraint-${badge.cls}` : 'curate-class';
        this.ui.cls.textContent = badge ? badge.label : '';
        this.ui.cls.title = badge ? badge.title : '';
        this.ui.hex.textContent = rule.hex;
        this._updateProgress();
        this._renderCandidates();
        this._bake(false);
    }

    _updateProgress() {
        const picked = Object.keys(this.choices).filter(h => this.choices[h] && this.choices[h].initialState).length;
        this.ui.progress.textContent = `— ${picked}/${this.rulesets.length} picked`;
    }

    _renderCandidates() {
        const rule = this.rulesets[this.index];
        const choice = this.choices[rule.hex];
        const noneSelected = choice && choice.initialState === null;
        const tiles = [
            `<button type="button" class="curate-tile${noneSelected ? ' selected' : ''}" data-cand-index="-1" title="No initial condition">
                <span class="curate-none">&empty;</span><span class="curate-tile-label">None</span>
            </button>`,
        ];
        CANDIDATE_ICS.forEach((c, i) => {
            const memoThumb = this.thumbMemo.get(`${rule.hex}|${c.label}`);
            const isSel = choice && choice.initialState && choice.label === c.label;
            const inner = memoThumb
                ? `<img class="curate-thumb" src="${memoThumb}" alt="" />`
                : `<span class="curate-thumb curate-thumb--pending">…</span>`;
            tiles.push(
                `<button type="button" class="curate-tile${isSel ? ' selected' : ''}" data-cand-index="${i}" title="${c.label} (press ${i + 1})">
                    ${inner}<span class="curate-tile-label">${c.label}</span>
                </button>`
            );
        });
        this.ui.candidates.innerHTML = tiles.join('');
    }

    async _bake(force) {
        const rule = this.rulesets[this.index];
        if (this.wm.autoExploreService?.isRunning?.()) {
            this.ui.status.textContent = 'Stop Auto-Explore to bake previews.';
            return;
        }
        const token = this.bakeToken;
        const jobs = CANDIDATE_ICS
            .filter(c => force || !this.thumbMemo.has(`${rule.hex}|${c.label}`))
            .map(c => ({
                hex: rule.hex,
                initialState: c.initialState,
                seed: c.seed,
                ticks: CURATION_TICKS,
                onResult: (thumb) => {
                    if (token !== this.bakeToken) return; // navigated away
                    if (thumb) this.thumbMemo.set(`${rule.hex}|${c.label}`, thumb);
                    this._renderCandidates();
                },
            }));
        if (jobs.length === 0) return;
        this.ui.status.textContent = 'Baking previews…';
        await this.wm.bakeThumbnails(jobs);
        if (token === this.bakeToken) this.ui.status.textContent = 'Pick the preview that best shows the rule.';
    }

    _pick(candIdx) {
        const rule = this.rulesets[this.index];
        if (candIdx === -1) { this._pickNone(); return; }
        const c = CANDIDATE_ICS[candIdx];
        if (!c) return;
        const thumb = this.thumbMemo.get(`${rule.hex}|${c.label}`) || null;
        this.choices[rule.hex] = { initialState: c.initialState, seed: c.seed, label: c.label };
        this._saveChoices();
        // Pre-warm the public thumbnail cache so the live library shows this preview without re-baking.
        if (thumb) PersistenceService.savePublicThumb(rule.hex, thumb);
        this._updateProgress();
        this._renderCandidates();
        this.ui.status.textContent = `Picked "${c.label}". → Next to continue.`;
    }

    _pickNone() {
        const rule = this.rulesets[this.index];
        this.choices[rule.hex] = { initialState: null, seed: null, label: null };
        this._saveChoices();
        this._updateProgress();
        this._renderCandidates();
    }

    _clearAll() {
        EventBus.dispatch(EVENTS.COMMAND_SHOW_CONFIRMATION, {
            title: 'Reset all curation picks',
            message: 'Discard every IC choice you have made in this session?',
            confirmLabel: 'Reset',
            onConfirm: () => {
                this.choices = {};
                this._saveChoices();
                this._updateProgress();
                this._renderCandidates();
            },
        });
    }

    /** Build the merged rulesets.json (chosen IC + seed folded into matched entries) and copy it. */
    _export() {
        const merged = this.rulesets.map(rule => {
            const choice = this.choices[rule.hex];
            if (!choice || !choice.initialState) {
                // No pick (or an explicit "None"): strip any IC fields so the entry stays ruleset-only.
                const { initialState: _i, seed: _s, ...rest } = rule;
                return rest;
            }
            return { ...rule, initialState: choice.initialState, seed: choice.seed };
        });
        const json = JSON.stringify(merged, null, 2);
        this.ui.json.value = json;
        this.ui.json.classList.add('visible');
        try {
            const blob = new Blob([json], { type: 'application/json' });
            this.ui.download.href = URL.createObjectURL(blob);
        } catch { /* download is a convenience only */ }
        if (navigator.clipboard) {
            navigator.clipboard.writeText(json)
                .then(() => { this.ui.status.textContent = 'rulesets.json copied to clipboard — paste it back to the agent.'; })
                .catch(() => { this.ui.status.textContent = 'Select the text below and copy it.'; });
        } else {
            this.ui.status.textContent = 'Select the text below and copy it.';
        }
    }

    destroy() {
        window.removeEventListener('keydown', this._keyHandler);
        this.el?.remove();
    }
}
