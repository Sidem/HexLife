# `@hexlife/embed`

**Fast, deterministic hexagonal cellular automata for ordinary web pages, browser workers, and Node.**

[![npm](https://img.shields.io/npm/v/@hexlife/embed?logo=npm&color=CB3837)](https://www.npmjs.com/package/@hexlife/embed)
[![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/Sidem/HexLife/blob/main/LICENSE)
![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![types](https://img.shields.io/badge/types-included-3178C6?logo=typescript&logoColor=white)
![engines](https://img.shields.io/badge/Rust-WebAssembly-orange?logo=rust&logoColor=white)
![WebGL2](https://img.shields.io/badge/WebGL2-instanced-990000?logo=webgl&logoColor=white)

The package bundles the Rust/Wasm tick engine and WebGL2 renderer used by
[HexLife Explorer](https://sidem.github.io/HexLife/), then exposes them at the level a host needs:
custom elements for the quickest integration, or DOM-free simulation and renderer-only entrypoints
for applications that own more of the stack.

The same `(ruleset, seed, density, rows)` produces a byte-identical tick sequence in HexLife
Explorer, an embed, and HexLife on Reddit. An embed is therefore a reproducible world, not a visual
approximation of one.

## Install

```bash
npm install @hexlife/embed
```

## Quick start

```js
import '@hexlife/embed' // registers <hexlife-world> and <hexlife-grid>
```

```html
<hexlife-world
  ruleset="D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6"
  rows="64"
  seed="12345"
  speed="20"
></hexlife-world>
```

The element is `display: block` with a `1 / 1` aspect ratio by default; give it a width and it sizes
itself. Everything lives in a shadow root, so the host page's CSS cannot break it and its CSS cannot
touch the host.

For host-owned computation, use the same engine without mounting a DOM element:

```js
import {createDensityState, createSimulation, packCells} from '@hexlife/embed/sim'

const initialCells = createDensityState({rows: 64, columns: 74, seed: 12345, density: 0.5})
const sim = await createSimulation({rulesetHex, rows: 64, columns: 74, initialCells})
sim.tick(10)
const packed = packCells(sim.snapshotCells())
sim.dispose()
```

## Printable solids

`@hexlife/embed/solid` extrudes a run through time into an object you can print: the hex grid is the
cross-section, each tick is a layer, on cells are matter. It **simulates nothing** — it is a layer
sink, so the binary, k-state and stochastic engines all feed the same buffer.

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
report.keptComponents // → 1 means it prints as a single piece
report.floating       // → components that never reach the build surface

const bytes = await stack.export({format: '3mf', cellSize: 2, layerHeight: 0.8})
stack.free()                             // mandatory
```

**Read the report before you export.** A slicer will not join separate bodies — it will happily
print forty loose fragments and let you find out on the build plate.

**`interpolate: 'bridge'`** is what makes the object hold together. Two prisms on consecutive layers
whose cells are diagonal neighbours meet along a single vertical edge — a zero-thickness hinge that
reports as connected and prints as two pieces. Bridging inserts exactly the set that turns that into
face contact, without the fattening `'union'` causes. For a **vacuum-stable** ruleset it guarantees
that nothing floats: every voxel is face-connected down to tick 0. Check with `isVacuumStable()` from
`/api` first — the guarantee is precisely as good as its precondition.

**Units are millimetres.** `cellSize` (hexagon circumradius) and `layerHeight` are independent, so
the object's Z aspect ratio is a print decision rather than an accident of tick count. Formats are
`'stl'` (default, universal), `'ply'` (indexed, ~⅓ the bytes) and `'3mf'` (indexed XML in a zip —
what slicers prefer, and the only one that carries real units).

**`merge: 'greedy'`** is the default and welds runs of coplanar faces into single quads: 586,864
triangles down to 16,796 on a 30×36×100 volume, and the 3MF down to 0.125 MiB. `merge: 'none'` is a
supported first-class setting, not a debug flag — merging necessarily leaves T-junctions, slicers do
not care, strict manifold validators do. Both meshes bound exactly the same solid.

The boundary of the printed object is **open, not toroidal**: the simulation wraps, an object cannot,
so features are cut at the grid edge and two pieces touching only across the seam are two pieces.

→ [Full `/solid` reference](https://github.com/Sidem/HexLife/blob/main/docs/embed/solid.md)

## Documentation

The full reference lives in the repository, one page per surface:

| Page | What it covers |
| :--- | :--- |
| [**Docs index**](https://github.com/Sidem/HexLife/blob/main/docs/embed/README.md) | Everything below, in one table. |
| [Getting started](https://github.com/Sidem/HexLife/blob/main/docs/embed/getting-started.md) | Install, first world, sizing, host-owned simulation, requirements. |
| [Entry points](https://github.com/Sidem/HexLife/blob/main/docs/embed/entrypoints.md) | Which of the eight imports you need and what each requires. |
| [`<hexlife-world>`](https://github.com/Sidem/HexLife/blob/main/docs/embed/hexlife-world.md) | Attributes, JavaScript API, events, GPU-loss recovery, policies, styling. |
| [`<hexlife-grid>`](https://github.com/Sidem/HexLife/blob/main/docs/embed/hexlife-grid.md) | Many worlds in one WebGL context. |
| [`/sim`](https://github.com/Sidem/HexLife/blob/main/docs/embed/sim.md) | DOM-free simulation, seeded and sparse states, vacuum stability, block skipping. |
| [`/render`](https://github.com/Sidem/HexLife/blob/main/docs/embed/renderer.md) | The renderer alone, for hosts that own their simulation. |
| [`/ca`](https://github.com/Sidem/HexLife/blob/main/docs/embed/ca.md) | k-state worlds, conservation, isotropy, `<hexlife-ca>`, `HXK1` codes. |
| [`/stochastic`](https://github.com/Sidem/HexLife/blob/main/docs/embed/stochastic.md) | Probability and time-in-state, the lattice gas, `<hexlife-stochastic>`, `HXS1` codes. |
| [`/solid`](https://github.com/Sidem/HexLife/blob/main/docs/embed/solid.md) | Extrude a run into a printable solid: welding, components, meshing, STL/PLY/3MF. |
| [`/api`](https://github.com/Sidem/HexLife/blob/main/docs/embed/api.md) | DOM-free metadata, world codecs, palettes, GPU probing. |
| [Determinism & versioning](https://github.com/Sidem/HexLife/blob/main/docs/embed/determinism.md) | The reproducibility contract and what a major bump means. |

## Entry points

| Import | Needs | Use for |
| :--- | :--- | :--- |
| `@hexlife/embed` | DOM, WebGL2, Wasm | The browser. Registers `<hexlife-world>` and `<hexlife-grid>`. |
| `@hexlife/embed/api` | Nothing | Node and browsers alike: world codes, ruleset metadata, palettes, GPU probing. |
| `@hexlife/embed/sim` | Wasm | Node and workers: deterministic host-driven simulation, no DOM or rendering. |
| `@hexlife/embed/render` | DOM, WebGL2 | Draw externally supplied state without ticking a simulation. |
| `@hexlife/embed/ca` | Wasm | **k-state** worlds — a second engine, with an optionally mass-conserving backend. |
| `@hexlife/embed/ca-element` | DOM, WebGL2, Wasm | Registers `<hexlife-ca>`. |
| `@hexlife/embed/stochastic` | Wasm | Probabilistic and time-dependent worlds, plus the conserved lattice gas. A separately loaded artifact. |
| `@hexlife/embed/stochastic-element` | DOM, WebGL2, Wasm | Registers `<hexlife-stochastic>`. The only element entry that reaches the stochastic artifact. |
| `@hexlife/embed/solid` | Wasm | **Printable solids.** Extrude a run of any of the engines above through time; export STL, PLY or 3MF. A third separately loaded artifact. |

A server that validates a pasted world code must import **only** `@hexlife/embed/api` — the root
entry evaluates custom-element, Wasm and WebGL code at import time.

The browser bundle **inlines the Wasm binary** as a data URI rather than fetching a side-car asset,
because a strict host CSP (a Reddit webview, for instance) is not something an embed can widen.

## Live examples

Every page below is a package consumer with the same presentation shell. The k-state pages resolve
the exact published npm version through jsDelivr; they do not reach into Explorer internals.

| Demo | What it demonstrates | Package surface |
|---|---|---|
| [**Interactive demo library**](https://sidem.github.io/HexLife/embed-demos.html) | Nine focused experiments spanning crystal growth, ecology, excitable media, particles, seeded probability, deterministic chaos, sound, and interacting matter. | Every public entrypoint, with each page consuming the published npm package |
| [**256 worlds, one rule class**](https://sidem.github.io/HexLife/totalistic-256.html) | All 256 totalistic rules simultaneously, or an equally sized sample of a larger rule class. One shared clock, initial condition, palette, and GPU context make rule-to-rule comparison direct. | `<hexlife-grid>`, `<hexlife-world>`, `/api` |
| [**Coffee extraction lab**](https://sidem.github.io/HexLife/coffee-percolation.html) | Six- and sixteen-state physical models with exact conservation, host-driven boundaries, and both rule backends side by side. | `/ca`, `/ca-element`, `<hexlife-ca>` |
| [**k-state CA builder**](https://sidem.github.io/HexLife/ca-builder.html) | Edit exact transition tables, paint and run the Wasm world, inspect invariants, and export a standalone npm-package example. | `/ca`, `/ca-element`, `<hexlife-ca>` |

The atlas is also a performance demonstration: `<hexlife-grid>` runs hundreds of simulations but
draws them through one WebGL2 context, avoiding the browser context limit that makes a wall of
independent canvases fail. For sparse or settled worlds, exact uniform-block skipping makes the
383k-cell binary engine about **13× faster** at a fixed point and about **2.4× faster** at 0.2%
occupancy on the project benchmark machine. No approximation or separate "fast" result is involved.

## Determinism

For the same `(ruleset, seed, density, rows)`, this package and HexLife Explorer run the same Wasm
`run_tick` over a grid derived the same way and filled by the same seeded RNG, so they agree tick for
tick. The pinned reference, if you want to check a build:

```js
const world = document.getElementById('ref')  // <hexlife-world ruleset="D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6"
world.reset(12345)                            //                rows="64" density="0.5" seed="12345" paused>
world.tick(100)
world.checksum // → 231200078
```

## Requirements

WebGL2 and WebAssembly, and Node 20+ for the DOM-free entries. There is no 2D fallback — call
`detectGraphicsPath()` from `@hexlife/embed/api` to detect that before you mount anything.

## Versioning

The custom-element API is **additive**: attributes, methods and events are only added, never removed
or repurposed. A *major* bump is reserved for the things that would break reproducibility — what a
ruleset hex decodes to, what an `HXW1.…` code decodes to, or the tick sequence itself. A visual
change is not breaking; a world that comes back different is.

This package versions independently of the HexLife Explorer application.

## Links

- [Documentation](https://github.com/Sidem/HexLife/blob/main/docs/embed/README.md)
- [Source and releases](https://github.com/Sidem/HexLife) — `embed-vX.Y.Z` tags
- [Changelog](https://github.com/Sidem/HexLife/blob/main/CHANGELOG.md)
- [Issues](https://github.com/Sidem/HexLife/issues)
- [HexLife Explorer](https://sidem.github.io/HexLife/) — the full lab

## License

[MIT](https://github.com/Sidem/HexLife/blob/main/LICENSE) © Sidem
