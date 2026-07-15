# HexLife on Reddit — Devvit Web app (#26)

**App:** `hexlifeapp` · **Subreddit:** r/hexlife · **Location:** `devvit/`

---

## Status (2026-07-15)

| Phase | Status |
|---|---|
| 0–2c (Live Specimen + transport/zoom + create paths) | ✅ Built; playtest green on r/hexlife |
| Create-path honesty (menu form + explorer helper) | ✅ Done |
| **Phase 3 — publish** | Ready for owner `devvit publish` |
| **Phase 3.5 — UX (A+B + autoplay policy)** | ✅ Deep-link, identity chrome, flicker-safe autoplay |
| Phase 3.5 C — further visual polish | Optional follow-up |
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

### Shipped (A + B + autoplay policy)

| Piece | Implementation |
|-------|----------------|
| **Explorer deep-link** | `explorerUrlForRuleset` → `?r=<hex>&g=<rows?>`; CTA “Open full lab” (lab) / “Open in Explorer” (feed). Tooltip: same ruleset, fresh start (recipe ≠ dish). |
| **Identity** | `rulesetName` (`src/core/rulesetName.js`); short hex + **Copy hex**; grid meta `rows×cols`. |
| **Feed vs lab chrome** | `mountHexLife(…, {mode:'feed'\|'lab'})`; speed/copy denser in expanded view. |
| **Autoplay** | **Only if `isFlickerProofPalette`**. Else always `paused` until play. Element still pauses off-screen via IntersectionObserver; reduced-motion still forces poster until explicit play. |
| **Visual pass (partial C)** | Dark tokens, 44px targets, safe-area padding, sans chrome / mono hex. |

Helpers: `isFlickerProofPalette`, `explorerUrlForRuleset` in `WorldCodec.js` (vitest-covered).

**Flicker-proof rule:** preset + `flickerProofPresets: true` (explorer default “Prevent birth/death flash”); neighbor/symmetry only when birth-on === death-off colors; gradient / baked LUT / missing settings → no autoplay.

### Still open

- **C residual:** speed presets, richer loading states.  
- **D:** form/textFallback mnemonic polish.  
- **E:** copy full world code, Daily Hex on Reddit, palette accent.

### Out of scope

- Forking `src/embed/`. External one-click create. Backend social graph.

### Verify

- Root: `npm run test:run` (WorldCodec + rulesetName).  
- `devvit/`: `npm test` (types, Biome, unit, build).  
- Playtest: flicker-proof specimen autoplays in feed; non-safe stays paused; Explorer link loads ruleset.

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
