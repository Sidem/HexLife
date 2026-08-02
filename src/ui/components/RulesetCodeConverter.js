import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { parseRulesetInput, rulesetToCode, RULESET_CODE_SPEC } from '../../core/rulesetCode.js';
import { describeRuleset, CONSTRAINT_CLASS_META } from '../../core/rulesetDescriptor.js';

/**
 * The Library panel's "Direct" pane: set a ruleset from a code, and convert between every way of
 * writing one.
 *
 * Replaces the old paste-a-32-char-hex box. The field accepts all three notations the app
 * understands — full hex, a constraint-aware short code (`T21` / `N080C` / `M1000D08` / `R3000081`),
 * or `B…/S…` — and shows the others live as you type, so this doubles as the conversion table.
 * The 32-char hex stays the identity: it is the row we set from and the one everything else stores.
 */
export class RulesetCodeConverter extends BaseComponent {
    constructor(mountPoint, appContext, options = {}) {
        super(mountPoint, options);
        this.appContext = appContext;
        /** Last successful parse, so Set doesn't re-parse and can't disagree with the readout. */
        this.parsed = null;
        this.render();
        this._loadCurrent();
    }

    render() {
        this.element = document.createElement('div');
        this.element.className = 'ruleset-converter';

        const inputId = 'ruleset-direct-input-field';
        this.element.innerHTML = `
            <div class="ruleset-field">
                <label class="ruleset-field-label" for="${inputId}">Ruleset code — hex, short code or B/S</label>
                <input type="text" id="${inputId}" class="hex-input" placeholder="R3000081, B2/S35, or 32-char hex"
                    autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
                <p class="converter-status" role="status" aria-live="polite"></p>
            </div>
            <button class="ruleset-primary-action" data-action="set-hex">Set ruleset</button>
            <div class="ruleset-secondary-actions">
                <button class="button" data-action="use-current">Use current</button>
                <button class="button" data-action="copy-hex">Copy hex</button>
            </div>
            <div class="converter-table">
                ${this._rowHtml('hex', 'Full hex', 'Always valid — the identity every share link and save uses.')}
                ${this._rowHtml('code', 'Short code', 'The shortest form this rule’s structure allows.')}
                ${this._rowHtml('notation', 'B/S notation', 'Birth and survival arrangements, when the rule has rotational symmetry.')}
            </div>
            <div class="converter-explain"></div>
        `;
        this.mountPoint.appendChild(this.element);

        this.inputElement = this.element.querySelector(`#${inputId}`);
        this.statusElement = this.element.querySelector('.converter-status');
        this.explainElement = this.element.querySelector('.converter-explain');
        this.setButton = this.element.querySelector('[data-action="set-hex"]');
        this.rows = {
            hex: this.element.querySelector('[data-row="hex"]'),
            code: this.element.querySelector('[data-row="code"]'),
            notation: this.element.querySelector('[data-row="notation"]'),
        };

        this._attachEventListeners();
    }

    /** One conversion row: label, monospace value, copy button. */
    _rowHtml(key, label, title) {
        return `
            <div class="converter-row" data-row="${key}">
                <span class="converter-row-label" title="${this._escapeAttr(title)}">${label}</span>
                <code class="converter-row-value">—</code>
                <button class="button-icon converter-copy" data-copy="${key}" title="Copy ${label}" aria-label="Copy ${label}">⧉</button>
            </div>
        `;
    }

    _attachEventListeners() {
        this._addDOMListener(this.inputElement, 'input', this._refresh);
        this._addDOMListener(this.inputElement, 'keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this._handleSet();
            }
        });
        this._addDOMListener(this.element, 'click', this._handleClick);

        // Mirror the selected world while the user is not mid-edit, so the pane opens on something
        // real and stays a live readout of the current rule.
        this._subscribeToEvent(EVENTS.RULESET_CHANGED, this._loadCurrentIfIdle);
        this._subscribeToEvent(EVENTS.SELECTED_WORLD_CHANGED, this._loadCurrentIfIdle);
    }

    _handleClick = (e) => {
        const copyKey = e.target.closest('[data-copy]')?.dataset.copy;
        if (copyKey) {
            this._copyRow(copyKey, e.target.closest('[data-copy]'));
            return;
        }
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'set-hex') this._handleSet();
        else if (action === 'use-current') this._loadCurrent();
        else if (action === 'copy-hex') this._copyRow('hex', e.target.closest('[data-action]'));
    };

    _currentHex() {
        const hex = this.appContext.worldManager.getCurrentRulesetHex();
        return hex && hex !== 'Error' && hex !== 'N/A' ? hex : '';
    }

    _loadCurrent = () => {
        this.inputElement.value = this._currentHex();
        this._refresh();
    };

    _loadCurrentIfIdle = () => {
        if (document.activeElement === this.inputElement) return;
        this._loadCurrent();
    };

    /** Re-parse the field and repaint every derived row. Cheap enough to run per keystroke. */
    _refresh = () => {
        const raw = this.inputElement.value.trim();
        this.parsed = raw ? parseRulesetInput(raw) : null;

        this.element.classList.toggle('is-invalid', !!raw && !this.parsed);
        this.setButton.disabled = !this.parsed;

        if (!raw) {
            this._setStatus('Paste or type a ruleset in any of the three forms below.', 'hint');
            this._paintRows(null);
            this.explainElement.innerHTML = '';
            return;
        }
        if (!this.parsed) {
            this._setStatus(this._rejectionReason(raw), 'error');
            this._paintRows(null);
            this.explainElement.innerHTML = '';
            return;
        }

        const described = describeRuleset(this.parsed.hex);
        const FORMAT_NAMES = { hex: 'full hex', code: 'short code', notation: 'B/S notation' };
        this._setStatus(`Read as ${FORMAT_NAMES[this.parsed.format]}.`, 'ok');
        this._paintRows(described);
        this.explainElement.innerHTML = this._explanationHtml(described);
    };

    /**
     * Why an input was refused. Specific beats "invalid" — the three grammars fail in different,
     * fixable ways, and a user who typed a truncated hex needs to hear about length, not syntax.
     */
    _rejectionReason(raw) {
        const upper = raw.toUpperCase();
        const spec = RULESET_CODE_SPEC[upper[0]];
        if (spec) {
            const body = upper.slice(1);
            if (body.length !== spec.chars) {
                return `${upper[0]} codes are ${upper[0]} plus ${spec.chars} hex digits (${spec.chars + 1} characters).`;
            }
            if (!/^[0-9A-F]+$/.test(body)) return `${upper[0]} codes take hex digits only after the tag.`;
            return `That ${upper[0]} code is out of range — it uses only ${spec.bits} bits.`;
        }
        if (/^[0-9A-F]+$/.test(upper)) {
            return `Hex codes are exactly 32 characters — that is ${upper.length}.`;
        }
        if (/^[bs]/i.test(raw)) {
            return "B/S notation looks like B2/S35 or B2o2m/S3m'. Arrangements are o, m and p.";
        }
        return 'Not a ruleset — expected a 32-character hex, a short code, or B/S notation.';
    }

    _setStatus(text, kind) {
        this.statusElement.textContent = text;
        this.statusElement.className = `converter-status is-${kind}`;
    }

    /**
     * Fill the three conversion rows. `notation` is genuinely absent for a `free` rule — there is no
     * B/S string for a table whose outputs differ between rotations, and inventing one would lie.
     */
    _paintRows(described) {
        const values = described
            ? { hex: described.hex, code: rulesetToCode(described.hex), notation: described.notation }
            : { hex: null, code: null, notation: null };

        for (const [key, row] of Object.entries(this.rows)) {
            const value = values[key];
            const valueEl = row.querySelector('.converter-row-value');
            const copyEl = row.querySelector('.converter-copy');
            const isSame = value && key === 'code' && value === values.hex;
            valueEl.textContent = value || '—';
            // A `free` rule's short code IS its hex; say so rather than repeating 32 characters.
            row.classList.toggle('is-empty', !value);
            row.classList.toggle('is-redundant', !!isSame);
            if (isSame) valueEl.textContent = 'same as full hex (no structure to exploit)';
            copyEl.disabled = !value || !!isSame;
        }
    }

    /** Class badge, the descriptor's own summary, and the arrangement legend when it applies. */
    _explanationHtml(described) {
        const meta = CONSTRAINT_CLASS_META[described.constraintClass];
        const parts = [
            `<div class="converter-explain-head">
                <span class="constraint-badge constraint-${described.constraintClass}">${this._escape(meta.label)}</span>
                <span class="converter-explain-class">${this._escape(meta.description)}</span>
            </div>`,
            `<p class="converter-explain-summary">${this._escape(described.summary)}</p>`,
        ];

        const notation = described.notation || '';
        if (/[omp]/.test(notation)) {
            parts.push(`<p class="converter-legend">
                <strong>o</strong> = adjacent · <strong>m</strong> = one apart · <strong>p</strong> = opposite
                — this rule cares how neighbours are arranged, not just how many.
            </p>`);
        }
        if (notation.includes("3m'")) {
            parts.push(`<p class="converter-legend">
                <strong>3m′</strong> is the mirror image of <strong>3m</strong>: the only pair of hex
                arrangements that a reflection cannot map onto each other. Treating them differently is
                exactly what makes this rule R-sym rather than D-sym — it can tell left from right.
            </p>`);
        }
        if (described.constraintClass === 'totalistic') {
            parts.push(`<p class="converter-legend">
                Totalistic rules do not even distinguish the centre cell from its neighbours — only the
                total number of live cells matters, which is why 8 bits are enough.
            </p>`);
        }
        return parts.join('');
    }

    _handleSet = () => {
        if (!this.parsed) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                message: 'Enter a 32-character hex, a short code, or B/S notation.',
                type: 'error',
            });
            this.inputElement.select();
            return;
        }
        EventBus.dispatch(EVENTS.COMMAND_SET_RULESET, {
            hexString: this.parsed.hex,
            scope: this.appContext.rulesetActionController.getGenScope(),
            resetOnNewRule: this.appContext.rulesetActionController.getGenAutoReset(),
        });
        this.inputElement.blur();
        EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
    };

    _copyRow(key, button) {
        const row = this.rows[key];
        const value = row && !row.classList.contains('is-empty') && !row.classList.contains('is-redundant')
            ? row.querySelector('.converter-row-value').textContent
            : '';
        if (!value) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Nothing to copy.', type: 'error' });
            return;
        }
        navigator.clipboard.writeText(value).then(() => {
            if (!button) return;
            const old = button.textContent;
            button.textContent = '✓';
            setTimeout(() => { button.textContent = old; }, 1200);
        }).catch(() => EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
            message: 'Failed to copy to clipboard.', type: 'error',
        }));
    }

    _escape(str) {
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    _escapeAttr(str) {
        return String(str).replace(/"/g, '&quot;');
    }
}
