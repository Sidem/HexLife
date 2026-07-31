/**
 * The import surface for **external hosts** of the HexLife engine.
 *
 * External hosts consume this surface through `@hexlife/embed/api`. The package is built from
 * this source tree so Reddit posts and the Explorer share one engine, one codec, and one
 * determinism contract without cross-repository source imports.
 *
 * The boundary is this file: adding an export is an explicit compatibility decision for hosts.
 *
 * Two entry points, split by what they need to run:
 *
 * - `api.js` (here) — **host-agnostic**: no DOM at module scope, no wasm, no GL. The Devvit
 *   *server* bundles this to validate a pasted world code in Node, so nothing here may assume a
 *   browser at import time.
 * - `index.js` — the **browser** entry: importing it registers `<hexlife-world>` and pulls in the
 *   sim + renderer. Webview clients import it for the side effect; a Node bundle must not.
 *
 * Adding an export here is the point at which a main-app internal becomes something external hosts
 * may depend on. Give it a declaration in `api.d.ts` (Devvit builds with `allowJs: false`) and
 * keep it dependency-light — the modules re-exported below deliberately avoid `utils.js`/`config.js`.
 */

export { describeRuleset, ORBIT_LABELS } from '../core/rulesetDescriptor.js';
export { rulesetName } from '../core/rulesetName.js';
export { decodeWorldCode, encodeWorldCode, explorerUrlForRuleset } from '../core/WorldCodec.js';
// Just the key + label projection, not the gradient table — a host building a palette picker needs
// the names the `palette` attribute accepts, and nothing here should make a ramp's stops a
// compatibility surface. `colorPalettes.js` is plain data with no imports, so this stays server-safe.
export { listPresetPalettes } from '../core/colorPalettes.js';
// DOM-building, but only when called — the panel is detached nodes built on demand, so a server
// bundle that never calls it carries nothing that touches `document` at import time.
export { createGpuHelpPanel, detectGraphicsPath } from '../utils/gpuSupport.js';
