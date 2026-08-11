[← `@hexlife/embed` docs](./README.md)

# `@hexlife/embed/ca` — k-state worlds

A **second engine**, not a generalization of the first. [`<hexlife-world>`](./hexlife-world.md),
[`<hexlife-grid>`](./hexlife-grid.md), [`@hexlife/embed/sim`](./sim.md), world codes, share links and
Explorer are binary and stay binary; their determinism contract is untouched by everything on this
page, because k-state runs on a separate engine struct that shares the neighbour table and nothing
else.

```js
import {
  HexCA, initEngine,
  ruleFromTable, blockRuleFromTable,
  isConservative, isIsotropic,
} from '@hexlife/embed/ca'

await initEngine()

const world = new HexCA({
  states: 4,               // 0 = air, 1 = water, 2 = dry ground, 3 = wet ground
  rows: 66, columns: 128,
  backend: 'block',
  rule: blockRuleFromTable(4, ([a, b, c]) => /* … */ [c, a, b]),
})

world.tick(100)
world.census()             // → per-state occupancy
```

## Two backends

| `backend` | Table | `states` | Use for |
|---|---|---|---|
| `'neighborhood'` (default) | `k⁷`, anisotropic, radius 1 | 2–6 | The direct generalization of HexLife's rule space. Position within the neighbourhood is part of the rule, which is how you express a direction (gravity). |
| `'block'` | `k³`, one 3-cell triangle at a time | 2–16 | Anything that has to **conserve** something, and any `k` above 6. |

The cap on `'neighborhood'` is the table: `k⁷` is 16 KB at k=4 (fits L1), 273 KB at k=6 (lives in
L2), 2 MB at k=8, 268 MB at k=16. The table is sized from the world's own `k`, so a k=2 or k=4 world
pays nothing for the cap being 6. `'block'` has no such problem, and can express local reactions as
well as transport, so a high-`k` model can live in it entirely.

## Why block mode is not a nicety

**A radius-1 synchronous CA cannot conserve mass, at any `k`.** Two water cells sitting diagonally
above one empty cell: each independently sees "empty below me" and vacates, the empty cell sees water
above and fills. Two in, one out. Preventing it requires the losing cell to know it lost — i.e. to see
its competitor, which is two cells away — and radius 2 on hex is 18 neighbours, so an anisotropic
table would be `k¹⁹`.

That bites a physical model in a way that *biases* it rather than breaking it visibly: the leak is
largest exactly at the wetting front where contact area is greatest, so the output looks plausible
and under-predicts penetration depth.

Block partitioning fixes it by construction. The rule rewrites a whole block at once, so arbitration
is internal and a rule that permutes multisets is exactly conservative with no bookkeeping. This is
the lattice-gas approach; FHP is the hexagonal precedent. `isConservative(states, rule)` checks the
property exactly in `O(k³)` at load — it is **reported, never enforced**, because non-conservative
block rules are legitimate (reactions, sources, sinks).

`isIsotropic(states, rule)` likewise checks equivariance under rotating the block. Default to
validating it: breaking isotropy is how you get gravity, and it should be a deliberate act rather
than an artefact of the vertex ordering.

> **`rows` must be a multiple of 3 in block mode.** The three-phase triangular partition is seamless
> only if the sublattice residue survives the row wrap. 64 rows — the binary element's own default —
> does not qualify; use 63 or 66. Construction throws rather than silently producing a seam.

## Why this lattice

Worth being loud about, because it is a real advantage and not a marketing one.

A hex grid has one neighbour class — six neighbours, all equidistant, six-fold symmetry. A square
grid has two (edge and corner, the latter at distance √2), and the resulting anisotropy is not
cosmetic: for a lattice gas to recover isotropic hydrodynamics in the continuum limit, the lattice's
fourth-rank velocity moment tensor must be isotropic. Four-fold symmetry is insufficient; six-fold is
sufficient. This is why HPP (1973, square) fails to give correct hydrodynamics and FHP (1986,
hexagonal) succeeds, and why square-lattice CAs produce diamond-shaped growth fronts where physics
wants circles.

Percolation lands even better. Hex cell centres form a triangular lattice, and **site percolation on
the triangular lattice has `p_c = 1/2` exactly** — on the square lattice it is ≈0.5927, known only
numerically with no closed form. So "pack the grid with obstacles at density p and ask whether fluid
gets through" has an exact analytic answer on this grid and on no other common one. The engine's own
test suite uses it as a validation of the neighbour topology, not as a demo.

Note the complementary property: the *lattice* is isotropic, but the rule space is anisotropic by
construction. That is the right pairing for physical simulation — isotropy by default, symmetry
broken only where the physics says so.

## Cost

Rules are **tables, not callbacks**. `ruleFromTable` / `blockRuleFromTable` call your function `k⁷`
or `k³` times once at load and materialize the lookup; a per-cell JS callback would let the boundary
crossing dominate the tick by orders of magnitude.

The engine tracks activity per 32×32 chunk and skips any chunk that, along with everything it reads
from, did not change last tick — for `'block'`, not for a full partition cycle. This is exact, not
approximate: a skipped chunk provably cannot change, and the write buffer already holds the right
bytes, so a settled region costs *nothing*, not merely less. Unlike a uniform-background check it
skips settled **structures** too, so an obstacle field that never moves or a pool that has come to
rest goes quiet even though it is nowhere near uniform. A chaotic rule keeps everything active and
pays a handful of counter updates. `world.isSettled` reports the fixed point; `world.chunkActivity`
reports the pay-off.

`setSkippingEnabled(false)` forces the dense path. Results are identical either way — that equality
is asserted in the engine's tests — so it is for benchmarking and for ruling the fast path out.

## Writing cells

Use `setCells`, `setCell` or `fill`. They validate states **and wake the activity tracker**; a poke
straight through the live `state` view does neither, and a skipped chunk will not notice it. If you
must write directly, call `markAllDirty()` afterwards.

`state` is a view into Wasm linear memory shared with every `<hexlife-world>` on the page, so it can
detach whenever anything allocates. `snapshotCells()` returns a copy that cannot.

## Rendering

HexLife's signature rule-index colouring does not survive `k > 2` — the index needs 21 bits at k=8,
and the instance attribute carrying it is an `UNSIGNED_BYTE` — so a k-state world is coloured by
**state** from a `k`-entry palette, through its own shader program. Everything else in the renderer
is state-agnostic and shared verbatim: the instanced draw, the per-cell offsets, the fit, the camera
and the hit test.

`<hexlife-ca>` below does all of this for you. Reach past it only if you are drawing into a surface
you already own.

---

## `<hexlife-ca>` — the k-state element

```html
<script type="module">
  import {initEngine, blockRuleFromTable} from '@hexlife/embed/ca'
  import '@hexlife/embed/ca-element'      // registers <hexlife-ca>

  await initEngine()
  const el = document.querySelector('hexlife-ca')
  el.setRule(blockRuleFromTable(4, ([a, b, c]) => [c, a, b]))
  el.setCells(myCells)
</script>

<hexlife-ca states="4" rows="66" backend="block" speed="20"></hexlife-ca>
```

A **separate element** from `<hexlife-world>`, not a mode on it — the same separation the engine
keeps between `World` and `WorldK`, for the same reason: `<hexlife-world>`'s API is frozen and its
determinism contract is load-bearing, so nothing k-state may reach it. The two share the renderer and
nothing else.

Like `<hexlife-world>`, it is `display: block` with a `1 / 1` aspect ratio, lives entirely in a
shadow root, and **never throws into the host page** — a bad attribute, a missing WebGL2 context, a
corrupt code and a wasm failure all land in a styled error box and fire `hexlife-ca-error`.

### The rule does not come from an attribute

There is no `ruleset=` counterpart. A `neighborhood` table is `k⁷` entries — 16 KB at k=4 — so there
is no honest way to spell one in HTML. A rule arrives either inside a `code`, or through `setRule()`
from script. With neither, the table is all zeros: a world that dies on tick one. That is stated
rather than treated as an error, because it is also the right starting point for a host that is about
to install a rule.

### Attributes

| Attribute | Default | Meaning |
|---|---|---|
| `states` | `2` | `k`. Clamped to the backend's cap (4 / 16). |
| `rows` | `66` | Grid rows, 6–512. Columns are derived so the grid is roughly square on screen. **Not 64**: the binary element's default is illegal in block mode, and a default that is fine in one backend and fatal in the other is a trap. |
| `backend` | `neighborhood` | `neighborhood` or `block`. An unrecognised value falls back rather than switching engines. |
| `code` | — | An `HXK1.` world code. It is a *complete* world and replaces every attribute above. |
| `speed` | `10` | Ticks/second. |
| `paused` | absent | Boolean. Shows the poster frame with a play button. |
| `palette` | built-in | Comma-separated `#rrggbb`, one per state. Short lists are padded from the built-in palette and long ones truncated, so tweaking two of four colours does not mean restating the others. |
| `draw` | absent | Boolean. Pointer paints `draw-state` into cells. |
| `draw-state` | `1` | The state a stroke paints. It paints a *value*; with `k` states there is no "the other one" to flip. |
| `brush` | `0` | Draw radius, 0–40; `0` is a single cell. **Not `<hexlife-world>`'s default of `2`** — this element has painted one cell since it shipped, and widening that silently would repaint every existing `<hexlife-ca draw>` embed. |
| `max-dpr` | `1.5` | devicePixelRatio cap, 1–4. |
| `link` | shown | `link="off"` hides the attribution. |

**`rows` in block mode is the one place this element refuses instead of clamping.** The three-phase
triangular partition is seamless only if the sublattice residue survives the row wrap, so it needs a
multiple of 3. `rows="64"` with `backend="block"` shows an error box naming 63 and 66 — because
rounding it would mean the grid you asked for is not the grid you got.

### JavaScript API

`setRule(rule)`, `setCells(cells)`, `setCell(index, value)`, `setBrushSize(size)`, `reset()`,
`clear()`, `tick(n)`, `play()`, `pause()`, `census()`, `caCode()`.

`setCells` / `setCell` are the supported writes: they validate the states **and wake the engine's
activity tracker**. A poke straight through `el.world.state` does neither, and a skipped chunk will
not notice it — call `el.world.markAllDirty()` if you must.

The [k-state CA builder](https://sidem.github.io/HexLife/ca-builder.html) is an editable reference
host for this surface. Its six- and sixteen-state coffee starters materialize physical transition
functions with `blockRuleFromTable`, edit the exact `k³` table, run it through `<hexlife-ca>`, and
export a standalone page that imports only the published `/ca` and `/ca-element` entrypoints.

Readonly: `world` (the live `HexCA`, so a model needing `setSkippingEnabled` or `phase` can reach it
directly), `states`, `rows`, `columns`, `backend`, `generation`, `checksum`, `isSettled`,
`chunkActivity`, `playing`, `userPaused`, `error`.

**`isSettled` is acted on, not merely reported.** A settled world is a fixed point it can never
leave, so the element stops its animation loop outright rather than spinning on a world that returns
"0 changed" forever. Physical models settle constantly — a pool comes to rest, a front reaches the
far wall. Any write wakes the loop again.

### Events

All bubble and cross the shadow boundary: `hexlife-ca-ready` (`{states, rows, columns, backend,
numCells, hasRule}`), `hexlife-ca-playstate` (`{playing, userPaused}`), `hexlife-ca-settled`
(`{generation}`), `hexlife-ca-error` (`{message, detail}`), `hexlife-ca-contextlost` /
`hexlife-ca-contextrestored`.

A lost GPU context does **not** restart the simulation. The world lives in wasm linear memory and
survives untouched, so only the renderer is rebuilt — a model somebody has been running for minutes
is not thrown away to recover a canvas.

## `HXK1` world codes

`encodeCaCode` / `decodeCaCode` / `isCaCode`, from `@hexlife/embed/ca` (DOM-free, so a Node host can
validate a pasted code without loading an engine). A code carries the grid, `k`, the backend, the
rule table, the exact cells and the palette.

```js
import {decodeCaCode, isCaCode} from '@hexlife/embed/ca'
```

**A distinct prefix, not an `HXW1` version bump.** An `HXW1` payload is binary everywhere — bitset
cells, a fixed 128-bit rule — so a k-state payload shares none of its regions. A version bump inside
`HXW1.` would let a decoder already deployed in someone's page recognise the magic and then
half-read a payload where every field means something else. `HXK1.` makes the refusal structural:
`decodeWorldCode` bails on the prefix before parsing a byte, and `isWorldCode` is false.

Decoding never throws — a code arrives from a text field a stranger pasted, and every caller wants a
"no" it can render. The rule blob's length is *derived* from `(k, backend)` rather than stored, so a
truncated or padded paste fails an exact byte count instead of being half-read.

## Related

- [Coffee extraction lab](https://sidem.github.io/HexLife/coffee-percolation.html) — six- and
  sixteen-state conserved models, and a four-state model run under both backends at once.
- [`/stochastic`](./stochastic.md) — the third engine, for probability and time-in-state.
