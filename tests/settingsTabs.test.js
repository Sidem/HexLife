import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    normalizeSettingsTab,
    SETTINGS_TAB_IDS,
} from '../src/ui/components/SettingsComponent.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Settings tabs', () => {
    it('keeps the task-based category order stable', () => {
        expect(SETTINGS_TAB_IDS).toEqual(['display', 'simulation', 'torus']);
    });

    it('falls back to Display for missing or stale persisted values', () => {
        expect(normalizeSettingsTab('simulation')).toBe('simulation');
        expect(normalizeSettingsTab('torus')).toBe('torus');
        expect(normalizeSettingsTab('appearance')).toBe('display');
        expect(normalizeSettingsTab(null)).toBe('display');
    });

    it('pins the accessible tab contract and the hidden-panel override', () => {
        const source = readFileSync(
            path.join(REPO_ROOT, 'src/ui/components/SettingsComponent.js'),
            'utf8',
        );
        const css = readFileSync(
            path.join(REPO_ROOT, 'src/ui/components/SettingsComponent.css'),
            'utf8',
        );

        expect(source).toContain('role="tablist"');
        expect(source.match(/role="tab"/g)).toHaveLength(3);
        expect(source.match(/role="tabpanel"/g)).toHaveLength(3);
        expect(source).toContain("event.key === 'ArrowRight'");
        expect(source).toContain("event.key === 'ArrowLeft'");
        expect(css).toMatch(/settings-tab-panel\[hidden\]\s*\{[\s\S]*display:\s*none\s*!important/);
    });

    it('mounts a panel that was restored open before VIEW_SHOWN could fire', () => {
        const uiManagerSource = readFileSync(
            path.join(REPO_ROOT, 'src/ui/UIManager.js'),
            'utf8',
        );

        expect(uiManagerSource).toContain('this._mountRestoredDesktopPanels();');
        expect(uiManagerSource).toMatch(
            /_mountRestoredDesktopPanels\(\)[\s\S]*filter\(\(panel\) => !panel\.isHidden\(\)\)[\s\S]*mountSharedComponentInto/,
        );
    });
});
