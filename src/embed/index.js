// NB: deliberately NOT `// @ts-check` — see the note atop EmbedSim.js.

/**
 * Public entry point for the embeddable widget (#25).
 *
 * Importing this module *registers* `<hexlife-world>` — that is its entire job as a side effect,
 * because the consumer contract is a bare script tag:
 *
 * ```html
 * <script type="module" src="https://sidem.github.io/HexLife/embed/v1/hexlife-embed.js"></script>
 * <hexlife-world ruleset="…32 hex…" seed="1234" rows="64" palette="synthwave"></hexlife-world>
 * ```
 *
 * Registration is idempotent: a page that (say) loads the script twice, or a bundler that pulls it
 * in from two places, must not throw a "name has already been used" DOMException at the host.
 *
 * The named exports exist for programmatic consumers — notably the Devvit webview (#26), which
 * imports this module directly from source rather than over a CDN.
 */

import { HexLifeElement } from './HexLifeElement.js';

export const TAG_NAME = 'hexlife-world';

if (typeof customElements !== 'undefined' && !customElements.get(TAG_NAME)) {
    customElements.define(TAG_NAME, HexLifeElement);
}

export { HexLifeElement };
export { EmbedSim, initEmbedWasm } from './EmbedSim.js';
export { EmbedRenderer } from './EmbedRenderer.js';
