# HexLife on Reddit — Devvit Web app (#26)

**App:** `hexlifeapp` · **Subreddit:** r/hexlife · **Location:** `devvit/`

---

## Status (2026-07-16)

| Phase | Status |
|---|---|
| 0–2c (Live Specimen + transport/zoom + create paths) | ✅ Built; playtest green on r/hexlife |
| Create-path honesty (menu form + explorer helper) | ✅ Done |
| **Phase 3 — publish** | **Ready for owner `devvit playtest` → `devvit publish`** (3.6 landed) |
| **Phase 3.5 — UX (A+B + start-paused)** | ✅ Deep-link, identity chrome; always start paused |
| **Draw + brush in world code** | ✅ Invert paint on drag; brush size in HXW1 v2 (legacy → 2) |
| **Phase 3.6 — feed UX + create-path overhaul** | ✅ WP1–WP5 shipped 2026-07-16; WP6 stretch 1 of 4 |
| **Phase 3.7 — post-publish UX & efficiency arc** | 📋 Planned 2026-07-17 (spec below) — remix-in-post, live poster, honest errors, bundle diet |
| Phase 4 — Daily Hex on Reddit | Later (depends on explorer #17) |

### What Phase 3.6 landed (2026-07-16)

| WP | Status | Notes |
|---|---|---|
| WP1 — post creation | ✅ | `styles` everywhere, postData (≤1800 B), ruleset-name titles, `runAs: 'USER'`, form re-show on bad paste, onPostSubmit comments instead of deleting |
| WP2 — embed additive API | ✅ | `hexlife-playstate` / `hexlife-error`, `wheel-zoom` attr; EMBED-PLAN updated |
| WP3 — client boot/transport | ✅ | postData fast path, **no `draw` in feed** (poster returns), events replace `setInterval`, `wheel-zoom="ctrl"`, `data-state` |
| WP4 — chrome | ✅ | `public/chrome.css`; splash 242→73, game 231→54 lines; lean feed + subtitle; draw hint; status colors split |
| WP5 — in-post create | ✅ | `POST api/post` + `showForm` button (lab only), shared `NEW_POST_COPY` |
| WP6 — stretch | 🟡 1 of 4 | `textFallback` deep-link done; other 3 deliberately skipped (see below) |

Commits: `2421680` (WP1), `d747b73` (WP2), `64c19a2` (WP3), `5073a62` (WP4), `bc36417` (WP5).

**`runAs` permission — resolved, no blocker.** The key is `permissions.reddit.asUser: ["SUBMIT_POST"]`.
The published schema's *prose* says asUser is "not currently in use, please set scope to `"user"`
instead" — **that prose is wrong for 0.13.8**: the shipped SDK's `assertUserScope()` throws
``To call this API with 'runAs: "USER"', set 'permissions.reddit.asUser: [ "SUBMIT_POST" ]'`` unless
the scope is listed, and `submitCustomPost` additionally throws without `userGeneratedContent`.
Verified offline with the SDK's own `parseAppConfigJson()` (it rejects bogus scopes, bogus asUser
values, and unknown keys, and accepts our config), since `upload`/`playtest` are the only
first-party validators and both push to Reddit. **A playtest must still confirm the platform grants
the scope at runtime** — the parser validates shape, not entitlement.

**Deviation from the WP4 spec:** instead of keeping mode-specific CSS inline per file, *all* of it
is in `chrome.css` keyed on `body[data-chrome='feed'|'lab']` (that attribute is hardcoded in each
HTML, so it applies before JS runs). Neither file has an inline `<style>` left — inline overrides
are how the two files drifted apart in the first place.

---

## How posts get created (platform limits)

| Path | Works? | Notes |
|---|---|---|
| **⋯ → New HexLife post** (app menu form) | ✅ Supported | Deliberate Live Specimen path from the subreddit |
| **“Create your own” inside a post** (3.6 WP5) | ✅ Supported | `showForm` → `POST api/post`; no hunting for the menu |
| Explorer “Copy code & open r/hexlife” | ✅ Helper | Copies `HXW1.…`, opens sub — user still uses one of the two forms |
| `/r/hexlife/submit` text composer | ❌ Not a custom post | No external URL opens a Devvit form |
| Pure-HXW1 text post → `onPostSubmit` | ⚠️ Best-effort | Creates a specimen and **comments a link** on the original (3.6 WP1 — no longer deletes it) |

Publishing lifts install limits and runs Reddit review; it does **not** add one-click create from outside Reddit.

**Members need:** post permission · app installed on the sub · **⋯ → New HexLife post** *or* any
existing HexLife post's **Create your own**. Both post as the member (`runAs: 'USER'`).

---

## Product (v1 — shipped)

Live Specimen: world code in Redis → `<hexlife-world code>` paused, with external transport
(play/pause/restart/speed) + zoom. No external fetch. Demo post on install if no code.

Chrome as of 3.6: identity row (ruleset name + grid), a feed subtitle, play/pause + restart, and
"Full screen"; the expanded lab adds speed, the ruleset hex, drawing, "Open full lab", and
"Create your own". Both entrypoints share `public/chrome.css`.

---

## Phase 3 — Owner publish checklist

1. **README** — `devvit/readme.md` ✅ (updated for 3.6: create-from-post, posted-as-user, ctrl+wheel)  
2. **Playtest** — re-run on r/hexlife; 3.6 added things only a playtest can confirm (see
   "Still needs the owner" below — `runAs: 'USER'` and the zero-fetch postData boot especially).  
3. **Upload + publish** (from `devvit/`, Node 22.6):

```powershell
cd <repo>/devvit
# `fnm use 22.6.0` needs a shell-profile hook; without it you silently stay on Node 20 and
# `--experimental-strip-types` fails. Prepending the install dir always works:
$env:PATH = "$env:APPDATA\fnm\node-versions\v22.6.0\installation;C:\Program Files\Git\bin;" + $env:PATH
npm test
npx devvit upload
npx devvit publish         # unlisted after approval
# npx devvit publish --public   # App Directory
```

4. After approval: update install on r/hexlife; pin a demo; sidebar create instructions.  
5. Do not claim one-click create from the explorer; document the menu **and** in-post create paths.

Review: typically ~1–2 business days. Contact r/Devvit if stuck.

---

## Phase 3.5 — UX & design upgrades

**Goal:** specimen card UX + one-tap path into HexLife Explorer with the ruleset loaded.

### Shipped (A + B + start-paused)

| Piece | Implementation |
|-------|----------------|
| **Explorer deep-link** | `explorerUrlForRuleset` → `?r=<hex>&g=<rows?>`; CTA “Open full lab” (lab) / “Open in Explorer” (feed). Tooltip: same ruleset, fresh start (recipe ≠ dish). |
| **Identity** | `rulesetName` (`src/core/rulesetName.js`); short hex + **Copy hex**; grid meta `rows×cols`. |
| **Feed vs lab chrome** | `mountHexLife(…, {mode:'feed'\|'lab'})`; speed/copy denser in expanded view. |
| **Start policy** | **Always `paused`** until the viewer presses play (large grids lag phones on scroll-by). Reduced-motion still forces poster until explicit play. |
| **Visual pass (partial C)** | Dark tokens, 44px targets, safe-area padding, sans chrome / mono hex. |

Helpers: `explorerUrlForRuleset` in `WorldCodec.js` (vitest-covered). `isFlickerProofPalette` remains in WorldCodec for other callers / tests.

### Still open

Loading states and title polish shipped in Phase 3.6 (WP4/WP1); `textFallback` polish is WP6.
Not in 3.6: speed presets, copy full world code, palette accent, Daily Hex on Reddit — later.

### Out of scope

- Forking `src/embed/`. External one-click create. Backend social graph.

---

## Phase 3.6 — Feed UX + create-path overhaul

**Shipped 2026-07-16 (WP1–WP5)** — see the status table at the top of this doc for what each landed,
and the per-WP commits for detail. The goal was: first tap in the feed plays the specimen instead of
silently drawing on it; posts boot without a network round-trip; viewers can create their own
specimen from inside a post; creators own their posts (karma). All met.

The full WP1–WP5 spec is in git history (this doc, before commit `bc36417`). Only the open stretch
work remains below.

**Ground rules (still apply to WP6)**

- `src/embed/` public API is **frozen — additive changes only** (new attributes/events OK, no
  behavior change to existing attrs). Update `docs/EMBED-PLAN.md` API section for anything added.
- Do not fork `src/embed/`; the Devvit client keeps importing it directly.
- `devvit/` runs Node 22.6 (fnm); root stays Node 20. Use PowerShell, not the Bash tool.
- `fnm use` fails here (no shell-profile hook) and silently leaves you on Node 20, where
  `--experimental-strip-types` dies. Prepend the install dir instead:
  `$env:PATH = "$env:APPDATA\fnm\node-versions\v22.6.0\installation;C:\Program Files\Git\bin;" + $env:PATH`

### WP6 — Stretch (1 of 4 done)

3. ✅ **`textFallback` Explorer deep-link** — done 2026-07-16. `specimenTextFallback()` in
   `server.ts` now emits ruleset name + hex, grid, and `explorerUrlForRuleset(...)`. old.reddit
   otherwise got a dead end naming a ruleset it gave no way to see. Still never embeds the code.

Deliberately **not** done — each needs something this session couldn't get:

1. **Lazy element boot on first intersection** — would save a WebGL context + wasm init per
   scrolled-past post, but it is a behavior change to the **frozen** `src/embed/` API (every
   existing embed's boot timing moves), and the local preview pane reports
   `visibilityState: 'hidden'` with no real scrolling, so an IntersectionObserver gate can't be
   verified here. Wants its own session with a real feed to test against.
2. **`shareImageUrl` (+ `heightPixels`)** — needs a *hosted* image URL. Unresolved: what Devvit
   accepts, and where a per-ruleset image would be generated/hosted (the thumbnail-bake path in the
   library redesign may be reusable). Research task, not a code task.
4. **Dead `readFormValues` branch** — the plan itself says this needs playtest logs to see which
   envelope shape 0.13.8 actually sends. Guessing and deleting the wrong branch silently breaks the
   create path, so leave both until the logs exist.

### Acceptance — met and verified locally 2026-07-16

Checked against the built webview via the `devvit-webview` launch config (vite on 5190). That pane
reports `visibilityState: 'hidden'`, so these are DOM/attribute/`tick()` assertions — never live
playback or screenshots:

- Feed: poster overlay visible (`aria-label="Play simulation"`) with **no `draw`** — first tap
  plays; speed/hex/Explorer links `display:none`; subtitle present; world keeps the `1fr` row
  (556/720 px); plain wheel **not** `defaultPrevented` (page scrolls), ctrl+wheel prevented.
- Lab: `draw` set, crosshair cursor, draw hint, “Create your own” present (44 px target, handler
  attached, no throw locally).
- `hexlife-playstate` fires on play/pause, dedupes a repeat, escapes the shadow root;
  `hexlife-error` on a bad code reaches the status line with `data-state="error"`.
- Status colors differ: loading `rgb(154,163,173)` vs error `rgb(240,180,41)`.
- No `setInterval` in either built bundle; both pages load only `chrome.css`, no inline `<style>`.
- Tests: 16 devvit, 564 root, root lint 0 errors, typecheck clean.

### Still needs the owner (not checkable locally)

`devvit playtest` on r/hexlife, then `devvit publish`:

- **`runAs: 'USER'` at runtime** — the config parses, but only the platform can confirm it grants
  the `SUBMIT_POST` asUser scope. If it rejects: drop `runAs`/`userGeneratedContent` from
  `createSpecimenPost` and the permission from devvit.json — everything else is independent of it.
- **postData boot** — confirm a *new* post renders with **zero** `api/world` calls in the network
  log. Locally there is no Devvit server and `context` is undefined, so only the fetch fallback runs
  (the 404s in the local console are that fallback, and are expected).
- Feed tap-to-play on a real phone; create-from-post (`showForm`/`navigateTo` no-op off-Reddit).

### Verify (future sessions)

- `devvit/` (Node 22.6, `sh` on PATH): `npm test` (types + Biome + unit + build).
- Root: `npm run test:run` **and** full `npm run lint` after the last edit.
- Local webview: launch config `devvit-webview` → assert DOM/attributes/`tick()`, per above.

---

## Phase 3.7 — Post-publish UX & efficiency arc (planned 2026-07-17)

Origin: deep evaluation session 2026-07-17 (architecture/maintainability/efficiency/UX review of
the shipped 3.6 build). Verdict in brief: engineering foundation is sound; the gaps are product-side
— the feed card is a static dark square that doesn't sell itself, and creating a post still requires
a copy-paste round-trip through the explorer even though everything needed to create *from inside a
post* is already on board.

**Relationship to publish:** none of this blocks the owner `devvit playtest` → `devvit publish` of
the 3.6 build, and that can happen before, during, or after this arc. WP6 (wasm-as-file) and WP7
(lazy boot) must be playtest-verified before they ride in a *published* version; everything else is
verifiable locally.

**Ground rules (inherited from 3.6, still binding):**

- `src/embed/` public API is **frozen — additive only**. WP4 and WP5 add to it; update
  `docs/EMBED-PLAN.md` § Public API in the same session the addition lands.
- Do not fork `src/embed/`; the Devvit client keeps importing it directly.
- `devvit/` runs Node 22.6. `fnm use` fails silently → prepend the install dir:
  `$env:PATH = "$env:APPDATA\fnm\node-versions\v22.6.0\installation;C:\Program Files\Git\bin;" + $env:PATH`
- Use PowerShell, not the Bash tool. Root stays Node 20.
- Local verification = the `devvit-webview` launch config (vite on 5190) + DOM/attribute/`tick()`
  assertions; that pane reports `visibilityState: 'hidden'`, so never assert on live playback.
- Root `npm run test:run` + full `npm run lint` after the last edit; `devvit/` `npm test`.

**Recommended order:** WP1 → WP2 → WP3 → WP4 → WP5 → WP6 → WP7. WP1–3 are small and de-risk the
rest; WP4 is the headline; WP6/WP7 are behind-the-scenes and playtest-gated. If context runs short,
split after WP4 — WP5–7 are independent of each other.

### WP1 — Maintainability batch (small, do first)

1. **Shared form fields.** The two-field array (`code` paragraph + `title` string) is hand-built in
   both `devvit/src/client/hexlife.ts` (`createOwn`) and `devvit/src/server/server.ts`
   (`newPostForm`). Move a `NEW_POST_FIELDS` builder into `devvit/src/shared/api.ts` (takes optional
   `defaultValue`s, returns the array) and consume it from both. Labels already come from
   `NEW_POST_COPY`; this closes the structural half of the drift.
2. **`.d.ts` for `<hexlife-world>`.** The `HexWorld` type in `hexlife.ts` hand-mirrors the element's
   JS API with nothing checking it. Add `src/embed/hexlife-world.d.ts` declaring the element class
   (attributes as documented in EMBED-PLAN § Public API; methods `play/pause/reset/tick/
   setBrushSize` + WP4's `worldCode`; readonly `tickCount/checksum/playing/userPaused/brushSize/
   sim/error`; the three events). Import it from `hexlife.ts` and delete the local mirror. Keep it
   in `src/embed/` so embed API changes and their type live in one commit.
3. **`requireEl` helper.** Every `getElementById` wire-up silently no-ops on a missing ID (an HTML
   typo fails invisibly). Add a tiny `el<T>(id): T | null` that `console.warn`s on miss, and use it
   in `hexlife.ts`.
4. **Route robustness.** `route()` matches `reqMsg.url?.slice(1)` verbatim — a query string turns
   into a 404. Strip `?…` before matching.

**Acceptance:** `devvit npm test` green; no behavior change in the local webview; the `.d.ts` is
consumed (no `HexWorld` type remains in `hexlife.ts`).

### WP2 — Honest fetch failure (feed trust)

Today `fetchWorldCode()` returns `undefined` for both "no code stored" (install demo — correct to
fall back) and "the call failed" (wrong: the viewer silently gets the DEMO world under someone
else's post title).

- `devvit/src/client/fetch.ts`: return a discriminated result — `{ok: true, code?: string}` on any
  2xx, `{ok: false}` on network error / non-OK.
- `devvit/src/client/hexlife.ts`: on `{ok: false}` **with no postData code**, do not mount the demo.
  Show `setStatus(status, 'Couldn't load this specimen.', 'error')` plus a retry affordance
  (simplest: a `Retry` button in `#chrome` shown only in this state, which re-runs the fetch+mount
  path). The demo fallback remains only for `{ok: true, code: undefined}` (install demo) and the
  local harness (where the fetch 404s are expected — keep the harness working: `context` is
  undefined there, so gate the hard-error path on... nothing platform-specific; the local harness
  hits `{ok:false}` and will now show the error + retry instead of the demo. That is acceptable —
  drive local verification with an explicit `code` or postData fixture instead, or keep a
  `?demo=1` query opt-in for the harness if the demo is still wanted locally).

**Acceptance:** local webview with the API stubbed to 500 shows error status + retry, not the demo;
stubbed to `{code: undefined}` shows the demo; retry after restoring the stub mounts the world.
Unit-test `fetch.ts`'s discrimination if practical (it's fetch-global; a thin injectable is fine).

### WP3 — Feed & lab polish batch (copy, labels, hints)

All in `devvit/public/*.html` + `chrome.css` + `NEW_POST_COPY`:

1. **Subtitle legibility** (`#specimen-sub`, splash): it is the one line explaining the post to a
   first-timer and currently the least legible text on the card (11px muted). Bump to ≥13px and
   raise contrast (e.g. `var(--text)` at 0.85 opacity). Keep it one line.
2. **"Full screen" → "Expand"** (`#expand-btn`, splash): the expanded view adds capabilities (draw,
   speed, create), it isn't just bigger. "Expand" matches Reddit convention. Keep the
   `requestExpandedMode` wiring unchanged.
3. **Feed create affordance:** add a quiet `Create your own` button to `splash.html`'s `.actions`
   (text-weight styling, not the primary pill — the feed stays lean). `wireCreateOwn` already runs
   unconditionally in `mountHexLife`, so adding the `#create-own` button to splash wires it for
   free; `showForm` works from any webview client. Verify the form → `api/post` path from the feed
   card in playtest.
4. **Zoom discoverability:** extend `#draw-hint` (lab) to
   `✏ drag to paint · pinch or ctrl+scroll to zoom` — one line, same element.
5. **Invalid-code copy:** `NEW_POST_COPY.invalid` should name the two real failure modes: truncated
   paste and extra text around the code (the server's `PURE_WORLD_CODE_RE` can distinguish "no
   HXW1 prefix at all" from "decode failed" if a sharper message is cheap — optional).

**Acceptance:** DOM assertions in the local webview (labels, hint text, feed `#create-own`
present + handler attached); chrome.css still the only stylesheet; no `.lab-only`/`.feed-only`
regressions (feed hides speed/hex/explorer links exactly as before).

### WP4 — "Post my remix" (the headline: create without leaving Reddit)

The lab already lets a viewer draw on the world, but their edit is ephemeral — the only postable
thing is a code pasted from the explorer. Close the loop: snapshot the *current* sim state as a
world code and post it, no explorer round-trip, no paste.

**Embed side (additive API — update EMBED-PLAN § Public API):**

1. `EmbedSim.snapshotCells()` — returns `new Uint8Array(this.state)` (null if freed). One line plus
   the view-detachment caveat does not apply (no allocation in wasm).
2. `EmbedRenderer`: retain the baked LUT bytes from `_buildLUT` on the instance (`this.lutBytes`)
   and expose `getLut()`. This is the palette fallback for attribute-driven worlds.
3. `HexLifeElement.worldCode()` — async; returns the current world as an `HXW1.` code, or `null`
   when there is nothing to encode (error state / not booted). Assembly:
   - `rows/cols/rulesetHex/speed` from `this.sim`; `cells` from `snapshotCells()`;
     `brushSize` from `this._brushSize`.
   - Palette precedence: `this._world?.colorSettings` → `this._world?.lut` →
     `this.renderer.getLut()`. (Matches the decode precedence; the renderer fallback covers
     attribute-driven demo worlds.)
   - **Never** encode a `generator` — a remix is the exact dish on screen, not a recipe.
   - Uses `encodeWorldCode` from `../core/WorldCodec.js` (already in the embed's import graph via
     `decodeWorldCode`).

**Devvit side:**

4. `game.html`: add `#post-remix` as the **primary** button in `.actions`; "Create your own"
   (paste path) stays for explorer users, demoted to secondary styling.
5. `hexlife.ts`: on click → `world.pause()` (what you see is what posts) → `await
   world.worldCode()` → `showForm` with a **title-only** field (the code is machine data; don't
   show the blob). Form copy (add to `NEW_POST_COPY`): title `Post my remix`, description
   `Posts this world exactly as it looks right now — including anything you've drawn.`, accept
   `Post it`. Then POST to the existing `api/post` with `{code, title}` — the server route,
   validation, `runAs: 'USER'`, and Redis write all reuse unchanged. Extract the shared
   submit-and-navigate tail of `createOwn` into a helper both buttons call.
6. `readme.md`: document the remix path as the easiest create path.

**Acceptance (local webview, lab mode):**

- `el.tick(5)` → `const c = await el.worldCode()` → `decodeWorldCode(c)` round-trips: same
  rows/cols/rulesetHex, cells equal to `el.sim.state`, brushSize preserved, no `generator`.
- Same round-trip after simulating a draw (call `el.sim.invertBrushLine(…)` directly, then
  `worldCode()` — the flipped cells are in the code).
- Attribute-driven demo world (no `code` attr) still produces a valid code via the renderer-LUT
  fallback.
- `#post-remix` present, 44px target, handler attached, no throw locally (showForm no-ops
  off-Reddit). Server tests: one new case posting a code through `api/post` built by
  `encodeWorldCode` from snapshot-shaped inputs (existing test helper already does this).
- EMBED-PLAN § Public API updated (method + "additive, 3.7" note).

### WP5 — Feed poster liveliness

A CA's appeal is motion; the poster is a static dark grid indistinguishable from a broken image at
scroll speed. Two layers, cheapest first:

1. **Pulsing play affordance (embed CSS only):** in `HexLifeElement`'s `STYLES`, animate the
   `.overlay svg` with a slow scale/opacity pulse (~2.5s ease-in-out infinite), wrapped in
   `@media (prefers-reduced-motion: no-preference)`. Zero sim cost, ships everywhere the poster
   shows.
2. **"Breathing" poster (additive `preview` attribute):** when `preview` is set (value = burst tick
   count, clamp 1–60, unparseable → 12) and the poster is showing (userPaused, no `draw`, not
   playRequested), then on each offscreen→onscreen transition (`_onScreen` false→true) while
   `_docVisible` and not `_reducedMotion`: run the burst at ~4 ticks/sec (a small
   `setTimeout`/rAF stepper calling `sim.tick()` + `_drawOnce()`), then `sim.reset(…)` back to
   tick 0 so the authored poster state returns (exact-cells worlds replay `initialCells`;
   generator worlds re-roll, which is their contract). Cancel the burst immediately on `play()`,
   draw-stroke start, disconnect, or attribute removal. The burst must **not** flip `playing` or
   emit `hexlife-playstate` — it is poster decoration, not playback.
3. Devvit: `splash.html`'s mount sets `preview="12"` (feed only; the lab needs no poster
   theatrics).

**Acceptance:** local webview — with `preview` set, forcing the intersection path (call the
element's internals or scroll the harness) advances `tickCount` and returns it to 0 afterwards;
`hexlife-playstate` fires nothing during the burst; with `prefers-reduced-motion: reduce`
emulated, no burst. EMBED-PLAN § Public API gains the attribute. Real-feed feel check rides the
next playtest.

### WP6 — Bundle diet (code-split, sourcemaps, wasm experiment)

Today `splash.js` and `game.js` are each ~440 KB, ~95% identical (full embed runtime + base64
wasm), and expanding a post re-downloads everything the feed just loaded. Sourcemaps (~880 KB
each) also sit in `public/` and ship with every upload.

1. **Code-split:** in `devvit/scripts/build-client.mjs` set `splitting: true` (already ESM). The
   shared chunk lands in `public/` beside the entries; `npm run clean`'s `public/*.js*` glob still
   catches it. Confirm both pages load in the local webview (chunks import relatively).
2. **Sourcemaps out of publish:** when `--minify` is passed (the publish build), set
   `sourcemap: false`; keep `linked` for watch/dev builds.
3. **Wasm-as-file experiment (playtest-gated):** the base64 inline costs ~33% size and forfeits
   streaming compilation. Try: build plugin emits the `?url` import as a real file copied to
   `public/hexlife_wasm_bg.wasm` (esbuild `loader: 'file'` with the right `publicPath`, or a
   manual copy step) — `loadWasmBytes` already handles non-data URLs via `fetch`. **Keep the
   inline path switchable** (env flag in build-client.mjs, e.g. `INLINE_WASM=1`) because only a
   playtest can prove the webview's CSP allows the same-origin fetch; if it doesn't, flip the flag
   back and lose nothing.

**Acceptance:** both entries boot in the local webview post-split; combined `public/*.js` size
drops materially (record before/after in PATCHNOTES); `npm test` (which runs the build) green.
Wasm-as-file: local webview boots with the fetched file; **do not publish it enabled until a
playtest confirms** — note it in "Still needs the owner".

### WP7 — Lazy boot on intersection (host-side; playtest-gated)

3.6 deferred this as an embed behavior change; it doesn't have to be one. **Host-side version, no
frozen-API impact:** `splash.ts` wraps `mountHexLife` in an IntersectionObserver on `#world`
(threshold 0, rootMargin ~'25%') and only mounts on first intersection. Until then, a CSS-only
placeholder (chrome.css: dark panel + centered play glyph on `#world:empty::before`, feed mode
only) keeps the card from looking blank. Every scrolled-past post then skips the 440 KB parse,
wasm compile, and WebGL context entirely.

- **Measure first in playtest:** log a timestamp at script start vs. IO-fire to learn whether
  Devvit even boots offscreen webviews (if it doesn't, this WP is a cheap no-op safety net —
  still worth keeping).
- Local webview: the mount is in-viewport, so the IO fires immediately — acceptance is simply "no
  regression" locally; the win is only observable in a real feed.

**Acceptance:** local webview boots identically (IO fires at once); placeholder visible if the IO
is artificially delayed; playtest confirms context/wasm are not created for offscreen posts (or
documents that Devvit already defers webview loads).

### Deliberately still out of scope

`shareImageUrl` (research task — needs answers on hosting, see 3.6 WP6-2), the dead
`readFormValues` branch (needs playtest logs), speed presets, palette accent, Daily Hex on Reddit.

### Session-end checklist for the implementing session

PATCHNOTES entry (with bundle before/after from WP6); update the Phase 3.7 row in this doc's
status table per-WP; update EMBED-PLAN § Public API for WP4 + WP5; update ROADMAP #26 line; note
anything newly playtest-gated under "Still needs the owner" below.

---

## Architecture

`devvit/` consumes `src/embed/` (no fork). World codes live in Redis `world:<t3>` **and** ride in
each post's `postData` when small enough (boot accelerator; Redis stays the source of truth). Menu
form, in-post `api/post`, and `onPostSubmit` all create posts through one `createSpecimenPost`
helper; `onPostDelete` clears Redis.

```
devvit/src/client/hexlife.ts   # mount + transport + create-your-own
devvit/public/{splash,game}.html
devvit/public/chrome.css       # shared chrome, keyed on body[data-chrome]
devvit/src/server/server.ts    # forms, api/post, Redis, triggers
devvit/src/shared/api.ts       # endpoints, WorldPostData, NEW_POST_COPY
src/embed/                     # shared sim/render element
src/core/WorldCodec.js         # HXW1 encode/decode
```

## Rollback

`checkpoint/pre-devvit-extensions-2026-07-15`
