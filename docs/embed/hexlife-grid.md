[← `@hexlife/embed` docs](./README.md)

# `<hexlife-grid>` — many worlds, one context

A browser gives a *page* about **sixteen** WebGL contexts. Chrome force-loses the oldest past that
and carries on without an error, so a wall of [`<hexlife-world>`](./hexlife-world.md) elements
silently stops being a wall at sixteen. That is a hard ceiling, not a budget to spend carefully.

`<hexlife-grid>` puts N simulations behind **one** context and draws each into its own viewport, so
the marginal cost of a world is an instance-buffer upload rather than a context. All 256 totalistic
rules at 96×112 cells measure ~19 ms a frame end to end — and 18 of those are the wasm ticks, not
the drawing.

```js
import '@hexlife/embed' // registers <hexlife-grid> alongside <hexlife-world>
```

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

The live version is [256 worlds, one rule class](https://sidem.github.io/HexLife/totalistic-256.html).

## Attributes

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

## JavaScript API

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

The grid schedules no redraw on frames that produce no tick, and parks its animation loop once
every tile is settled. It still advances settled tiles while another tile is active so all worlds
remain on the same generation; any reset, clear, cell replacement, or rule change wakes the grid.

## Events

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

## What it deliberately does not have

`draw`, `brush`, `torus`, `zoom`, `code` and `worldCode()`. All six are single-world ideas. Open one
`<hexlife-world>` on the tile the viewer picked — that handoff is what `hexlife-worldselect` is for,
and mounting that element only while it is on screen keeps the context budget honest.

The [policies](./hexlife-world.md#policies) are unchanged: it never throws into the host page,
offscreen and hidden-tab grids pause, `prefers-reduced-motion` suppresses autoplay, disconnecting
frees every wasm world, and a lost GPU context is a gap rather than an error state.
