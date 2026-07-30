import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const JS = read('src/ui/components/ExploreComponent.js');
const CSS = read('src/ui/components/ExploreComponent.css');

describe('Auto-Explore tabs', () => {
    it('renders three accessible tabs and matching panels', () => {
        expect(JS).toContain('role="tablist"');
        expect(JS).toContain("['setup', 'objective', 'finds']");
        expect(JS).toContain('id="explore-tab-${tab}"');
        expect(JS).toContain('aria-controls="explore-panel-${tab}"');
        for (const name of ['setup', 'objective', 'finds']) {
            expect(JS).toContain(`id="explore-panel-${name}"`);
            expect(JS).toContain(`aria-labelledby="explore-tab-${name}"`);
        }
    });

    it('keeps run status and controls before the tab list', () => {
        const tablist = JS.indexOf('role="tablist"');
        expect(tablist).toBeGreaterThan(-1);
        // A missing marker would make an `indexOf(...) < tablist` assertion pass at -1, so require
        // each one to exist before comparing.
        for (const marker of ['explore-status', 'explore-run-buttons', 'data-action="start"',
            'data-action="pause"', 'data-action="stop"', 'data-action="adopt"']) {
            const at = JS.indexOf(marker);
            expect(at, `${marker} must be rendered`).toBeGreaterThan(-1);
            expect(at, `${marker} must precede the tab list`).toBeLessThan(tablist);
        }
    });

    it('never hides the run controls behind a tab panel', () => {
        const firstPanel = JS.indexOf('class="explore-tab-panel"');
        expect(firstPanel).toBeGreaterThan(-1);
        expect(JS.indexOf('explore-run-buttons')).toBeLessThan(firstPanel);
    });

    it('puts setup, objective, and gallery content in the intended order', () => {
        expect(JS.indexOf('id="explore-settings"')).toBeGreaterThan(JS.indexOf('id="explore-panel-setup"'));
        expect(JS.indexOf('id="explore-scoring-group"')).toBeGreaterThan(JS.indexOf('id="explore-panel-objective"'));
        expect(JS.indexOf('explore-gallery-group')).toBeGreaterThan(JS.indexOf('id="explore-panel-finds"'));
    });

    it('supports arrow-key tab navigation and persists the active tab', () => {
        expect(JS).toContain('_onTabKeydown');
        expect(JS).toMatch(/ArrowRight|ArrowLeft/);
        expect(JS).toContain("saveUISetting(SETTING_KEYS.activeTab");
    });

    it('has author-level hidden rules for tab panels and collapsed model tools', () => {
        expect(CSS).toMatch(/\.explore-tab-panel\[hidden\][^{]*\{[^}]*display:\s*none/);
        expect(CSS).toMatch(/details:not\(\[open\]\)[^{]*\{[^}]*display:\s*none/);
    });
});

describe('[hidden] survives component layout', () => {
    it('keeps the rater mount hidden at rest', () => {
        expect(CSS).toMatch(/\.explore-rater\[hidden\][^{]*\{[^}]*display:\s*none/);
    });
});
