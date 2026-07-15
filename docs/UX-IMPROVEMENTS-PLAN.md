# HexLife Explorer — UX Audit & Improvement Plan

Owns roadmap **#18** (audit) plus desktop candidate fixes (§B — inputs to the audit, not
pre-approved work). Older shipped UX waves live in `PATCHNOTES.md` only.

**Goal:** make the app as fun as possible for **newcomers**, while letting users **continuously
discover** deeper functionality. The audit decides iterate-vs-overhaul.

---

## §A — The audit (roadmap #18, C2 · I5) — evaluation only, no code

One session, desktop **and** mobile → written verdict.

### A1 — Surface inventory

Catalog every user-facing surface (desktop toolbar/panels/popouts/palette; mobile tabs + More +
sheets + FABs). Per surface: control count, duplicated affordances, expert controls at newcomer
eye-level. Output: table sorted by control count.

### A2 — Cold-start walkthrough (“time to first wonder”)

Fresh profile, desktop + 375px mobile. First ~90s: what is visible/clickable/breakable, and how
long until the first “whoa” moment. Audit the onboarding tour against that path. Note choices with
≥5 equal-weight options.

### A3 — Task-path audit

For ~10 core tasks (run/pause, speed, random rule, edit bit, draw, save/load library, auto-explore,
judge/vote, share): clicks/taps from cold, dead ends, mode traps. Desktop and mobile separately.

### A4 — Progressive-disclosure map

Classify features: **day-one** / **discoverable** / **advanced**. Map which mechanisms (tour,
empty states, command palette, More, Settings) carry discovery.

### A5 — Deliverable

Write `docs/UX-AUDIT-2026-07.md`: inventory, cold-start, task paths, disclosure map,
**overhaul-vs-iterate verdict**, ranked fix list with C/I → append to `ROADMAP.md`. §B candidates
confirmed, re-scoped, or superseded. Play-layer P-items consume the verdict for surface placement.

**Method:** live preview (`npm run dev` / `hexlife-dev`), both viewports, fresh localStorage.
Screenshots OK here (headless-screenshot ban is for `?headless=1` regression only).

**Acceptance:** full inventory; clear verdict; ≥5 scored roadmap items; **zero code** in the audit session.

---

## §B — Candidate fixes (do not implement ahead of §A5)

- **Single-panel focus + “reset layout”** *(C2 · I3)* — one-panel default; free multi-panel advanced.
  Touches `PanelManager`, panel components, Settings → Behaviour.
- **Minimap hover affordance** *(C1 · I1)* — cursor on 3×3 minimaps (`InputManager` hit-test).

## Verify (for post-audit fixes)

`/?headless=1` + `window.__hexlife`; drive desktop via `panelManager.getPanel(…).show()`, mobile via
`COMMAND_SHOW_MOBILE_VIEW`. `npm run test:run` + full `npm run lint` before commit.
