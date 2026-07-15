# Embeddable World Widget (`<hexlife-world>`) — Development Plan (#25)

**Goal:** a standalone script that renders one live HexLife world on third-party sites —
lossless, ~200 bytes of attributes (or one world code), native GPU resolution.

**Live demo (dev):** `embed-demo.html` · **CDN target:** `…/HexLife/embed/v1/hexlife-embed.js`

---

## Status (2026-07-15)

| Phase | Status |
|---|---|
| 0 — pure helpers (`rng`, `rulesetHex`, `gridMath`) | ✅ Done |
| 1 — `EmbedSim` + `EmbedRenderer` | ✅ Done |
| 2 — `<hexlife-world>` custom element + policies | ✅ Done (public API treated as frozen) |
| 2b — `code` attribute (WorldCodec), generator codes, poster/reset, live `speed` | ✅ Done |
| **2c — zoom (wheel + pinch)** | **In progress** (with #26) |
| 3 — lib build + deploy + iframe wrapper | Open |
| 4 — determinism cross-check automation | Open (manual goldens exist) |
| 5 — in-app "Copy embed code" | Open |

---

## Public API (frozen surface — extend carefully)

### Attributes

| Attribute | Meaning |
|---|---|
| `ruleset` | 32-char hex (required unless `code`) |
| `seed` / `density` / `rows` / `speed` / `palette` / `palette-on`/`off` | Standard params |
| `code` | `HXW1.…` world code — full dish; wins over individual attrs |
| `paused` | Start paused (poster) |
| `max-dpr` | Cap devicePixelRatio (default 1.5) |
| `link` | `on`/`off` attribution |

### JS API

`play()`, `pause()`, `reset(seed?)`, `tick(n)`, readonly `tickCount` / `checksum` / `playing` / `sim`,
event `hexlife-ready`.

### Built-in policies

IntersectionObserver pause, `visibilityState`, `prefers-reduced-motion` poster, never throw into host,
full teardown on disconnect, multi-instance wasm view-refresh registry.

---

## Architecture

```
src/embed/
  index.js            # customElements.define (idempotent)
  HexLifeElement.js   # shell: attributes, loop, policies, chrome
  EmbedSim.js         # one wasm World; same tick path as the app
  EmbedRenderer.js    # one instanced WebGL2 draw (shaders/LUT shared)
  attrs.js            # pure attribute coercers (vitest-safe)
src/core/WorldCodec.js  # HXW1 world codes (async deflate)
```

**Do not import** `config.js` / fat `utils.js` into the embed graph.

**Keystone invariant:** same `(ruleset, seed, density, rows)` ⇒ byte-identical ticks with the app
(pinned checksum seed 12345 → `231200078` at tick 100).

---

## Open work

### Phase 3 — build + deploy + iframe wrapper

- `vite.embed.config.js` + `build:embed`; size budget ≤ 100 KB gz
- Deploy to Pages at `embed/v1/`; `embed/v1/frame/?…` iframe wrapper
- Polished demo page (script-tag + iframe snippets, host tier table)

### Phase 4 — determinism cross-check in CI

Automate app-vs-embed checksum at tick 100 (headless / documented script).

### Phase 5 — in-app "Copy embed code"

Seed retention if needed; emit script-tag + iframe snippets; disable when world is hand-edited.

### Out of scope (v1)

Worker offload, oEmbed/Embedly, 2D canvas fallback, npm package, k-state.

---

## Gotchas (carry-overs)

- Cross-instance view detachment on `World` alloc — registry + `refreshAllViews()`
- Attribute upgrade order boots once per attr without `_hasConnected` gate
- Preview browser: `visibilityState === 'hidden'` kills rAF; drive via debug handle
- Wasm `data:` URI: decode with `atob`, never `fetch` (CSP `connect-src`)
