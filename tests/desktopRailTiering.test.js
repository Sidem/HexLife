import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Roadmap #32 — the desktop rail must communicate its tiers while collapsed,
 * and the top bar must not duplicate actions already available in that rail.
 * These are source-level guards because both regressions remain functional:
 * they only make the interface visually noisy again.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const HTML = read('index.html');
const TOP_BAR = read(path.join('src', 'ui', 'TopInfoBar.js'));
const TOOLBAR = read(path.join('src', 'ui', 'Toolbar.js'));
const TOOLBAR_CSS = read(path.join('src', 'ui', 'Toolbar.css'));
const THEME_CSS = read(path.join('src', 'styles', 'theme.css'));

function rulesetDisplayMarkup() {
    const start = HTML.indexOf('<div id="rulesetDisplayContainer"');
    expect(start).toBeGreaterThan(-1);
    const end = HTML.indexOf('<div id="statsDisplayContainer"', start);
    expect(end).toBeGreaterThan(start);
    return HTML.slice(start, end);
}

describe('top-bar action close-out (#32)', () => {
    const markup = rulesetDisplayMarkup();

    it('keeps only Save Ruleset and View History beside the ruleset identity', () => {
        const ids = [...markup.matchAll(/<button id="([^"]+)"/g)].map(([, id]) => id);
        expect(ids).toEqual(['saveRulesetButton', 'historyButton']);
    });

    it('does not rebuild the removed actions at runtime', () => {
        expect(TOP_BAR).not.toContain('_buildRuleDeck');
        expect(TOP_BAR).not.toContain('ruleDeckSurprise');
        expect(TOP_BAR).not.toContain('undoButton');
        expect(TOP_BAR).not.toContain('redoButton');
    });
});

describe('collapsed and expanded rail hierarchy (#32)', () => {
    it('keeps rail actions visually uniform apart from the existing Play hero', () => {
        expect(TOOLBAR).not.toContain('toolbar-button--day-one');
        expect(THEME_CSS).not.toContain('toolbar-button--day-one');
        expect(THEME_CSS).toMatch(/#playPauseButton\s*\{[^}]*background-color:\s*var\(--accent\)/s);
    });

    it('gives collapsed separators a visible two-pixel treatment', () => {
        expect(THEME_CSS).toMatch(
            /#vertical-toolbar:not\(\.is-expanded\)\s*>\s*\.toolbar-separator\s*\{[^}]*height:\s*2px[^}]*background-color:\s*var\(--border-strong\)/s
        );
    });

    it('uses labelled headers instead of separators when expanded', () => {
        expect(TOOLBAR).toContain('toolbar-group-header');
        expect(TOOLBAR_CSS).toMatch(
            /#vertical-toolbar\.is-expanded\s+\.toolbar-separator\s*\{[^}]*display:\s*none/s
        );
        expect(TOOLBAR_CSS).toMatch(
            /#vertical-toolbar\.is-expanded\s+\.toolbar-group-header\s*\{[^}]*display:\s*block/s
        );
    });
});
