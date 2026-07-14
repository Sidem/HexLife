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

### Phase 0 — scaffold + toolchain — ✅ MOSTLY DONE 2026-07-14

App created (`hexlifeapp`), subreddit created (r/hexlife), CLI installed and authed, scaffold runs
locally, **repo layout settled (in-repo at `devvit/`, see above)**. **Remaining:** `devvit playtest`
the STOCK template on r/hexlife — unmodified, before any HexLife code — to prove the whole
auth→upload→render loop works end-to-end. Do this first; it is 10 minutes and it isolates platform
problems from our problems. **Requires owner approval to run** (it pushes code to Reddit).

### Phase 1 — wasm/WebGL smoke test in a real post (the go/no-go)

Before building anything nice: get the #25 embed runtime rendering *at all* inside a Devvit
webview on the test subreddit. Hardcode params. Prove wasm instantiates, WebGL2 acquires a
context, and it animates — **on desktop web AND in the iOS + Android Reddit apps**.
**Accept:** a live hex world animating in a real Reddit post on all three surfaces. If wasm or
WebGL2 fails on any surface, stop and reassess here — everything after this is wasted otherwise.

### Phase 2 — v1 "Live Specimen" post

Devvit post type + menu action to create a post with chosen params; Redis param storage keyed by
post ID; typed init message to the webview; Reseed + Open-in-Explorer buttons; loading and error
states; mobile sizing; reduced-motion/offscreen policies.
**Accept:** moderator creates a post from a ruleset hex; it renders, reseeds, and deep-links back
to the explorer with the ruleset applied; passes a real-phone check.

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
