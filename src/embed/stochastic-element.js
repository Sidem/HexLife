// NB: deliberately NOT `// @ts-check` — see the note atop EmbedSim.js.

/**
 * `@hexlife/embed/stochastic-element` — importing this module *registers* `<hexlife-stochastic>`.
 *
 * ```html
 * <script type="module">
 *   import { compileStochasticRule } from 'https://cdn.jsdelivr.net/npm/@hexlife/embed/stochastic/+esm'
 *   import 'https://cdn.jsdelivr.net/npm/@hexlife/embed/stochastic-element/+esm'
 *
 *   const el = document.querySelector('hexlife-stochastic')
 *   el.addEventListener('hexlife-stochastic-ready', () => el.setRule(wildfire))
 * </script>
 * <hexlife-stochastic rows="96" speed="20"></hexlife-stochastic>
 * ```
 *
 * ## Why this is its own entry
 *
 * The same argument that gave `<hexlife-ca>` its own entry, one step stronger.
 *
 * - **Not `stochastic.js`.** That entry is DOM-free by contract — a Node host imports it to compile
 *   rules, drive `StochasticWorld` headlessly, and validate `HXS1` codes — and it is deliberately
 *   absent from the package's `sideEffects` list. A `customElements.define` there would be a side
 *   effect a bundler is licensed to tree-shake away: it would cost Node hosts an `HTMLElement`
 *   reference they cannot satisfy, and would not reliably be there for the hosts that want it.
 * - **Not `index.js` or `ca-element.js`.** Registering here would weld the **isolated stochastic
 *   Wasm artifact** into the binary and k-state element bundles. That is not merely dead weight; it
 *   is the exact invariant the second artifact exists to protect, and the one the import-boundary
 *   tests and the cold-import fixtures measure: a root-only or ca-only consumer makes zero
 *   stochastic requests and instantiates zero stochastic bytes.
 *
 * Registration is idempotent: a page that loads this twice, or a bundler that pulls it in from two
 * places, must not throw a "name has already been used" DOMException at the host.
 */

import { HexStochasticElement } from './HexStochasticElement.js';

export const STOCHASTIC_TAG_NAME = 'hexlife-stochastic';

if (typeof customElements !== 'undefined' && !customElements.get(STOCHASTIC_TAG_NAME)) {
    customElements.define(STOCHASTIC_TAG_NAME, HexStochasticElement);
}

export { HexStochasticElement };
// Convenience re-exports so a host that only imports this entry can still compile a rule, build a
// gas table and read a code. The engine surface proper lives in `@hexlife/embed/stochastic`, which
// this imports anyway — these add no bytes.
export {
    compileGasRule,
    compileStochasticRule,
    createStochasticWorldFromCode,
    decodeStochasticCode,
    encodeStochasticCode,
    hexGasCollide,
    independentNeighborChance,
    initStochasticEngine,
    isConservativeGasRule,
    isStochasticCode,
    randomU32,
    StochasticWorld,
    BACKEND_LATTICE_GAS,
    BACKEND_NEIGHBORHOOD,
    GAS_SPECIES,
    GAS_STATES,
    MAX_STOCHASTIC_STATES,
    RNG_LEGACY_DEMO_V0,
    RNG_PHILOX_V1,
    STOCHASTIC_RNG_VERSION,
} from './stochastic.js';
