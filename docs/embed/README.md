# `@hexlife/embed` — documentation

Fast, deterministic hexagonal cellular automata for ordinary web pages, browser workers, and Node.

This directory is the full reference for the package. The
[package README](../../packages/hexlife-embed/README.md) — the page you see on
[npmjs.com](https://www.npmjs.com/package/@hexlife/embed) — is the short version: what it is, how to
install it, and one working example. Everything else lives here.

These pages track `main`. The documentation for a published version is the copy on that version's
`embed-vX.Y.Z` tag.

## Start here

| Page | What it covers |
| :--- | :--- |
| [Getting started](./getting-started.md) | Install, first world, sizing, the host-owned simulation path, requirements. |
| [Entry points](./entrypoints.md) | Which of the ten imports you need, what each one costs, and what it requires. |

## Elements

| Page | What it covers |
| :--- | :--- |
| [`<hexlife-world>`](./hexlife-world.md) | One binary world. Attributes, JavaScript API, events, GPU-loss recovery, host policies, styling. |
| [`<hexlife-grid>`](./hexlife-grid.md) | Many worlds in one WebGL context — the comparison instrument. |
| [`<hexlife-ca>`](./ca.md#hexlife-ca--the-k-state-element) | The k-state element. |
| [`<hexlife-stochastic>`](./stochastic.md#hexlife-stochastic--the-stochastic-element) | The stochastic element. |

## Engines and modules

| Page | What it covers |
| :--- | :--- |
| [`/sim`](./sim.md) | DOM-free binary simulation, seeded and sparse initial states, vacuum stability, block skipping. |
| [`/render`](./renderer.md) | The renderer alone, for hosts that already own their simulation. |
| [`/spacetime`](./spacetime.md) | A whole run drawn as a 3D solid: one tick per layer, ray-marched, turnable and sliceable. |
| [`/ca`](./ca.md) | k-state worlds: two backends, conservation, isotropy, `HXK1` codes. |
| [`/stochastic`](./stochastic.md) | Probability and time-in-state, the conserved lattice gas, `HXS1` codes. |
| [`/solid`](./solid.md) | Extrude a run into a printable solid: welding, components, meshing, STL/PLY/3MF. |
| [`/api`](./api.md) | DOM-free metadata, world codecs, palettes, GPU probing. |

## Contracts

| Page | What it covers |
| :--- | :--- |
| [Determinism and versioning](./determinism.md) | The reproducibility contract, the pinned reference checksum, what a major bump means. |

## Live examples

Every page below is a package consumer with the same presentation shell. They resolve the exact
published npm version through jsDelivr; they do not reach into Explorer internals.

- [Interactive demo library](https://sidem.github.io/HexLife/embed-demos.html) — nine focused
  experiments spanning crystal growth, ecology, excitable media, particles, seeded probability,
  deterministic chaos, sound, and interacting matter.
- [256 worlds, one rule class](https://sidem.github.io/HexLife/totalistic-256.html) — the complete
  totalistic class on one map, through `<hexlife-grid>`.
- [Coffee extraction lab](https://sidem.github.io/HexLife/coffee-percolation.html) — six- and
  sixteen-state physical models with exact conservation, through `<hexlife-ca>`.
- [k-state CA builder](https://sidem.github.io/HexLife/ca-builder.html) — edit exact transition
  tables and export a standalone npm-package example.
