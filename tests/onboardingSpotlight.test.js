import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The tour spotlight is two cooperating pieces of stacking: `#onboarding-overlay`
 * (z-index 2000) holds the four dim panels, and `_renderStep` escalates the
 * highlighted target's own panel above them so it is not dimmed. The glow ring
 * has to clear *both*.
 *
 * It did not: the ring was a child of the overlay, whose z-index makes it a
 * stacking context, so the escalated panel painted straight over the ring and
 * the highlight silently vanished (reported 2026-07-22 as "the button glows but
 * the glow is behind the panel"). The fix parents the ring to <body> with its own
 * z-index. Nothing throws when this regresses — the glow just disappears — so the
 * ordering is pinned here.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const MANAGER = read(path.join('src', 'ui', 'OnboardingManager.js'));
const CSS = read(path.join('src', 'ui', 'Onboarding.css'));

/** z-index of the first rule matching `selector` in Onboarding.css. */
function zIndexOf(selector) {
    const block = new RegExp(`${selector.replace(/[.#]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(CSS);
    const z = block && /z-index:\s*(\d+)/.exec(block[1]);
    return z ? Number(z[1]) : null;
}

describe('onboarding spotlight stacking', () => {
    const overlayZ = zIndexOf('#onboarding-overlay');
    const ringZ = zIndexOf('.ob-ring');
    const tooltipZ = zIndexOf('#onboarding-tooltip');
    // The value `_renderStep` assigns to the highlighted target's parent panel.
    const escalatedZ = Number(/parentPanel\.style\.zIndex\s*=\s*'(\d+)'/.exec(MANAGER)?.[1]);

    it('reads the stacking values it is guarding', () => {
        expect(overlayZ).toBeGreaterThan(0);
        expect(ringZ).toBeGreaterThan(0);
        expect(tooltipZ).toBeGreaterThan(0);
        expect(escalatedZ).toBeGreaterThan(0);
    });

    it('the ring clears the panel escalated over the dim layer', () => {
        expect(ringZ).toBeGreaterThan(escalatedZ);
        expect(ringZ).toBeGreaterThan(overlayZ);
    });

    it('the ring stays under the tooltip, so it never covers the step text', () => {
        expect(ringZ).toBeLessThan(tooltipZ);
    });

    it('the ring is parented to <body>, not the overlay stacking context', () => {
        // A ring appended to `this.ui.overlay` cannot escape that context no
        // matter what z-index it is given — the CSS above would be inert.
        expect(MANAGER).toMatch(/document\.body\.appendChild\(this\.ring\)/);
        expect(MANAGER).not.toMatch(/overlay\.appendChild\(this\.ring\)/);
    });
});
