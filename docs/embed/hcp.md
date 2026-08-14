# `@hexlife/embed/hcp`

A **general k-state cellular automaton** on the hexagonal close-packed lattice. Fourth isolated
Wasm artifact: root, `/sim`, `/ca`, `/stochastic`, `/solid` and `/spacetime` fetch zero HCP bytes.

Coffee is a host. The engine has no coffee identifiers. A rule is a `k⁴` table a host installs
with `blockRuleFromTet`.

```js
import {
  initHcpEngine,
  HexHcp,
  blockRuleFromTet,
  isConservative,
  isIsotropic,
  encodeHcpCode, decodeHcpCode, isHcpCode,
} from '@hexlife/embed/hcp'

await initHcpEngine()
const rule = blockRuleFromTet(6, ([a, b, c, apex]) => [a, b, c, apex])
const world = new HexHcp({
  states: 6,
  layers: 24,
  rows: 48,
  columns: 56,
  rule,
  stacking: 'hcp',
  xyBoundary: 'torus',
  zBoundary: 'open',
})
world.setBlockAlternates(true)
world.tick(6)
world.census()
world.paintIf(0, inlets, 0, 1)
world.clearStatesInLayer(world.layers - 1, 0b0110)
```

`<hexlife-hcp>` is registered by `@hexlife/embed/hcp-element`. Attributes stay small (`states`,
`layers`, `rows`, `columns`, `speed`, `palette`, `paused`, `link`, `clip`, `opacity`). The rule and
cells arrive through `setRule` / `setCells` / `code` (`HXP1.`). The element calls native `tick(n)`
and draws the live Wasm view; it does not `setCells` after a tick.

Layer 0 is the open / shower face and is drawn at the **top** of the canvas, so `+layer` (the
engine's down) is visually down. Occupied sites are hex prisms of circumradius `R`, so in-plane
neighbours share an edge. `opacity` is site alpha (`0..1`); below 1 the draw depth-selects the
nearest occupied site and blends only that winner — the same contract as the torus shell, so
`0.99` is almost solid rather than a stack of every cell along the ray. The clip plane is what
opens the interior.

## Lattice

Layer-major indexing, then the existing odd-q layout:

```
index = ((layer * rows) + row) * cols + col
```

Constraints (throw, do not round): even `columns`, `rows % 3 == 0`, `layers >= 2`, `k` in `2..=16`.
`zBoundary: 'torus'` also requires even `layers`.

Twelve equidistant neighbours. In-plane slots are `neighbor-dirs.json`. Interlayer slots are
`hcp-dirs.json`. HCP: up offsets equal down offsets. Gravity is three equally-tilted down-bonds;
there is no unique vertical bond.

## Partition

v1 is **block only**. The block is a regular tetrahedron: a 2D triangle plus the unique HCP site
in its hollow. Table size `k⁴`. Period **6**:

```
tick % 6 → (σ, φ) = (⌊t/3⌋ % 2, t % 3)
```

Slot order is geometric and frozen: `[face0, face1, face2, apex=down]`. Changing it is a codec
version bump. `isConservative` is the multiset property over all `k⁴` entries — reported, never
enforced. `isIsotropic` is 3-fold about z (cycle the three face slots). Gravity rules fail it
on purpose.

`setBlockAlternates(true)` uses the exact 2D conjugate on odd ticks. Period becomes 12.

## Bulk layer ops

Pour and drip must not become a JS loop of `setCell`. Use:

- `paintIf(layer, indices, from, to)`
- `clearStatesInLayer(layer, mask)`
- `layerCensus(layer)`

## `HXP1`

Distinct prefix. Decoding never throws; invalid codes return `null`. A code is the **current**
world: geometry, boundaries, stacking, rule, generation, alternation, and cells. Restoring one
resumes the next tick identically.

Do **not** use jsDelivr's standalone ESM transform for more than one subpath.
