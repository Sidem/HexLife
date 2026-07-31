import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    validateSubmission,
    buildSubmissionIssue,
    submissionTitle,
    SUBMISSION_FIELDS,
    SUBMISSION_TEMPLATE,
    SUBMISSION_URL_MAX,
} from '../src/services/LibrarySubmission.js';

/**
 * Roadmap #27 — the streamlined "Submit to public library" path.
 *
 * Two failure modes this guards, neither of which throws:
 *  1. Intake drift: an entry reaching the reviewer without the metadata that makes a catalog entry
 *     usable (findable, described, replayable) or duplicating one already committed.
 *  2. A silent prefill: GitHub ignores query parameters that don't match an issue-form field `id`,
 *     so a renamed field in the YAML hands the user an empty form with no error anywhere.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_PATH = path.join('.github', 'ISSUE_TEMPLATE', SUBMISSION_TEMPLATE);
const HEX = '12482080480080006880800180010117';
const PUBLIC_HEX = '200110000006000C8903020805009804';

/** An entry that clears every intake rule. */
function goodEntry(overrides = {}) {
    return {
        id: '1699999999999',
        createdAt: '2026-07-30T00:00:00.000Z',
        schemaVersion: 2,
        name: 'Spiral Weaver',
        description: 'Slow spirals that keep re-seeding each other.',
        tags: ['spirals', 'my-own-tag'],
        hex: HEX,
        initialState: { mode: 'density', params: { density: 0.05 } },
        seed: 10003,
        thumb: 'data:image/jpeg;base64,' + 'A'.repeat(64),
        ...overrides,
    };
}

describe('LibrarySubmission.validateSubmission', () => {
    it('accepts a complete entry', () => {
        expect(validateSubmission(goodEntry(), { publicHexes: [PUBLIC_HEX] }))
            .toEqual({ ok: true, problems: [] });
    });

    it('requires a valid ruleset code', () => {
        const { ok, problems } = validateSubmission(goodEntry({ hex: 'nope' }));
        expect(ok).toBe(false);
        expect(problems.join(' ')).toContain('32-character');
    });

    it('rejects a ruleset the catalog already has, case-insensitively', () => {
        const { ok, problems } = validateSubmission(goodEntry({ hex: PUBLIC_HEX.toLowerCase() }), {
            publicHexes: [PUBLIC_HEX],
        });
        expect(ok).toBe(false);
        expect(problems.join(' ')).toContain('already in the public library');
    });

    it('requires a name and a real description', () => {
        expect(validateSubmission(goodEntry({ name: '   ' })).problems.join(' ')).toContain('name');
        expect(validateSubmission(goodEntry({ description: 'nice' })).problems.join(' ')).toContain('Describe');
        expect(validateSubmission(goodEntry({ description: undefined })).ok).toBe(false);
    });

    it('requires at least one canonical tag — custom tags alone do not filter', () => {
        const { ok, problems } = validateSubmission(goodEntry({ tags: ['my-own-tag'] }));
        expect(ok).toBe(false);
        expect(problems.join(' ')).toContain('standard tag');
        expect(validateSubmission(goodEntry({ tags: ['gliders'] })).ok).toBe(true);
    });

    it('requires a replayable paired start: IC and seed together', () => {
        expect(validateSubmission(goodEntry({ initialState: null })).problems.join(' '))
            .toContain('starting condition');
        expect(validateSubmission(goodEntry({ seed: null })).problems.join(' ')).toContain('seed');
    });

    it('reports every problem at once, so the editor is opened once', () => {
        const { problems } = validateSubmission({ hex: HEX });
        expect(problems.length).toBeGreaterThanOrEqual(4);
    });
});

describe('LibrarySubmission.buildSubmissionIssue', () => {
    it('prefills the issue form with the committed entry shape', () => {
        const { url, title, entryJson } = buildSubmissionIssue(goodEntry());
        const parsed = new URL(url);
        expect(parsed.origin + parsed.pathname).toBe('https://github.com/Sidem/HexLife/issues/new');
        expect(parsed.searchParams.get('template')).toBe(SUBMISSION_TEMPLATE);
        expect(parsed.searchParams.get('title')).toBe(title);
        expect(parsed.searchParams.get(SUBMISSION_FIELDS.entry)).toBe(entryJson);
        expect(title).toBe('Ruleset: Spiral Weaver');
    });

    it('never ships local-only or attribution fields — credit is assigned at review', () => {
        const payload = JSON.parse(buildSubmissionIssue(goodEntry()).entryJson);
        expect(payload).toEqual({
            name: 'Spiral Weaver',
            description: 'Slow spirals that keep re-seeding each other.',
            tags: ['spirals', 'my-own-tag'],
            hex: HEX,
            initialState: { mode: 'density', params: { density: 0.05 } },
            seed: 10003,
        });
        expect(payload.thumb).toBeUndefined();
        expect(payload.author).toBeUndefined();
    });

    it('gives the reviewer a one-click preview link at the submitting build origin', () => {
        const { explorerUrl, url } = buildSubmissionIssue(goodEntry(), { origin: 'http://localhost:5173/' });
        expect(explorerUrl).toBe(`http://localhost:5173/?r=${HEX.toUpperCase()}`);
        expect(new URL(url).searchParams.get(SUBMISSION_FIELDS.link)).toBe(explorerUrl);
    });

    it('passes an explicit credit and notes through to their fields', () => {
        const { url } = buildSubmissionIssue(goodEntry(), { credit: '  Sidem  ', notes: 'takes ~2k ticks' });
        const params = new URL(url).searchParams;
        expect(params.get(SUBMISSION_FIELDS.credit)).toBe('Sidem');
        expect(params.get(SUBMISSION_FIELDS.notes)).toBe('takes ~2k ticks');
    });

    it('omits empty optional fields rather than prefilling blanks', () => {
        const params = new URL(buildSubmissionIssue(goodEntry()).url).searchParams;
        expect(params.has(SUBMISSION_FIELDS.credit)).toBe(false);
        expect(params.has(SUBMISSION_FIELDS.notes)).toBe(false);
    });

    it('drops the entry from the URL when it would overflow, flagging the clipboard fallback', () => {
        // A pathological IC: the recipe is still valid, it just cannot ride a query string.
        const params = {};
        for (let i = 0; i < 400; i++) params[`param_${i}`] = i;
        const built = buildSubmissionIssue(goodEntry({ initialState: { mode: 'clusters', params } }));
        expect(built.oversize).toBe(true);
        expect(built.url.length).toBeLessThanOrEqual(SUBMISSION_URL_MAX);
        expect(new URL(built.url).searchParams.has(SUBMISSION_FIELDS.entry)).toBe(false);
        // The payload still exists for the clipboard path.
        expect(JSON.parse(built.entryJson).initialState.params.param_399).toBe(399);
    });

    it('keeps a normal entry well under the URL ceiling', () => {
        const built = buildSubmissionIssue(goodEntry());
        expect(built.oversize).toBe(false);
        expect(built.url.length).toBeLessThan(SUBMISSION_URL_MAX / 2);
    });

    it('titles an unnamed entry rather than emitting a bare prefix', () => {
        expect(submissionTitle('')).toBe('Ruleset: untitled');
        expect(submissionTitle('x'.repeat(300)).length).toBeLessThanOrEqual(120);
    });
});

describe('issue form agreement (a mismatch fails silently on GitHub)', () => {
    const yaml = fs.readFileSync(path.join(REPO_ROOT, TEMPLATE_PATH), 'utf8');

    it('declares an id for every field the app prefills', () => {
        for (const id of Object.values(SUBMISSION_FIELDS)) {
            expect(yaml).toMatch(new RegExp(`^\\s*id:\\s*${id}\\s*$`, 'm'));
        }
    });

    it('makes the entry itself the one required field, so a submission is never empty', () => {
        expect(yaml).toMatch(/id:\s*entry[\s\S]*?required:\s*true/);
    });

    it('is reachable at the exact template filename the app links to', () => {
        expect(fs.existsSync(path.join(REPO_ROOT, TEMPLATE_PATH))).toBe(true);
    });
});

describe('library card wiring', () => {
    const LIBRARY = fs.readFileSync(
        path.join(REPO_ROOT, 'src', 'ui', 'components', 'RulesetLibraryComponent.js'), 'utf8');

    it('offers submission from the ⋯ menu and keeps the manual copy as the escape hatch', () => {
        expect(LIBRARY).toContain("label: 'Submit to public library…'");
        expect(LIBRARY).toContain("label: 'Copy as public-library JSON'");
    });

    it('validates before opening anything, and routes a failure to the editor', () => {
        expect(LIBRARY).toContain('validateSubmission(rule, { publicHexes })');
        expect(LIBRARY).toContain('COMMAND_SHOW_SAVE_RULESET_MODAL');
    });

    it('confirms before leaving the app', () => {
        expect(LIBRARY).toMatch(/title: 'Submit to the public library'[\s\S]*?onConfirm: \(\) => this\._openSubmissionIssue/);
    });

    it('starts the oversize clipboard copy before window.open, so the popup keeps its activation', () => {
        const open = LIBRARY.slice(LIBRARY.indexOf('_openSubmissionIssue(submission) {'));
        expect(open.indexOf('clipboard.writeText')).toBeLessThan(open.indexOf('window.open'));
    });
});
