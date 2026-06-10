# HexLife UI Rework — Session Handoff

_Last updated: 2026-06-10. Branch `main`, deploys to GitHub Pages via `.github/workflows/deploy.yml` on every push._

This document hands off an in-progress UI/UX overhaul of HexLife Explorer so a new
session can continue without re-deriving context.

## How to run & test locally

- Dev server: `npm run dev` (Vite, port 5173). Preview launch config: `.claude/launch.json` → `hexlife-dev`.
- **Headless/preview testing quirk:** the preview browser reports `document.hidden === true`,
  so `requestAnimationFrame` never fires and the app hangs on the loading overlay.
  Load with **`/?headless=1`** — a shim in `index.html` overrides visibility and polyfills
  rAF. Then wait ~5s and dismiss onboarding (`#onboarding-action-secondary`) before screenshots.
- Lint: `npm run lint` (currently **0 errors**, 9 pre-existing warnings in untouched files).
- Build: `npx vite build` (sanity-check the bundle before pushing).
- To re-trigger the auto-start core tour, clear `localStorage['hexLifeExplorer_onboardingStates']` and reload.

## What shipped (2 commits on main)

### Commit `b229bb4` — Visual design overhaul
- **`src/styles/theme.css`** (new, imported LAST in `style.css`): design-token layer.
  Surfaces/borders/text scale, single **amber accent** (`--accent: #f0c674`, matches the ⬡
  brand and the WebGL selection outline) replacing the old blue/amber clash. Radii, shadows,
  focus rings, scrollbars. Fixed the invisible slider fill (`#2b2d42` → amber).
- **`src/ui/icons.js`** (new): ~26 stroke-based `currentColor` SVG icons replacing emoji in the
  desktop toolbar (`Toolbar.js`), mobile tab bar (`BottomTabBar.js`), and mobile FABs/play
  (`UIManager.js`). Play↔pause toggles swap icon markup, not text.
- Desktop toolbar grouped with `.toolbar-separator`s (in `index.html`).
- **`renderer.js`** `_calculateAndCacheLayout`: minimap column/strip capped at its square grid
  size; the freed width/height goes to the main world view (big win on wide screens).
- Mobile overflow fix: the ruleset chip's `min-width` was forcing `#app-container` past the
  viewport, clipping the stats row and the "More" tab. Now all 5 stats + 7 tabs fit at 375px.

### Commit `897fb10` — Menu behavior + Learning Hub
- **Panel stacking** (`PanelManager.js`, `DraggablePanel.js`, `Panel.js`): panels used to all
  open at `(100,100)` with a fixed z-index and no focus management. Now:
  - `defaultPosition` cascades per panel (`{x:64+i*32, y:52+i*28}`).
  - `bringToFront(panel)` restacks z-indexes (range 1001–10xx, kept below popouts at 1050) on
    `show()` and on `pointerdown` (capture) anywhere in a panel.
  - `getTopMostVisiblePanel()` added for Escape handling.
  - `onVisibilityChange` toggles the triggering toolbar button's `.active` class.
- **Escape ordering** (`KeyboardShortcutManager._handleEscape`): closes open popouts first, then
  only the **top-most** panel — no longer nukes every overlay at once.
- **Top-bar popouts** (`TopInfoBar.js` + `Toolbar.registerPopout`): History and App-menu popouts
  are now registered with the toolbar's `activePopouts`, so they close on outside-click / Escape
  like the others. (`Toolbar._initPopoutPanels` now *appends* to `activePopouts` instead of
  reassigning, since TopInfoBar registers earlier.)
- **Tours fixed** (`tourSteps.js`, `Application.js`, `MoreView.js`, `index.html`):
  - `startTour('coreMobile')` was a no-op (tour never existed) → mobile users got **no
    onboarding at all**. Now both platforms use the unified `core` tour, which already adapts.
  - Added 4 missing tours: **`worldsetup`, `analysis`, `rulerank`, `history`** — every `[?]`
    help trigger and Learning Hub row now maps to a real registered tour.
  - Fixed `[?]` `data-tour-name`s in `index.html`: `setup→worldsetup`, `ruleRank→rulerank`,
    `rulesetGeneration→ruleset_actions`.
  - Removed stale `aria-modal="true"` from non-modal draggable panels.
- **Learning Hub** (`LearningComponent.js`): tour ids corrected (`reset-clear→resetClear`,
  `save-load→saveLoad`); list grouped into **Missions / Tutorials** section headers; desktop-only
  tours (`rulerank`, `resetClear`, `history`) hidden on mobile.

All of the above was verified in-preview on desktop (1280×800) and mobile (375×812): cascade,
bring-to-front, active states, Escape ordering, history outside-click close, the `worldsetup`
help-trigger tour stepping through all 4 steps, and the grouped Learning Hub. No console errors.

### Deterministic reset fix (re-applying PR #1)

The "Deterministic Reset" toggle (`WorldManager.deterministic`, World Setup panel) only worked on
the bulk **Reset All** path. Five other reset paths bypassed it — Clone & Mutate, Clone, and
`_modifyRulesetForScope` reseeded with `Date.now() + idx` (never reproducible), while
`COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET` and `#applyRulesetToWorlds` called `resetWorld` with
**no seed at all** (worker falls back to `Math.random`). This is the regression originally fixed in
[PR #1](https://github.com/Sidem/HexLife/pull/1), which had been lost.

- **`WorldManager._getResetSeed(baseSeed, worldIndex)`** (new): returns the shared `baseSeed` in
  deterministic mode, else `baseSeed + worldIndex`. Each reset path now captures `baseSeed =
  Date.now()` **once before its loop** and routes every `resetWorld` call through the helper. All
  six paths are unified.
- **Dead FAB constants fixed** (`WorldsController.js`, `UIManager.js`): the mobile density FABs
  dispatched undefined `COMMAND_RESET_DENSITIES_TO_DEFAULT` / `COMMAND_APPLY_SELECTED_DENSITY_TO_ALL`
  (silent no-ops) → now `COMMAND_RESET_INITIAL_STATES_TO_DEFAULT` /
  `COMMAND_APPLY_SELECTED_INITIAL_STATE_TO_ALL`.

Verified in-preview via the real EventBus command path (all worlds set to density 0.5): deterministic
ON → all 9 worlds produce byte-identical gen-0 grids (paused, same checksum & on-count); OFF → 9
distinct grids; Clone with deterministic ON → identical grids. No console errors. Note: the worker
treats a falsy seed as `Math.random`, so every reset path **must** pass a real seed.

**Headless debug handle:** the `?headless=1` shim (`index.html`) now also sets `window.__headless`,
and `main.js` exposes `window.__hexlife = appContext` when that flag is set. Use it to drive
commands and read `worldManager.worlds[i].latestStateArray` in-browser. Reads after a reset/clone
are async (worker round-trip) — read in a **separate** eval call, not the same one that dispatches.

### Tour polish + calm first-contact + emoji cleanup (this session)

Addresses follow-ups 1, 2, and 6 below.

- **Tour open-gate skip (follow-up 1)** (`tourSteps.js`, `OnboardingManager.js` unchanged):
  panel/popout tours (`controls`, `ruleset_actions`, `editor`, `worldsetup`, `analysis`,
  `rulerank`) now carry a `condition` on their step-1 "Open this panel" gate. New
  `isViewOpen({desktop, mobile})` helper checks `panelManager.getPanel(name).isHidden()` /
  `toolbar.getPopout(name).isHidden()` / `uiManager.activeMobileViewName`. When the panel is
  already open (e.g. the tour was launched from that panel's own `[?]` trigger), `condition`
  returns false → the engine's existing skip-to-next logic drops straight to step 2. Verified
  in-preview: panel open → tour starts at step index 1; panel closed → step 0.
- **Calm first-contact via the core tour (follow-up 2)** (`tourSteps.js`): new
  `focusOrientation()` runs on the core "Welcome" step's `onBeforeShow` — `resetUIState()` +
  `COMMAND_SET_PAUSE_STATE true` + `COMMAND_SELECT_WORLD` (centre). A brand-new user starts on
  ONE still, centred universe behind the dimmed welcome card (matching the "Time is currently
  frozen" copy), and the existing Play → minimap → draw → help steps reveal the rest
  progressively. No renderer/single-world-canvas changes (worlds+minimap share one WebGL
  canvas, so a true one-world view would need renderer work — left as a follow-up). The default
  selected world is already the centre and `INITIAL_RULESET_CODE` is already a fixed curated
  ruleset, so "curated ruleset" was effectively already satisfied; this just guarantees the
  frozen, centred focal point (also on tour replays).
- **Remaining emoji → `icons.js` (follow-up 6)**: added `star`, `starFilled`, `history`,
  `check` icons. `TopInfoBar.js` injects them at init (the ⭐/🕒 in `index.html` stay as a
  no-JS fallback, matching the toolbar/tab-bar pattern); `updateSaveStatus` now swaps
  filled-star (saved: personal/public) vs outline-star (unsaved). Also migrated `MoreView.js`
  (Save Ruleset), `RulesetActionsComponent.js` empty-state, the `personal_library` tour text,
  `LearningComponent.js` status icons (🎓/✅ → graduationCap/check), and `ToolsBottomSheet.js`'s
  FAB-customization list (was a stale emoji duplicate of `UIManager.renderCustomFabs`' icon
  map). New `.inline-icon` util in `theme.css` sizes in-text SVGs to ~1.1em. Verified: top-bar
  buttons + Learning Hub rows render `<svg>`, no console errors.
  - **Still emoji (intentional / out of scope):** `index.html` `#appLogo`/tab `⬡` brand mark;
    undo/redo `↶ ↷` glyphs; `ChromaLabComponent.js` `⚠️` warnings and `🢂` swatch arrows.

## Known-good registered tour names (must stay in sync)

`tourSteps.js` exports: `core, controls, ruleset_actions, editor, worldsetup, analysis,
rulerank, history, appliedEvolution, resetClear, saveLoad, personal_library`.
`LearningComponent.availableTours[].id` and every `index.html` `data-tour-name` must match these.

## Open follow-ups / next candidates (NOT yet done)

Higher-value UX work observed but out of scope so far, roughly prioritized:

1. ✅ **Done (this session).** Tour open-gate skip — see "Tour polish" above.
2. ✅ **Partially done (this session).** Calm first-contact via the core tour — see above. A
   true single-world *canvas* focus (hiding the minimap + other 8 worlds and progressively
   revealing the 3×3) still needs `renderer.js` work and is the remaining piece if desired.
3. **Mobile parity gaps in tours.** A few steps still reference desktop-only popouts (e.g. the
   `resetClear`/`history` flows). They're now hidden in the Learning Hub on mobile, but the
   `appliedEvolution` mission still has desktop-only `condition` branches worth auditing on a real
   phone. Also: there is no mobile entry point for Rule Rank at all (no tab, no FAB).
4. **Panel positions aren't clamped on resize.** A panel dragged to the right edge then a window
   shrink can leave it partly off-screen until next drag. `_loadState` could re-clamp to viewport.
5. **`z-index` ceiling.** `bringToFront` counts up from 1001; with many open/close cycles it stays
   bounded (it re-sorts existing values), but if popouts (1050) ever need to coexist above a
   focused panel, revisit the band allocation.
6. ✅ **Done (this session).** Remaining emoji migrated to `icons.js` — see "Remaining emoji"
   above. Only the intentional brand/glyph/ChromaLab emoji remain.
7. **Toolbar tooltips** are native `title=` (slow, unstyled). A lightweight custom tooltip would
   match the new visual language and could show the keyboard shortcut.

## Project memory

Memory lives at `C:\Users\Sidem\.claude\projects\X--Programming-Projects-HexLife\memory\`.
Relevant: `hexlife-headless-preview-testing.md` (the `?headless=1` quirk above).
