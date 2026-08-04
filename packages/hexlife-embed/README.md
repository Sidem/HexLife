# `@hexlife/embed`

A live [HexLife](https://sidem.github.io/HexLife/) world as a custom element — a hexagonal cellular
automaton running on WebGL2, with the Rust/Wasm tick engine bundled in.

This is the shared runtime behind HexLife Explorer and HexLife on Reddit. The same
`(ruleset, seed, density, rows)` produces a byte-identical tick sequence in all three, which is what
makes an embed a *recording* of a world rather than something that merely resembles one.

**[▶ Live demo: the complete totalistic class](https://sidem.github.io/HexLife/totalistic-256.html)**
— all 256 totalistic rules running at once on one 16×16 map, built entirely with this package. It is
the clearest single demonstration of what `<hexlife-grid>` is for.

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

---

## Two entry points

| Import | Needs | Use for |
|---|---|---|
| `@hexlife/embed` | DOM, WebGL2, Wasm | The browser. Importing it registers `<hexlife-world>` and `<hexlife-grid>`. |
| `@hexlife/embed/api` | Nothing | Node and browsers alike: world codes, ruleset metadata, palette names, GPU probing. No DOM at module scope. |

A server that validates a pasted world code must import **only** `@hexlife/embed/api` — the root
entry evaluates custom-element, Wasm and WebGL code at import time.

The browser bundle **inlines the Wasm binary** as a data URI rather than fetching a side-car asset,
because a strict host CSP (a Reddit webview, for instance) is not something an embed can widen.

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
| `palette` / `palette-on` / `palette-off` | as `<hexlife-world>` | `default` | ✅ |
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

## `@hexlife/embed/api`

DOM-free, safe in Node.

```js
import {
  decodeWorldCode, encodeWorldCode, explorerUrlForRuleset,
  describeRuleset, rulesetName, ORBIT_LABELS,
  listPresetPalettes,
  detectGraphicsPath, createGpuHelpPanel,
} from '@hexlife/embed/api'
```

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
