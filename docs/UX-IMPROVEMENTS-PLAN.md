# HexLife Explorer — UX / UI Improvement Plan (2026-06-28)

A focused plan for the next round of **UI/UX** improvements (no CA-engine changes). The goal is a UI
that serves **two audiences at once**: a complete beginner who has never heard of a cellular automaton,
and a power user who wants to discover and experiment fast.

Each item carries **Complexity** (`C`, 1 trivial → 5 large) and **Impact** (`I`, 1 polish → 5
transformative), the exact files it touches, and acceptance criteria. Items are ordered by priority.

> Status legend: ☐ open · ◐ in progress · ☑ shipped. The **bold "This iteration"** items below are being
> built now (1, 3, 6, plus the Surprise-Me hero action).

---

## Diagnosis

The engineering is strong (EventBus command bus, tour engine, design-token theme, thumbnails,
configurable FABs). The core UX tension is that **everything is presented at equal weight**: a beginner
and an expert both face the same flat wall of 22 icon-only toolbar buttons, with meaning carried only by
`title` tooltips. The fixes below add **hierarchy** (so beginners find the few things that matter) and
**acceleration** (so experts skip the chrome).

---

## This iteration — ☑ shipped & verified (2026-06-28)

*284 JS tests green · lint clean · verified live in the headless preview (toolbar 50↔200px with
canvas reflow + persistence; rule-deck Surprise flips paused→playing and re-rolls all 9 worlds;
Ctrl-K palette opens/filters/runs/closes).*

### 1. Tiered, labelled toolbar  — ☑  *(C2 · I4)*
The desktop rail (`index.html:163-188`) is 22 icon-only buttons in 6 *unlabelled* separator groups.
- Add a persisted **expand/collapse toggle**: collapsed = today's icon rail; expanded = icon **+ text
  label** rows with **group headers** (Simulate · Rules · Discover · Capture · Settings). Play stays a
  pinned primary action at the top.
- Add `aria-label` to every icon-only control (sourced from the existing `title`), closing the roadmap
  a11y gap at the same time.
- Touches: `src/ui/Toolbar.js` (label map, group headers, expand state + persistence, aria-labels),
  `src/ui/Toolbar.css` (expanded-state styles), `src/services/PersistenceService` key `toolbarExpanded`.
- Acceptance: collapsed state is visually identical to today; expanded state shows labels + group
  headers and persists across reloads; toggling triggers a canvas resize (no stale layout); every button
  exposes a sensible accessible name.

### 3. Persistent "rule deck" HUD  — ☑  *(C2 · I4)*
The core creative loop (Generate → watch → Mutate → Keep/Save) is buried in the 🧬 panel. The top-bar
ruleset cluster (`index.html:99-113`) already holds Undo/Redo/Save/History — extend it into an
always-visible deck so the 90% action never needs a panel.
- Add **Generate** and **Mutate** buttons + the **Surprise Me** hero (below) beside the ruleset identity.
- Touches: `src/ui/TopInfoBar.js` (build + wire deck buttons), `src/ui/TopInfoBar.css`.
- Acceptance: Generate / Mutate fire `COMMAND_EXECUTE_GENERATE_RULESET` / `COMMAND_EXECUTE_MUTATE_RULESET`
  (same as the `g` / `Shift+M` shortcuts) with a confirming toast; deck is desktop-only (mobile keeps its
  FAB stack); no reflow of the centred ruleset identity as values change.

### 2 (lite). "Surprise Me" hero action  — ☑  *(C1 · I4)*
The fastest path to delight — random rule + reset + play — has no one-click entry. Add a prominent
**Surprise Me** button in the rule deck that generates a fresh random ruleset across **all 9 worlds**,
reseeds, and starts playing, regardless of the user's saved scope/auto-reset settings.
- **Tour-safe by design:** it is a plain button, dispatched on click only. It does **not** auto-fire and
  does **not** alter the `core` onboarding tour (`Application.js:141`). A future tour step *may* reference
  it via `data-tour-id="surprise-me-button"` (added now), but the existing tour flow is left untouched.
- Touches: `src/ui/TopInfoBar.js` (dispatch `COMMAND_GENERATE_RANDOM_RULESET` {applyScope:'all',
  shouldReset:true} → `COMMAND_SET_PAUSE_STATE` false).
- Acceptance: one click on a fresh load yields nine freshly-seeded worlds running a new random rule;
  works whether or not the tour has been completed; does not trip the tour's spotlight.

### 6. Command palette (Ctrl/⌘-K)  — ☑  *(C3 · I4)*
A fuzzy, keyboard-driven action launcher. Serves experts (speed) and beginners (type-what-you-want
discovery), and future-proofs against toolbar crowding. Cheap because every action is already a
`COMMAND_*` dispatch.
- New `src/ui/components/CommandPalette.js` + CSS; opened by `Ctrl/⌘-K` (desktop), Esc/click-out to close,
  ↑/↓ + Enter to run, substring filter, shortcut hints shown per row.
- Touches: new component + CSS, `src/services/EventBus.js` (`COMMAND_TOGGLE_COMMAND_PALETTE`),
  `src/ui/KeyboardShortcutManager.js` (register the open shortcut so it appears in the Shortcuts panel),
  `src/ui/UIManager.js` (instantiate).
- Acceptance: Ctrl/⌘-K opens the palette from anywhere on desktop; typing filters; Enter runs the
  highlighted command and closes; every listed command maps to a working `COMMAND_*` dispatch.

---

## Next up (not in this iteration)

### Shipped 2026-06-29 — ☑ Settings / Preferences panel (+ destructive-op safeguard)
*293 JS tests green · lint clean (0 errors) · `npx vite build` clean · verified in the headless preview
(panel renders 3 sections / 6 toggles / viz radio; show-performance hides FPS/TPS; Reset All / Clear All
request confirmation when the gate is on and run straight through when off; selected-scope clear always
bypasses).* A new global home for cross-cutting preferences, reachable from the toolbar gear, the app
menu, the command palette, and the mobile **More** view.
- New `src/ui/components/SettingsComponent.js` + `.css`; registered as a draggable panel (`#settingsPanel`,
  trigger `settingsButton`) in `PanelManager`, added to `UIManager` shared components + `#mobileViewConfig`,
  and to the `CommandPalette` list. New `cog` icon in `icons.js`.
- **Relocated** the display toggles (cell coloring, minimap overlays, status badges, action toasts) out of
  the "Controls" popout into Settings — Controls is now just Simulation + Drawing, matching its
  "Speed & Brush" label. Single source of truth; same persisted settings, same `COMMAND_*` events.
- **New: show-performance toggle** — `VisualizationController.getShowPerformance` + `COMMAND_SET_SHOW_PERFORMANCE`;
  `TopInfoBar.applyShowPerformance` hides/shows the FPS/TPS tiles + their separator (the deferred half of #4).
- **New: confirm-destructive-actions toggle** (default on) — delivers the CLAUDE.md roadmap
  *destructive-op safeguard*. `WorldManager._guardDestructive` routes Clear All / Reset All through
  `COMMAND_SHOW_CONFIRMATION` (gating every dispatch source centrally — toolbar, FABs, keyboard, palette);
  selected-scope clear bypasses (it keeps scrub-back). Deterministic-resets toggle also surfaced here.
- **Relocated world prefs** — **Grid size** + **Deterministic resets** moved out of World Setup into a new
  Settings **Simulation** section (they're global prefs; now in one place). World Setup keeps only
  per-world initial-state config + bulk actions; the orphaned "Grid Size" tour step was removed.
- **Appearance** section is a "coming soon" placeholder (light theme + CVD palette are the next items it
  will host).

### Shipped this session — ☑ #4, #8, #7 (2026-06-28)
*293 JS tests green (+9 from `tests/worldStatus.test.js`) · lint clean (0 errors) · `npx vite build`
clean · verified live in the headless preview (status chip → Died out / Full / Cycling ↻N / Active;
FPS/TPS demoted; one-time canvas hint shows once then never again across reload; panel subtitles +
Explore/Library empty-states render).*
- **#4** — extracted the status classifier into a pure shared module `src/ui/worldStatus.js`
  (`computeWorldStatus` reused by `MinimapOverlays`; `computeStatusWord` adds the "Active" case). New
  `#stat-status` chip in the top bar (fixed 84px width so the centred ruleset identity never reflows);
  FPS/TPS tiles get `.stat-tile--secondary` muted treatment.
- **#8** — `src/ui/CanvasHint.js` + `.css`, triggered from `Application.#maybeShowCanvasHint` after the
  loader hides; gated by persisted `seenCanvasHint` and suppressed while the `core` tour is active.
- **#7** — `.panel-subtitle` glosses on every jargon panel `<h3>` in `index.html`; richer
  `.panel-empty-state` blocks for the Explore gallery and the personal Ruleset Library.

### 4. Legible simulation status in the top bar — ☑  *(C2 · I3)*
`MinimapOverlays._computeStatus` already classifies extinct / saturated / cycling (`↻N`). Surface a
plain-language word ("Died out" / "Chaotic" / "Cycling ↻") for the selected world in the top bar, and
demote FPS/TPS (engineering telemetry) to a smaller/secondary treatment or a toggle.

### 5. Single-panel focus + "reset layout"  *(C2 · I3)*
Reconcile the two paradigms (anchored popouts vs. free draggable panels). Default to single-panel focus
(opening one closes others) with a "close all / reset layout" affordance; expose free multi-panel as an
advanced preference.

### 7. Plain-language naming & contextual empty-states — ☑  *(C2 · I3)*
Pair jargon with human words in panel headers/tooltips (Chroma Lab → *Colors*; Rule Rank → *Rule usage*;
Ruleset → *the rules of life*). Add self-describing empty-states to the Explore and Library panels. Keep
the auto-start `core` tour short; full feature tour on demand.

### 8. Canvas-interaction discoverability — ☑  *(C1 · I3)*
One-time hint that minimaps are click-to-focus and the big canvas is drawable; hover affordances on the
3×3 grid. *(Shipped the one-time hint; the optional minimap hover-cursor affordance is left as polish.)*

### 9. Mobile tab-bar consolidation  *(C2 · I2)*
The bottom tab bar carries 7 destinations (`index.html:328-357`), past the comfortable 5. Merge
Rules / Editor / Worlds into one "Build" area with a segmented sub-view; surface the configurable left
FAB stack so users discover it.

---

## Notes
- This doc is a working plan; shipped detail still lands in `PATCHNOTES.md`. The roadmap in `CLAUDE.md`
  covers complementary visual-design items (CVD palette, light theme, destructive-op safeguard) that
  intersect with 4/5/7 above.

---

## Next-session handoff — #4, #8, #7 ✅ DONE (2026-06-28)

**#4, #8, #7 shipped & verified this session** (see "Shipped this session" above). The touch-point notes
below are retained for reference. **Next up:** #5 (single-panel focus + reset layout) and #9 (mobile
tab-bar consolidation), plus the optional minimap hover-cursor polish from #8.

**Status as of commit `2c2e273` (pushed to `main`, deployed to Pages):** items 1, 2-lite, 3, 6 are live.
Below are the concrete touch-points for the next three, grounded in the current code.

**Verify in the headless preview** (rAF is suspended in the hidden browser): `preview_start` the
`hexlife-dev` launch config, then load `http://localhost:<port>/HexLife/?headless=1` (a plain
`location.reload()` drops the `?headless=1` query and stalls the app — always re-navigate to the full
URL). Debug handle: `window.__hexlife` (worldManager, eventBus, appContext, simulationController, …).
WebGL screenshots hang — assert via DOM/state, not screenshots. `npm run test:run` + `npm run lint`
before committing; validate the prod bundle with `npx vite build` (skip the wasm step — binary is
git-tracked, CI rebuilds it).

### #4 — Legible simulation status + demote FPS/TPS  *(C2 · I3)*
- **Status word.** `MinimapOverlays._computeStatus(stats)` (`src/ui/MinimapOverlays.js`) already returns
  the extinct / saturated / cycling (`↻N`) classification. Lift that pure function out (or export it) and
  reuse it in `TopInfoBar` to show a plain-language chip for the **selected** world — e.g. "Died out",
  "Full", "Cycling ↻N", "Active". `TopInfoBar.updateStatsDisplay(stats)` already receives the selected
  world's stats via `WORLD_STATS_UPDATED`; add a `.stat-tile` for status (new markup in
  `index.html` `#statsDisplayContainer`, styled in `TopInfoBar.css`).
- **Demote telemetry.** FPS/TPS tiles live at `index.html:133-143` (`#stat-fps`, `#stat-tps-bar`). Give
  them a muted/secondary treatment (smaller, lower-contrast) or gate them behind a persisted "show
  performance" UI setting (`PersistenceService` UI setting, like `toolbarExpanded`). Keep Tick + Active
  prominent.
- Acceptance: a run that dies out shows "Died out"; an oscillator shows "Cycling ↻N"; FPS/TPS read as
  secondary. No reflow of the centred ruleset identity (the stats column already reserves fixed widths —
  preserve that discipline for the new tile).

### #8 — Canvas-interaction discoverability  *(C1 · I3)*
- A **one-time** hint that the 3×3 minimaps are click-to-focus and the big view is drawable. Cheapest:
  a dismissible hint (toast via `COMMAND_SHOW_TOAST`, or a small transient overlay near the canvas) shown
  once after the loader hides — gate on a persisted flag (new `PersistenceService` UI setting, e.g.
  `seenCanvasHint`) so it never repeats. Don't collide with the auto-start `core` tour
  (`Application.js:141`): show it only when the tour is **not** active / already completed
  (`onboardingManager.isActive()` / `loadOnboardingStates()`).
- Optional polish: a hover cursor/affordance on minimaps (selection hit-testing is in
  `InputManager.getCoordsFromPointerEvent`).
- Acceptance: first run shows the hint once; never again after dismissal/reload; never overlaps the tour.

### #7 — Plain-language naming & contextual empty-states  *(C2 · I3)*
- **Naming.** The expanded toolbar rail already uses human labels (Colors, Rule Usage, Generate &
  Mutate — see `TOOLBAR_BUTTON_LABELS` in `Toolbar.js`). The **panel titles** still read as jargon:
  `index.html` `#chromaLabTitle` ("Chroma Lab"), `#rankPanelTitle` ("Rule Usage Ranking"),
  `#rulesetActionsTitle`, etc. Add plain-language subtitles to those `<h3>`/`<h4>` headers (keep the
  jargon, pair it with a human gloss). **HTML-edit gotcha:** include the full tag through `>` when
  editing element openers (see CLAUDE.md).
- **Empty-states.** Give the Explore and Library panels a self-describing message before they have
  content: `src/ui/components/ExploreComponent.js` (no run yet) and `RulesetLibraryComponent.js` (empty
  personal library). One-sentence "what this does / how to start".
- Acceptance: a newcomer can read each panel's purpose without a tooltip; empty Explore/Library explain
  themselves.

### Suggested order & sizing
`#8` (C1) is the quickest standalone win; `#4` (C2) is the biggest comprehension gain; `#7` (C2) is two
independent sub-tasks (naming vs. empty-states) that can ship separately. Recommend **#4 → #8 → #7**, or
do `#8` first as a warm-up. Mark each ☑ here and add a one-liner to `PATCHNOTES.md` when shipped.
