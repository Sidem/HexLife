// @ts-check

/** Elements that own their own keystrokes; the overlay never takes keys away from them. */
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * @param {any} target
 * @returns {boolean} Whether the event landed in a field the owner is typing into.
 */
export function isTypingTarget(target) {
    if (!target) return false;
    if (target.isContentEditable === true) return true;
    return TYPING_TAGS.has(target.tagName);
}

/**
 * Whether the Corpus Lab overlay consumes a key event outright while it is mounted.
 *
 * Corpus Lab is modal out of necessity, not style. Its judging keys collide head-on with global
 * shortcuts that mutate the very world the next capture is about to encode: `I` inverts the selected
 * world's ruleset, `B` flags it as a breeding parent, `V` swaps the renderer into the 3D torus, `1`–`9`
 * re-select worlds out from under the queue, `←`/`→` scrub ticks, Space pauses the simulation. The
 * globals win the race, because `KeyboardShortcutManager` listens on `document` in the bubble phase
 * while the overlay listens on `window` — so a stray `I` inverted the ruleset *and then* captured the
 * clip, filing it in the corpus under the pre-inversion hex. Nothing in the resulting ZIP records that
 * it happened.
 *
 * Suppressing only the keys that collide today would fix the registry and quietly rot. `G` generates a
 * ruleset, `R` resets every world, `M` mutates, `C` clears, `D` rewrites the densities, `O` clones,
 * `T` reassigns the saved start, Shift+B breeds — every one of them is equally destructive mid-round
 * and equally invisible afterwards. So the rule is *ownership*, not a blocklist: while the overlay is
 * up, every unmodified key belongs to it, whether or not it has a use for that key.
 *
 * Ctrl/Cmd/Alt chords are deliberately excluded. A collection session runs for hours and still needs
 * reload, devtools and copy/paste, and `stopPropagation` would not suppress a browser-level default
 * anyway — only the in-page listeners, which is exactly what this guards.
 *
 * @param {{target?: any, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean}|null|undefined} event
 * @returns {boolean}
 */
export function corpusOwnsKey(event) {
    if (!event) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    return !isTypingTarget(event.target);
}
