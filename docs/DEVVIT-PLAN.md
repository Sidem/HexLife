# HexLife on Reddit — Devvit Web app (#26)

**App:** `hexlifeapp` · **Subreddit:** r/hexlife · **Location:** `devvit/`

---

## Status (2026-07-17)

| Phase | Status |
|---|---|
| 0–2c (Live Specimen + transport/zoom + create paths) | ✅ Built; playtest green on r/hexlife |
| Create-path honesty (menu form + explorer helper) | ✅ Done |
| **Phase 3 — publish** | **Ready for owner `devvit playtest` → `devvit publish`** (3.6 + 3.7 landed) |
| **Phase 3.5 — UX (A+B + start-paused)** | ✅ Deep-link, identity chrome; always start paused |
| **Draw + brush in world code** | ✅ Invert paint on drag; brush size in HXW1 v2 (legacy → 2) |
| **Phase 3.6 — feed UX + create-path overhaul** | ✅ WP1–WP5 shipped 2026-07-16; WP6 stretch 1 of 4 |
| **Phase 3.7 — post-publish UX & efficiency arc** | ✅ **WP1–WP7 all shipped 2026-07-17** |
| Phase 4 — Daily Hex on Reddit | Later (depends on explorer #17) |

### What Phase 3.7 landed (2026-07-17)

| WP | Status | Notes |
|---|---|---|
| WP1 — maintainability | ✅ | `newPostFields()` shared by both create paths; `src/embed/hexlife-world.d.ts` (replaces the unchecked hand-mirrored type); `el(id)` warns on a missing id; `route()` strips `?…` |
| WP2 — honest fetch failure | ✅ | Discriminated `{ok}` result; error + Retry instead of a silent demo under someone else's title; `?demo=1` for the local harness |
| WP3 — feed & lab polish | ✅ | Subtitle 13px; “Expand”; quiet feed “Create your own”; zoom in the draw hint; invalid-code copy names the real failure modes |
| **WP4 — “Post my remix”** | ✅ | `worldCode()` + `snapshotCells()` + `getLut()` (additive; EMBED-PLAN updated); `#post-remix` primary; title-only form → existing `api/post` |
| WP5 — poster liveliness | ✅ | CSS pulse + additive `preview` attribute; feed sets `preview="12"`. Decoration, not playback: no `playing`, no `hexlife-playstate` |
| WP6 — bundle diet | ✅ | **2237.2 KB → 234.6 KB uploaded (−89.5%)**; code-split, publish sourcemaps dropped, portable `clean`; wasm-as-file behind `INLINE_WASM=0` (playtest-gated) |
| WP7 — lazy boot | ✅ | Host-side IO gate + CSS placeholder; boots anyway if the observer never reports (playtest-gated measurement) |

Commits: `a969f5b` (WP1), `70da772` (WP2), `964209a` (WP3), `82ae2a4` (WP4), `b121f39` (WP5),
`c5398a0` (WP6), `b7303fb` (WP7). The spec each was built from is in `0e4e196`.

**Three findings from 3.7 worth not rediscovering:**

1. **The preview pane's `visibilityState: 'hidden'` kills IntersectionObserver too**, not just rAF —
   IO only delivers on a rendering opportunity. A mount measuring 1280×1134 at top 0 (geometrically
   in view) never got a single callback in 2.5 s. Any IO-gated behavior is unverifiable there; drive
   it through the element's internals (`el._docVisible = true;
   el._onIntersect([{isIntersecting: true}])`). It also throttles `setTimeout` to ~1/sec, which
   makes any timed burst look broken.
2. **A viewport gate must fail toward showing the thing.** `<hexlife-world>`'s own IO assumes
   on-screen until told otherwise, so a silent observer costs nothing. WP7's first draft inverted
   that, and a silent observer meant a permanently blank card. It now makes the observer prove it
   works (any report, including “not intersecting”), or bypasses it after 1500 ms.
3. **`npm run clean` never worked on Windows** (`rm` isn't on `cmd.exe`'s PATH), which also killed
   `npm run publish` at step one — and since Devvit uploads `public/` **whole**, the stale
   sourcemaps it left behind were shipping. Now `scripts/clean.mjs`.

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
| **Open lab → Post my remix** | ✅ Primary | Snapshot + title form; no explorer, no paste — the onboarding path |
| **⋯ → New HexLife post** (app menu form) | ✅ Supported | Paste path for explorer exports |
| **Lab “Create your own”** (paste form) | ✅ Power-user | Expanded view only; feed no longer shows this (paste ≠ onboarding) |
| Explorer “Copy code & open r/hexlife” | ✅ Helper | Copies `HXW1.…`, opens sub — user still uses menu or lab paste form |
| `/r/hexlife/submit` text composer | ❌ Not a custom post | No external URL opens a Devvit form |
| Pure-HXW1 text post → `onPostSubmit` | ⚠️ Best-effort | Creates a specimen and **comments a link** on the original (3.6 WP1 — no longer deletes it) |

Publishing lifts install limits and runs Reddit review; it does **not** add one-click create from outside Reddit.

**Members need:** post permission · app installed on the sub · **Post my remix** (lab) *or*
**⋯ → New HexLife post** (paste). Both post as the member (`runAs: 'USER'`).

---

## Product (v1 — shipped)

Live Specimen: world code in Redis → `<hexlife-world code>` paused, with external transport
(play/pause/restart/speed) + zoom. No external fetch. Demo post on install if no code.

Chrome: identity row (ruleset name + notation badge + grid), feed subtitle, play/pause + restart,
and **Open lab**; the lab adds speed, a **Ruleset** card (read-only: notation, Born/Survive orbit
diagrams or 128-bit fingerprint, hex + copy, `edit=1` Explorer deep link — see
`src/core/rulesetDescriptor.js`), drawing, **Post my remix**, "Open full lab", and a quiet
paste-code **Create your own**. Feed deliberately omits paste-code create. Both entrypoints share
`public/chrome.css`.

**"What ruleset is this?"** (2026-07-18): every created specimen gets a first comment identifying
its ruleset (name, `B2/S35` / `B2o3p/S2` notation when expressible, hex, `edit=1` Explorer link
that opens the editor in the fitting mode). Needs owner `devvit upload` + playtest like the rest.

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

**From 3.6:**

- **`runAs: 'USER'` at runtime** — the config parses, but only the platform can confirm it grants
  the `SUBMIT_POST` asUser scope. If it rejects: drop `runAs`/`userGeneratedContent` from
  `createSpecimenPost` and the permission from devvit.json — everything else is independent of it.
- **postData boot** — confirm a *new* post renders with **zero** `api/world` calls in the network
  log. Locally there is no Devvit server and `context` is undefined, so only the fetch fallback runs
  (the 404s in the local console are that fallback, and are expected).
- Feed tap-to-play on a real phone; create-from-post (`showForm`/`navigateTo` no-op off-Reddit).

**New in 3.7:**

- **WP7 — does Devvit boot offscreen webviews at all?** This is the measurement the whole WP hangs
  on. Both mount paths log `hexlife: mounting (<why>) at +<n>ms after script start`. In a real feed,
  scroll a HexLife post into view and read the console: `scrolled into view` with a large `+n` means
  the deferral works and offscreen posts are genuinely skipping the wasm compile and WebGL context.
  `observer never reported` means the observer is not delivering in the webview and the 1500 ms
  safety net booted it — the card still works, but the WP is buying nothing and can be reverted.
  Confirm too that a scrolled-past post creates no WebGL context / wasm instance.
- **WP6 — wasm as a file (`INLINE_WASM=0`).** Off by default; **do not publish it enabled until a
  playtest confirms it.** The open question is only whether the webview's CSP permits a same-origin
  `fetch` of `hexlife_wasm_bg.wasm`. To test: `INLINE_WASM=0 npm run build:client`, playtest, and
  check the network log for the `.wasm` and the console for a CSP violation. If it loads, enabling
  it by default saves ~45 KB and buys streaming compilation; if it doesn't, flip the flag back and
  nothing else changes (`loadWasmBytes` handles both forms).
- **WP5 — does the feed poster actually read as alive?** The burst and the pulse are verified
  mechanically (tick counts, no `hexlife-playstate`, reduced-motion gating), but "does this stop
  looking like a broken image while scrolling" is a judgement only a real feed on a real phone can
  make. If 12 ticks is too subtle or too busy, it is one number in `splash.ts`.
- **WP3/WP4 — the two create paths from a real post.** The feed's new quiet "Create your own" and
  the lab's "Post my remix" both wire up and no-op locally (`showForm` only acts inside Reddit).
  Worth confirming end-to-end that a remix posts, and that the posted world is *exactly* what was on
  screen — including anything drawn on it.

### Verify (future sessions)

- `devvit/` (Node 22.6, `sh` on PATH): `npm test` (types + Biome + unit + build).
- Root: `npm run test:run` **and** full `npm run lint` after the last edit.
- Local webview: launch config `devvit-webview` → assert DOM/attributes/`tick()`, per above.

---

## Phase 3.7 — Post-publish UX & efficiency arc

**Shipped 2026-07-17 (WP1–WP7).** See the status table at the top of this doc for what each landed,
and the per-WP commits for detail. The full spec is in git history — commit `0e4e196`, and this
doc before `b7303fb` — per the repo's "shipped plan docs collapse; history lives in git"
convention.

The goal was: close the create loop from inside a post (a remix, with no copy-paste round-trip
through the explorer), make the feed card sell itself instead of reading as a broken image at scroll
speed, stop the card quietly lying when it cannot load its world, and cut what every post pays to
render. All met.

**Ground rules (still binding for anything touching this app)**

- `src/embed/` public API is **frozen — additive changes only**. Update `docs/EMBED-PLAN.md`
  § Public API in the same commit as any addition.
- Do not fork `src/embed/`; the Devvit client keeps importing it directly.
- `devvit/` runs Node 22.6; root stays Node 20. Use PowerShell, not the Bash tool.
- `fnm use` fails here (no shell-profile hook) and silently leaves you on Node 20, where
  `--experimental-strip-types` dies. Prepend the install dir instead:
  `$env:PATH = "$env:APPDATA\fnm\node-versions\v22.6.0\installation;C:\Program Files\Git\bin;" + $env:PATH`
- Local verification = the `devvit-webview` launch config (vite on 5190) + DOM/attribute/`tick()`
  assertions. That pane reports `visibilityState: 'hidden'`: never assert on live playback, and see
  finding 1 above — it also suppresses IntersectionObserver entirely and throttles timers.
- `devvit/` `npm test`; root `npm run test:run` + full `npm run lint` after the last edit.

### Deliberately still out of scope

`shareImageUrl` (research task — needs answers on hosting, see 3.6 WP6-2), the dead
`readFormValues` branch (needs playtest logs), speed presets, palette accent, Daily Hex on Reddit.

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
