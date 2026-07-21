/**
 * The import surface for **external hosts** of the HexLife engine.
 *
 * One host exists today: the Devvit app in `devvit/`, which is bundled straight from this source
 * tree (esbuild, not a package) so that Reddit posts and the Explorer share one engine, one codec
 * and one determinism contract. That arrangement is deliberate — see `devvit/scripts/build-client.mjs`
 * — but without a declared surface it degrades into "reach into whatever `src/` file has the symbol",
 * and every such reach is a refactor in the main app that silently breaks the Reddit app.
 *
 * So the boundary is this file, and the rule is one line: **`devvit/` imports from `src/embed/` and
 * nowhere else in `src/`.** `tests/devvitBoundary.test.js` enforces it.
 *
 * Two entry points, split by what they need to run:
 *
 * - `api.js` (here) — **host-agnostic**: no DOM at module scope, no wasm, no GL. The Devvit
 *   *server* bundles this to validate a pasted world code in Node, so nothing here may assume a
 *   browser at import time.
 * - `index.js` — the **browser** entry: importing it registers `<hexlife-world>` and pulls in the
 *   sim + renderer. Webview clients import it for the side effect; a Node bundle must not.
 *
 * Adding an export here is the point at which a main-app internal becomes something the Devvit app
 * may depend on. Give it a declaration in `api.d.ts` (the host builds with `allowJs: false`) and
 * keep it dependency-light — the modules re-exported below deliberately avoid `utils.js`/`config.js`.
 */

export { describeRuleset, ORBIT_LABELS } from '../core/rulesetDescriptor.js';
export { rulesetName } from '../core/rulesetName.js';
export { decodeWorldCode, encodeWorldCode, explorerUrlForRuleset } from '../core/WorldCodec.js';
// DOM-building, but only when called — the panel is detached nodes built on demand, so a server
// bundle that never calls it carries nothing that touches `document` at import time.
export { createGpuHelpPanel, detectGraphicsPath } from '../utils/gpuSupport.js';
