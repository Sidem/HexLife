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
const MOBILE_CSS = read(path.join('src', 'ui', 'views', 'MobileViews.css'));

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
    const panelZ = Number(/contains\('modal-overlay'\)\s*\?\s*'(\d+)'\s*:\s*'(\d+)'/.exec(MANAGER)?.[2]);
    const modalZ = Number(/contains\('modal-overlay'\)\s*\?\s*'(\d+)'/.exec(MANAGER)?.[1]);
    const mobileViewZ = Number(/\.mobile-view\s*\{[^}]*z-index:\s*(\d+)/s.exec(MOBILE_CSS)?.[1]);

    it('reads the stacking values it is guarding', () => {
        expect(overlayZ).toBeGreaterThan(0);
        expect(ringZ).toBeGreaterThan(0);
        expect(tooltipZ).toBeGreaterThan(0);
        expect(panelZ).toBeGreaterThan(0);
        expect(modalZ).toBeGreaterThan(0);
        expect(mobileViewZ).toBeGreaterThan(0);
    });

    it('the ring clears the panel escalated over the dim layer', () => {
        expect(ringZ).toBeGreaterThan(panelZ);
        expect(ringZ).toBeGreaterThan(modalZ);
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

    it('modal targets stay clickable above mobile views but below tour guidance', () => {
        expect(MANAGER).toMatch(/closest\([^)]*\.modal-overlay/);
        expect(modalZ).toBeGreaterThan(mobileViewZ);
        expect(modalZ).toBeLessThan(ringZ);
    });
});
