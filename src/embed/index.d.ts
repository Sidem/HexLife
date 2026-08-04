/**
 * Type surface for the package root (`@hexlife/embed`) — the browser entry.
 *
 * Importing the root *registers* both custom elements as a side effect; this file declares what
 * that import makes available to a TypeScript host. It adds no types of its own, on purpose: it
 * declares *membership* in the public surface, and each element's shape is maintained in the
 * sibling `.d.ts` that sits beside its runtime.
 *
 * Both element modules also augment `HTMLElementTagNameMap`, so `document.querySelector` and
 * `document.createElement` are typed for `<hexlife-world>` and `<hexlife-grid>` after this import.
 */

export declare const TAG_NAME: 'hexlife-world'
export declare const GRID_TAG_NAME: 'hexlife-grid'

// Classes, so a host can `extends` them or name them as values — not merely as types.
export {HexLifeElement} from './hexlife-world.js'
export {HexLifeGridElement} from './hexlife-grid.js'

export type {
  HexLifeSim,
  HexLifeReadyDetail,
  HexLifePlayStateDetail,
  HexLifeErrorDetail,
  HexLifeContextDetail,
  HexLifeElementEventMap,
} from './hexlife-world.js'

export type {
  HexLifeGridReadyDetail,
  HexLifeWorldSelectDetail,
  HexLifeTileRect,
  HexLifeGridElementEventMap,
} from './hexlife-grid.js'

export {decodeWorldCode, encodeWorldCode, isWorldCode} from '../core/WorldCodec.js'
