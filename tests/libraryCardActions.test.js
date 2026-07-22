import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Roadmap #30 (UX audit fix 3) — the double load affordance on library cards.
 *
 * Every entry with a paired initial condition used to render both "Load" and "Load + IC", which is
 * how the mobile Library tab reached 104 controls (~2 per card). The pair collapsed into one Load
 * button plus one list-level "Paired start" toggle that decides what Load *means*.
 *
 * Two things have to keep holding, and neither throws if it stops:
 *  1. The card factory emits exactly one load control. A second one silently doubles the tab's
 *     control count again — the defect this item exists to remove.
 *  2. Collapsing removes a *control*, not a *capability*: the opposite load is still reachable
 *     per-entry from the ⋯ menu, and the list-level choice is persisted.
 *
 * jsdom isn't available here (vitest runs in `node`), so this is a source-level guard on the
 * templates and handlers, in the same spirit as `exploreDisclosure.test.js`.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const FACTORY = read(path.join('src', 'ui', 'RulesetDisplayFactory.js'));
const LIBRARY = read(path.join('src', 'ui', 'components', 'RulesetLibraryComponent.js'));

/** The body of `createLibraryListItem`, up to the next method — where a card's actions are built. */
function cardFactoryBody() {
    const start = FACTORY.indexOf('createLibraryListItem(');
    expect(start).toBeGreaterThan(-1);
    const end = FACTORY.indexOf('\n    _escape(', start);
    expect(end).toBeGreaterThan(start);
    return FACTORY.slice(start, end);
}

describe('library card load affordance (#30)', () => {
    const body = cardFactoryBody();

    it('renders exactly one load control per card', () => {
        const loadActions = [...body.matchAll(/data-action="([^"]*)"/g)]
            .map(([, a]) => a)
            .filter((a) => a.includes('load'));
        // One template picking between two ids (personal vs public list) — one button either way.
        expect(loadActions).toEqual(["${isPersonal ? 'load-personal' : 'load-rule'}"]);
    });

    it('no longer ships the second load button or the duplicated inline share button', () => {
        // "Share on Reddit" was an inline button *and* a ⋯ menu item; only the menu item remains.
        expect(body).not.toContain('load-with-ic');
        expect(body).not.toContain('data-action="share-reddit"');
    });

    it('keeps the ⋯ overflow on personal cards — it is where the per-entry override lives', () => {
        expect(body).toContain('data-action="manage-personal"');
    });

    it('still tells the user an entry has a paired start (the badge carries what the button no longer says)', () => {
        expect(body).toContain('library-card-ic-badge');
    });
});

describe('paired-start toggle (#30)', () => {
    it('is a persisted list-level setting, defaulting to the previewed dish', () => {
        expect(LIBRARY).toContain("PersistenceService.loadUISetting('libraryPairedStart', true)");
        expect(LIBRARY).toContain("PersistenceService.saveUISetting('libraryPairedStart'");
    });

    it('renders as a pressed-state control in the library toolbar', () => {
        expect(LIBRARY).toContain('data-action="toggle-paired-start"');
        expect(LIBRARY).toContain('aria-pressed="${this.pairedStart}"');
    });

    it('routes a Load click through the one helper that honours it', () => {
        expect(LIBRARY).toMatch(/action === 'load-rule' \|\| action === 'load-personal'/);
        expect(LIBRARY).toContain('this._loadCard(card)');
        // With paired start on, a card load replays ruleset + IC + seed via the explore-find path;
        // with it off it is a plain ruleset load onto the cells already on screen.
        expect(LIBRARY).toContain('COMMAND_APPLY_EXPLORE_FIND');
        expect(LIBRARY).toContain('libraryController.loadRuleset(');
    });

    it('offers the opposite load per entry from the ⋯ menu, so nothing became unreachable', () => {
        expect(LIBRARY).toContain("this.pairedStart ? 'Load rule only' : 'Load with paired start'");
        expect(LIBRARY).toContain('withPairedStart: !this.pairedStart');
    });
});

describe('on-canvas view controls (#31)', () => {
    const VIEW = read(path.join('src', 'ui', 'ViewControls.js'));
    const VIEW_CSS = read(path.join('src', 'ui', 'ViewControls.css'));

    it('names the desktop pan gesture the rail never advertised', () => {
        expect(VIEW).toContain('Ctrl-drag or middle-drag to pan');
    });

    it('offers the way back out of a zoom (#34 opens a first-time visitor inside one)', () => {
        expect(VIEW).toContain('resetSelectedCamera');
        expect(read(path.join('src', 'core', 'WorldManager.js'))).toContain('resetSelectedCamera = ()');
    });

    it('hides itself through an author rule, not a bare UA default', () => {
        // AGENTS.md: a UA `display: none` loses to any author `display` on the same element, which
        // is how the Scoring disclosure rendered nine sliders while looking collapsed.
        expect(VIEW_CSS).toMatch(/\.view-controls\.hidden\s*\{[^}]*display:\s*none/);
    });
});
