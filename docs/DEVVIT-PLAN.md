# HexLife on Reddit — Devvit Web app (#26)

**Goal:** live, GPU-rendered hex worlds inside Reddit interactive posts (desktop + mobile apps).
Consumes `#25` embed runtime — **never fork the sim/renderer.**

**App:** `hexlifeapp` · **Subreddit:** r/hexlife · **Location:** `devvit/`

---

## Status (2026-07-15)

| Phase | Status |
|---|---|
| 0 — scaffold + toolchain + stock playtest render | ✅ Done |
| 1 — wasm/WebGL smoke (`<hexlife-world>` in webview) | ✅ Built + locally green; **owner playtest still the Reddit proof** |
| 2 — Live Specimen via world codes (`HXW1.…`) | ✅ Built + locally green; same playtest gate |
| 2b — generator codes, transparent poster, in-element reset, speed slider | ✅ Built |
| **2c — transport chrome, zoom, explorer→Reddit post** | **In progress** (this branch) |
| 3 — polish + publish | Open |
| 4 — Daily Hex on Reddit | Later (depends on #17) |

**Hard gate still open:** `devvit playtest` + a real post on desktop web / iOS / Android Reddit apps. Until that is green, wasm/WebGL on Reddit is unproven.

### Owner-only steps (agent must not do)

- `devvit login` / credentials
- Each `devvit playtest` / `upload` / `publish` (ask every time)
- Confirm render on real phone webviews
- App-directory review responses

### Local playtest command

```powershell
$env:PATH="C:\Program Files\Git\bin;"+$env:PATH
cd <repo>/devvit
fnm exec --using=22.6.0 -- npx.cmd devvit playtest hexlife
```

(Git Bash on PATH or live-reload silently no-ops. Use `npm.cmd` / `npx.cmd` under `fnm exec` on Windows.)

---

## Product

**v1 — Live Specimen.** Explorer exports the world you are looking at as a **world code**
(`HXW1.…` via Share → Copy World Code / Post to r/hexlife). The post form (or converted text
post) takes that code. Posts open **paused** behind the play overlay. Code = dish (grid, ruleset,
exact tick-0 cells or a generator recipe, palette settings, speed) — not a re-derived seed.

**v2 — Daily Hex on Reddit.** Scheduler + Redis; reuse app #17 logic. Do not start before #17.

**v3 — voting → library.** Only if v1/v2 get traction.

---

## Architecture (settled)

```
devvit/
  devvit.json          # name=hexlifeapp; entrypoints splash.html + game.html; menu + forms
  public/              # webroot (esbuild OUTPUT — do not hand-edit *.js)
  src/client/          # webview TS → public/*.js  (imports ../../../src/embed/)
  src/server/          # Node + Redis (world:<t3> codes)
  src/shared/api.ts
  scripts/build-client.mjs   # esbuild plugin: ?url wasm → base64 data URI, ?raw glsl
```

- Separate toolchain from root (TS + esbuild + Biome; Node 22.6 via fnm). Root stays on Node 20.
- Root ESLint ignores `devvit/**`. Nested `.gitignore` covers build output.
- Webview mounts `<hexlife-world code="…">` with `paused` + `link="off"`.

---

## Open work

### 2c — transport chrome + zoom + explorer post *(current)*

- [ ] Pause/play + restart beside the speed slider (splash + game); hide in-element corner reset when external chrome owns transport
- [ ] Scroll-wheel zoom (desktop) + pinch zoom (mobile) on the embed (shared with #25)
- [ ] Explorer Share: title + **Post to r/hexlife** (open Reddit submit prefilled; optional server-side upgrade of pure world-code text posts to Live Specimens)
- [ ] Verify on built webview + root tests

### Phase 3 — polish + publish

App listing (icon, description, screenshots), Devvit rules compliance, demo post, submit for review.
**Accept:** app installable; demo post live.

### Phase 4 — Daily Hex on Reddit

After #17 ships in the explorer. Scheduler-driven daily + Redis per-user state.

---

## Risks

- **Mobile webview variance** — the whole Phase 1 go/no-go
- **Toolchain churn** — trust `devvit new` templates over tutorials
- **Review rejection** — zero external network calls helps
- **Divergence from #25** — keep consuming `src/embed/` only

## Rollback

Git tag/branch: `checkpoint/pre-devvit-extensions-2026-07-15` (pre-2c work).
