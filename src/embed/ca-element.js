// NB: deliberately NOT `// @ts-check` — see the note atop EmbedSim.js.

/**
 * `@hexlife/embed/ca-element` — importing this module *registers* `<hexlife-ca>`.
 *
 * ```html
 * <script type="module">
 *   import { initEngine, blockRuleFromTable } from 'https://cdn.jsdelivr.net/npm/@hexlife/embed/ca/+esm'
 *   import 'https://cdn.jsdelivr.net/npm/@hexlife/embed/ca-element/+esm'   // registers <hexlife-ca>
 * </script>
 * <hexlife-ca states="4" rows="66" backend="block"></hexlife-ca>
 * ```
 *
 * ## Why this is its own entry
 *
 * Registration is a **side effect**, and the two modules that could otherwise host it both refuse it
 * for good reasons:
 *
 * - **Not `ca.js`.** That entry is DOM-free by contract — a Node host imports it to build rules and
 *   drive `HexCA` headlessly — and it is deliberately absent from the package's `sideEffects` list.
 *   A `customElements.define` there would be a side effect a bundler is licensed to tree-shake away,
 *   which is the worst of both worlds: it costs Node hosts a `HTMLElement` reference they cannot
 *   satisfy, and it is not reliably there for the hosts that want it.
 * - **Not `index.js`.** That is the bare-script-tag path for `<hexlife-world>`, and it is the one
 *   the Reddit webview and the CDN consumers load. Registering `<hexlife-ca>` there would weld the
 *   `WorldK` binding, the state-palette shader program and the `HXK1` codec into every binary
 *   embed's bundle — dead weight for the overwhelmingly common case, on exactly the devices least
 *   able to pay for it. The same separation the engine keeps between `World` and `WorldK`, carried
 *   through to distribution.
 *
 * The cost is that a page wanting both elements writes two imports. That is the honest price.
 *
 * Registration is idempotent: a page that loads this twice, or a bundler that pulls it in from two
 * places, must not throw a "name has already been used" DOMException at the host.
 */

import { HexCAElement } from './HexCAElement.js';

export const CA_TAG_NAME = 'hexlife-ca';

if (typeof customElements !== 'undefined' && !customElements.get(CA_TAG_NAME)) {
    customElements.define(CA_TAG_NAME, HexCAElement);
}

export { HexCAElement };
// Convenience re-exports so a host that only imports this entry can still build a rule and read a
// code. The engine surface proper lives in `@hexlife/embed/ca`, which this imports anyway.
export {
    blockRuleFromTable,
    decodeCaCode,
    encodeCaCode,
    HexCA,
    initEngine,
    isCaCode,
    isConservative,
    isIsotropic,
    ruleFromTable,
    BLOCK_PHASES,
    MAX_BLOCK_STATES,
    MAX_NEIGHBORHOOD_STATES,
} from './ca.js';
