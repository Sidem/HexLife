import { SliderComponent } from './SliderComponent.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import {
    WEIGHT_KEYS, SCORING_PRESETS, DEFAULT_FIND_THRESHOLD,
    FIND_THRESHOLD_MIN, FIND_THRESHOLD_MAX,
    sanitizeScoring, detectPreset,
} from '../../core/analysis/ScoringPresets.js';
import { refitWeights, MIN_VOTES_FOR_REFIT } from '../../core/analysis/WeightRefit.js';
import { COMPONENT_META, UNIFORM_FACTOR_META, renderTermExplainer } from './scoringTermMeta.js';

const SETTING_KEY = 'exploreScoring';

/**
 * The Scoring section of the Explore panel (v3.1): user-customizable interestingness objective.
 * Owns the persisted `exploreScoring` setting — one relative-weight slider per graded term, the
 * uniform-chaos penalty strength, and the advanced find threshold — plus a preset dropdown and a
 * per-row ⓘ explainer (plain-language description, slider semantics, and the term's actual score
 * curve with a marker at the best find's measured value).
 *
 * Weights are RELATIVE 0–100 (the score renormalizes), so only ratios matter; the explainers say so.
 */
export class ExploreScoringPanel {
    /**
     * @param {HTMLElement} mountPoint
     * @param {{onChange?: (scoring: object, presetKey: string) => void,
     *   voteBank?: import('../../core/analysis/VoteBank.js').VoteBank|null}} [opts] `onChange` fires
     *   after every persisted change (slider, preset, reset) with the sanitized scoring + preset key.
     *   `voteBank` (§S3) enables the "Refit from my votes" affordance.
     */
    constructor(mountPoint, { onChange = null, voteBank = null } = {}) {
        this.mount = mountPoint;
        this.onChange = onChange;
        this.voteBank = voteBank;
        this.scoring = sanitizeScoring(PersistenceService.loadUISetting(SETTING_KEY, null));
        /** @type {Record<string, SliderComponent>} */
        this.sliders = {};
        /** Raw metric inputs used for explainer curve markers (best find / last measurement). */
        this._markerRaw = null;
        this._render();
    }

    /** The current sanitized scoring settings (for the COMMAND_START_AUTO_EXPLORE payload). */
    getScoring() {
        return {
            weights: { ...this.scoring.weights },
            uniformPenaltyPct: this.scoring.uniformPenaltyPct,
            findThreshold: this.scoring.findThreshold,
        };
    }

    /** Preset key matching the current settings, or 'custom'. */
    getPresetKey() {
        return detectPreset(this.scoring);
    }

    /** Grey out every control while a search is running (settings are read at Start). */
    setDisabled(disabled) {
        this._disabled = !!disabled;
        this.mount.classList.toggle('disabled', !!disabled);
        for (const s of Object.values(this.sliders)) s.setDisabled(!!disabled);
        if (this.presetSelect) this.presetSelect.disabled = !!disabled;
        if (this.resetBtn) this.resetBtn.disabled = !!disabled;
        this.refreshRefit();
    }

    /**
     * Refresh the "Refit from my votes (N)" affordance from the current vote bank (§S3). Called on
     * mount, whenever a vote is recorded (VOTE_RECORDED), and on enable/disable. No-op without a bank.
     */
    refreshRefit() {
        if (!this.voteBank) return;
        const decisive = this.voteBank.getDecisiveCount();
        const countEl = this.mount.querySelector('[data-field="refit-count"]');
        if (countEl) countEl.textContent = String(decisive);
        const enough = decisive >= MIN_VOTES_FOR_REFIT && !this._disabled;
        const btn = this.mount.querySelector('[data-action="refit"]');
        if (btn) btn.disabled = !enough;
        const hint = this.mount.querySelector('[data-field="refit-hint"]');
        if (hint) {
            hint.textContent = decisive >= MIN_VOTES_FOR_REFIT
                ? ''
                : `Rate at least ${MIN_VOTES_FOR_REFIT} pairs to refit (you have ${decisive}).`;
        }
    }

    /** Compute a fit from the banked votes and show a before/after comparison (§S3). */
    _runRefit() {
        const box = this.mount.querySelector('[data-field="refit-result"]');
        if (!this.voteBank || !box) return;
        const res = refitWeights(this.voteBank.getVotes());
        this._lastRefit = res;
        box.hidden = false;
        if (!res.ok) {
            const msg = res.reason === 'not-enough-votes'
                ? `Rate at least ${MIN_VOTES_FOR_REFIT} pairs first — you have ${res.nUsed}.`
                : 'Your votes don\'t yet separate the signals cleanly. Rate a few more pairs (more decisively) and try again.';
            box.innerHTML = `<p class="explore-scoring-refit-msg">${msg}</p>`;
            return;
        }
        const rows = COMPONENT_META.map(({ key, label }) => {
            const before = this.scoring.weights[key] ?? 0;
            const after = res.weightsPct[key] ?? 0;
            const changed = before !== after ? ' explore-scoring-refit-changed' : '';
            return `
                <div class="explore-scoring-refit-trow${changed}">
                    <span class="explore-scoring-refit-tlabel">${label}</span>
                    <span class="explore-scoring-refit-tbefore">${before}</span>
                    <span class="explore-scoring-refit-tarrow">→</span>
                    <span class="explore-scoring-refit-tafter">${after}</span>
                </div>`;
        }).join('');
        box.innerHTML = `
            <p class="explore-scoring-refit-summary">Fitted from <strong>${res.nUsed}</strong> votes · agrees with ${Math.round(res.accuracy * 100)}% of them. Relative weights (0–100):</p>
            <div class="explore-scoring-refit-table">
                <div class="explore-scoring-refit-trow explore-scoring-refit-thead">
                    <span class="explore-scoring-refit-tlabel">Term</span>
                    <span class="explore-scoring-refit-tbefore">Now</span>
                    <span class="explore-scoring-refit-tarrow"></span>
                    <span class="explore-scoring-refit-tafter">Fitted</span>
                </div>
                ${rows}
            </div>
            <div class="explore-scoring-refit-apply-row">
                <button type="button" class="button action-button" data-action="apply-refit">Apply as my objective</button>
            </div>`;
    }

    /** Apply the last computed fit to the weight sliders (an explicit, reversible user action, §S3). */
    _applyRefit() {
        if (!this._lastRefit || !this._lastRefit.ok) return;
        const pct = this._lastRefit.weightsPct;
        for (const k of WEIGHT_KEYS) {
            const v = Math.max(0, Math.min(100, Math.round(Number(pct[k]) || 0)));
            this.scoring.weights[k] = v;
            this.sliders[k]?.setValue(v);
        }
        this.mount.classList.remove('all-zero');
        this._persistAndNotify();
        const box = this.mount.querySelector('[data-field="refit-result"]');
        if (box) {
            const date = new Date().toISOString().slice(0, 10);
            box.innerHTML = `<p class="explore-scoring-refit-msg explore-scoring-refit-applied">Applied — Personal objective (fit from ${this._lastRefit.nUsed} votes, ${date}). Reselect a stock preset to revert.</p>`;
        }
    }

    /**
     * Feed raw metric inputs (an ICScore.raw / gallery rawMetrics object) into the explainer curve
     * markers. Open explainers re-render immediately; closed ones pick it up on open.
     * @param {object|null} raw
     */
    setMarkers(raw) {
        this._markerRaw = raw || null;
        for (const row of this.mount.querySelectorAll('.explore-scoring-row.explainer-open')) {
            this._fillExplainer(row);
        }
    }

    destroy() {
        for (const s of Object.values(this.sliders)) s.destroy?.();
        this.sliders = {};
        this.mount.innerHTML = '';
    }

    // --- internals -----------------------------------------------------------

    _render() {
        const presetOptions = Object.entries(SCORING_PRESETS)
            .map(([key, p]) => `<option value="${key}">${p.label}</option>`)
            .join('');
        this.mount.innerHTML = `
            <p class="explore-scoring-blurb">
                What should count as "interesting"? Each term below is a signal measured during a
                candidate's evaluation burst; the score is their <strong>weighted average</strong>
                (weights are relative — only the ratios matter). Tap <span class="explore-scoring-info-glyph">ⓘ</span>
                on a term to see what it measures and the exact curve that turns the measurement into
                a 0–1 term score.
            </p>
            <div class="explore-scoring-preset-row">
                <label class="explore-field-label" for="explore-scoring-preset">Preset</label>
                <select id="explore-scoring-preset" class="explore-scoring-preset">
                    ${presetOptions}
                    <option value="custom" disabled>Custom</option>
                </select>
                <button type="button" class="button explore-scoring-reset" title="Reset weights, penalty and threshold to the tuned defaults">Reset</button>
            </div>
            <p class="explore-scoring-preset-desc" data-field="preset-desc"></p>
            <div class="explore-scoring-rows" data-field="weights"></div>
            <div class="explore-scoring-row" data-term="uniformPenalty">
                <div class="explore-scoring-slider-mount"></div>
                <button type="button" class="button-icon explore-scoring-info" data-term-info aria-label="Explain the uniform-chaos penalty" aria-expanded="false">ⓘ</button>
                <div class="explore-scoring-explainer" hidden></div>
            </div>
            <div class="explore-scoring-advanced">
                <h6 class="explore-scoring-advanced-title">Advanced</h6>
                <div class="explore-scoring-row" data-term="findThreshold">
                    <div class="explore-scoring-slider-mount"></div>
                    <button type="button" class="button-icon explore-scoring-info" data-term-info aria-label="Explain the find threshold" aria-expanded="false">ⓘ</button>
                    <div class="explore-scoring-explainer" hidden></div>
                </div>
            </div>
            ${this.voteBank ? `
            <div class="explore-scoring-refit" data-field="refit">
                <h6 class="explore-scoring-advanced-title">Personalize from your votes</h6>
                <p class="explore-scoring-refit-blurb">Rate finds head-to-head (the balance-scale button on the Gallery) to teach the objective what <em>you</em> find interesting, then refit these weights from your votes. Applying the fit becomes a "Custom" preset — reselect a stock preset to undo it.</p>
                <div class="explore-scoring-refit-row">
                    <button type="button" class="button explore-scoring-refit-btn" data-action="refit">Refit from my votes (<span data-field="refit-count">0</span>)</button>
                    <span class="explore-scoring-refit-hint" data-field="refit-hint"></span>
                </div>
                <div class="explore-scoring-refit-result" data-field="refit-result" hidden></div>
            </div>` : ''}
        `;

        this.presetSelect = this.mount.querySelector('#explore-scoring-preset');
        this.resetBtn = this.mount.querySelector('.explore-scoring-reset');
        const weightsHost = this.mount.querySelector('[data-field="weights"]');

        for (const meta of COMPONENT_META) {
            const row = document.createElement('div');
            row.className = 'explore-scoring-row';
            row.dataset.term = meta.key;
            row.innerHTML = `
                <div class="explore-scoring-slider-mount"></div>
                <button type="button" class="button-icon explore-scoring-info" data-term-info aria-label="Explain the ${meta.label} term" aria-expanded="false">ⓘ</button>
                <div class="explore-scoring-explainer" hidden></div>
            `;
            weightsHost.appendChild(row);
            this.sliders[meta.key] = new SliderComponent(row.querySelector('.explore-scoring-slider-mount'), {
                id: `explore-weight-${meta.key}`,
                label: `${meta.label}:`,
                min: 0, max: 100, step: 1,
                value: this.scoring.weights[meta.key],
                showValue: true,
                onChange: (v) => this._onWeightChange(meta.key, v),
            });
        }

        const penaltyRow = this.mount.querySelector('[data-term="uniformPenalty"]');
        this.sliders.uniformPenalty = new SliderComponent(penaltyRow.querySelector('.explore-scoring-slider-mount'), {
            id: 'explore-uniform-penalty',
            label: 'Chaos penalty:',
            min: 0, max: 100, step: 1, unit: '%',
            value: this.scoring.uniformPenaltyPct,
            showValue: true,
            onChange: (v) => {
                this.scoring.uniformPenaltyPct = v;
                this._persistAndNotify();
            },
        });

        const thresholdRow = this.mount.querySelector('[data-term="findThreshold"]');
        this.sliders.findThreshold = new SliderComponent(thresholdRow.querySelector('.explore-scoring-slider-mount'), {
            id: 'explore-find-threshold',
            label: 'Find threshold:',
            min: FIND_THRESHOLD_MIN, max: FIND_THRESHOLD_MAX, step: 0.05,
            value: this.scoring.findThreshold,
            showValue: true,
            onChange: (v) => {
                this.scoring.findThreshold = v;
                this._persistAndNotify();
            },
        });

        this.presetSelect.addEventListener('change', () => this._applyPreset(this.presetSelect.value));
        this.resetBtn.addEventListener('click', () => {
            this._applyPreset('default', { resetThreshold: true });
        });
        this.mount.addEventListener('click', (e) => {
            const infoBtn = e.target.closest('[data-term-info]');
            if (infoBtn) { this._toggleExplainer(infoBtn.closest('.explore-scoring-row')); return; }
            const actionBtn = e.target.closest('[data-action]');
            if (!actionBtn) return;
            if (actionBtn.dataset.action === 'refit') this._runRefit();
            else if (actionBtn.dataset.action === 'apply-refit') this._applyRefit();
        });

        this._syncPresetSelect();
        this.refreshRefit();
    }

    _onWeightChange(key, value) {
        this.scoring.weights[key] = value;
        if (WEIGHT_KEYS.every((k) => this.scoring.weights[k] === 0)) {
            // All-zero weights would score every candidate 0 (nothing banked); Start guards too,
            // but flag it immediately where the user is looking.
            this.mount.classList.add('all-zero');
        } else {
            this.mount.classList.remove('all-zero');
        }
        this._persistAndNotify();
    }

    _applyPreset(key, { resetThreshold = false } = {}) {
        const preset = SCORING_PRESETS[key];
        if (!preset) return;
        this.scoring.weights = { ...preset.weights };
        this.scoring.uniformPenaltyPct = preset.uniformPenaltyPct;
        if (resetThreshold) this.scoring.findThreshold = DEFAULT_FIND_THRESHOLD;
        for (const k of WEIGHT_KEYS) this.sliders[k].setValue(this.scoring.weights[k]);
        this.sliders.uniformPenalty.setValue(this.scoring.uniformPenaltyPct);
        this.sliders.findThreshold.setValue(this.scoring.findThreshold);
        this.mount.classList.remove('all-zero');
        this._persistAndNotify();
    }

    _persistAndNotify() {
        PersistenceService.saveUISetting(SETTING_KEY, this.getScoring());
        this._syncPresetSelect();
        if (this.onChange) this.onChange(this.getScoring(), this.getPresetKey());
    }

    _syncPresetSelect() {
        const key = this.getPresetKey();
        if (this.presetSelect) this.presetSelect.value = key;
        const descEl = this.mount.querySelector('[data-field="preset-desc"]');
        if (descEl) {
            descEl.textContent = key === 'custom'
                ? 'Custom weighting — your own mix of the signals below.'
                : (SCORING_PRESETS[key]?.description || '');
        }
    }

    _toggleExplainer(row) {
        if (!row) return;
        const box = row.querySelector('.explore-scoring-explainer');
        const btn = row.querySelector('[data-term-info]');
        const open = box.hidden;
        if (open) this._fillExplainer(row);
        box.hidden = !open;
        row.classList.toggle('explainer-open', open);
        if (btn) btn.setAttribute('aria-expanded', String(open));
    }

    _fillExplainer(row) {
        const box = row.querySelector('.explore-scoring-explainer');
        const term = row.dataset.term;
        if (term === 'uniformPenalty') {
            box.innerHTML = renderTermExplainer({ ...UNIFORM_FACTOR_META, shape: null }, null);
            return;
        }
        if (term === 'findThreshold') {
            box.innerHTML = `
                <div class="term-explainer">
                    <p class="term-explainer-desc">A candidate's cheap screening score must reach this threshold before the expensive confirmation burst runs and the find can enter the gallery. Lower = more (and more mediocre) finds; higher = only standouts. NB: custom weights change what scores are reachable — if you max a single term, candidates can score much higher (or lower) than under the defaults, so tune this together with the weights.</p>
                    <div class="term-explainer-minmax">
                        <span><strong>${FIND_THRESHOLD_MIN.toFixed(2)}</strong> — very permissive, the gallery fills fast.</span>
                        <span><strong>${FIND_THRESHOLD_MAX.toFixed(2)}</strong> — only exceptional candidates are confirmed.</span>
                    </div>
                </div>`;
            return;
        }
        const meta = COMPONENT_META.find((m) => m.key === term);
        if (!meta) return;
        const raw = this._markerRaw && this._markerRaw[meta.rawKey] != null ? this._markerRaw[meta.rawKey] : null;
        box.innerHTML = renderTermExplainer(meta, raw);
    }
}
