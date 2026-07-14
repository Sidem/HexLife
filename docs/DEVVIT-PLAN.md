# HexLife on Reddit — Devvit Web app (#26)

**Goal:** ship HexLife as a Reddit **interactive post**: a live, GPU-rendered hex world running
inside the post itself, on desktop and in the Reddit mobile apps. Reddit sanitizes all markdown
(no iframe, no script — see `docs/EMBED-PLAN.md` host table), so **Devvit Web is the only way to
run HexLife inside Reddit**. This is a separate build target and a separate product from #25;
it *consumes* #25's embed runtime as its payload.

**Depends on #25 phases 0–2** (`EmbedSim` + `EmbedRenderer` + the custom element). Do not start
this before that runtime exists — otherwise you fork the sim/renderer twice.

---

## Feasibility verdict: GREEN (with two unknowns to confirm in Phase 0)

The blocker that could have killed this was **WebAssembly under Reddit's webview CSP** (a
webview iframe without `wasm-unsafe-eval` in `script-src` cannot instantiate wasm at all).
**Resolved: wasm works.** Reddit officially advertises Devvit Web support for **Godot, Unity,
and GameMaker** ([Reddit's Fun and Games hackathon page](https://redditfunandgames.devpost.com/)),
and every one of those engines' web export is WebAssembly. WebGL is likewise implied (Three.js
is named explicitly, and `reddit/devvit-corridor` is a canvas-rendered shooter).

Our payload is the *easy* case for this platform: ~34 KB wasm + a small JS bundle, **no backend,
no external network calls** (so we never touch Devvit's fetch-domain allowlist, which is the
usual approval friction).

**Remaining unknown:** `webroot/` total asset size limit (we need well under 1 MB — almost
certainly fine; confirm against developers.reddit.com/docs, which blocks automated fetch).

### Verified on this machine (2026-07-14)

- **Devvit CLI 0.13.8 installed globally and RUNS ON NODE 20.17.0** (`@devvit/cli/0.13.8
  win32-x64 node-v20.17.0`). The oft-cited "Node 22+" requirement did not bite; the package
  declares no `engines` field. **No Node upgrade was performed** — deliberately, to avoid
  perturbing the known-good wasm build. `fnm` is installed if a later command forces the issue.
- **Unpublished-app subscriber cap CONFIRMED: < 200 subscribers.** Straight from `devvit --help`:
  *"Uploaded apps are only visible to you (the app owner) and can only be installed to a small
  test subreddit with less than 200 subscribers."* The test subreddit must stay small until the
  app clears review.
- **`devvit publish` uploads app SOURCE for review**, not just the built artifact. Fine for an
  open-source project; note it before pushing anything you would not publish.
- CLI command surface (0.13.8): `init`/`new`, `playtest`, `upload`, `publish`, `install`,
  `uninstall`, `logs`, `login`/`logout`/`whoami`, `list apps`/`list installs`, `settings`,
  `products add`, `update app`, `create icons`. **These commands are the source of truth over any
  tutorial (or this doc) — the API churned across 0.10 → 0.11 → 0.13.**

## Product: what the post actually is

**MVP (v1) — "Live Specimen" post.** A post renders one world from a fixed
(ruleset, seed, density, rows, palette), auto-playing when in view. Two buttons: **Reseed** (new
random seed, same ruleset — the variable reward) and **Open in Explorer** (deep link to the app
with `?r=<hex>`, using the existing ShareCodec params). Post title carries the ruleset's mnemonic
name from `rulesetName()`.

**v2 — Daily Hex on Reddit.** Devvit gives us a **scheduler** and **Redis** for free, so the app
can auto-post a daily ruleset to the subreddit and persist per-user state. This is the same
mechanic as roadmap **#17 (Daily Hex)** with Reddit as the distribution surface — build #17's
core deterministic-daily logic first and let the Devvit app be a second frontend onto it, not a
reimplementation. Optional: users comment their prediction; the app reveals the outcome (ties to
**#19 prediction mode**).

**v3 — voting feeds the community library.** Upvote/rate rulesets in-post; results flow back into
the existing `VoteBank` / community-library machinery. Only pursue if v1/v2 get traction.

Scope this session to **v1**. It is the whole technical risk; v2/v3 are content on top.

## CURRENT STATE (2026-07-14) — read this first

**The app is scaffolded and exists.** Owner completed all account steps.

- **App slug: `hexlifeapp`** (in `devvit.json` → `name`). **Permanent** — this is the Reddit app
  directory identity. (`hexlife` was presumably taken or lost to the captcha retries.)
- **Location: `HexLife/devvit/`** — in-repo, as of 2026-07-14. See "Repo layout" below. (It was
  scaffolded outside the repo at `X:\Programming\Projects\HexLifeDevvit\hexlifeapp`; that copy is a
  now-redundant fallback.)
- Test subreddit **r/hexlife** created (owner moderates, <200 subs ✓). `devvit whoami` →
  `u/SciStone_`. Runs locally with `npm run dev`.
- **Captcha war story:** app creation kept failing the "humanity check" on the owner's PC with
  bogus CSP violations (a policy *different* from the one Reddit actually serves — almost certainly
  an HTTPS-inspecting antivirus rewriting headers locally). **Solved by doing it from a phone.**
  If `devvit upload`/`publish` behaves strangely from the PC, suspect the same local TLS
  interception first.

### The scaffold is NOT what this plan originally assumed — corrected below

The 0.13.8 "Devvit Web" template is a modern TS monorepo-ish layout. **Trust this, not any older
tutorial (or the pre-2026-07-14 version of this doc).**

```
hexlifeapp/
  devvit.json          # NOT devvit.yaml. name=hexlifeapp; post.entrypoints {default: splash.html,
                       #   game: game.html}; menu items; triggers; $schema is authoritative
  public/              # THE WEBROOT (not `webroot/`). Static files served to the webview.
    splash.html        # default post entrypoint (pre-click / lightweight card)
    game.html          # the interactive entrypoint  ← HexLife renders here
    *.js               # esbuild OUTPUT (bundled from src/client) — do not hand-edit
  src/client/          # webview TS (splash.ts, game.ts, fetch.ts) → bundled into public/*.js
  src/server/          # Node server Reddit hosts for us (index.ts, server.ts, db.ts = Redis)
  src/shared/api.ts    # types shared across the client/server boundary
  package.json         # esbuild build, biome lint, node --test; engines: node >= 22.6
```

- **Toolchain is separate from HexLife's**: TypeScript 6 + **esbuild** + **Biome** (not Vite, not
  ESLint, not vitest). Don't try to unify them; let each project keep its own.
- **`engines: node >= 22.6`** and `.nvmrc` = `22.6.0`. The machine's global Node is **20.17.0** and
  the main HexLife build must STAY there. `fnm` is installed — run `fnm use` inside the devvit dir
  (it reads `.nvmrc`) and leave the system Node alone.
- `npm run watch` shells out via `sh -c` — needs Git Bash on PATH (it works; `npm run dev` runs).
- There IS a server half (Redis via `src/server/db.ts`). v1 barely needs it (store post params);
  it's already wired for the v2 Daily.

### Repo layout — ✅ SETTLED 2026-07-14: option 1, the app lives in-repo at `devvit/`

The webview **cannot fetch our embed bundle from a CDN** — Devvit webview assets must be bundled and
served from `public/`. So the Devvit app needs `src/embed/` (#25) *in its build graph*. The
alternative (separate repo + a sync script copying the built embed artifact in) was rejected: it
institutionalizes drift and a stale-copy failure mode. Option 1 is the whole reason #25 Phase 0
extracted pure modules. **Do not fork the sim/renderer.**

**What was done:** the scaffold was copied from `X:\Programming\Projects\HexLifeDevvit\hexlifeapp`
to `HexLife/devvit/`. Its inner `.git` was dropped (it had **zero commits and no remote** — nothing
was lost) along with its `.github/` (dependabot + a CI workflow that would be inert in a
subdirectory — GitHub only reads workflows from the *root* `.github/workflows`). Everything else is
the stock template, byte for byte. The original directory is still there as a fallback and can be
deleted once playtest is green from the new location.

Boundaries that keep the two toolchains from perturbing each other:

- `devvit/` keeps its **own** `package.json` / `node_modules` / TypeScript + esbuild + Biome. The
  root never builds or lints it; it lints itself (`npm run lint` inside `devvit/`).
- **Root ESLint ignores `devvit/**`** (eslint.config.js) — otherwise `eslint .` picks up the
  bundled esbuild output in `devvit/public/*.js`. This was the *only* root guard needed: vitest is
  scoped to `tests/**/*.test.js` and root `tsconfig.json` to `src/**/*.js`, so neither sweeps it.
- Git ignores devvit's build output via the scaffold's **nested `.gitignore`** (`/node_modules/`,
  `/dist/`, `/public/*.js*`) — nested ignores work, no root change needed. 25 source files tracked.
- **Node:** root stays on **20.17.0** (the known-good wasm build). `devvit/` runs on **22.6.0**,
  installed via `fnm install 22.6.0` (its `.nvmrc` pins it). fnm's *default* is still 20 — nothing
  about the system Node changed. `fnm use` inside `devvit/`, or non-interactively:
  `fnm exec --using=22.6.0 -- npm.cmd <script>` (note **`npm.cmd`** — `fnm exec -- npm` fails with
  "program not found" on Windows because npm is a `.cmd` shim).
- **Verified from the new location:** `npm run build` (esbuild client + server) succeeds; the root's
  `npm run lint` / `typecheck` / `test:run` are unchanged.

- The webview is **the #25 embed runtime with a different shell**: import `EmbedSim` +
  `EmbedRenderer` (or just use `<hexlife-world>` directly — simplest, and it exercises the same
  public API third parties get). It is bundled by **devvit's own esbuild** (`build:client`, which
  already bundles `src/client/game.ts`) via a relative import across the repo — there is no separate
  Vite config for this, and no copied artifact.
- **Devvit ↔ webview messaging** is `postMessage`-based (typed both ways; see `devvit-corridor`'s
  messaging module for the pattern). v1 needs it only for: Devvit → webview (initial params) and
  webview → Devvit ("open explorer" URL nav, Reseed if the seed should persist to Redis).
- Post params (ruleset/seed/palette) live in **Redis keyed by post ID**, set when the post is
  created; the webview receives them in the init message. Don't try to smuggle them in the URL.
- **No `fetch` to anything.** Everything is bundled. This keeps us out of app-review's network
  allowlist path entirely.

## Constraints to design against

- **Mobile webviews are the majority of Reddit traffic.** Budget for a phone GPU: default to a
  **small grid (64–96 rows)** and a modest speed; the desktop-tier grid sizes are not appropriate
  here. Test on a real phone in the Reddit app, not just desktop web.
- **Post height is fixed/limited**; webviews render in the post's viewport (with an expand
  affordance). Design for a square-ish, small canvas — no panels, no chrome, no text overlays
  beyond one line.
- Autoplay + `IntersectionObserver` pause + reduced-motion handling from #25 apply here verbatim
  and matter *more* (a feed scrolls past many posts).
- **Node 22+ is likely required by the Devvit CLI** (this machine is on **v20.17.0** — see
  prerequisites). Devvit's own toolchain (esbuild) is separate from our Vite build; keep
  `devvit/` isolated with its own `package.json` so it can't perturb the app's build.
- Reddit review applies to *publishing to the app directory*; you can install an uploaded app on
  a subreddit you moderate without full directory publication.

## What must be done by the owner (cannot be automated by an agent)

These are account/authorization actions — an agent must not perform them:

1. ~~Reddit account prerequisites~~ — **DONE** (owner: 480 karma, 5y age, email verified — clears
   the bar comfortably).
2. ~~Install Node 22+~~ — **NOT NEEDED**, see verified section above. CLI runs on Node 20.17.0.
3. ~~`npm i -g devvit`~~ — **DONE** (0.13.8). **`devvit login` is still owner-only**: it opens a
   browser OAuth flow against the Reddit account. An agent must never drive an auth flow or enter
   credentials. Confirm with `devvit whoami`.
4. **Create a test subreddit you moderate** (e.g. `r/hexlife`) for playtesting and the demo post.
   Must have **< 200 subscribers** (confirmed cap) until the app is published. Name is
   **permanent** — subreddits cannot be renamed. Recommend Public, since it later becomes the
   project's public home + demo-post host.
5. **Pick the app name** — a *globally unique* slug on Reddit's app directory, effectively
   permanent. Decide before the first `devvit upload`.
6. **Approve each `devvit upload` / `devvit playtest` / `devvit publish`** — these push code (and,
   for `publish`, source) to Reddit's servers. An agent must ask every time.
7. **Submit for review / publish** to the app directory when you want it public, and respond to
   any reviewer feedback.

Everything else — scaffolding, the webview client, the Devvit-side post type, messaging, the
build pipeline, tests, docs — an agent can build and run locally.

## Phases

### Phase 0 — scaffold + toolchain — ✅ DONE 2026-07-14

App created (`hexlifeapp`), subreddit created (r/hexlife), CLI installed and authed, scaffold runs
locally, **repo layout settled (in-repo at `devvit/`, see above)**, the **stock template was
playtested**, and the **post renders in r/hexlife** (owner-confirmed — see below). Nothing is
blocking Phase 1.

**#25's dependency is also satisfied as of 2026-07-14:** phases 0–2 of the embed are done, so
`<hexlife-world>` exists and the webview can simply *use* it. Phase 1 below is now unblocked on both
sides.

#### Stock-template playtest, 2026-07-14 — upload/install ✅, render unconfirmed

`devvit playtest hexlife`, run from `devvit/` on the unmodified template. Results:

- **✅ The auth → build → upload → install loop works.** 7 WebView assets (~732 KB) uploaded;
  `devvit list installs` shows `hexlifeapp` installed on **r/hexlife (v0.0.1)**. The positional
  subreddit argument IS honored (no `dev.subreddit` field needed in `devvit.json`).
- **⚠️ The CLI also announced "We'll create a default playtest subreddit for your app!" and an
  `hexlifeapp_dev` subreddit now exists** (carrying Reddit's own "Devvit Admin Helper App"), even
  though we passed an explicit subreddit. Unclear whether the CLI created it or it pre-dated the
  run. Harmless, but know that playtest may mint a `r/<app-name>_dev` subreddit as a side effect.
- **⚠️ `playtest`'s watch half needs `sh` on PATH.** The template's `watch` script is
  `sh -c '…'`, so from PowerShell it dies with `'sh' is not recognized` and **live-reload-on-save
  silently does not run** (the upload still succeeds — it just ships whatever `public/*.js` was
  last built). Fix: prepend Git Bash before invoking, e.g.
  `$env:PATH="C:\Program Files\Git\bin;"+$env:PATH` then
  `fnm exec --using=22.6.0 -- npx.cmd devvit playtest hexlife`.
- **✅ RENDERING CONFIRMED 2026-07-14 (owner).** A post was created in r/hexlife and it renders: the
  stock template's counter app (a number, a Start button, and +/− buttons that increment and
  decrement it). So the **whole chain — upload → install → create post → webview loads → JS runs →
  DOM updates on interaction — is green.** Phase 0 is closed.

  **What this does and does not prove.** It proves the platform loop and that scripted, interactive
  DOM works in the webview. It does **not** prove wasm instantiation or a WebGL2 context, because the
  counter template uses neither. Those remain Phase 1's entire job — do not treat this as the
  go/no-go.

### Phase 1 — wasm/WebGL smoke test in a real post (the go/no-go)

Before building anything nice: get the #25 embed runtime rendering *at all* inside a Devvit
webview on the test subreddit. Hardcode params. Prove wasm instantiates, WebGL2 acquires a
context, and it animates — **on desktop web AND in the iOS + Android Reddit apps**.
**Accept:** a live hex world animating in a real Reddit post on all three surfaces. If wasm or
WebGL2 fails on any surface, stop and reassess here — everything after this is wasted otherwise.

#### Status 2026-07-14 — BUILT AND LOCALLY GREEN; awaiting the owner's playtest (the Reddit half)

The webview payload is done and verified everywhere it *can* be verified without pushing to Reddit.
What remains is exactly the part an agent must not do: `devvit playtest` / `upload` and creating the
post. **Nothing here is proven about Reddit's webview yet** — that is the whole point of the run.

**What was built**

- `devvit/src/client/hexlife.ts` — mounts `<hexlife-world>` with hardcoded params (ruleset
  `D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6`, seed 12345, **rows 64** — phone-GPU budget — speed 20,
  `link="off"`). Imported by **both** entrypoints: `splash.ts` (the in-feed post view — the
  acceptance criterion is a world animating *in the post*, so it must live there, not only in
  expanded mode) and `game.ts` (expanded). `splash` keeps an **Expand** button.
- **A diagnostics strip** under the canvas: `webgl2:ok · wasm:ok · ticks:N`. It exists because a
  phone has no console: a blank post would tell us nothing, while `webgl2:NO` names the failure.
  It is temporary — delete it in Phase 2.
- `devvit/scripts/build-client.mjs` — replaces the bare `esbuild` CLI call in `build:client`.
  **This is the crux of the phase.** The embed source uses two *Vite* import suffixes esbuild does
  not understand: `…hexlife_wasm_bg.wasm?url` (EmbedSim) and `…*.glsl?raw` (EmbedRenderer). A tiny
  plugin teaches esbuild both — `?url` → a base64 `data:application/wasm` URI (the wasm is **inlined**,
  which is mandatory: a webview serves only `public/` and may not fetch a CDN), `?raw` → text.
  Result: a self-contained `public/game.js` (76 KB) / `splash.js` (201 KB, +`@devvit/web`).
  **No fork of the sim or renderer** — that was the entire reason the app lives in-repo.
- `src/embed/EmbedSim.js` — `initEmbedWasm` now **decodes a base64 `data:` URI directly (`atob`)
  instead of `fetch`ing it**. Fetching a data URI is subject to the host page's CSP `connect-src`,
  and a Reddit webview's CSP is not ours to widen; `atob` is subject to nothing. Real URLs still go
  through `fetch`, so the dev-server path is unchanged. This also hardens #25 Phase 3's lib build.
- `.claude/launch.json` — a `devvit-webview` config (`vite devvit/public`, port 5190) that serves the
  built webview as a plain static site, i.e. the way Devvit serves it.

**Verified locally (the built esbuild bundle, in a browser — not a Vite dev graph)**

- `game.html` and `splash.html` both: `webgl2:ok · wasm:ok`, tick count advancing, `world.error`
  null, **zero console errors**.
- Actually drawing: `gl.readPixels` over the canvas → **8308 distinct color buckets**,
  `gl.getError() === 0` (read in the same task as the draw — after compositing the backbuffer is
  undefined and reads back a single flat color, which is a *measurement* artifact, not a bug).
- **Determinism survived the new wasm-loading path**: seed 12345 → checksum **231200078** at tick
  100, the value pinned in #25 Phase 1; seed 999 differs.
- Gates: devvit `npm test` (tsc --build + Biome + 4 unit tests + build) green; root `npm run lint`
  0 errors, `typecheck` clean, **535/535** vitest (determinism goldens included).

**The command the owner runs** (from `devvit/`, Git Bash on PATH or live-reload silently no-ops):

```powershell
$env:PATH="C:\Program Files\Git\bin;"+$env:PATH
cd X:\Programming\Projects\HexLife\devvit
fnm exec --using=22.6.0 -- npx.cmd devvit playtest hexlife
```

Then open the r/hexlife post on **desktop web, the iOS app, and the Android app** and read the
strip on each. Three outcomes: `webgl2:NO` ⇒ WebGL2 is unavailable in that webview (reassess: a 2D
fallback, or Reddit is not a surface for this). `wasm:…` stuck ⇒ wasm was blocked (CSP) — the
go/no-go failed. `ticks:` frozen at a number ⇒ it booted but the rAF loop is throttled/paused in
the webview (survivable; investigate the visibility/IntersectionObserver policy).

### Phase 2 — v1 "Live Specimen" post — BUILT, awaiting the owner's playtest

**Design change from the original plan (owner's call, 2026-07-14): the post's world is NOT configured
on Reddit.** Params-in-a-form was the wrong seam — a world is something you *look at* while you tune
it, and Reddit is not where you can. Instead the explorer exports the world you are looking at as a
single **world code**, and the Reddit form takes nothing but that code. Consequences:

- The code is the *dish*, not the recipe: grid, ruleset, the **exact tick-0 cells**, the palette, and
  speed. Nothing is re-derived on Reddit's side, so a post cannot drift from what its author saw.
- **Posts open paused.** The element's poster overlay is the play button; a feed full of
  self-starting animations is exactly what nobody asked for. Reseed is *gone* from v1 — reseeding a
  code's exact cells is a contradiction; if a random-start post is wanted later it belongs on a
  seed-based post type, not this one.

**What was built**

- `src/core/WorldCodec.js` — the `HXW1.<base64url>` codec (pure; header + 16-byte ruleset + palette +
  bit-packed cells, the whole payload **deflate-raw compressed** via `CompressionStream`, which makes
  encode/decode async). Unit-tested in `tests/worldCodec.test.js`, including that its cell packing
  matches the save-file format's. `src/core/WorldCodec.d.ts` exists **only** so devvit's tsc can
  import it across the repo boundary.
- **The palette travels as *settings*, not as a baked table** (mode, preset key, custom color maps,
  flicker-proof flag, hue shift — a few dozen highly compressible bytes instead of 768 near-random
  ones). This is safe *because* `Symmetry.precomputeSymmetryGroups` is pure and cheap: the embed
  recomputes the symmetry tables the symmetry-keyed palettes need rather than being handed them, so
  `EmbedRenderer` now renders **every** app palette (`symmetryGradient` and `mode: 'symmetry'`
  included — they used to be unsupported). A baked-LUT kind stays in the format as an escape hatch.
- **Size scales with entropy, as it must.** Measured at the default 192×222 grid: 50% random → 7.5 KB
  (deflate can't help — that's information theory), 20% → 5.8 KB, 5% → 3.1 KB, 1% → 1.4 KB, a drawn
  or cleared grid → well under 1 KB. So a *structured* world posts fine at any grid size; only a
  50%-random one is big, and for those a smaller grid is the answer (and the phone-friendly choice).
- Explorer: `WorldManager.exportWorldCode(colorSettings)` → Share popout's **Copy World Code** button
  + a command-palette entry (`COMMAND_COPY_WORLD_CODE` → `UIManager._onCopyWorldCode`).
- Embed: `EmbedSim` takes `initialCells` (replays them verbatim instead of density+seed) and an
  explicit `cols`; `EmbedRenderer` takes `colorSettings` (or a baked `lut`); `<hexlife-world
  code="…">` decodes one and drives all of it.
- Devvit: menu → **form** (`devvit.json` → `forms.newWorldPost` → `/internal/on/form/new-post`) →
  `decodeWorldCode` validates the paste server-side → `reddit.submitCustomPost` → the code is stored
  in Redis under `world:<t3>` → the webview GETs `/api/world` and mounts it **paused**. A post with
  no code (the install trigger's) falls back to the built-in demo specimen. The Phase 1 diagnostics
  strip is gone; the status line now shows only loading/error text.

**Verified locally** — root: lint 0 errors, typecheck clean, **545/545** vitest, clean `npm run build`
(wasm rebuilt from source). devvit: tsc, Biome, **6** unit tests, both bundles build. In the browser
(`?headless=1`): a code exported from the app decodes back to byte-identical cells, and its color
settings rebuild the app's LUT **byte-for-byte on a `symmetry`-mode palette with 28 custom color
pairs** — the case that used to be unrenderable in the embed. Mounted in `<hexlife-world code>` it
boots with the same grid/ruleset/cells, **playing:false, ticks:0, overlay shown**, and plays on
clicking the overlay (GL error 0, 977 distinct colors on screen).

**Not proven:** anything on Reddit. `devvit playtest` + creating a post from a real code is the
owner's step (see Phase 1's command) — including whether Reddit's paragraph field takes a
multi-kilobyte paste.

**Accept:** moderator pastes a code from the explorer; the post renders that exact world, paused;
pressing play runs it; passes a real-phone check.

### Phase 3 — polish + publish

App listing (icon, description, screenshots), Devvit rules compliance pass, demo post on the
public test subreddit, submit for review.
**Accept:** app is published/installable; a demo post is live.

### Phase 4 (later) — Daily Hex on Reddit

Scheduler-driven daily post + Redis per-user state, sharing #17's deterministic daily logic.
Do not start before #17 ships in the app.

## Risks

- **Toolchain churn.** Devvit's API has changed significantly across 0.10 → 0.11 → 0.13. Any
  tutorial (or this doc) may be stale. **The installed CLI's `devvit new` templates are the
  source of truth.**
- **Mobile GPU/webview variance** is the real technical risk now that wasm is cleared. Phase 1
  exists specifically to find this out cheaply.
- **Review rejection** — mitigated by having zero external network calls, no user data
  collection, and no ads. Read the Devvit rules before Phase 3, not after.
- **Divergence from #25.** If the Devvit webview forks the sim/renderer, we now maintain two
  engines. Keep it a *consumer* of `src/embed/`, enforced by the build config, not by discipline.
