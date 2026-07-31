// @ts-check

/**
 * Public-library submission intake (roadmap #27).
 *
 * The bundled catalog (`src/core/library/rulesets.json`) is curated and committed, so a community
 * addition is a repository change, not a write to a service. This module turns a finished personal
 * entry into a **prefilled GitHub issue** — the shortest honest path from "I found something" to a
 * reviewable proposal, with no backend and no account beyond the GitHub one the PR would need anyway.
 *
 * Why an issue and not a PR: `rulesets.json` is one monolithic array, and GitHub can prefill a *new*
 * file or a blank issue but not an edit to an existing file. The reviewer pastes the entry in.
 *
 * Attribution is deliberately NOT taken from the payload. The submitter says how they want to be
 * credited in the issue form; the reviewer copies that into the entry's `author` field when merging,
 * having seen who actually opened the issue. Client data never assigns credit on its own.
 *
 * PURE (no DOM, EventBus or storage) so vitest covers it directly, like {@link module:services/RedditShareService}.
 */

import { isCanonicalTag, tagLabel } from '../core/tags.js';
import { explorerUrlForRuleset } from '../core/WorldCodec.js';
import { toPublicLibraryEntry } from './LibraryPackCodec.js';

/** Repository that owns the committed catalog. */
export const SUBMISSION_REPO_URL = 'https://github.com/Sidem/HexLife';

/** Issue form the prefill targets — `.github/ISSUE_TEMPLATE/ruleset-submission.yml`. */
export const SUBMISSION_TEMPLATE = 'ruleset-submission.yml';

/**
 * Query-parameter names for the prefill. Each MUST equal an `id` in the issue form, or GitHub
 * silently ignores the value and the user faces an empty form.
 * `tests/librarySubmission.test.js` pins these against the YAML.
 */
export const SUBMISSION_FIELDS = Object.freeze({
    entry: 'entry',
    credit: 'credit',
    link: 'link',
    notes: 'notes',
});

/**
 * Longest prefilled URL we'll hand to `window.open`. GitHub rejects requests whose URL passes its
 * header limit with a 414 and browsers have their own ceilings, so above this the entry rides the
 * clipboard and the form opens empty. A complete entry is ~400–800 chars, so this only trips on
 * something pathological (a giant clusters IC).
 */
export const SUBMISSION_URL_MAX = 6000;

const HEX_RE = /^[0-9a-fA-F]{32}$/;
const NAME_MAX = 80;
const DESC_MIN = 10;
const DESC_MAX = 500;
const TITLE_MAX = 120;
/** How many canonical tag labels to name in the "add a tag" problem line. */
const TAG_HINT_COUNT = 4;

/**
 * @typedef {{
 *   hex?: string,
 *   name?: string,
 *   description?: string,
 *   tags?: string[],
 *   initialState?: {mode?: string, params?: object}|null,
 *   seed?: number|null,
 * }} SubmittableEntry
 */

/**
 * Check a personal entry against the intake bar for the curated catalog. A personal save is allowed
 * to be a bare hex with no metadata; a public entry is not — it has to be findable (name, tags),
 * explicable (description) and replayable (paired IC + seed), and it must not already be in there.
 *
 * Returns problems as finished user-facing sentences so the caller only has to bullet them.
 *
 * @param {SubmittableEntry|null|undefined} entry
 * @param {{publicHexes?: string[]}} [opts] Hexes already in the committed catalog.
 * @returns {{ok: boolean, problems: string[]}}
 */
export function validateSubmission(entry, { publicHexes = [] } = {}) {
    /** @type {string[]} */
    const problems = [];

    const hex = typeof entry?.hex === 'string' ? entry.hex : '';
    if (!HEX_RE.test(hex)) {
        problems.push('This entry has no valid 32-character ruleset code.');
    } else {
        const known = new Set(
            (publicHexes || [])
                .filter(h => typeof h === 'string')
                .map(h => h.toLowerCase())
        );
        if (known.has(hex.toLowerCase())) {
            problems.push('This ruleset is already in the public library.');
        }
    }

    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    if (!name) {
        problems.push('Give it a name.');
    } else if (name.length > NAME_MAX) {
        problems.push(`Shorten the name to ${NAME_MAX} characters or fewer.`);
    }

    const description = typeof entry?.description === 'string' ? entry.description.trim() : '';
    if (description.length < DESC_MIN) {
        problems.push(`Describe what it does (at least ${DESC_MIN} characters) — the library card shows this.`);
    } else if (description.length > DESC_MAX) {
        problems.push(`Shorten the description to ${DESC_MAX} characters or fewer.`);
    }

    const tags = Array.isArray(entry?.tags) ? entry.tags : [];
    if (!tags.some(t => typeof t === 'string' && isCanonicalTag(t))) {
        const hint = tagLabelHint();
        problems.push(`Add at least one standard tag (${hint}) so it shows up in the library filters — custom tags alone don't.`);
    }

    const is = entry?.initialState;
    const hasIC = !!is && typeof is.mode === 'string' && !!is.params && typeof is.params === 'object';
    if (!hasIC) {
        problems.push('Pair a starting condition — public entries replay from the state their preview was baked from.');
    } else if (!Number.isFinite(entry?.seed)) {
        problems.push('The paired start has no seed, so nobody else can reproduce it. Re-save the entry with an initial condition.');
    }

    return { ok: problems.length === 0, problems };
}

/** "Gliders, Spirals, Chaos, …" — a few canonical labels for the missing-tag message. */
function tagLabelHint() {
    const ids = ['gliders', 'spirals', 'oscillators', 'chaos'].slice(0, TAG_HINT_COUNT);
    return `${ids.map(tagLabel).join(', ')}, …`;
}

/**
 * Build everything needed to hand a validated entry to GitHub.
 *
 * The payload is exactly {@link toPublicLibraryEntry}'s projection — name, description, tags, hex,
 * paired IC + seed. No thumbnail (the app bakes those locally), no id/timestamp, no author: those are
 * either local noise or assigned at review.
 *
 * @param {SubmittableEntry} entry
 * @param {{
 *   credit?: string,
 *   notes?: string,
 *   repoUrl?: string,
 *   origin?: string,
 *   rows?: number,
 * }} [opts] `credit`/`notes` prefill the optional form fields; `origin` is the Explorer base URL the
 *   reviewer's preview link should point at (defaults to the published app).
 * @returns {{title: string, entryJson: string, explorerUrl: string, url: string, oversize: boolean}}
 *   `url` is always the one to open: the prefilled form, or — when `oversize` — the same form without
 *   the entry, in which case the caller must put `entryJson` on the clipboard first.
 */
export function buildSubmissionIssue(entry, {
    credit = '',
    notes = '',
    repoUrl = SUBMISSION_REPO_URL,
    origin,
    rows,
} = {}) {
    const publicEntry = toPublicLibraryEntry(entry);
    const entryJson = JSON.stringify(publicEntry, null, 2);
    const title = submissionTitle(publicEntry.name);
    const explorerUrl = explorerUrlForRuleset(publicEntry.hex, { origin, rows });
    const base = `${String(repoUrl).replace(/\/+$/, '')}/issues/new`;

    const params = new URLSearchParams({ template: SUBMISSION_TEMPLATE, title });
    params.set(SUBMISSION_FIELDS.link, explorerUrl);
    if (typeof credit === 'string' && credit.trim()) params.set(SUBMISSION_FIELDS.credit, credit.trim());
    if (typeof notes === 'string' && notes.trim()) params.set(SUBMISSION_FIELDS.notes, notes.trim());

    const withEntry = new URLSearchParams(params);
    withEntry.set(SUBMISSION_FIELDS.entry, entryJson);
    const prefilled = `${base}?${withEntry.toString()}`;
    const oversize = prefilled.length > SUBMISSION_URL_MAX;

    return {
        title,
        entryJson,
        explorerUrl,
        url: oversize ? `${base}?${params.toString()}` : prefilled,
        oversize,
    };
}

/**
 * Issue title: `Ruleset: <name>`. GitHub allows far more, but a title that fits a list is kinder.
 * @param {string} name
 * @returns {string}
 */
export function submissionTitle(name) {
    const clean = (typeof name === 'string' ? name.trim() : '') || 'untitled';
    return `Ruleset: ${clean}`.slice(0, TITLE_MAX);
}
