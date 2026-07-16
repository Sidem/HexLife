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
| **Phase 3.6 — feed UX + create-path overhaul** | ✅ WP1–WP5 shipped 2026-07-16; WP6 stretch not started |
| Phase 4 — Daily Hex on Reddit | Later (depends on explorer #17) |

### What Phase 3.6 landed (2026-07-16)

| WP | Status | Notes |
|---|---|---|
| WP1 — post creation | ✅ | `styles` everywhere, postData (≤1800 B), ruleset-name titles, `runAs: 'USER'`, form re-show on bad paste, onPostSubmit comments instead of deleting |
| WP2 — embed additive API | ✅ | `hexlife-playstate` / `hexlife-error`, `wheel-zoom` attr; EMBED-PLAN updated |
| WP3 — client boot/transport | ✅ | postData fast path, **no `draw` in feed** (poster returns), events replace `setInterval`, `wheel-zoom="ctrl"`, `data-state` |
| WP4 — chrome | ✅ | `public/chrome.css`; splash 242→73, game 231→54 lines; lean feed + subtitle; draw hint; status colors split |
| WP5 — in-post create | ✅ | `POST api/post` + `showForm` button (lab only), shared `NEW_POST_COPY` |
| WP6 — stretch | ⬜ Not started | See below |

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

### WP6 — Stretch (open; WP1–5 are green)

1. **Lazy element boot on first intersection** (pre-boot IntersectionObserver in
   `connectedCallback`; `_boot` on first `isIntersecting`; dark placeholder until then). Saves a
   WebGL context + wasm init per scrolled-past post. Element change on the frozen API — do it
   carefully or skip.
2. `shareImageUrl` (+ `heightPixels` tuning) in `styles` — off-Reddit shares currently show
   Reddit's generic placeholder. Needs a hosted image URL; investigate what Devvit accepts.
3. `textFallback` gains the Explorer deep-link URL (`explorerUrlForRuleset`) for old.reddit users.
4. Verify which form-envelope shape 0.13.8 actually sends (playtest logs) and delete the dead
   branch in `readFormValues`.

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
