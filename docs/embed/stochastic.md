[← `@hexlife/embed` docs](./README.md)

# `@hexlife/embed/stochastic` — stateful probability in native Wasm

The stochastic entry is a third engine and a second Wasm artifact. Importing the package root,
`/sim`, `/ca`, or `/ca-element` neither downloads nor initializes it. Use it for a radius-1 model
whose transition depends on probability or time spent in a state, such as wildfire and epidemics.

```js
import {
  compileStochasticRule,
  independentNeighborChance,
  initStochasticEngine,
  StochasticWorld,
} from '@hexlife/embed/stochastic'

const rule = compileStochasticRule({
  states: 4,
  transitions: [
    {
      from: 0,
      neighborState: 1,
      probabilityByMask: independentNeighborChance(0.12),
      to: 1,
      stream: 'infection',
    },
    {from: 1, minAge: 6, to: 2},
    {from: 2, minAge: 36, to: 0},
  ],
})

await initStochasticEngine()
const world = new StochasticWorld({
  rows: 72,
  columns: 84, // even, so the odd-q torus closes
  seed: 12345,
  rule,
  cells: initialCells,
})

world.tick(10)
console.log(world.generation, world.census(), world.checksum())
world.dispose()
```

## Compiling a rule

`compileStochasticRule()` canonicalizes at most 64 rows by current state and descending priority,
rejects equal-priority ambiguity, and quantizes probability once into 64 integer thresholds indexed
by the canonical six-direction neighbor mask. The Rust tick performs no floating-point probability
work, host callback, grid upload, or allocation. `probability: 0` never fires and `probability: 1`
always fires.

`independentNeighborChance(p)` materializes `1 - (1 - p)ⁿ` for all masks. Pass six probabilities
instead of one to author direction-dependent exposure such as wind. A stochastic row needs an
explicit `stream`; strings are converted to stable FNV-1a ids, and numeric u32 ids are accepted when
matching an existing counter schedule.

## Age, interventions, comparison

Age is stored as the generation when a cell entered its current state rather than incremented on
every tick. `minAge`/`maxAge` are inclusive u16 bounds. `setInitialState(cells, elapsedAges)` replaces
the exact reset snapshot; `setCells()` and `setCell()` are intervention APIs, not streaming tick
paths. `snapshotElapsedAges()` is an explicit copy for export/debug only.
`differenceCount(other)` compares two same-sized worlds' visible states inside Wasm and returns one
number; paired instruments do not need two snapshots or a JavaScript per-cell scan.

## Randomness

New rules use version-1 Philox4x32-10, addressed by `(seed, generation, cell, stream)`, so decisions
do not depend on iteration order or on whether another cell was evaluated. `legacy-demo-v0` is an
explicit compiler option only for byte-identical migration of HexLife's frozen Wildfire and Outbreak
reference trajectories. It is never selected implicitly.

## Activity skipping is exact, not approximate

Ticks skip chunks that provably cannot change, and `setSkippingEnabled(false)` forces the dense
reference path. The two produce identical state, ages, census, transition counts and checksums every
tick — which is the point: skipping is a change-propagation argument, not a quiescence heuristic, so a
world full of spontaneous transitions simply has nothing to skip rather than drifting.
`activeChunkCount()` / `chunkCount()` report what it actually bought.

## The conserved lattice gas

The second backend, chosen at construction (`backend: 'lattice-gas'`) because each allocates its own
buffers and never the other's. A site is **six velocity channels** rather than one particle, so it
carries momentum; `compileGasRule()` runs your collision operator once per packed configuration at
compile time and stores the result, and the tick never evaluates it per cell.

```js
import {compileGasRule, isConservativeGasRule, GAS_STATES} from '@hexlife/embed/stochastic'

const rule = compileGasRule()                   // the canonical two-species hex operator
isConservativeGasRule(rule)                     // → true: every entry conserves both species
```

`hexGasCollide` is that default operator: head-on pairs rotate ±60° (the one genuinely ambiguous
outcome, and the only one that consumes a random number), symmetric triads rotate to the other triad,
everything else streams through. Species travel with their particle, so `speciesCount(1)` and
`speciesCount(2)` are conserved entry by entry rather than on average. `scatter` adds an optional
thermal rotation and is deliberately *not* momentum-conserving; `scatter: 0` is the conserving mode.

The five visible states are projected from the channels: `vacuum · amber · cyan · mixed · wall`.
Walls are reflecting sites — a closed rim is what makes the toroidal lattice finite — and `setWall()`
opens or seals one without touching anything else.

## `HXS1` world codes

`encodeStochasticCode` / `decodeStochasticCode` / `isStochasticCode`, DOM-free like the k-state pair,
so a Node host can validate a pasted code without loading the second artifact at all.

A code carries geometry, backend, visible states, palette, the compiled rule, the seed, the
**generation**, and the exact visible *and auxiliary* state — age epochs for the neighborhood backend,
channels and walls for the gas. That is what makes the contract stronger than the other two codecs':
an `HXS1.` resumes to an identical **next tick**, not merely an identical frame. A code that restored
the picture but not the generation would draw the same world and then diverge on its first roll.

`createStochasticWorldFromCode(code)` rebuilds that world at its own generation, or returns `null` for
anything that is not a decodable code — a pasted string is a "no", never an exception.

---

## `<hexlife-stochastic>` — the stochastic element

```html
<script type="module">
  import {compileStochasticRule, independentNeighborChance} from '@hexlife/embed/stochastic'
  import '@hexlife/embed/stochastic-element'    // registers <hexlife-stochastic>

  const el = document.querySelector('hexlife-stochastic')
  el.addEventListener('hexlife-stochastic-ready', () => {
    el.setRule(compileStochasticRule({states: 3, transitions: [/* … */]}))
    el.setInitialState(myCells)
  })
</script>

<hexlife-stochastic rows="96" speed="20"></hexlife-stochastic>
```

The third element, and separate for a reason stronger than the k-state one: it is the only element
that touches the second Wasm artifact, and a root-only or `ca-element`-only page must download and
instantiate **zero** stochastic bytes. It shares `EmbedRenderer` with the other two and nothing else.

Like them it is `display: block` with a `1 / 1` aspect ratio, lives entirely in a shadow root, and
**never throws into the host page** — a bad `code`, a malformed rule, a missing WebGL2 context and a
wasm failure all land in a styled error box and fire `hexlife-stochastic-error`. It carries the same
lifecycle policies as [`<hexlife-ca>`](./ca.md#hexlife-ca--the-k-state-element): offscreen pause,
hidden-tab pause, reduced motion, a DPR cap, and context-loss recovery that rebuilds only the
renderer.

The render loop calls native `tick(n)` and draws the engine's **visible-state view directly**. There
is no per-tick snapshot, no host mirror and no upload: `setCells()` is an intervention API here and
never becomes a streaming one.

### Neither the rule nor the seed is an attribute

A compiled rule is 272 bytes per row and a gas table is 32 KB, so there is no honest way to spell
either in HTML. A rule arrives inside a `code` or through `setRule()`. **The bytes decide the
backend** — installing an `HSG1` gas table on a neighborhood world rebuilds it as a lattice gas, same
seed and geometry, at generation 0 — so there is no `backend` attribute that could contradict them.
Until a rule is installed the world cannot tick at all, so the element keeps its loop down and says so
in `hexlife-stochastic-ready`'s `hasRule`.

The seed is the `el.seed` property (a `bigint`), defaulting to a **fixed** value rather than entropy:
two loads of the same page must be the same run. Assigning a different one reboots the element; a host
that cares about the seed is already writing the script that installs the rule.

### Attributes

| Attribute | Default | Meaning |
|---|---|---|
| `rows` | `66` | Grid rows, 6–512. Columns are derived even, so the odd-q torus closes. |
| `code` | — | An `HXS1.` world code. A *complete* world — including its generation — replacing every attribute above. |
| `speed` | `10` | Ticks/second. |
| `paused` | absent | Boolean. Shows the poster frame with a play button. |
| `palette` | built-in | Comma-separated `#rrggbb`, one per visible state. Short lists are padded and long ones truncated. The lattice-gas default is semantic (`vacuum · amber · cyan · mixed · wall`), not a hue sweep. |
| `draw` | absent | Boolean. Pointer paints `draw-state`. |
| `draw-state` | `1` / `wall` | The visible state a stroke paints. In the gas only `vacuum` and `wall` are legal — a single site is six velocity channels, and the barrier is the one honest per-site write — so a gas stroke defaults to painting walls. |
| `brush` | `0` | Draw radius, 0–40; `0` is a single cell. In the gas this widens the barrier you are drawing, which is the point of having it. |
| `link` | shown | `link="off"` hides the attribution. |

### JavaScript API

`setRule(rule)`, `setInitialState(cells, ages?)`, `setCells(cells, ages?)`, `setCell(index, value)`,
`setInitialGasState(channels, walls?)`, `setGasCells(channels, walls?)`, `setWall(index, isWall)`,
`setBrushSize(size)`, `reset()`, `clear()`, `tick(n)`, `play()`, `pause()`, `census()`,
`speciesCount(species)`, `collisionCount()`, `stochasticCode()`.

`setInitialState` / `setInitialGasState` also replace the snapshot `reset()` rewinds to; the plain
`setCells` / `setGasCells` are interventions at the current generation. `clear()` blanks the world
without rewinding, and in the gas it keeps the walls — they are the container, not its contents.

Readonly: `world` (the live `StochasticWorld`, so a model needing `setSkippingEnabled`,
`transitionCounts()` or `sample()` can reach it directly), `rows`, `columns`, `backend`, `states`,
`generation`, `hasRule`, `checksum`, `lastChangedCount`, `chunkActivity`, `playing`, `userPaused`,
`error`. Read-write: `seed`.

There is no `isSettled`. `<hexlife-ca>` stops its loop on a fixed point because a k-state one is
genuinely unleavable; a stochastic world with a spontaneous transition can wake on any tick, so there
is nothing here that could honestly be called settled.

### Events

All bubble and cross the shadow boundary: `hexlife-stochastic-ready` (`{backend, rows, columns,
numCells, seed, generation, states, hasRule}`), `hexlife-stochastic-playstate` (`{playing,
userPaused}`), `hexlife-stochastic-error` (`{message, detail}`), `hexlife-stochastic-contextlost` /
`hexlife-stochastic-contextrestored`.

A lost GPU context does **not** restart the simulation, and here that matters twice over: the world
lives in the isolated artifact's linear memory and survives untouched, and a reboot would also drop
the rule, which arrived from script that has already finished running.

## Related

- [Interactive demo library](https://sidem.github.io/HexLife/embed-demos.html) — the wildfire,
  outbreak and lattice-gas pages are this engine.
- [`/ca`](./ca.md) — deterministic multi-state worlds, including the conserved block backend.
