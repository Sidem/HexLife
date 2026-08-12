[← `@hexlife/embed` docs](./README.md)

# Getting started

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

The package has no runtime dependencies.

## A world on the page

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

From here, [`<hexlife-world>`](./hexlife-world.md) documents every attribute, method and event —
including the playback, interaction and appearance attributes that are safe to change on a live
world, and the ones that re-boot it.

## Many worlds

A browser gives a *page* about sixteen WebGL contexts, so a wall of `<hexlife-world>` elements
silently stops being a wall at sixteen. [`<hexlife-grid>`](./hexlife-grid.md) puts N simulations
behind one context and draws each into its own viewport.

```html
<hexlife-grid layout="16x16" rows="96" seed="12345" speed="15" paused></hexlife-grid>
```

## A world you own

For host-owned computation, use the same engine without mounting a DOM element:

```js
import {createDensityState, createSimulation, packCells} from '@hexlife/embed/sim'

const initialCells = createDensityState({rows: 64, columns: 74, seed: 12345, density: 0.5})
const sim = await createSimulation({rulesetHex, rows: 64, columns: 74, initialCells})
sim.tick(10)
const packed = packCells(sim.snapshotCells())
sim.dispose()
```

That entry has no DOM at module scope, so it runs in a Web Worker or in Node. See
[`/sim`](./sim.md) for initial-state generators, vacuum stability, and what the engine's exact
block-skipping fast path buys.

If you already own a simulation and only want HexLife's renderer, see [`/render`](./renderer.md).

## Beyond binary

`<hexlife-world>`, `<hexlife-grid>` and `/sim` are two-state worlds and stay that way. Two further
engines ship in the same package, each behind its own entry point:

- [`/ca`](./ca.md) — **k-state** worlds, with a block-partitioned backend that can conserve mass
  exactly. For physical models: fluids, granular matter, reactions.
- [`/stochastic`](./stochastic.md) — probability and time spent in a state, plus a conserved lattice
  gas. For wildfire, epidemics, and momentum-carrying flow.

Neither is downloaded or initialized by importing the package root.

## Requirements

WebGL2 and WebAssembly, and Node 20+ for the DOM-free entries. There is no 2D fallback — call
`detectGraphicsPath()` from [`/api`](./api.md#gpu-support) to detect that up front, before you mount
anything.

The browser bundle **inlines the Wasm binary** as a data URI rather than fetching a side-car asset,
because a strict host CSP (a Reddit webview, for instance) is not something an embed can widen.

## Next

- [Entry points](./entrypoints.md) — the ten imports and what each requires.
- [Determinism and versioning](./determinism.md) — the reproducibility contract and how to check a
  build against the pinned reference checksum.
