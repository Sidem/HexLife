[← `@hexlife/embed` docs](./README.md)

# `@hexlife/embed/spacetime` — a run, drawn as a solid

The grid is the cross-section, time is the vertical axis, and one retained tick is one layer of a
three-dimensional object you can turn, slice and look inside. It is the HexLife Explorer's spacetime
view, packaged: the same ray-march, the same shaders, the same framing.

**It simulates nothing.** Like [`/solid`](./solid.md), it is a layer sink: a host runs whichever
engine it likes — [`/sim`](./sim.md), [`/ca`](./ca.md), [`/stochastic`](./stochastic.md), or its own
— and hands over one generation per tick. The two entries are siblings on purpose. `/solid` welds
those layers into a mesh you can print; this one draws them as the object they would be, at
interactive frame rates, without meshing anything.

```js
import {createSpacetimeView} from '@hexlife/embed/spacetime'
import {createSimulation} from '@hexlife/embed/sim'

const world = await createSimulation({rulesetHex, rows: 24, columns: 30})
const view = createSpacetimeView(canvas, {rows: 24, columns: 30, depth: 120})

for (let tick = 0; tick < 120; tick++) {
  view.pushState(world.state, {ruleIndices: world.ruleIndices, tick})
  world.tick()
}
view.draw()
```

Drag the canvas to turn the object, wheel or pinch to move in and out. That is on by default; pass
`controls: false` and drive [`orbit()`](#the-camera) yourself if the host has its own gestures.

## What it costs

Cost is **pixels × march steps, and is independent of grid resolution**: a 576-row world costs the
same per frame as a 96-row one, because the object is a fragment-shader construction rather than
geometry. Two dials matter and neither is the grid:

| Dial | Effect |
| :--- | :--- |
| `maxDpr` (default `1.5`) | The march is pure fragment work, so a phone at DPR 3 pays 9× for the same object. This is the cap that stops it. |
| `layerAlpha` (default `0.12`) | `0` is an **opaque** solid: the first hit wins and the ray stops, which is the cheap case. Above 0 the ray accumulates front-to-back and every ray runs the length of the object. |

What a bigger world does cost is texture memory: **one byte per cell per layer**, allocated once.
`rows × columns × depth` — 43 KB for a 24×30 grid over 60 ticks, 41 MB for a 384-row world over the
full 240. Read it back from `view.stats.textureBytes` before committing to a large `depth`.

## Depth is a budget, not a total

`depth` is how many ticks the object retains, and it is **clamped to the device's
`MAX_ARRAY_TEXTURE_LAYERS`**, which WebGL2 only guarantees at 256. Ask for what you want and then
read what you got:

```js
const view = createSpacetimeView(canvas, {rows, columns, depth: 400})
view.depth      // ≤ 400 — what the device actually granted
view.maxLayers  // the device's cap
```

Past capacity the object behaves exactly like the Explorer's scrub ring: pushing a tick overwrites
the oldest layer, and the object keeps the most recent `depth` ticks. A host that wants the *whole*
run on a device with a low cap should feed every nth tick rather than let the bottom scroll away.

## Feeding it

| Call | Use for |
| :--- | :--- |
| `pushLayer(bytes, tick?)` | One tick, already one byte per cell. No copy at all. |
| `pushState(cells, {ruleIndices, tick})` | One generation, packed for you. |
| `setHistory(generations, {ruleIndices})` | A finished run, in a single upload. |
| `truncate(length)` / `reset()` | Drop the newest layers, or empty the object. Neither touches a texel. |

The layer byte **is** the colour-table index: `rule * 2 + state`. That has two consequences worth
knowing.

The first is that a binary world with no rule indices is *already packed* — its 0/1 state bytes are
valid layer bytes as they stand — so `pushLayer(world.state)` uploads a live view of the engine's
memory with no intermediate copy. With `ruleIndices`, `pushState` packs them in one JavaScript pass
per tick; a host feeding many worlds at once should pack in its own engine and call `pushLayer`.

The second is that **changing the palette re-uploads nothing**. `setPalette()` rewrites a 1 KB table
and retints every layer of history; not one byte of the volume moves. `view.stats.uploads` is there
so you can check that rather than take it on trust.

## Slicing

```js
view.setCrossSection(30)                          // layer 30 as an opaque plane through the solid
view.setScrub({offset: 12, isScrubbing: true})    // …or 12 ticks back from the live tip
view.setCrossSection(null)                        // no plane; the object whole
```

`setScrub` takes exactly the payload an Explorer-style transport bar reports, so a host that already
has one can forward it unchanged and the bar and the shape cannot drift apart.

## The camera

The object is framed for an orbit camera that sits 4.1–10 units out; `dolly()` clamps to that range,
because closer than the minimum the camera is inside a full-height object and further than the
maximum it is a speck. Both angles wrap: the up vector is derived from the view tangent, so pitch
passes through the poles indefinitely without a look-at singularity or a sudden flip.

```js
view.orbit(0.12, -0.04)   // radians
view.dolly(1.1)           // > 1 pulls back
view.setCamera({yaw: 0.55, pitch: 0.42, distance: 6.5})
view.resetCamera()
view.camera               // {yaw, pitch, distance}
```

`SPACETIME_CAMERA` exports those bounds and the default angles, and `computeGeometry(cols, rows,
depth, liveLayers)` returns the object's extent in camera space for a host that wants to reason
about the framing itself.

## Growth reads as growth

The object is **bottom-anchored** and its layer thickness comes from the volume's *capacity*, not
from how full it is. A half-fed volume is therefore a half-height object with ticks the same
thickness — not a full-height object with fat ones — so a live view grows upward as it runs, and
loses its top when a host truncates. If you are showing a *finished* run and want it to fill the
frame, create the view with `depth` equal to the number of layers you are about to push.

## Losing the context

The canvas emits `hexlife-spacetime-contextlost`, `hexlife-spacetime-contextrestored` and
`hexlife-spacetime-error`, and the matching `onContextLost` / `onContextRestored` options are called
first. **The volume comes back empty**: layers live only in GPU memory, because keeping a CPU mirror
of every tick would double the memory this entry exists to bound. A host that wants its object back
re-feeds it in the restore handler.

Call `destroy()` when you are done. It is not optional — the volume is by far the largest allocation
here, and dropping the last reference to the view does not reclaim GPU memory.

## Related

- [`/solid`](./solid.md) — the same layers, welded into a printable mesh.
- [`/render`](./renderer.md) — one generation, drawn flat. A separate entry because this one is a
  second program, two more shaders and a texture ring, and a host drawing a flat world should not
  carry them.
- [Solid Garden](https://sidem.github.io/HexLife/solid-garden.html) — both, side by side: the same
  run previewed as a solid and exported as a mesh.
