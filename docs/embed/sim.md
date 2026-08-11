[← `@hexlife/embed` docs](./README.md)

# `@hexlife/embed/sim` — host-driven binary simulation

The deterministic binary engine without DOM or rendering. Safe in a Web Worker and in Node.

```js
import {createDensityState, createSimulation, packCells} from '@hexlife/embed/sim'

const initialCells = createDensityState({rows: 64, columns: 74, seed: 12345, density: 0.5})
const sim = await createSimulation({rulesetHex, rows: 64, columns: 74, initialCells})
sim.tick(10)
const packed = packCells(sim.snapshotCells())
sim.dispose()
```

## Initial states

`createDensityState()` is the pure host-side initializer for canonical seeded density worlds. It does
not initialize Wasm, takes explicit rows and columns, preserves HexLife's special center cell at
density `0` or `1`, and treats every safe-integer seed—including `0`—deterministically. The custom
element's `seed="0"` attribute remains nondeterministic for backward compatibility.

`createSparseState()` is its opposite number: empty space with small connected structures scattered
into it. Same determinism contract, same explicit dimensions, and exactly
`round(occupancy × rows × columns)` live cells.

```js
import {createSparseState} from '@hexlife/embed/sim'
import {isVacuumStable} from '@hexlife/embed/api'

isVacuumStable(rulesetHex) // → does empty space stay empty?
const cells = createSparseState({rows: 1152, columns: 1332, seed, occupancy: 0.002})
```

The two go together. A density fill asks what a rule does to *noise*, and everything a viewer adds
afterwards is a perturbation the rule erases within a few generations. A sparse structured state asks
what a rule does to *things* — but only if the rule leaves the vacuum alone. If the empty
neighbourhood fires, every dead cell ignites on tick one and the world saturates from any start, so
`isVacuumStable()` is the precondition, not a suggestion.

## Vacuum stability

The predicate is exact and costs one character: the engine indexes its table as
`(centerState << 6) | neighbourMask`, so the empty neighbourhood is rule index `0`, and the 128-bit
hex is laid out most-significant-bit first — index `0` is the high bit of the first hex character.
Vacuum-stable rulesets are exactly those whose hex begins `0`–`7`, which is half the ruleset space.
It is also what makes sparse *evaluation* sound: a dead cell with six dead neighbours evaluates rule
`0`, so under a stable vacuum it is provably unchanged.

`isVacuumStable` and `VACUUM_RULE_INDEX` live in [`/api`](./api.md), which is DOM- and Wasm-free, so
a host can gate on the property before it loads an engine at all.

## The block-skipping fast path

The engine cashes that in. Each tick classifies the grid into 8×8 blocks of uniform cells and
resolves every block whose neighbouring blocks share its value in closed form — one rule index, one
fill — instead of gathering six neighbours per cell. Nothing needs enabling, and it is exact rather
than approximate: identical states, counters and checksums, so the byte-identity contract with the
app is untouched. On a 383k-cell grid the fast path ticks a world that has died out or saturated
**≈13× faster**, an `occupancy: 0.002` sparse world **≈2.4× faster**, and a fully mixed grid slightly
ahead of parity, so a host sweeping rulesets pays for the worlds that are actually doing something.

Vacuum stability is not required for the speedup — an igniting vacuum is still uniform, just
uniformly live — but it is what keeps a sparse world sparse enough to benefit for more than one tick.

## The simulation object

`createSimulation()` resolves to a `HexLifeSim`, which exposes `rows`, `cols`, `numCells`,
`rulesetHex`, `tickCount`, `activeCount` (live cells), `speed`, `state`, `snapshotCells()`, `tick()`
and `dispose()`.

> `sim.state` is a **view into Wasm linear memory**, not a copy. It changes every tick, and
> constructing another world anywhere on the page can detach it. Use `snapshotCells()` for anything
> you intend to hold.

## Related

- [`/api`](./api.md) — world codecs, ruleset metadata and `isVacuumStable`, with no Wasm at all.
- [`/render`](./renderer.md) — draw the state this entry produces.
- [Determinism](./determinism.md) — what the tick sequence guarantees across Explorer, embeds and Node.
