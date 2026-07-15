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
`code` (`HXW1.…`, wins over attrs) · `paused` · `max-dpr` · `link` (`on`/`off`).

**JS:** `play()` / `pause()` / `reset(seed?)` / `tick(n)` · readonly `tickCount` / `checksum` /
`playing` / `sim` · event `hexlife-ready`.

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
