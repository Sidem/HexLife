# HexLife on Reddit — Devvit Web app (#26)

**App:** `hexlifeapp` · **Subreddit:** r/hexlife · **Location:** `devvit/`

---

## Status (2026-07-16)

| Phase | Status |
|---|---|
| 0–2c (Live Specimen + transport/zoom + create paths) | ✅ Built; playtest green on r/hexlife |
| Create-path honesty (menu form + explorer helper) | ✅ Done |
| **Phase 3 — publish** | Ready for owner `devvit publish` — **do Phase 3.6 first** (review snapshot ships whatever exists) |
| **Phase 3.5 — UX (A+B + start-paused)** | ✅ Deep-link, identity chrome; always start paused |
| **Draw + brush in world code** | ✅ Invert paint on drag; brush size in HXW1 v2 (legacy → 2) |
| **Phase 3.6 — feed UX + create-path overhaul** | 📋 Planned (spec below, from 2026-07-16 evaluation) |
| Phase 4 — Daily Hex on Reddit | Later (depends on explorer #17) |

---

## How posts get created (platform limits)

| Path | Works? | Notes |
|---|---|---|
| **⋯ → New HexLife post** (app menu form) | ✅ Supported | Only deliberate Live Specimen path |
| Explorer “Copy code & open r/hexlife” | ✅ Helper | Copies `HXW1.…`, opens sub — user still uses the menu |
| `/r/hexlife/submit` text composer | ❌ Not a custom post | No external URL opens a Devvit form |
| Pure-HXW1 text post → `onPostSubmit` | ⚠️ Best-effort | May fail silently; not the product path |

Publishing lifts install limits and runs Reddit review; it does **not** add one-click create from outside Reddit.

**Members need:** post permission · app installed on the sub · **⋯ → New HexLife post**.

---

## Product (v1 — shipped)

Live Specimen: world code in Redis → `<hexlife-world code>` paused, with external transport
(play/pause/restart/speed) + zoom. No external fetch. Demo post on install if no code.

Current chrome is functional but minimal (monospace strip, no identity, no lab escape hatch).

---

## Phase 3 — Owner publish checklist

1. **README** — `devvit/readme.md` ✅  
2. **Playtest** — green on r/hexlife desktop (re-check phone if needed).  
3. **Upload + publish** (from `devvit/`, Node 22.6):

```powershell
$env:PATH = "C:\Program Files\Git\bin;" + $env:PATH
cd <repo>/devvit
fnm use 22.6.0
npm test
npx devvit upload
npx devvit publish         # unlisted after approval
# npx devvit publish --public   # App Directory
```

4. After approval: update install on r/hexlife; pin a demo; sidebar create instructions.  
5. Do not claim one-click create from the explorer; document the menu path.

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

Folded into **Phase 3.6** below (loading states → WP4; title/textFallback polish → WP1/WP6).
Not in 3.6: speed presets, copy full world code, palette accent, Daily Hex on Reddit — later.

### Out of scope

- Forking `src/embed/`. External one-click create. Backend social graph.

---

## Phase 3.6 — Feed UX + create-path overhaul

Spec from the 2026-07-16 evaluation session (code review + DOM verification of the built webview).
**Goal:** first tap in the feed plays the specimen instead of silently drawing on it; posts boot
without a network round-trip; viewers can create their own specimen from inside a post; creators
own their posts (karma). One session should complete WP1–WP5; WP6 is stretch.

**Ground rules for the implementing session**

- `src/embed/` public API is **frozen — additive changes only** (new attributes/events OK, no
  behavior change to existing attrs). Update `docs/EMBED-PLAN.md` API section for anything added.
- Do not fork `src/embed/`; the Devvit client keeps importing it directly.
- `devvit/` runs Node 22.6 (fnm); root stays Node 20. Use PowerShell, not the Bash tool.
- Working tree already has uncommitted 2026-07-16 changes (always-start-paused + readme + this
  doc). Commit those first (or fold in, owner's call) before starting.

### WP1 — Post-creation upgrades (server)

Files: `devvit/src/server/server.ts`, `devvit/src/shared/api.ts`, `devvit/devvit.json`,
`devvit/src/server/server.test.ts`.

1. **`styles` on every `submitCustomPost`** (form path, install demo, onPostSubmit):
   `{backgroundColor: '#0C0E10FF', backgroundColorDark: '#0C0E10FF'}` — kills the light-mode flash
   before the iframe paints (`CustomPostStylesInput`, 0.13.8).
2. **`postData` fast path**: always include `{rulesetHex, rows, cols}`; additionally include
   `{code}` when the JSON-serialized postData stays ≤ ~1800 bytes (2 KB platform cap, leave
   headroom). Redis stays the source of truth (`api/world` unchanged) — postData is a boot
   accelerator, and oversized codes simply omit `code`.
3. **Default title from the ruleset name**: import `rulesetName` from
   `../../../src/core/rulesetName.js`; blank title → `` `${rulesetName(hex)} — live HexLife specimen` ``.
4. **`runAs: 'USER'` on the form path** so menu-created specimens are authored by the creator
   (karma!). Requires `userGeneratedContent: {text: …}` per 0.13.8 types, and a devvit.json
   permission — **verify the exact key against the schema**
   (`https://developers.reddit.com/schema/config-file.v1.json`; likely `permissions` →
   user-actions/`asUser` submit). Install demo + onPostSubmit stay APP-authored. If playtest
   rejects the permission, ship everything else and log the blocker here.
5. **Invalid code → re-show the form, not just a toast**: `routeFormNewPost` on decode failure
   returns `showForm` again with the submitted `code`/`title` as `defaultValue`s and the error in
   the form `description` (current toast-only response discards the user's input).
6. **`onPostSubmit`: stop deleting the user's text post.** Create the specimen, then
   `reddit.submitComment({id: <original t3>, text: <link to specimen>})`. Delete the whole
   `getPostById` probe block (lines ~209–231).

Tests (extend `server.test.ts`, same mock style): capture `submitCustomPost` options and assert
styles/postData/title-default/runAs; invalid form returns `showForm` with preserved values;
onPostSubmit comments instead of deleting.

### WP2 — Embed element: additive events + wheel gating (root `src/embed/`)

Files: `src/embed/HexLifeElement.js`, `docs/EMBED-PLAN.md`, root `tests/`.

1. **`hexlife-playstate` event**: dispatched from `_syncPlayback` whenever the computed state
   tuple `{playing, userPaused}` differs from the last one emitted (store the last tuple on the
   element). `detail: {playing, userPaused}`, bubbles + composed like `hexlife-ready`.
2. **`hexlife-error` event**: dispatched from `_fail` with `detail: {message, detail}`.
3. **`wheel-zoom` attribute**: `'free'` (default — current behavior) | `'ctrl'` (wheel zooms only
   with `ctrlKey || metaKey`; plain wheel falls through so the page scrolls — no `preventDefault`).
   Trackpad pinch emits ctrl+wheel in Chromium/Firefox, so pinch-to-zoom keeps working. Add to
   `observedAttributes`; applies live (no re-boot), read in `_onWheel`.
4. Update EMBED-PLAN's frozen-API section (attributes + events).

Tests: follow the existing embed test pattern under root `tests/` (attrs are pure-function
testable; events testable wherever existing element tests run).

### WP3 — Devvit client boot + transport (`devvit/src/client/`)

Files: `hexlife.ts`, `fetch.ts`, `splash.ts`, `game.ts`.

1. **postData fast path**: read `context.postData` (from `@devvit/web/client`). If it has `code`,
   skip `fetchWorldCode()` entirely; if it has only ruleset meta, paint identity immediately and
   fetch in parallel. No postData (old posts, install demo) → current fetch path.
2. **Feed mode: do NOT set `draw`.** The element's poster play overlay returns automatically
   (`_syncPlayback` only hid it because of draw mode) — first tap on the world plays it. Lab mode
   keeps `draw`.
3. **Replace the 400 ms `setInterval` label polling** with a `hexlife-playstate` listener.
4. **Listen for `hexlife-error`** → status line. Keep `hexlife-ready` settle; the 2 s `setTimeout`
   may stay as a last-resort fallback or go — either is fine once the error event exists.
5. **Set `wheel-zoom="ctrl"`** on the element in both modes (desktop feed scroll must never be
   hijacked).
6. Status element gets `dataset.state = 'loading' | 'error'` so CSS can color them differently (WP4).

### WP4 — Chrome simplification + CSS dedupe (`devvit/public/`)

Files: `splash.html`, `game.html`, new `chrome.css`.

1. **Extract the ~190 duplicated CSS lines** into `devvit/public/chrome.css` (plain
   `<link rel="stylesheet">` — Devvit serves `public/` as-is). Keep only genuinely mode-specific
   overrides inline. Reconcile the accidental drift (paddings, button backgrounds) while merging.
2. **Feed (`splash.html`)**: speed label+slider and `#specimen-hex` become `.lab-only`
   ("Open in Explorer" quiet link → also lab-only; "Full screen" stays). Add a `.feed-only` muted
   subtitle under the identity row: “a living hexagonal world — press ▶ to run”.
3. **Status colors**: `[data-state='loading']` muted, `[data-state='error']` amber
   (`--danger-soft` currently colors both).
4. **Lab (`game.html`)**: add a one-line muted draw hint (“✏ drag on the world to paint — it
   pauses while you draw”) so drawing is discoverable.
5. Keep `::part(reset)` hidden in both (host chrome owns Restart). Mind the repo HTML-edit gotcha
   (always include full tags through `>`).

### WP5 — In-post “Create your own” (client `showForm` + new endpoint)

Files: `devvit/src/shared/api.ts`, `devvit/src/server/server.ts`, `devvit/src/client/hexlife.ts`,
`devvit/public/game.html`, `devvit/src/server/server.test.ts`.

1. `Endpoint.CreatePost = 'api/post'` (POST) in the shared endpoint table.
2. Server: extract a shared `createSpecimenPost(code, title)` helper (validate → submit with
   styles/postData/title-default/runAs from WP1 → store Redis) used by **both** the form callback
   and the new route. Route returns `{url}` on success, `ErrorRsp` on invalid code.
3. Client (lab mode only): “Create your own” button → `showForm({...})` (client-side effect from
   `@devvit/client`, same two fields as the menu form) → POST values to `api/post` → success:
   `navigateTo(url)`; failure: message in `#status`. Feed mode omits the button (keep the card lean).
4. Note for local verification: `showForm`/`navigateTo` only function inside Reddit — locally,
   verify wiring/presence only.

Tests: `api/post` valid/invalid/blank-title in `server.test.ts`.

### WP6 — Stretch (only if WP1–5 are green and time remains)

1. **Lazy element boot on first intersection** (pre-boot IntersectionObserver in
   `connectedCallback`; `_boot` on first `isIntersecting`; dark placeholder until then). Saves a
   WebGL context + wasm init per scrolled-past post. Element change on the frozen API — do it
   carefully or skip.
2. `shareImageUrl` (+ `heightPixels` tuning) in `styles` — off-Reddit shares currently show
   Reddit's generic placeholder. Needs a hosted image URL; investigate what Devvit accepts.
3. `textFallback` gains the Explorer deep-link URL (`explorerUrlForRuleset`) for old.reddit users.
4. Verify which form-envelope shape 0.13.8 actually sends (playtest logs) and delete the dead
   branch in `readFormValues`.

### Acceptance (Phase 3.6)

- Feed card: poster play overlay visible; **tapping the world plays it**; no draw in feed; no
  speed slider/hex/Explorer link; subtitle present; plain mouse wheel over the card scrolls the
  page (desktop).
- Lab view: draw works as before, draw hint visible, “Create your own” button present and wired.
- New posts: created with styles + postData + ruleset-name default title; form path `runAs: USER`
  (or the blocker documented); invalid paste re-shows the form with input preserved.
- Boot: a post with postData renders identity + world with **zero** `api/world` calls
  (check the network log in playtest).
- No `setInterval` polling in the client; play/pause label driven by `hexlife-playstate`.
- `splash.html`/`game.html` share `chrome.css`; both entrypoints build.
- All tests green (see Verify).

### Verify

- `devvit/` (Node 22.6 via fnm, `sh` on PATH): `npm test` (types + Biome + unit + build).
- Root: `npm run test:run` **and** full `npm run lint` after the last edit.
- Local webview: launch config `devvit-webview` (vite on 5190) → check `splash.html` and
  `game.html` DOM state via JS/a11y tree. **Preview pane reports `visibilityState: 'hidden'`** —
  assert DOM/attributes/`tick()` results, not live playback or screenshots.
- Owner: `devvit playtest` on r/hexlife (feed tap-to-play on phone, postData boot, create-from-post,
  runAs) before `devvit publish`.

### Docs & bookkeeping (end of session)

- Update the status table in this doc; log any WP that slipped.
- `devvit/readme.md`: create-from-post path, posted-as-user, ctrl+wheel zoom.
- `docs/EMBED-PLAN.md`: `wheel-zoom` attr + `hexlife-playstate`/`hexlife-error` events.
- `PATCHNOTES.md` entry; `ROADMAP.md` #26 line.

---

## Architecture

`devvit/` consumes `src/embed/` (no fork). World codes in Redis `world:<t3>`. Menu + form create
posts; `onPostDelete` clears Redis; optional `onPostSubmit` pure-code upgrade.

```
devvit/src/client/hexlife.ts   # mount + transport
devvit/public/{splash,game}.html
devvit/src/server/server.ts    # form, Redis, triggers
src/embed/                     # shared sim/render element
src/core/WorldCodec.js         # HXW1 encode/decode
```

## Rollback

`checkpoint/pre-devvit-extensions-2026-07-15`
