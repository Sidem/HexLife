/**
 * Type surface for `api.js` — the host boundary (see the JSDoc there).
 *
 * Hosts build with `allowJs: false`, so a symbol is only usable across the boundary if it has a
 * declaration. Everything here re-exports a sibling `.d.ts` that is kept in step with the JSDoc of
 * its own module; this file adds no types of its own, on purpose — it declares *membership* in the
 * public surface, not shape.
 */

export {
  describeRuleset,
  ORBIT_LABELS,
  type RulesetDescription,
} from '../core/rulesetDescriptor.js'
export {rulesetName} from '../core/rulesetName.js'
export {
  decodeWorldCode,
  encodeWorldCode,
  explorerUrlForRuleset,
  type DecodedWorld,
  type GeneratorDescriptor,
  type WorldCodeInput,
} from '../core/WorldCodec.js'
export {
  createGpuHelpPanel,
  detectGraphicsPath,
  type GraphicsPath,
  type GraphicsStatus,
} from '../utils/gpuSupport.js'
/** The element `index.js` registers. Type-only: registration is that module's side effect. */
export type {HexLifeElement} from './hexlife-world.js'
