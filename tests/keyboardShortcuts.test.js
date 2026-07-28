import { describe, expect, it } from 'vitest';
import { KeyboardShortcutManager } from '../src/ui/KeyboardShortcutManager.js';
import { KeyboardShortcutsComponent } from '../src/ui/components/KeyboardShortcutsComponent.js';

function registeredShortcuts() {
    const manager = new KeyboardShortcutManager({}, null, null);
    manager._registerShortcuts();
    return manager.getShortcuts();
}

function chord(shortcut) {
    return [
        shortcut.code || shortcut.key.toLowerCase(),
        shortcut.ctrlKey ? 'ctrl' : '',
        shortcut.shiftKey ? 'shift' : '',
    ].filter(Boolean).join('+');
}

describe('keyboard shortcut registry', () => {
    it('does not register duplicate dispatchable chords', () => {
        const shortcuts = registeredShortcuts().filter(shortcut => !shortcut.displayOnly);
        const chords = shortcuts.map(chord);
        expect(new Set(chords).size).toBe(chords.length);
    });

    it('keeps torus and recording controls on distinct V chords', () => {
        const shortcuts = registeredShortcuts();
        const byChord = new Map(shortcuts.filter(shortcut => !shortcut.displayOnly)
            .map(shortcut => [chord(shortcut), shortcut.description]));

        expect(byChord.get('v')).toBe('Toggle flat / 3D torus view');
        expect(byChord.get('v+shift')).toContain('Record video');
        expect(byChord.get('v+ctrl+shift')).toContain('Pause / resume');
    });

    it('formats non-letter keys for the categorized fallback list', () => {
        const viewer = Object.create(KeyboardShortcutsComponent.prototype);

        expect(viewer._shortcutKeyParts({ key: 'ArrowLeft' })).toEqual(['←']);
        expect(viewer._shortcutKeyParts({ key: ' ', ctrlKey: true })).toEqual(['Ctrl/⌘', 'Space']);
        expect(viewer._shortcutKeyParts({ displayKey: 'Ctrl + Num 7' })).toEqual(['Ctrl', 'Num 7']);
    });
});
