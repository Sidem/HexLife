import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #29 re-tiered mobile Discover: the expert controls (Search Settings + the nine-term Scoring
 * objective) moved behind an "Advanced" disclosure so the tab lands on one action.
 *
 * The tier is held up by two things that fail *silently* — no throw, no console warning, the panel
 * simply renders everything and looks fine in code review:
 *
 *  1. A closed `<details>` hides its children through a **UA** `display: none` rule, and UA rules
 *     lose to any author `display` on those children. `.tool-group { display: flex }` and
 *     `#explore-scoring-mount { display: flex }` both do exactly that — which is why the Scoring
 *     disclosure shipped in v3.1 looking collapsed while rendering all nine sliders. The hiding has
 *     to be restated as an author rule specific enough to outrank them, ids included.
 *  2. `[hidden]` is the same trap: `.explore-rater { display: flex }` beat it, so the empty rater
 *     mount rendered as a bordered strip under the gallery header at rest.
 *
 * jsdom has no UA stylesheet cascade to reproduce either, so this is a source-level guard: it pins
 * the structure of the render template and the CSS rules the tier depends on.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const JS = read(path.join('src', 'ui', 'components', 'ExploreComponent.js'));
const CSS = read(path.join('src', 'ui', 'components', 'ExploreComponent.css'));
const DECK_JS = read(path.join('src', 'ui', 'components', 'PredictionDeck.js'));

/** Strip comments + collapse whitespace so rule matching survives reformatting. */
const FLAT_CSS = CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

/** The declarations of every rule whose selector list matches `pattern`. */
function declarationsFor(pattern) {
    return [...FLAT_CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)]
        .filter(([, selector]) => pattern.test(selector))
        .map(([, , body]) => body.trim());
}

describe('Advanced disclosure structure (#29)', () => {
    const advancedOpen = JS.indexOf('id="explore-advanced"');
    const settings = JS.indexOf('id="explore-settings"');
    const scoring = JS.indexOf('id="explore-scoring-group"');
    const gallery = JS.indexOf('explore-gallery-group');

    it('renders the disclosure and the surfaces it is meant to contain', () => {
        expect(advancedOpen).toBeGreaterThan(-1);
        expect(settings).toBeGreaterThan(-1);
        expect(scoring).toBeGreaterThan(-1);
        expect(gallery).toBeGreaterThan(-1);
    });

    it('nests Search Settings and Scoring inside it, and leaves the gallery outside', () => {
        // Ordering is the cheap proxy for nesting: both expert blocks open after the disclosure
        // does, and the gallery — a day-one surface — comes after the disclosure has closed.
        expect(settings).toBeGreaterThan(advancedOpen);
        expect(scoring).toBeGreaterThan(settings);
        expect(gallery).toBeGreaterThan(scoring);
        // The `</details>` that closes Advanced sits between Scoring's own close and the gallery.
        const closes = JS.slice(scoring, gallery).match(/<\/details>/g) || [];
        expect(closes.length, 'expected Scoring and Advanced to both close before the gallery').toBe(2);
    });

    it('keeps the Prediction mount (#19) ABOVE the disclosure, in the newcomer tier', () => {
        // #29 set the rule every later Discover surface inherits: newcomer-facing content goes above
        // `<details id="explore-advanced">`, expert content inside it. Prediction mode is a newcomer
        // entry point, so a refactor that tucks it in with the nine-term objective is a regression of
        // the tier — and one nothing else would catch. The deck is currently switched OFF (see the
        // next test), which is exactly when a placement contract quietly rots, so pin it anyway.
        const deck = JS.indexOf('id="explore-prediction-mount"');
        expect(deck, 'the prediction mount vanished from the render template').toBeGreaterThan(-1);
        expect(deck).toBeLessThan(advancedOpen);
    });

    it('the deck is gated on PREDICTION_MODE_ENABLED, and that flag is currently off', () => {
        // #19 shipped and was switched back off the same day: it works mechanically but does not play
        // well enough to show a newcomer. Two ways that can silently go wrong — the flag flips back to
        // `true` in an unrelated edit and the unfinished deck ships, or the gate is dropped from the
        // mount and the flag becomes decorative. Both are cheap to catch and expensive to notice.
        //
        // WHEN RE-ENABLING: flip PREDICTION_MODE_ENABLED to true, then invert this test rather than
        // deleting it — the mount must stay gated on the flag either way.
        expect(DECK_JS).toMatch(/export const PREDICTION_MODE_ENABLED = false;/);
        expect(JS).toMatch(/_mountPredictionDeck\(\)\s*\{\s*if \(!PREDICTION_MODE_ENABLED/);
    });

    it('keeps one primary action, with the run controls that need a run behind it', () => {
        expect(JS).toContain('explore-primary-action');
        expect((JS.match(/explore-run-secondary/g) || []).length).toBe(3);
        const hidden = declarationsFor(/explore-run-secondary/);
        expect(hidden.some((d) => /display:\s*none/.test(d)), 'idle Discover must not show disabled run controls').toBe(true);
        expect(FLAT_CSS).toMatch(/:not\(\.is-running\)[^{]*explore-run-secondary/);
    });
});

describe('disclosure hiding outranks the component\'s own layout', () => {
    const closedRules = declarationsFor(/details:not\(\[open\]\)/);

    it('restates the UA hiding as an author rule', () => {
        expect(closedRules.length, 'no author rule hides a closed <details> in ExploreComponent.css').toBeGreaterThan(0);
        expect(closedRules.every((d) => /display:\s*none/.test(d))).toBe(true);
    });

    it('covers the id-styled scoring mount, which outranks a class-only rule', () => {
        const selectors = [...FLAT_CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)]
            .filter(([, sel]) => /details:not\(\[open\]\)/.test(sel))
            .map(([, sel]) => sel)
            .join(' ');
        expect(selectors).toContain('#explore-scoring-mount');
    });

    it('the layout rules this is protecting against still exist', () => {
        // If these ever stop setting `display`, the guard above is no longer load-bearing — but it
        // must fail loudly rather than quietly pass for the wrong reason.
        expect(declarationsFor(/\.tool-group(?!\s*>)/).some((d) => /display:\s*flex/.test(d))).toBe(true);
        expect(declarationsFor(/#explore-scoring-mount/).some((d) => /display:\s*flex/.test(d))).toBe(true);
    });
});

describe('[hidden] survives the component stylesheet', () => {
    it('the rater mount stays hidden at rest', () => {
        const rules = declarationsFor(/\.explore-rater\[hidden\]/);
        expect(rules.length, '.explore-rater { display: flex } would beat the UA [hidden] rule').toBeGreaterThan(0);
        expect(rules.every((d) => /display:\s*none/.test(d))).toBe(true);
    });
});
