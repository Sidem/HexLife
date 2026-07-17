# Embeddable World Widget (`<hexlife-world>`) — Plan (#25)

Standalone script: one live HexLife world on third-party sites — lossless, small attributes (or one
world code), native GPU resolution.

**Demo (dev):** `embed-demo.html` · **CDN target:** `…/HexLife/embed/v1/hexlife-embed.js`

---

## Status (2026-07-15)

| Phase | Status |
|---|---|
| 0 — pure helpers (`rng`, `rulesetHex`, `gridMath`) | ✅ Done |
| 1 — `EmbedSim` + `EmbedRenderer` | ✅ Done |
| 2 — custom element + policies | ✅ Done (public API frozen) |
| 2b — `code` (WorldCodec), poster/reset, live `speed` | ✅ Done |
| 2c — zoom (wheel + pinch; min 1 = fit, max 8) | ✅ In element (used by Devvit) |
| 3 — lib build + deploy + iframe wrapper | Open |
| 4 — determinism cross-check automation | Open (manual goldens exist) |
| 5 — in-app “Copy embed code” | Open |

---

## Public API (frozen — extend carefully)

**Attributes:** `ruleset` · `seed` · `density` · `rows` · `speed` · `palette` · `palette-on`/`off` ·
`code` (`HXW1.…`, wins over attrs) · `paused` · `max-dpr` · `link` (`on`/`off`) ·
`draw` (invert-paint on drag; pauses while drawing) ·
`wheel-zoom` (`free` default | `ctrl`) ·
`preview` (poster burst tick count).

`preview` *(additive, 3.7)* — the paused poster runs a short burst of generations (~4/sec) when the
element **arrives on screen**, then rewinds to tick 0. Value = tick count, clamped 1–60;
unparseable → 12; absent → off. For feeds, where a still dark grid reads as a broken image at
scroll speed.

It is decoration, not playback, and that distinction is the contract: it never touches the rAF loop,
so `playing` stays `false` and **no `hexlife-playstate` fires**. It runs only while the poster is up
(`userPaused`, no `draw`, no explicit `play()`), only when `_docVisible`, and never under
`prefers-reduced-motion: reduce`. Anything the user does cancels it instantly — `play()` and a draw
stroke cancel *without* rewinding (their state is the one that matters now); scrolling away, a
hidden tab, or removing the attribute rewind to the authored poster. An exact-cells world replays
its cells on rewind; a generator world re-rolls, which is that world's own contract.

"Arrives" means scrolled into view **or** already in view at the element's first intersection
report — the latter is what makes it work for hosts that defer mounting until the element is
visible (see DEVVIT-PLAN 3.7 WP7).

`wheel-zoom="ctrl"` zooms only with ctrl/meta held; a plain wheel falls through **unprevented** so
the host page scrolls. For embeds in a feed, where scrolling past is the common case and a swallowed
wheel traps the reader. Trackpad pinch is delivered as ctrl+wheel (Chromium/Firefox), so
pinch-to-zoom is unaffected. Applies live — no re-boot. Unrecognized values mean `free`, so a typo
can never silently disable zoom.

**JS:** `play()` / `pause()` / `reset(seed?)` / `tick(n)` / `setBrushSize(n)` / `worldCode()` ·
readonly `tickCount` / `checksum` / `playing` / `userPaused` / `brushSize` / `sim`.

`worldCode()` *(additive, 3.7)* — async; the world as it stands **right now**, encoded as an
`HXW1.` code, or `null` when there is nothing to encode (error state, or not booted). The cells are
whatever is on screen, painted ones included. It **never** encodes a `generator`, even when the
world was booted from a code that had one: a generator is a recipe that re-rolls a different state
on every reset, and this is meant to reproduce *this* world. Palette precedence mirrors the
decoder's — `colorSettings`, then a baked `lut`, then the renderer's resolved LUT (which is what
covers an attribute-driven world, whose colors exist only as a preset name until drawn).

Built on two additive internals, both public on their objects: `EmbedSim.snapshotCells()` (a private
copy — `sim.state` is a view into wasm memory that detaches on any `World` alloc and changes every
tick) and `EmbedRenderer.getLut()` (the 128×2 RGBA table currently on screen; retained on every
`_buildLUT`, so it tracks live `setPalette` calls too).

**Types:** `src/embed/hexlife-world.d.ts` declares the element class (and augments
`HTMLElementTagNameMap`). It is the compiler-checkable copy of this section — keep them in step.

**Events** (all `bubbles` + `composed`):

| Event | Detail | Fires |
|---|---|---|
| `hexlife-ready` | `{rows, cols, numCells, brushSize}` | Once per successful boot |
| `hexlife-playstate` | `{playing, userPaused}` | Whenever the tuple changes (deduped) |
| `hexlife-error` | `{message, detail}` | On entering the styled error state |

`hexlife-playstate` exists because playback has five invisible gates (attribute, API call, viewport,
tab visibility, reduced motion); without it a host must poll a getter on a timer to keep a
play/pause label honest. It fires *before* `hexlife-ready` on boot (the boot's `_syncPlayback`
precedes the ready dispatch), so attach listeners before connecting the element.

**Policies:** IntersectionObserver pause, `visibilityState`, `prefers-reduced-motion` poster, never
throw into host, full teardown on disconnect, multi-instance wasm view-refresh registry.

---

## Architecture

```
src/embed/
  index.js            # customElements.define (idempotent)
  HexLifeElement.js   # shell: attributes, loop, policies, chrome
  EmbedSim.js         # one wasm World; same tick path as the app
  EmbedRenderer.js    # one instanced WebGL2 draw
  attrs.js            # pure coercers (vitest-safe)
src/core/WorldCodec.js  # HXW1 world codes (async deflate)
```

**Do not import** `config.js` / fat `utils.js` into the embed graph.

**Keystone:** same `(ruleset, seed, density, rows)` ⇒ byte-identical ticks with the app
(pinned: seed 12345 → checksum `231200078` at tick 100).

Attribution link (when `link` ≠ `off`): `https://sidem.github.io/HexLife/?r=<hex>&g=<rows?>` —
same deep-link pattern Devvit Phase 3.5 should reuse outside the element.

---

## Open work

### Phase 3 — build + deploy + iframe

- `vite.embed.config.js` + `build:embed`; size budget ≤ 100 KB gz  
- Pages at `embed/v1/`; `embed/v1/frame/?…` iframe wrapper  
- Polished demo (script-tag + iframe snippets)

### Planned additive API (Devvit Phase 3.7 — spec in `docs/DEVVIT-PLAN.md`)

- ✅ `worldCode()` — landed 3.7 WP4; see Public API above.
- ✅ `preview` attribute — landed 3.7 WP5; see Public API above.
- ✅ CSS-only pulse on the poster play overlay (reduced-motion gated) — landed 3.7 WP5. Internal to
  the element's shadow `STYLES`; no API surface.

### Phase 4 — CI determinism

Automate app-vs-embed checksum at tick 100.

### Phase 5 — in-app “Copy embed code”

Emit script-tag + iframe snippets; disable when world is hand-edited if seed/cells can’t round-trip.

### Out of scope (v1)

Worker offload, oEmbed, 2D fallback, npm package, k-state.

---

## Gotchas

- Cross-instance view detachment on `World` alloc — registry + `refreshAllViews()`  
- Attribute upgrade order: gate boots with `_hasConnected`  
- Preview browser: `visibilityState === 'hidden'` kills rAF — drive via debug handle  
- Wasm `data:` URI: `atob`, never `fetch` (CSP `connect-src`)
