# Embeddable World Widget (`<hexlife-world>`) — Development Plan (#25)

**Goal:** a standalone, self-contained script that renders a single live HexLife world on any
third-party website — replacing badly-compressed video captures with the real simulation. The
entire "video" is described by ~200 bytes of attributes (ruleset + seed + density + grid +
palette + speed) and rendered losslessly at native resolution on the viewer's GPU.

**Why this is cheap for us:** the wasm engine is 34 KB, deterministic seeded resets are already
a hard invariant, the ruleset is a 32-char hex string, and palettes are pure data. The embed is
mostly *subtraction*: one world, no workers, no panels, no analysis.

**Product framing:** every embed is an advertisement for the app. The widget should carry an
unobtrusive attribution link back to the explorer (deep-linking the same ruleset via the
existing share-URL params) unless disabled.

---

## Deliverable & distribution

- One build artifact: `hexlife-embed.js` (ES module; wasm inlined as base64 — **single file**,
  no secondary fetches, works from any static host).
- Served from GitHub Pages at a **versioned** path: `https://sidem.github.io/HexLife/embed/v1/hexlife-embed.js`.
  The `v1` segment is the compatibility contract (see "Versioning contract" below).
- Consumer usage:

```html
<script type="module" src="https://sidem.github.io/HexLife/embed/v1/hexlife-embed.js"></script>
<hexlife-world ruleset="ab54c1d2…32hex" seed="1720968400000" density="0.5"
               rows="128" speed="10" palette="synthwave"></hexlife-world>
```

- npm publish is **out of scope** for v1 (adds release ceremony; the CDN URL covers the use case).

### Second deliverable: the iframe wrapper page (do NOT skip — it doubles the addressable hosts)

Many high-value hosts (Notion, Confluence, Google Sites, LMS platforms, forums) allow **iframes
but never third-party scripts**. A custom element alone is unusable there. So also ship a tiny
hosted page that mounts the element from query params:

`https://sidem.github.io/HexLife/embed/v1/frame/?r=<hex>&seed=…&d=…&rows=…&speed=…&palette=…`

- Param names mirror `ShareCodec` where they overlap (`r`, `d`, `g`→`rows`) so the app's share
  vocabulary stays consistent.
- The page is ~30 lines: full-bleed transparent body, one `<hexlife-world>`, attributes read
  from `URLSearchParams`, same script tag a Tier-A user would paste.
- Consumers embed with `<iframe src="…/frame/?…" width="480" height="480" style="border:0"
  loading="lazy" allow="autoplay">`. The in-app "Copy embed code" UI (Phase 5) should offer
  **both** snippets (script-tag and iframe), with the iframe as the safe default for
  non-technical users.
- Cost of an iframe: an extra document + wasm instance per embed (no cross-instance memory
  sharing). Acceptable — pages rarely host more than a few.

### Host compatibility (what to tell users on the demo page)

| Tier | Hosts | Works with |
|---|---|---|
| **A — scripts allowed** | Own/static sites (GH Pages, Netlify, Vercel), Hugo/Jekyll/Astro/11ty, Docusaurus/VitePress/MkDocs, self-hosted WordPress & Ghost, CodePen/CodeSandbox/Observable, reveal.js/Slidev, itch.io | `<hexlife-world>` directly |
| **B — iframes only** | Notion, Coda, Confluence/Jira, Google Sites, LMS (Canvas/Moodle), Discourse (admin-whitelisted domain), WordPress.com lower tiers | the `frame/` wrapper |
| **C — neither** | Medium, Substack, LinkedIn/X/Reddit/Bluesky/Mastodon posts, **GitHub READMEs** (markdown is sanitized), email, PDF | video/GIF only (Capture Studio) — unless oEmbed, below |

**The Tier-C unlock lever (future, not v1):** Medium and Substack delegate embeds to
**Embedly / Iframely**, which accept **oEmbed provider registrations**. Registering HexLife as a
provider (an oEmbed endpoint returning a `rich` type whose HTML is the `frame/` iframe) would let
a pasted HexLife share link unfurl into a live simulation on those platforms. Bureaucratic but
real; revisit once v1 embeds exist in the wild. GitHub READMEs are unreachable by any mechanism —
that surface stays GIF.

**Reddit is Tier C and cannot be unlocked by embedding** (markdown is sanitized site-wide; no
per-subreddit setting changes this; old-reddit CSS can't run wasm). The *only* way to run HexLife
inside Reddit is **Devvit Web** — Reddit's developer platform, which hosts a real web app in a
webview inside an interactive post (static assets in `webroot/`, Reddit hosts front+back end for
free). Our wasm+WebGL, backend-free bundle is a good structural fit and the embed widget would be
the payload. **This is a separate project, not part of #25**: separate build target, `devvit
upload` pipeline, and app-directory review. Unverified blockers to check first (Reddit's docs site
blocked automated fetch — check developers.reddit.com/docs + r/Devvit by hand): `webroot/` asset
size limits, whether the webview CSP permits WebAssembly instantiation, and the review bar. Until
then, Reddit = GIF/video post linking to the live app.

## Public API (the forever-contract — design carefully, freeze on ship)

### Attributes

| Attribute | Type / default | Meaning |
|---|---|---|
| `ruleset` | 32-char hex, **required** | The 128-rule table (same format as share links / `hexToRuleset`). |
| `seed` | uint32; default: random | mulberry32 seed for the initial fill. Omitted ⇒ nondeterministic (fresh run per load). |
| `density` | float 0–1, default 0.5 | Initial density. 0/1 keep the app's single-center-cell special case (DensityStrategy). |
| `rows` | int 16–512, default 64 | Grid rows; cols derived exactly like the app (see Determinism). Cap lower than the app's 2048 — embeds must stay cheap. |
| `speed` | float ticks/sec, default = app default (`Config.DEFAULT_SPEED` — verify name) | Target tick rate. |
| `palette` | preset key, default `default` | Key into `PRESET_PALETTES` (v1: all presets except `symmetryGradient`, which needs `Symmetry.js` — include it only if it tree-shakes small). |
| `palette-on` / `palette-off` | comma-separated hex colors | Custom gradient override (mirrors the `customGradient` LUT mode). Wins over `palette`. |
| `paused` | boolean attr | Start paused on the rendered initial state (poster frame). |
| `max-dpr` | float, default 1.5 | Cap on devicePixelRatio for the canvas backing store. |
| `link` | `on` (default) / `off` | Attribution overlay: small corner link to the app with `?r=<ruleset>` (ShareCodec-compatible). |

### JS API (on the element)

`play()`, `pause()`, `reset()`, `tick(n)`, readonly `tickCount`, readonly `checksum`
(delegates to `World.checksum_state()` — this is what the determinism cross-check test uses).
Fire a `hexlife-ready` CustomEvent after wasm init + first frame.

### Built-in behaviors (not configurable)

- **IntersectionObserver:** pause when offscreen, resume when visible. Non-negotiable — pages
  may embed several instances.
- **`prefers-reduced-motion: reduce`:** render the initial state as a static frame with a
  play-button overlay; never autoplay.
- **`document.visibilityState`:** pause on hidden tabs (rAF throttling mostly handles this, but
  pause explicitly so the tick accumulator doesn't burst on return).
- **No WebGL2:** replace canvas with a styled fallback note + the attribution link. Do not
  attempt a 2D-canvas renderer in v1.
- **Tick budget:** accumulator-based loop, hard cap ~4 ticks per frame (no spiral of death when
  `speed` exceeds what the device sustains — visual rate degrades gracefully instead).
- Element sizing: canvas fills the element (`display:block`), default aspect-ratio 1/1 (cols ≈
  rows/(√3/2) makes the world square in render space, same as the app's square FBO).

## Determinism contract

Identical `ruleset+seed+density+rows` ⇒ **byte-identical tick sequence** with the main app in
deterministic mode. This is the whole selling point ("this embed IS the recording") and it is
achievable because both sides will share the exact same code:

- RNG: `mulberry32` (currently inline in `src/core/WorldWorker.js:106` — extract, see Phase 0).
- Fill: `DensityStrategy.generate` (`src/core/initialStateStrategies/DensityStrategy.js` — already
  pure, imports only `BaseStateStrategy`).
- Cols derivation: `cols = Math.round(rows / (√3/2))` inside `config.js` `setGridDimensions`
  (config.js:29) — extract the pure math (config.js is a mutable-global singleton with an
  import-time side effect at config.js:53; the embed must NOT import it).
- Tick: the same wasm binary (`World::run_tick`).

**Acceptance test (the keystone):** headless app runs world with (R, S, d, rows) for 100 ticks →
`checksum_state()`; embed test page runs `<hexlife-world>` with the same params for 100 ticks →
same checksum. Automate both sides via `?headless=1` + a debug handle (below).

## Architecture

New code lives under `src/embed/`:

```
src/embed/
  index.js          # entry: initSync(wasm) singleton + customElements.define
  HexLifeElement.js # the custom element: attributes, lifecycle, observers, JS API
  EmbedSim.js       # owns one wasm World: views, mirror-swap, seeded reset, tick accumulator
  EmbedRenderer.js  # minimal WebGL2 renderer (one instanced draw, no FBOs)
```

### Reuse map (import, don't fork)

- **Wasm engine** `src/core/wasm-engine/`: `initSync` + `World`. Embed uses ONLY non-allocating
  calls (`run_tick`, `*_ptr()`, `num_cells`, `checksum_state`) so views can't detach from
  *engine* calls. See the multi-instance trap below.
- **Shaders** `shaders/vertex.glsl` + `shaders/fragment.glsl` via `?raw` (same imports as
  `src/rendering/renderer.js:8-14`). Pass the hover uniforms as 0 / hover state 0 — do not fork
  the GLSL. Grid dims are already uniforms, not compile-time constants.
- **GL helpers** `src/rendering/webglUtils.js` — pure, reuse as-is (skip the FBO helpers).
- **Color LUT** `generateColorLUT(colorSettings, symmetryData)` (`src/utils/ruleVizUtils.js:110`)
  builds the 128×2 RGBA texture. Embed calls it with `mode:'preset'` or `mode:'gradient'`.
  Verify its transitive imports tree-shake (it pulls `colorPalettes.js` — fine — plus color-math
  helpers; if it drags heavy utils, extract in Phase 0).
- **Ruleset decode** `hexToRuleset` (`src/utils/utils.js:543`) — extract (Phase 0), don't import
  the 700-line grab-bag.
- **Sim loop mechanics**: mirror `WorldWorker.js` — `refreshSimViews`-style view construction
  (WorldWorker.js:125), the RESET_WORLD path (WorldWorker.js:537-563: fill state via strategy,
  `ruleIndexArray.fill(255)`, zero next buffers, `reset_rule_usage_counters`), and the
  **post-tick view swap** (`run_tick` swaps current/next internally; JS must swap its view
  references, exactly as the worker does — find `runTick` in WorldWorker.js).

### Forked (deliberately NOT shared)

- The renderer. The app's `renderer.js` (43 KB) is welded to 9 worlds / FBOs / minimap
  composition / dirty flags. The embed renderer is ~150 lines: context setup, hex VAO
  (6-vertex TRIANGLE_FAN, instanced over N cells — copy the setup from
  `renderWorldsToTextures`, renderer.js:436-470), two per-instance Uint8 attribute buffers
  (state + rule index, `bufferSubData` from the wasm views each rendered frame), the LUT
  texture, fixed centered camera, draw straight to the default framebuffer. **Do not refactor
  the app renderer to share code in v1** — that's high-risk churn for ~150 saved lines.

### The multi-instance wasm trap (write this on the wall)

All `<hexlife-world>` instances share ONE wasm instance (wasm-bindgen module-level singleton via
`initSync`) and therefore one linear memory. Constructing a new `World` can GROW that memory and
**detach every other instance's typed-array views** — the same class of bug as the app's
`refreshSimViews` gotcha, but cross-instance. Design: module-level registry of live `EmbedSim`s;
after ANY `World` construction, every registered sim rebuilds its views. `disconnectedCallback`
must `world.free()`, unregister, and cancel its rAF. Add a two-instance test page to catch this.

### Wasm inlining

Vite **lib mode inlines all assets as base64 data-URIs** by default. Import
`hexlife_wasm_bg.wasm?url`, decode the data-URI to a `Uint8Array`, and call
`initSync({ module: bytes })` — synchronous, no fetch, no MIME issues (34 KB compiles fast
enough for sync init). Do not rely on `instantiateStreaming` with a data URI (MIME check fails).

## Build & deploy

- `vite.embed.config.js`: `build.lib = { entry: 'src/embed/index.js', formats: ['es'], fileName: 'hexlife-embed' }`,
  `outDir: 'dist-embed'`, no `base` needed (single self-contained file). Keep the main
  `vite.config.js` untouched.
- `package.json`: `"build:embed": "vite build --config vite.embed.config.js"`.
- `.github/workflows/deploy.yml`: after the main build, run `build:embed` and copy
  `dist-embed/hexlife-embed.js` into the Pages artifact at `dist/embed/v1/`. Also copy
  `embed-demo.html` (below) to `dist/embed/` as a live demo + copy-paste snippet page.
- Local dev: `embed-demo.html` at repo root (or `public/`) loading the source entry via Vite dev
  server — this is the manual + headless test page. Give it a debug handle
  (`window.__hexlifeEmbed = [...elements]`) mirroring the `window.__hexlife` convention.
- **Size budget: ≤ 100 KB gzipped** (expect ~60–80: 34 KB wasm→~46 KB base64, glue + runtime).
  Add a size assertion to the build script (fail loudly, not silently grow). If over budget, the
  usual suspect is an accidental deep import of `utils.js`/`config.js`.

## Versioning contract

Once shipped, `embed/v1/` params + tick semantics are frozen forever (live embeds in the wild).
This *hardens* the existing byte-identity invariant: any future engine change that alters
`run_tick` behavior requires `embed/v2/` and keeping the v1 binary deployed. Document this in
the demo page and in `CLAUDE.md`'s gotchas (one line, pointing here).

## In-app integration ("Copy embed code")

A button (Share flow / Capture Studio — wherever the share-link button lives) that emits the
`<script>` + `<hexlife-world>` snippet for the **selected world's current run**: its ruleset
hex, grid rows, density, current palette preset, current speed, and **the seed of the last
reset**. Prerequisite: WorldManager currently *derives* seeds (`_getResetSeed`,
WorldManager.js:599 — baseSeed is `Date.now()` at reset) but verify whether it *retains* them;
if not, store `lastResetSeed` per world on every reset path (initial load uses
`initialBaseSeed`, WorldManager.js:155). Non-density initial states (clusters/saved/draw-edits):
v1 embeds the *current statistical config* only — if the world has been hand-edited, disable the
button with a tooltip ("embed captures a seeded start, not edited cells"), same philosophy as
ShareCodec's saved-state downgrade (ShareCodec.js:44-47).

## Phases

### Phase 0 — extract shared pure helpers (no behavior change) — ✅ DONE 2026-07-14

Created, all pure and side-effect free:
- `src/core/rng.js` — `mulberry32`. **It was copy-pasted in FOUR modules** (`WorldWorker`,
  `AutoExploreService`, `analysis/EmbeddingArchive`, `ui/components/initialStatePreview`). All four
  were arithmetically identical (EmbeddingArchive's extra `seed >>> 0` is a no-op once `a |= 0`
  runs), so unifying them changed no seeded output. All four now import the one copy.
- `src/core/rulesetHex.js` — `hexToRuleset` / `rulesetToHex`, moved out of `utils.js` (34 KB, and
  it imports `config.js`). `utils.js` re-exports them; no call site moved.
- `src/core/gridMath.js` — `deriveGridDimensions` + `GRID_SIZE_PRESETS` + `DEFAULT_GRID_SIZE_KEY`.
  The function was *already* pure in `config.js`; the reason to move it is that `config.js` runs
  `setGridDimensions()` as an **import-time side effect**, which the embed must not pull in.
  `config.js` re-exports; no call site moved.

New `tests/rng.test.js` pins the determinism contract as golden values (PRNG stream for seed 1,
grid dims per preset, and the composed seeded fill = mulberry32 + DensityStrategy). **These are a
public contract — a failure means the change invalidated every share link and embed in existence;
fix the change, don't re-bless the values.**

**Verified:** `npm run test:run` 524/524 pass (34 files, incl. all pre-existing determinism +
share-codec suites); `npm run lint` 0 errors; `npm run typecheck` clean; headless app boots, the
worker's seeded fill lands at ratio 0.497 for density 0.5, and the sim ticks (119 ticks, ratio
evolved 0.497 → 0.028), no console errors.

**Gotcha found:** `deriveGridDimensions(96)` → **112 cols, not 110** (the even-column rounding
after the ÷(√3/2)). Don't hand-derive these; the test pins them.

### Phase 1 — embed runtime (sim + renderer, no element yet) — ✅ DONE 2026-07-14

`src/embed/EmbedSim.js` + `src/embed/EmbedRenderer.js`, driven from `embed-demo.html` (repo root)
with hardcoded params and a `window.__hexlifeEmbed` debug handle.

**Reuse held.** The sim imports `rng.js` / `rulesetHex.js` / `gridMath.js` / `DensityStrategy` and
the same wasm `run_tick`; the renderer imports the **unforked** `shaders/*.glsl`, `webglUtils.js`
and `generateColorLUT`. Only the renderer's *plumbing* is forked (one world, no FBOs, no minimap).
Neither file imports `config.js` or `utils.js`.

**Verified in the preview browser** (`/HexLife/embed-demo.html`):
- Grid derivation matches: `rows:64 → 74 cols`, 4736 cells.
- **Determinism:** seed 12345 → checksum `231200078` at tick 100, reproduced exactly on a second
  run; seed 999 → a different checksum (so the check isn't vacuously passing on a constant).
- **Render:** one instanced draw fills the canvas (95% of pixels non-background, **130 distinct
  color buckets** ⇒ the rule-index LUT is genuinely being sampled), `gl.getError() === 0`.
- **The cross-instance detachment trap is REAL and the registry catches it.** Constructing a second
  256-row world grew wasm linear memory — sim #1's `state.buffer` identity changed — which without
  the registry would have left every one of its views detached. With it, sim #1 was not detached and
  still reproduced checksum `231200078`. Do not remove `refreshAllViews()`.

**Two gotchas found:**
- **The preview browser reports `document.visibilityState === 'hidden'`, so rAF NEVER FIRES there.**
  The demo's animation loop is dead in that pane — this is not a bug in the loop. Drive ticks through
  the debug handle (`__hexlifeEmbed.runTicks(n, seed)`) instead. (Also: WebGL screenshots hang
  headless, so verify pixels via `gl.readPixels`, as above — not screenshots.)
- The dev server's `base` is `/HexLife/`, so the page is at **`/HexLife/embed-demo.html`**; a bare
  `/embed-demo.html` serves Vite's "did you mean" notice, and an HMR reload drops the path back to
  the app root (same family as the known `?headless=1` query-drop gotcha).

**Deferred to Phase 3 as planned:** wasm is loaded with `fetch(wasmUrl) → init({module_or_path})`
rather than `initSync` on inlined bytes. `fetch` handles a real URL (dev) *and* a base64 `data:`
URI (Vite lib build inlines it), so the same code path survives the Phase 3 build with no branch —
and it sidesteps `instantiateStreaming`'s MIME check on data URIs.

### Phase 2 — custom element + policies

`HexLifeElement`: attribute parsing/validation (bad ruleset ⇒ styled error state, never a
throw), JS API, `hexlife-ready` event, IntersectionObserver, reduced-motion poster + play
button, visibility pause, `max-dpr` + ResizeObserver, attribution link, disconnect cleanup,
multi-instance registry + view-refresh-on-construction.
**Accept:** demo page with 3+ instances (different palettes/speeds; one `paused`, one added
dynamically after 2 s to exercise the detachment registry) all animate correctly; removing one
frees it (no rAF leak — assert via handle); reduced-motion emulation shows posters.

### Phase 3 — build + deploy + demo page + iframe wrapper

`vite.embed.config.js`, `build:embed` script, size assertion, deploy.yml integration, the
`embed/v1/frame/` wrapper page (params → attributes; see "Second deliverable" above), and a
polished `embed/` demo page: live examples, **both** copy-paste snippets (script-tag + iframe),
the host-compatibility table, param docs, and the determinism pitch.
**Accept:** clean `npm run build && npm run build:embed` locally (wasm-pack PATH gotcha applies
— see CLAUDE.md); artifact is ONE file ≤ 100 KB gz; a plain `python -m http.server` page with
just the script tag + element works (proves self-containment, no /HexLife/ base assumptions);
the `frame/` URL renders correctly when loaded inside a cross-origin `<iframe>` on that page.

### Phase 4 — determinism cross-check + unit tests

- vitest: attribute parsing/clamping; `deriveGridCols` pinned values; seeded-fill golden vector
  (mulberry32(S) + DensityStrategy over a small grid ⇒ pinned byte array); LUT generation for a
  preset + custom gradient (pinned few entries).
- Headless E2E: app side seeds (R,S,d,rows) deterministically, ticks 100, records checksum;
  embed demo page (`?headless=1`-style) same params, asserts equal checksum via element API.
**Accept:** the cross-check runs green and is wired into the test suite (or a documented npm
script if it needs the preview browser).

### Phase 5 — in-app "Copy embed code"

Seed retention (verify/add `lastResetSeed`), snippet builder emitting **both** the script-tag and
iframe forms (unit-test both strings), button + disabled-when-edited state, toast on copy.
**Accept:** copy from a freshly-reset world → paste into demo host page → visually identical
run (spot-check checksum at tick 100 via the element API); the iframe snippet works when pasted
into a Notion-style host (manual check against one real Tier-B platform).

## Risks & gotchas (carry-overs + new)

- **Cross-instance view detachment** — the trap above; it will pass single-instance tests and
  fail in the wild. The dynamic-add test in Phase 2 exists to catch it.
- **`utils.js`/`config.js` gravity**: both are import-time-side-effect grab-bags; one careless
  import drags the app into the bundle. The size assertion is the tripwire.
- **Shader reuse**: vertex.glsl may reference app-specific uniforms (hover factors, etc.) — set
  them to neutral values rather than forking; if the shader hard-depends on something the embed
  can't supply, fork ONLY then and leave a comment linking the two.
- **`speed` semantics**: match the app's speed unit exactly (verify what
  `SimulationController.getSpeed()` means — ticks/sec vs multiplier) so copied embeds match.
- **GH Pages caching**: Pages serves with long cache headers; versioned path (`/v1/`) makes
  that a feature, not a bug. Never mutate a shipped `vN` artifact's behavior.
- **Lint discipline**: run FULL `npm run lint` after the last edit before each commit (CI has
  been broken by per-file lint before).

## Out of scope (v1) — noted for later

- Worker-offloaded ticking (only needed for big grids at high speed; main-thread is fine ≤256 rows).
- Exact-cell starts (`stateB64` attribute) — works technically, fat markup; add if requested.
- Scrub/seek API, k-state, npm package.
- **oEmbed / Embedly-Iframely provider registration** — the Tier-C unlock lever (Medium,
  Substack). Deliberately deferred, not dismissed: revisit once v1 embeds exist in the wild and
  the `frame/` URL is a stable public surface to point an oEmbed endpoint at.
- 2D-canvas fallback renderer.
