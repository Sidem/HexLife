[← `@hexlife/embed` docs](./README.md)

# Determinism and versioning

## The contract

The contract is reproducibility. For the same `(ruleset, seed, density, rows)`,
[`<hexlife-world>`](./hexlife-world.md) and HexLife Explorer run the same Wasm `run_tick` over a grid
derived the same way and filled by the same seeded RNG, so they agree tick for tick. The same holds
for [`/sim`](./sim.md) in a worker or in Node, and for HexLife on Reddit.

An embed is therefore a reproducible world, not a visual approximation of one.

## Checking a build

The pinned reference:

```html
<hexlife-world id="ref"
  ruleset="D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6"
  rows="64" density="0.5" seed="12345" paused
></hexlife-world>
```

```js
const world = document.getElementById('ref')
world.reset(12345)
world.tick(100)
world.checksum // → 231200078
```

## The other two engines

[`@hexlife/embed/ca`](./ca.md) is deterministic on the same terms — same states, grid, rule and cells
give the same tick sequence — but it is a **separate** engine with its own contract, and nothing
about it can move the number above.

[`@hexlife/embed/stochastic`](./stochastic.md) is deterministic in the seeded sense: the same
`(seed, generation, cell, stream)` produces the same decision, independent of iteration order and of
whether another cell was evaluated. Its exact-skipping fast path is asserted identical to the dense
path every tick, and an `HXS1.` code resumes to an identical *next tick* rather than merely an
identical frame.

## Requirements

WebGL2 and WebAssembly. No 2D fallback — see [`detectGraphicsPath`](./api.md#gpu-support) for
detecting that up front. Node 20+ for the DOM-free entries.

## Versioning

The custom-element API is **additive**: attributes, methods and events are only added, never removed
or repurposed. A *major* bump is reserved for the things that would break reproducibility — what a
ruleset hex decodes to, what an `HXW1.…` code decodes to, or the tick sequence itself. A visual
change is not breaking; a world that comes back different is.

This package versions independently of the HexLife Explorer application. Releases are tagged
`embed-vX.Y.Z` in the [repository](https://github.com/Sidem/HexLife/releases).
