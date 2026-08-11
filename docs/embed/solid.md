[← `@hexlife/embed` docs](./README.md)

# `@hexlife/embed/solid` — printable solids from a run

Extrude a cellular-automaton run through time and get an object you can print: the 2D hex grid is the
cross-section, each tick is a layer, on cells are matter and off cells are void. DOM-free, so it
works in a Web Worker and in Node.

```js
import {createSolidStack, initSolidEngine} from '@hexlife/embed/solid'

await initSolidEngine()
const stack = createSolidStack({rows, cols, ticks, interpolate: 'bridge', subLayers: 1, basePlate: 2})

const layer = stack.layerView()          // build ONCE, outside the loop
for (let tick = 0; tick < ticks; tick++) {
  layer.set(world.state)                 // one memcpy per tick
  stack.pushLayer()
  world.tick()
}

const report = stack.finalize({keepComponents: 'plate-connected'})
if (report.keptComponents === 1) {
  const bytes = await stack.export({format: '3mf', cellSize: 2, layerHeight: 0.8})
}
stack.free()                             // mandatory
```

## It does not simulate

This engine is a **sink**, not a world. A host runs whichever HexLife engine it likes and hands over
one layer of cell states per tick, which is what makes it engine-agnostic: the binary
[`/sim`](./sim.md), the k-state [`/ca`](./ca.md), and the stochastic [`/stochastic`](./stochastic.md)
worlds all feed the same buffer. `solidStates` is a bitmask over state values — `0b10` (the default,
exported as `SOLID_STATES_BINARY`) means "state 1 is matter" — so a k-state world can decide that
states 2 and 5 are the solid ones and the rest are air.

It ships as a **separately loaded Wasm artifact**, like `/stochastic`. A page that embeds a world and
never exports one pays nothing for the mesher.

## `layerView()` is the whole ingestion path

Build the view once, outside the tick loop, and `set()` into it each tick. That copy is one memcpy
and it is the only data movement this pipeline performs in JavaScript; every per-voxel operation —
masking, bit-packing, interpolation, components, culling, merging, welding, and byte emission — is in
Rust. Prefer the engine's live `state` view over `snapshotCells()`, which allocates a copy per tick
for no benefit here.

> Everything sized by the geometry is allocated when the stack is constructed, so ingestion cannot
> grow the artifact's memory and detach the view you are reusing. Exporting *can* grow it; the
> package re-views its own buffers, so you only need to re-read `layerView()` if you cached the
> array across an `export()`.

## Welding the layers together — `interpolate`

Two prisms on consecutive layers whose cells are diagonal neighbours touch along a single vertical
edge. That is a zero-thickness hinge, not a joint: it reports as connected, prints as two pieces.

| Mode | What it does |
| :--- | :--- |
| `'bridge'` | **Default.** Inserts the exact set that converts diagonal space-time contact into face contact, and nothing more. |
| `'union'` | `A ∪ B`. Also welds, but fattens the object. |
| `'none'` | Raw layers. Forces `subLayers` to 0. Useful for measuring what interpolation is worth. |

`subLayers` is how many synthesized layers sit between two ingested ones. One is enough to weld;
more are a Z-resolution knob, not extra welding.

**The guarantee, and its precondition.** For a **vacuum-stable** ruleset, `'bridge'` with
`subLayers ≥ 1` makes every voxel face-connected downward to tick 0 — nothing can float. Vacuum
stability means birth requires a live neighbour, so every live cell at `t+1` has a live cell in its
neighbourhood-or-self at `t`, and the bridge layer turns that relation into a face path. Check it
with `isVacuumStable()` from [`/api`](./api.md) before you commit to a run.

It does **not** hold for non-vacuum-stable or stochastic rules, where an isolated birth is genuinely
orphaned. That is what the report below is for.

## Read the report before you export

A slicer will not join separate bodies. It will happily print forty loose fragments and let you
discover that on the build plate.

```js
const report = stack.finalize({keepComponents: 'plate-connected'})
// {componentCount, keptComponents, keptVoxels, droppedVoxels, floating}
```

`keptComponents === 1` means the object prints as one piece. `floating` counts the components that
never reach layer 0.

| `keepComponents` | Keeps |
| :--- | :--- |
| `'all'` | **Default.** Everything, fragments included. |
| `'largest'` | The single biggest component. |
| `'plate-connected'` | Everything reachable from layer 0 — the build surface. |

`basePlate: N` prepends `N` solid grid layers below tick 0, which is what makes `'plate-connected'`
mean "reachable from the build surface". It is a **construction** option, not a `finalize()` one,
because it changes the height of the volume and the volume is allocated exactly once.

## Geometry and units

Millimetres. `cellSize` is the hexagon circumradius and `layerHeight` the thickness of one layer;
they are independent, so the Z aspect ratio of the object is a print decision rather than an accident
of how many ticks you ran. A `rows × cols × totalLayers` object measures
`cols · 1.5 · cellSize` by `rows · √3 · cellSize` by `totalLayers · layerHeight`.

**The boundary is open, not toroidal.** The simulation wraps; a printed object cannot. Features are
cut at the grid edge, and two pieces touching only across the seam are two pieces. `neighborOf(cell,
direction)` returns `-1` there, and it is the same table the mesher culls against — so you can pin
the mesh's adjacency against `neighbor-dirs.json` rather than trusting a second derivation of the hex
geometry.

## Formats

```js
await stack.export({format: '3mf', cellSize: 2, layerHeight: 0.8, merge: 'greedy'})
```

| `format` | Notes |
| :--- | :--- |
| `'stl'` | **Default.** Binary, 50 bytes per triangle, no vertex sharing. The universal fallback. |
| `'ply'` | Binary indexed. Roughly a third of the STL for the same surface. |
| `'3mf'` | Indexed XML in a zip. What slicers prefer, and the only one carrying real units, so scale is unambiguous on import. |

`export()` is async because the 3MF container is deflated by `CompressionStream`. It returns a
`Uint8Array` copied out of Wasm memory, so it outlives the next export.

## `merge` and T-junctions

| Mode | What it does |
| :--- | :--- |
| `'greedy'` | **Default.** Welds runs of coplanar, contiguous, identically-oriented faces into single quads. |
| `'none'` | Every exposed face on its own. Watertight in the half-edge sense: no T-junctions anywhere. |

On a 30×36×100 reference volume merging takes the mesh from 586,864 triangles to 16,796 —
**34.9×** — and the 3MF from 4.50 MiB to 0.125 MiB.

`merge: 'none'` is a **first-class setting, not a debug flag.** Merging necessarily leaves
T-junctions, where one wall's run ends partway along its neighbour's. Slicers intersect planes and
never notice; strict manifold validators do, and `'none'` is the answer for them. Both meshes bound
exactly the same solid — the engine proves it, comparing their surface areas and enclosed volumes as
exact integers rather than within a tolerance.

Caps are not merged. `capTriangleCount` tells you how much of a given mesh they are; on a tall
extrusion the walls dominate before merging and the caps after.

## Budget

For a 30 rows × 36 cols × 100 ticks run with `bridge`, `subLayers: 1` and `basePlate: 2` — 202
layers, 162,703 voxels — at the defaults:

| | |
| :--- | :--- |
| Full pipeline | 22 ms (STL) · 54 ms (3MF) |
| Peak artifact memory | 4.94 MiB (STL) · 5.31 MiB (3MF) |
| Output | 0.80 MiB STL · 0.30 MiB PLY · 0.125 MiB 3MF |

`solidMemoryBytes()` reports the artifact's linear memory; Wasm memory never shrinks, so after a run
that is the run's peak. The one combination worth knowing about: `merge: 'none'` with `format: '3mf'`
on that volume needs ~71 MiB, because an unmerged mesh as XML is ~38 MB of text held at once. Either
merge, or pick another format, or both.

`free()` is mandatory — the volume is the largest allocation in the artifact and nothing else
reclaims it.

## Reproducibility

An export is a pure function of `(volume, geometry options, mesh options)`: vertices weld on exact
integer lattice coordinates rather than floats, so there are no epsilon comparisons and no cracks,
and nothing depends on hash iteration order or a per-process seed. Record `solidEngineVersion()`
alongside your option block and the object is reproducible exactly.

Reproducing an object means reproducing the **recipe**, not shipping the mesh: ruleset hex, seed,
ticks, grid and options are about sixty bytes. Stochastic worlds carry their seed in their world
code, so a stochastic variation is reproducible too — variation is intended, irreproducibility is
not.

One limit, stated plainly: for 3MF that guarantee covers the model part, which Rust writes
deterministically, not the compressed container. The deflate is the platform's, and zlib output
varies between implementations. Two runs on one machine are byte-identical; the same options
elsewhere may compress differently while inflating to identical bytes. STL and PLY carry the full
guarantee.

## What a slicer owns

Supports, orientation, and print preparation are not modelled here — a slicer does those better and
already asks you about them. Neither is smoothing: the object is exactly the prisms the automaton
occupied.

## Related

- [`/sim`](./sim.md) — the binary engine, and `isVacuumStable` as a precondition for the guarantee.
- [`/ca`](./ca.md) — k-state worlds, where `solidStates` picks which states are matter.
- [`/stochastic`](./stochastic.md) — probabilistic worlds; variation is a supported input, not a defect.
- [Determinism](./determinism.md) — the package-wide reproducibility contract.
