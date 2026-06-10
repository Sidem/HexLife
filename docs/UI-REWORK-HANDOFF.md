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

## Known-good registered tour names (must stay in sync)

`tourSteps.js` exports: `core, controls, ruleset_actions, editor, worldsetup, analysis,
rulerank, history, appliedEvolution, resetClear, saveLoad, personal_library`.
`LearningComponent.availableTours[].id` and every `index.html` `data-tour-name` must match these.

## Open follow-ups / next candidates (NOT yet done)

Higher-value UX work observed but out of scope so far, roughly prioritized:

1. **Tour launched from inside its own panel feels awkward.** `worldsetup`/`analysis`/etc.
   step 1 runs `resetUIState` (closes the panel) then asks the user to re-open it via the
   toolbar button to fire `VIEW_SHOWN`. Consider: if the panel is already open, skip step 1's
   open-gate and start at step 2. (Low risk, good polish.)
2. **First-contact overwhelm.** New users see 9 worlds of noise + a 14-button toolbar. Consider a
   "focus mode" that starts on one world with a curated ruleset, revealing the grid progressively.
3. **Mobile parity gaps in tours.** A few steps still reference desktop-only popouts (e.g. the
   `resetClear`/`history` flows). They're now hidden in the Learning Hub on mobile, but the
   `appliedEvolution` mission still has desktop-only `condition` branches worth auditing on a real
   phone. Also: there is no mobile entry point for Rule Rank at all (no tab, no FAB).
4. **Panel positions aren't clamped on resize.** A panel dragged to the right edge then a window
   shrink can leave it partly off-screen until next drag. `_loadState` could re-clamp to viewport.
5. **`z-index` ceiling.** `bringToFront` counts up from 1001; with many open/close cycles it stays
   bounded (it re-sorts existing values), but if popouts (1050) ever need to coexist above a
   focused panel, revisit the band allocation.
6. **Remaining emoji** in panel *content* (⭐/🕒 top-bar buttons, More view, save-ruleset states)
   still use emoji; migrate to `icons.js` for full consistency. The toolbar/tabs/FABs are done.
7. **Toolbar tooltips** are native `title=` (slow, unstyled). A lightweight custom tooltip would
   match the new visual language and could show the keyboard shortcut.

## Project memory

Memory lives at `C:\Users\Sidem\.claude\projects\X--Programming-Projects-HexLife\memory\`.
Relevant: `hexlife-headless-preview-testing.md` (the `?headless=1` quirk above).
