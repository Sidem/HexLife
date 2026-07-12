# HexLife Explorer — UX / UI Improvement Plan (2026-06-28, trimmed 2026-07-12)

UI/UX improvements serving two audiences at once: a complete beginner and a power user. No
CA-engine changes. Items carry Complexity/Impact `(C# · I#)`.

**Shipped (2026-06-28/29, details in PATCHNOTES.md):** #1 tiered/labelled toolbar, #2-lite
Surprise Me, #3 rule-deck HUD, #4 status word + demoted FPS/TPS, #6 Ctrl-K command palette,
#7 plain-language naming + empty-states, #8 one-time canvas hint, plus the Settings panel +
destructive-op safeguard. Only the items below remain open.

---

## Diagnosis (still the guiding idea)

The core UX tension is that **everything is presented at equal weight**. Fixes add **hierarchy**
(beginners find the few things that matter) and **acceleration** (experts skip the chrome).

## Open items

### 5. Single-panel focus + "reset layout" *(C2 · I3)*

Reconcile the two paradigms (anchored popouts vs. free draggable panels). Default to
single-panel focus (opening one closes others) with a "close all / reset layout" affordance;
expose free multi-panel as an advanced preference (Settings → Behaviour). Touches
`PanelManager.js`, `Panel.js`/`DraggablePanel.js`, `SettingsComponent.js`.

### 9. Mobile tab-bar consolidation *(C2 · I2)*

The bottom tab bar carries 7 destinations (`index.html`, `#bottomTabBar`), past the comfortable 5.
Merge Rules / Editor / Worlds into one "Build" area with a segmented sub-view; surface the
configurable left FAB stack so users discover it. Touches `BottomTabBar.js`, `MobileView.js`,
`UIManager.js` `#mobileViewConfig`.

### 8-polish. Minimap hover affordance *(C1 · I1)*

Optional: a hover cursor/affordance on the 3×3 minimaps (selection hit-testing is in
`InputManager.getCoordsFromPointerEvent`).

## Verify recipe

Headless preview (`/?headless=1`, `window.__hexlife`); the hidden browser boots in *mobile* mode
(0×0 viewport) — drive desktop panels via `panelManager.getPanel(...).show()` and mobile via
`COMMAND_SHOW_MOBILE_VIEW`. A Vite HMR full reload drops `?headless=1` — re-navigate with the
flag. `npm run test:run` + full `npm run lint` before committing.
