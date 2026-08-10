# `@hexlife/embed`

Fast, deterministic hexagonal cellular automata for ordinary web pages, browser workers, and Node.
The package bundles the Rust/Wasm tick engine and WebGL2 renderer used by
[HexLife Explorer](https://sidem.github.io/HexLife/), then exposes them at the level a host needs:
custom elements for the quickest integration, or DOM-free simulation and renderer-only entrypoints
for applications that own more of the stack.

The same `(ruleset, seed, density, rows)` produces a byte-identical tick sequence in HexLife
Explorer, an embed, and HexLife on Reddit. An embed is therefore a reproducible world, not a visual
approximation of one.

## Quick start

```bash
npm install @hexlife/embed
```

```js
import '@hexlife/embed' // registers <hexlife-world>
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

## Live package showcases

Every page below is a package consumer with the same presentation shell. The k-state pages resolve
the exact published npm version through jsDelivr; they do not reach into Explorer internals.

| Demo | What it demonstrates | Package surface |
|---|---|---|
| [**Interactive demo library**](https://sidem.github.io/HexLife/embed-demos.html) | Nine focused experiments spanning crystal growth, ecology, excitable media, particles, seeded probability, deterministic chaos, sound, and interacting matter. | Every public entrypoint, with each page consuming the published npm package |
| [**256 worlds, one rule class**](https://sidem.github.io/HexLife/totalistic-256.html) | All 256 totalistic rules simultaneously, or an equally sized sample of a larger rule class. One shared clock, initial condition, palette, and GPU context make rule-to-rule comparison direct; fullscreen and `?focus=1` turn the page into a workspace-only instrument. | `<hexlife-grid>`, `<hexlife-world>`, `/api` |
| [**Coffee extraction lab**](https://sidem.github.io/HexLife/coffee-percolation.html) | Six- and sixteen-state physical models with exact conservation, host-driven boundaries, and both rule backends side by side. | `/ca`, `/ca-element`, `<hexlife-ca>` |
| [**k-state CA builder**](https://sidem.github.io/HexLife/ca-builder.html) | Edit exact transition tables, paint and run the Wasm world, inspect invariants, and export a standalone npm-package example. | `/ca`, `/ca-element`, `<hexlife-ca>` |

The atlas is also a performance demonstration: `<hexlife-grid>` runs hundreds of simulations but
draws them through one WebGL2 context, avoiding the browser context limit that makes a wall of
independent canvases fail. For sparse or settled worlds, exact uniform-block skipping makes the
383k-cell binary engine about **13× faster** at a fixed point and about **2.4× faster** at 0.2%
occupancy on the project benchmark machine. No approximation or separate “fast” result is involved.

For host-owned computation, use the same engine without mounting a DOM element:

```js
import {createDensityState, createSimulation, packCells} from '@hexlife/embed/sim'

const initialCells = createDensityState({rows: 64, columns: 74, seed: 12345, density: 0.5})
const sim = await createSimulation({rulesetHex, rows: 64, columns: 74, initialCells})
sim.tick(10)
const packed = packCells(sim.snapshotCells())
sim.dispose()
```

---

## Public entry points

| Import | Needs | Use for |
|---|---|---|
| `@hexlife/embed` | DOM, WebGL2, Wasm | The browser. Importing it registers `<hexlife-world>` and `<hexlife-grid>`. |
| `@hexlife/embed/api` | Nothing | Node and browsers alike: world codes, ruleset metadata, palette names, GPU probing. No DOM at module scope. |
| `@hexlife/embed/sim` | Wasm | Node and browser workers: deterministic host-driven simulation without DOM or rendering. |
| `@hexlife/embed/render` | DOM, WebGL2 | Browser hosts: draw externally supplied state without allocating or ticking a simulation. |
| `@hexlife/embed/ca` | Wasm | **k-state** worlds: multi-state simulation on the same lattice, with an optionally mass-conserving backend. A second engine — everything else here stays binary. No DOM at module scope. |
| `@hexlife/embed/ca-element` | DOM, WebGL2, Wasm | Importing it registers `<hexlife-ca>`, the k-state element. Separate from `/ca` because that entry is DOM-free, and separate from the root because a binary embed should not carry the k-state engine. |
| `@hexlife/embed/stochastic` | Wasm | Stateful/probabilistic neighborhood worlds with compiled native rules, age epochs, counter RNG, census and checksums. A separately loaded artifact with no DOM at module scope. |

A server that validates a pasted world code must import **only** `@hexlife/embed/api` — the root
entry evaluates custom-element, Wasm and WebGL code at import time.

The browser bundle **inlines the Wasm binary** as a data URI rather than fetching a side-car asset,
because a strict host CSP (a Reddit webview, for instance) is not something an embed can widen.

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

The predicate is exact and costs one character: the engine indexes its table as
`(centerState << 6) | neighbourMask`, so the empty neighbourhood is rule index `0`, and the 128-bit
hex is laid out most-significant-bit first — index `0` is the high bit of the first hex character.
Vacuum-stable rulesets are exactly those whose hex begins `0`–`7`, which is half the ruleset space.
It is also what makes sparse *evaluation* sound: a dead cell with six dead neighbours evaluates rule
`0`, so under a stable vacuum it is provably unchanged.

The engine cashes that in. Each tick classifies the grid into 8×8 blocks of uniform cells and
resolves every block whose neighbouring blocks share its value in closed form — one rule index, one
fill — instead of gathering six neighbours per cell. Nothing needs enabling, and it is exact rather
than approximate: identical states, counters and checksums, so the byte-identity contract with the
app is untouched. On a 383k-cell grid the fast path ticks a world that has died out or saturated
**≈13× faster**, an `occupancy: 0.002` sparse world **≈2.4× faster**, and a fully mixed grid slightly
ahead of parity, so a host sweeping rulesets pays for the worlds that are actually doing something.
Vacuum stability is not required for the speedup — an igniting vacuum is still uniform, just
uniformly live — but it is what keeps a sparse world sparse enough to benefit for more than one tick.

---

## `@hexlife/embed/render`

The renderer-only entry is for applications that already own their simulation, verification,
networking, and history. It accepts row-major byte arrays (`index = row * columns + column`) and owns
only the WebGL lifecycle and camera. `setState()` is the state-buffer upload boundary; `panBy()`,
`setZoom()`, `resize()`, and `draw()` do not upload cell state.

```js
const renderer = createRenderer(canvas, {
  rows,
  columns,
  palette: 'default',
  flickerProof: true,
  repeatToroidal: true,
  minZoom: 0.3,
  maxZoom: 5,
  onContextLost: () => showGpuRecoveryNotice(),
  onContextRestored: () => hideGpuRecoveryNotice(),
})

renderer.setState(cells)                 // Uint8Array(rows * columns), values 0/1
renderer.setSelection(42)                // null clears it
renderer.setDraftPreview([{index: 9, value: 1}])
renderer.panBy(24, -8)                   // CSS pixels
renderer.setZoom(1.5, {x: 400, y: 300}) // keep the cell under this canvas point fixed
renderer.centerOnCell(42)
renderer.draw()                          // draw on demand
```

`hitTest(x, y)` takes CSS pixels relative to the canvas and returns
`{row, column, index}`. With `repeatToroidal: true`, every repeated visual copy resolves to the same
canonical index. The repeated flat view covers the viewport and maps each cell to its nearest
toroidal copy, so continuous pan does not require a second state buffer.

The live state and draft preview are separate GPU attributes. Draft value `1` is a translucent live
preview and `0` is a translucent erase preview; neither mutates the verified state passed to
`setState()`.

`renderer.stats` reports draws, explicit state uploads and bytes, and context losses. These counters
make it possible to assert that camera-only gestures perform no full state-buffer upload.

The canvas emits `hexlife-renderer-contextlost`, `hexlife-renderer-contextrestored`, and
`hexlife-renderer-error`. Context loss is prevented so the browser may restore it; on restoration the
renderer rebuilds its shared shader resources and re-uploads the latest state, selection, and draft.
Networking and history stay entirely under host control throughout. Call `destroy()` to remove event
listeners and release GPU resources.

---

## Two ways to specify a world

**Attributes** — a recipe. `ruleset` + `seed` + `density` + `rows` regenerate a statistically
equivalent world on every reset.

**A `code`** — the dish. An `HXW1.…` world code carries the exact grid, the exact cells, the exact
colors and the speed, so it reproduces the world someone was actually looking at.

`code` **wins over every world-defining attribute**. Not merged with them: a half-applied world code
is a different world. Attributes that are not part of the world — playback rate, input policy,
camera, tool settings, decoration — still apply, and are listed as *live* below.

---

## Attributes

### The world

| Attribute | Value | Default | Notes |
|---|---|---|---|
| `ruleset` | 32 hex chars | — | Required unless `code` is set. |
| `code` | `HXW1.…` | — | A complete world; overrides everything in this section. |
| `rows` | 16–512 | `64` | Columns are derived; never pass them. |
| `seed` | uint32 | — | Absent, `0` or unparseable ⇒ nondeterministic. See below. |
| `density` | 0–1 | `0.5` | Initial fill. Ignored when `code` carries exact cells. |

`seed="0"` is deliberately "no seed". The engine branches on a *falsy* seed to `Math.random`, so
accepting 0 would promise a determinism it does not deliver — the one lie this element will not tell.

### Playback

| Attribute | Value | Default | Live |
|---|---|---|---|
| `speed` | 0–1000 ticks/sec | `40` | ✅ |
| `paused` | boolean | absent | ✅ Start paused, showing a poster frame with a play button. |
| `preview` | 1–60 | `12` when valueless | ✅ Poster "breathes" this many generations when scrolled into view, then rewinds. |

`preview` is decoration, not playback: it never starts the animation loop, so `playing` stays
`false` and no `hexlife-playstate` fires. Anything the user does cancels it instantly. It is for
feeds, where a still dark grid reads as a broken image at scroll speed.

### Interaction

| Attribute | Value | Default | Live |
|---|---|---|---|
| `draw` | boolean | absent | ✅ Drag to invert cells. Pauses while drawing. |
| `brush` | 0–40 | `2`, or the code's own value | ✅ Draw radius; `0` is a single cell. |
| `zoom` | 1–8 | `1` (fitted) | ✅ Flat camera. |
| `wheel-zoom` | `free` \| `ctrl` | `free` | ✅ |
| `torus` | 0–45 °/s | `14` when valueless | ✅ Wrap the world onto its 3D surface. |

`wheel-zoom="ctrl"` lets a plain wheel fall through **unprevented** so the host page scrolls — for
embeds in a feed, where swallowing the wheel traps a reader who only meant to scroll past. Trackpad
pinch arrives as ctrl+wheel in Chromium and Firefox, so pinch-to-zoom is unaffected.

`brush` runs the opposite way to every world-defining attribute: it **beats** a code's own value.
Brush size never touches the tick sequence, so it is a tool setting, and a host rendering a brush
control has to be able to make that control tell the truth.

`torus` is a projection, not a mode — the same cells, drawn from outside the surface whose edges they
already wrap around. Toggling it never re-boots the world, so the generation on screen survives.
Drag orbits (pitch passes through the poles freely), wheel and two-finger pinch dolly. Note that
**`draw` is inert while the torus is up** — there is no cell under a point on a curved surface — and
that, like `draw`, it takes the pointer, so the poster play overlay steps aside and **the host owns
the play control**.

### Appearance

| Attribute | Value | Default | Live |
|---|---|---|---|
| `palette` | preset key | `default` | ✅ See `listPresetPalettes()`. |
| `palette-on` | comma-separated hex | — | ✅ Custom gradient for live cells. |
| `palette-off` | comma-separated hex | dark neutral | ✅ Only meaningful with `palette-on`. |
| `hue-shift` | 0–359 degrees | `0` | ✅ Rotates chromatic colors; black, gray, and white stay put. |
| `flicker-proof` | boolean | absent | ✅ Suppress the birth/death flash. |
| `link` | `on` \| `off` | `on` | ✅ The small attribution link in the corner. |
| `max-dpr` | 1–4 | `1.5` | ✅ Caps `devicePixelRatio`; a phone at DPR 3 would otherwise pay 9× the fragment cost. |

`flicker-proof` is the Explorer's "Prevent birth/death flash", and it is a two-entry edit to the
color table: rule 0 firing a birth and rule 127 firing a death are forced to black, so a cell about
to change does not show a full-brightness frame on its way there. On a busy rule that is the
difference between texture and strobe — worth setting on anything that autoplays in a feed. It
applies to **preset palettes only**; `palette-on`/`palette-off` and a `code`'s own colors are the
host's, and quietly rewriting two of them is not this element's call.

The palette attributes **override the colors a `code` carries**, and apply to a live world without
re-booting it. *Presence* is what overrides, so removing them restores the world's own colors — the
only way back, since decoded colors have no preset name to ask for. While overridden,
`worldCode()` encodes what is on screen rather than what arrived.

`hue-shift` is a modifier rather than a replacement: without another palette attribute it rotates
the colors carried by a `code`. Removing it restores the authored hue, and `worldCode()` still
captures the shifted colors currently on screen.

### "Live" means

A live attribute reconfigures the running world. Everything else re-boots it, which re-decodes the
code and replays tick 0 — discarding whatever the viewer had drawn or evolved. That distinction is
the reason the table above marks it explicitly.

---

## JavaScript API

```js
const world = document.querySelector('hexlife-world')
```

### Playback

```js
world.play()          // also overrides prefers-reduced-motion
world.pause()         // current generation stays on screen
world.tick(10)        // advance exactly 10 generations now, whatever the speed → new tickCount
```

### Editing

```js
world.reset()         // rewind to the authored tick 0
world.reset(999)      // …with a different seed
world.clear()         // blank canvas: every cell dead, no rule history
world.setBrushSize(4) // 0–40
```

`clear()` is not `reset()`. Reset hands back the world the author made; clear gives you an empty
grid to draw your own on, and `tickCount` keeps counting because the sim has not gone back in time —
it has been painted over.

### Camera

```js
world.setZoom(3)
world.setZoom(1)      // back to the fitted whole-world view, pan cleared
world.zoom            // → number
```

`setZoom(1)` is worth a button: it is the only way back after a pinch, which otherwise has no undo.
The torus keeps its own camera and ignores this.

### Capture

```js
const code = await world.worldCode() // → 'HXW1.…' | null
```

The world **as it stands right now** — exact cells, painted ones included, however many generations
it has run. It never encodes a generator, even when the world was booted from a code that had one: a
generator is a recipe that re-rolls a different state on every reset, and this is meant to reproduce
*this* world. Returns `null` in the error state or before boot.

### Readonly

| Property | Type | |
|---|---|---|
| `sim` | `HexLifeSim \| null` | The live simulation; null before boot and after teardown. |
| `error` | `string \| null` | Non-null while in the styled error state. |
| `tickCount` | `number` | Generations since the last reset. |
| `checksum` | `number` | Hash of the current state — the determinism cross-check. |
| `playing` | `boolean` | Is the animation loop running? |
| `userPaused` | `boolean` | Has the *user* paused, ignoring viewport/visibility gates? |
| `brushSize` | `number` | |
| `zoom` | `number` | |
| `torusEnabled` | `boolean` | Is the world *actually* on the torus? See below. |

`torusEnabled` is not the same question as `hasAttribute('torus')`. The projection needs a second
shader program, built on first use, and a device that cannot compile it keeps the flat grid rather
than showing a blank canvas. If you paint a pressed-state 3D toggle, read this after setting the
attribute — otherwise your button will claim 3D is on over an unmistakably flat world.

`sim` exposes `rows`, `cols`, `numCells`, `rulesetHex`, `tickCount`, `activeCount` (live cells),
`speed`, `state`, and `snapshotCells()`.

> `sim.state` is a **view into Wasm linear memory**, not a copy. It changes every tick, and
> constructing another world anywhere on the page can detach it. Use `snapshotCells()` for anything
> you intend to hold.

---

## Events

All of these bubble and are `composed`, so they escape the shadow root and you can listen on the
element itself.

| Event | `detail` | Fires |
|---|---|---|
| `hexlife-ready` | `{rows, cols, numCells, brushSize}` | Once per successful boot. |
| `hexlife-playstate` | `{playing, userPaused}` | Whenever the tuple changes (deduped). |
| `hexlife-error` | `{message, detail}` | On entering the styled error state. |
| `hexlife-contextlost` | — | The GPU took the drawing context back. |
| `hexlife-contextrestored` | — | It came back; the world is being rebuilt. |

```js
world.addEventListener('hexlife-playstate', (e) => {
  button.textContent = e.detail.userPaused ? '▶' : '❚❚'
})
```

Playback has five invisible gates — the attribute, an API call, the viewport, tab visibility and
reduced motion — so `hexlife-playstate` exists to keep a host's play/pause label honest without
polling a getter on a timer. Count `userPaused`, not `playing`: `playing` also flips on every
scroll-offscreen auto-pause and tab switch.

`hexlife-playstate` fires **before** `hexlife-ready` on boot, so attach listeners before connecting
the element.

### Losing the GPU

A WebGL context is not yours to keep. The browser can reclaim it when the GPU resets, the machine
sleeps, or — the common case on phones — something needs the memory more than a decoration in a feed
does. The `torus` view is by a wide margin the most expensive thing this element asks for, and an
in-app webview (Reddit's, notably) gets a far smaller budget than the same page in a standalone
browser, so that is where you will see this.

The element handles it: it stops every loop, asks for the context back, and rebuilds the world from
scratch when it arrives — a recovery ends in a fresh `hexlife-ready`. **A lost context is not an
error state**, so `error` stays null and no `hexlife-error` fires while a recovery is pending.

Two cases end in `hexlife-error` instead, and a host that only listens for that will still behave
correctly — it just won't know about the gap:

- The browser never restores the context (a few seconds' grace, then the styled error box).
- The context drops again within ten seconds of a recovery. Rebuilding is what lost it the first
  time, so asking again would only buy another blank canvas at the price of a fresh Wasm world and a
  shader compile on a device that has already said it has nothing to spare.

If you host your own 3D toggle, the cheapest thing you can do for a struggling device is cap
`max-dpr` while the torus is up. Framebuffer bytes scale with the square of the DPR, and the torus
needs a depth attachment and multisampled color that the flat grid never touches.

---

## Policies

These are what make an embed a good citizen on someone else's page, and they are not configurable:

- **It never throws into the host page.** A bad attribute, a missing WebGL2 context, a Wasm failure —
  every one lands in a styled error box inside the shadow root and a `hexlife-error` event. Every
  unparseable attribute value clamps or falls back to a sane default.
- **Offscreen worlds pause** (IntersectionObserver), as do worlds in a hidden tab.
- **`prefers-reduced-motion: reduce` suppresses autoplay** and shows the poster frame instead. An
  explicit `play()` — including a click on the poster — overrides it, because that is the user asking.
- **Full teardown on disconnect.** Removing the element frees its Wasm world and stops its loop.
- **Multiple instances are safe.** They share one Wasm memory; the element handles the view
  invalidation that a later world's allocation causes.

### Styling

Two shadow parts:

```css
hexlife-world::part(overlay) { /* the poster play button */ }
hexlife-world::part(reset)   { /* the small corner restart button */ }
```

Hide `::part(reset)` when your own chrome owns restart, or you will show two of them.

---

## `<hexlife-grid>` — many worlds, one context

A browser gives a *page* about **sixteen** WebGL contexts. Chrome force-loses the oldest past that
and carries on without an error, so a wall of `<hexlife-world>` elements silently stops being a wall
at sixteen. That is a hard ceiling, not a budget to spend carefully.

`<hexlife-grid>` puts N simulations behind **one** context and draws each into its own viewport, so
the marginal cost of a world is an instance-buffer upload rather than a context. All 256 totalistic
rules at 96×112 cells measure ~19 ms a frame end to end — and 18 of those are the wasm ticks, not
the drawing.

```html
<hexlife-grid id="map" layout="16x16" rows="96" seed="12345" speed="15" paused></hexlife-grid>
```

```js
// T00–TFF *is* the totalistic class: a hex cell plus six neighbours has eight possible live counts,
// so a rule keyed on that total has exactly 2^8 forms. Nothing is sampled away.
document.getElementById('map').rulesets =
  Array.from({length: 256}, (_, i) => 'T' + i.toString(16).padStart(2, '0'))
```

It is a **comparison instrument**, and that shapes the whole API: every world shares one grid, one
seed, one density, one palette and one clock, because the point is that the only difference between
two tiles is the rule. At generation N, every tile is showing generation N.

### Attributes

| Attribute | Value | Default | Live |
|---|---|---|---|
| `rulesets` | comma/space-separated codes | — | Required. 32-char hexes **or** short codes (`T21`, `N080C`, `M…`, `R…`). |
| `layout` | `COLSxROWS` | squarest fit | ✅ |
| `rows` | 16–512 | `48` | Cells per world; columns derived. |
| `seed` | uint32 | — | ✅ Shared by every world — pass one, or the tiles stop sharing an initial condition. |
| `density` | 0–1 | `0.5` | ✅ |
| `speed` | 0–1000 | `20` | ✅ |
| `paused` | boolean | absent | ✅ |
| `palette` / `palette-on` / `palette-off` / `hue-shift` | as `<hexlife-world>` | `default` | ✅ |
| `flicker-proof` | boolean | absent | ✅ As `<hexlife-world>`. Worth it here: N tiles strobing at once is N times the problem. |
| `gap` | 0–32 CSS px | `2` | ✅ Gutter between tiles. |
| `max-dpr` | 1–4 | `1.5` | ✅ |
| `link` | `on` \| `off` | `on` | ✅ |

An unparseable entry in `rulesets` is **dropped with a warning**, not fatal: one typo in a 256-item
list must cost that tile, never the page. Past 1024 worlds the list is truncated and says so — a
backstop against a typo allocating gigabytes, since each world is `rows × cols × 4` bytes of wasm.

The `rulesets` **property** is the programmatic twin and beats the attribute — which is what you
want when the list is computed rather than authored. Assigning it mid-boot is fine and expected: the
element reads the list after its engine is up, precisely so `<hexlife-grid>` in markup plus
`grid.rulesets = […]` in the module below it works without a spurious error. A list of the same
length swaps rules on the live worlds; a different length rebuilds them.

### JavaScript API

```js
grid.play(); grid.pause()
grid.reset(); grid.reset(999)   // every world, back to generation 0
grid.clear()                    // every world blank
grid.tick(10)                   // every world forward 10 → new generation

grid.setInitialCells(cells)     // the same exact tick-0 grid in every world
grid.setInitialCells(null)      // …back to the seed + density generator
```

`setInitialCells` is what makes an initial condition other than "random fill" possible *as a
comparison*. A single live cell at the centre, a ring, a glider — one array, replayed verbatim into
all N worlds and by every later `reset()`. One copy is shared, so it costs one grid of memory rather
than one per world.

| Property / method | | |
|---|---|---|
| `worlds` | `HexLifeSim[]` | The live sims, in tile order. |
| `worldAt(i)` / `rulesetAt(i)` | | The sim, and the 32-char hex it is running. |
| `count` · `generation` · `playing` · `userPaused` · `error` · `layout` | | Readonly. |
| `indexAt(clientX, clientY)` | `number \| null` | Which tile a point is in; null in a gutter. |
| `tileRect(i)` | `{x, y, width, height}` | CSS px relative to the element. |

### Events

| Event | `detail` |
|---|---|
| `hexlife-ready` | `{worlds, rows, cols, numCells, layout: {cols, rows}}` |
| `hexlife-worldselect` | `{index, rulesetHex, tick, activeCount}` — the viewer clicked a tile |
| `hexlife-playstate` · `hexlife-error` · `hexlife-contextlost` · `hexlife-contextrestored` | as `<hexlife-world>` |

The element draws **no selection chrome of its own**, on purpose: what a picked world is *for* — open
it full size, deep-link the Explorer, copy the hex — is host business, and a built-in highlight would
only be in the way of whatever you draw instead. `tileRect()` puts yours exactly where the tile is.

```js
grid.addEventListener('hexlife-worldselect', (e) => {
  const r = grid.tileRect(e.detail.index)
  Object.assign(outline.style, {left: `${r.x}px`, top: `${r.y}px`,
                               width: `${r.width}px`, height: `${r.height}px`})
  detail.setAttribute('ruleset', e.detail.rulesetHex)   // a <hexlife-world>, full size
})
```

### What it deliberately does not have

`draw`, `brush`, `torus`, `zoom`, `code` and `worldCode()`. All six are single-world ideas. Open one
`<hexlife-world>` on the tile the viewer picked — that handoff is what `hexlife-worldselect` is for,
and mounting that element only while it is on screen keeps the context budget honest.

The policies are unchanged: it never throws into the host page, offscreen and hidden-tab grids pause,
`prefers-reduced-motion` suppresses autoplay, disconnecting frees every wasm world, and a lost GPU
context is a gap rather than an error state.

---

## `@hexlife/embed/ca` — k-state worlds

A **second engine**, not a generalization of the first. `<hexlife-world>`, `<hexlife-grid>`,
`@hexlife/embed/sim`, world codes, share links and Explorer are binary and stay binary; their
determinism contract is untouched by everything in this section, because k-state runs on a separate
engine struct that shares the neighbour table and nothing else.

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

### Two backends

| `backend` | Table | `states` | Use for |
|---|---|---|---|
| `'neighborhood'` (default) | `k⁷`, anisotropic, radius 1 | 2–4 | The direct generalization of HexLife's rule space. Position within the neighbourhood is part of the rule, which is how you express a direction (gravity). |
| `'block'` | `k³`, one 3-cell triangle at a time | 2–16 | Anything that has to **conserve** something, and any `k` above 4. |

The cap on `'neighborhood'` is the table: `k⁷` is 16 KB at k=4 (fits L1), 78 KB at k=5, 2 MB at k=8,
268 MB at k=16. `'block'` has no such problem, and can express local reactions as well as transport,
so a high-`k` model can live in it entirely.

### Why block mode is not a nicety

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
> only if the sublattice residue survives the row wrap. 64 rows — the element's own default — does
> not qualify; use 63 or 66. Construction throws rather than silently producing a seam.

### Why this lattice

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

### Cost

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

### Writing cells

Use `setCells`, `setCell` or `fill`. They validate states **and wake the activity tracker**; a poke
straight through the live `state` view does neither, and a skipped chunk will not notice it. If you
must write directly, call `markAllDirty()` afterwards.

`state` is a view into Wasm linear memory shared with every `<hexlife-world>` on the page, so it can
detach whenever anything allocates. `snapshotCells()` returns a copy that cannot.

### Rendering

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
| `max-dpr` | `1.5` | devicePixelRatio cap, 1–4. |
| `link` | shown | `link="off"` hides the attribution. |

**`rows` in block mode is the one place this element refuses instead of clamping.** The three-phase
triangular partition is seamless only if the sublattice residue survives the row wrap, so it needs a
multiple of 3. `rows="64"` with `backend="block"` shows an error box naming 63 and 66 — because
rounding it would mean the grid you asked for is not the grid you got.

### JavaScript API

`setRule(rule)`, `setCells(cells)`, `setCell(index, value)`, `reset()`, `clear()`, `tick(n)`,
`play()`, `pause()`, `census()`, `caCode()`.

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

### `HXK1` world codes

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

---

## `@hexlife/embed/stochastic` — stateful probability in native Wasm

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

`compileStochasticRule()` canonicalizes at most 64 rows by current state and descending priority,
rejects equal-priority ambiguity, and quantizes probability once into 64 integer thresholds indexed
by the canonical six-direction neighbor mask. The Rust tick performs no floating-point probability
work, host callback, grid upload, or allocation. `probability: 0` never fires and `probability: 1`
always fires.

`independentNeighborChance(p)` materializes `1 - (1 - p)ⁿ` for all masks. Pass six probabilities
instead of one to author direction-dependent exposure such as wind. A stochastic row needs an
explicit `stream`; strings are converted to stable FNV-1a ids, and numeric u32 ids are accepted when
matching an existing counter schedule.

Age is stored as the generation when a cell entered its current state rather than incremented on
every tick. `minAge`/`maxAge` are inclusive u16 bounds. `setInitialState(cells, elapsedAges)` replaces
the exact reset snapshot; `setCells()` and `setCell()` are intervention APIs, not streaming tick
paths. `snapshotElapsedAges()` is an explicit copy for export/debug only.

New rules use version-1 Philox4x32-10, addressed by `(seed, generation, cell, stream)`, so decisions
do not depend on iteration order or on whether another cell was evaluated. `legacy-demo-v0` is an
explicit compiler option only for byte-identical migration of HexLife's frozen Wildfire and Outbreak
reference trajectories. It is never selected implicitly.

The current surface is intentionally DOM-free and dense. Temporal activity skipping, the conserved
lattice-gas backend, `<hexlife-stochastic>`, and `HXS1` codes are additive later phases; no placeholder
API for those features is exported early.

---

## `@hexlife/embed/api`

DOM-free, safe in Node.

```js
import {
  decodeWorldCode, encodeWorldCode, explorerUrlForRuleset,
  describeRuleset, rulesetName, ORBIT_LABELS,
  normalizeRulesetHex, isVacuumStable, VACUUM_RULE_INDEX,
  listPresetPalettes,
  detectGraphicsPath, createGpuHelpPanel,
} from '@hexlife/embed/api'
```

`normalizeRulesetHex(value)` trims and uppercases an exact 32-character ruleset identity, returning
`null` for short codes, notation, or malformed input. Use `codeToHex()` when those short codes should
also be accepted.

`isVacuumStable(value)` takes a 32-char hex or a 128-entry rule table and answers whether empty space
stays empty — see `@hexlife/embed/sim` above for what that buys and why it is one character of the
hex. It returns `false` for anything malformed, so a host can use it as an admission gate without a
separate validity branch. `VACUUM_RULE_INDEX` is the rule index it reads (`0`), named so a host
asserting the bit-order claim does not have to restate the literal.

### Reference application

HexWorlds is the package's practical reference host: it exercises externally owned simulation,
verified state rendering, Node/browser determinism, and large-world operation. Reusable HexLife
behavior discovered there is implemented and tested in this package first, then consumed through an
exact packed or published version. HexWorlds retains its collaboration protocol, networking, history,
and application UI; it must not carry copies of HexLife determinism or rendering primitives.

### World codes

```js
const world = await decodeWorldCode(code) // → DecodedWorld | null, never throws
const code = await encodeWorldCode({rows, cols, rulesetHex, cells})
```

Both are async — the payload is deflated. `decodeWorldCode` resolves to `null` for anything
malformed, which is what makes it safe to point at user input.

### Ruleset metadata

```js
rulesetName('D5F5…')      // → a deterministic two-word mnemonic
describeRuleset('D5F5…')  // → {notation: 'B2/S35', summary, birth, survival, …} | null
```

`describeRuleset` returns `notation: null` for rules with no compact B/S form. `ORBIT_LABELS` maps
rotation-orbit representatives to their notation labels.

### Palettes

```js
listPresetPalettes()
// → [{key: 'default', name: 'Default Spectrum'},
//    {key: 'viridis', name: 'Viridis', cvdSafe: true},
//    {key: 'symmetryGradient', name: 'Symmetry Groups', logic: 'symmetry'}, …]
```

`key` is what the `palette` attribute takes. `logic` marks the two presets that color by *rule
structure* rather than by taste; `cvdSafe` marks the perceptually-uniform, colorblind-safe ramps.

### GPU support

```js
const gpu = detectGraphicsPath() // {status: 'no-webgl2' | 'software' | 'likely-hardware', info, masked}
if (gpu.status === 'no-webgl2') mount.append(createGpuHelpPanel({status: 'no-webgl2'}))
```

Worth calling before you mount: a device that cannot run WebGL2 will never render a world, and the
element's own message ("This browser can't run WebGL2.") is true but not actionable.
`createGpuHelpPanel` returns detached DOM with browser-specific remediation steps.

---

## Determinism

The contract is reproducibility. For the same `(ruleset, seed, density, rows)`, this element and
HexLife Explorer run the same Wasm `run_tick` over a grid derived the same way and filled by the same
seeded RNG, so they agree tick for tick.

The pinned reference, if you want to check a build:

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

`@hexlife/embed/ca` is deterministic on the same terms — same states, grid, rule and cells give the
same tick sequence — but it is a **separate** engine with its own contract, and nothing about it can
move the number above.

## Requirements

WebGL2 and WebAssembly. No 2D fallback — see `detectGraphicsPath` for detecting that up front.

## Versioning

The custom-element API is **additive**: attributes, methods and events are only added, never removed
or repurposed. A *major* bump is reserved for the things that would break reproducibility — what a
ruleset hex decodes to, what an `HXW1.…` code decodes to, or the tick sequence itself. A visual
change is not breaking; a world that comes back different is.

This package versions independently of the HexLife Explorer application.

## Links

- [Source and releases](https://github.com/Sidem/HexLife) — `embed-vX.Y.Z` tags
- [HexLife Explorer](https://sidem.github.io/HexLife/) — the full lab
- MIT licensed
