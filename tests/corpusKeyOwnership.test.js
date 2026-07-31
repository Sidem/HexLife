import { describe, expect, it } from 'vitest';
import { KeyboardShortcutManager } from '../src/ui/KeyboardShortcutManager.js';
import { corpusOwnsKey, isTypingTarget } from '../src/ui/dev/corpusKeyOwnership.js';

function registeredShortcuts() {
    const manager = new KeyboardShortcutManager({}, null, null);
    manager._registerShortcuts();
    return manager.getShortcuts();
}

describe('Corpus Lab keyboard ownership', () => {
    it('claims every global shortcut that needs no Ctrl/Cmd', () => {
        // The point of the rule: a shortcut added to the global registry later is suppressed during a
        // collection session automatically, without anyone remembering to add it to a blocklist.
        const leaked = registeredShortcuts()
            .filter(shortcut => !shortcut.displayOnly && !shortcut.ctrlKey)
            .filter(shortcut => !corpusOwnsKey({
                target: { tagName: 'BODY' },
                shiftKey: !!shortcut.shiftKey,
            }))
            .map(shortcut => shortcut.description);

        expect(leaked).toEqual([]);
    });

    it('claims the keys that used to fire a global action alongside a judgment', () => {
        // `I` inverted the judged world's ruleset before the clip was captured, `B` flagged it for
        // breeding, `V` swapped in the torus renderer, digits re-selected worlds, Space paused the sim.
        for (const key of ['i', 'b', 'v', 'u', '1', '9', '0', ' ', 'ArrowLeft', 'ArrowDown', 'Escape']) {
            expect(corpusOwnsKey({ key, target: { tagName: 'BODY' } })).toBe(true);
        }
    });

    it('leaves the settings inputs and browser chords alone', () => {
        expect(corpusOwnsKey({ target: { tagName: 'INPUT' } })).toBe(false);
        expect(corpusOwnsKey({ target: { tagName: 'TEXTAREA' } })).toBe(false);
        expect(corpusOwnsKey({ target: { tagName: 'SELECT' } })).toBe(false);
        expect(corpusOwnsKey({ target: { isContentEditable: true } })).toBe(false);

        // Reload, devtools and copy/paste have to survive a session that runs for hours.
        expect(corpusOwnsKey({ key: 'r', ctrlKey: true, target: { tagName: 'BODY' } })).toBe(false);
        expect(corpusOwnsKey({ key: 'c', metaKey: true, target: { tagName: 'BODY' } })).toBe(false);
        expect(corpusOwnsKey({ key: 'Tab', altKey: true, target: { tagName: 'BODY' } })).toBe(false);
    });

    it('treats a missing event or target as not owned', () => {
        expect(corpusOwnsKey(null)).toBe(false);
        expect(isTypingTarget(null)).toBe(false);
        expect(corpusOwnsKey({ key: 'i' })).toBe(true);
    });
});
