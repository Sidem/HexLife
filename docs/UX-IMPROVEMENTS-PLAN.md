# HexLife Explorer — UX Audit & Improvement Plan (rewritten 2026-07-14)

Owns roadmap **#18** (the audit) plus the surviving desktop items from the old UX plan (folded
in as §B — candidate fixes, not commitments). The 2026-06-28 wave (#1–#8) shipped and lives in
PATCHNOTES; #9 mobile tab-bar was absorbed by the #16 mobile redesign.

**Goal (owner-stated):** make the application as fun and engaging as possible for **newcomers**,
while letting users **continuously discover** functionality that makes use even more fun. The
audit decides whether that goal is reachable by iterating on the current UI or whether an
overhaul is needed.

---

## §A — The audit (roadmap #18, C2 · I5) — evaluation only, no code changes

One session, desktop **and** mobile, producing a written verdict. The 2026-06-28 diagnosis
("everything is presented at equal weight") predates the mobile redesign, the play layer, and
two feature waves — re-derive it, don't assume it.

### A1 — Surface inventory (the clutter map)

Catalog every user-facing surface: desktop toolbar tiers, each panel/popout (Rules, Editor,
Worlds, Analysis, Chroma Lab, Library, Explore, Settings, Capture Studio…), the command
palette, context/canvas interactions, the 4 mobile tabs + gear/More view + bottom sheets +
quick-actions row + FABs. For each: **control count**, duplicated affordances (how many ways
exist to do the same thing, e.g. the three "Apply to:" switches), and dead or expert-only
controls sitting at newcomer eye level. Output: a table, sorted by control count — the
overload ranking.

### A2 — Cold-start walkthrough (time-to-first-wonder)

Fresh profile (cleared localStorage), desktop + 375px mobile. Walk the first 90 seconds as a
newcomer: what is visible, what is clickable, what can be broken, and — the metric that matters
for this app — **how long until the first "whoa" moment** (a rule doing something surprising).
Audit the existing onboarding tour against that path: does it front-load chrome, or does it get
a world running fast? Note every point where the newcomer must choose among ≥5 equal-weight
options. HexLife's actual fun is *wonder*; the cold start should reach it in seconds, not
after a tour.

### A3 — Task-path audit (navigation cost)

For the ~10 core tasks (run/pause, change speed, new random rule, edit a rule bit, draw cells,
save to library, load from library, start auto-explore, judge/vote, share a link): count
clicks/taps from cold, note dead ends, mode traps (e.g. explore borrowing worlds), and menus
where the task hides below the fold. Desktop and mobile separately.

### A4 — Progressive-disclosure map (the "continuous discovery" half of the goal)

Classify every feature into: **day-one** (visible immediately), **discoverable** (revealed by
use — the delight of finding Chroma Lab or the command palette), and **advanced** (should sit
behind an explicit Advanced affordance, e.g. the 128-cell editor grid already is). The current
UI largely exposes everything at once; the map says what *should* be in each tier and which
existing mechanisms (tour, empty states, command palette, More view, Settings) can serve as
the discovery channel. Discovery moments are a retention mechanic in their own right — treat
"user finds a new capability in week 2" as a designed event, not an accident.

### A5 — Verdict + ranked fix list (the deliverable)

A written `docs/UX-AUDIT-2026-07.md` containing: the inventory table, the cold-start findings,
the task-path table, the disclosure map, and an explicit **overhaul-vs-iterate verdict** with
rationale. Then a ranked fix list with C/I scores, appended to ROADMAP.md as new numbered
items; §B's candidates get confirmed, re-scoped, or superseded by that list. The play-layer
P-items (prediction deck, expedition, PWA) consume the verdict — their surfaces should land
where the audit says newcomers actually look.

**Method notes:** headless preview for state-level checks, but this item is primarily *visual*
— use the real browser preview (`npm run dev` via the `hexlife-dev` launch config), both
viewport presets, fresh-profile localStorage. Screenshots are legitimate evidence here (the
headless-screenshot ban applies to `?headless=1`, not the live preview).

**Acceptance:** every surface inventoried with counts; a clear verdict with rationale; ≥5
ranked, scored fix items appended to the roadmap; zero code changes in the audit session.

---

## §B — Known candidate fixes (inputs to §A5, not pre-approved work)

Carried from the old plan — do **not** implement ahead of the audit verdict:

- **Single-panel focus + "reset layout"** *(C2 · I3, old #5)* — reconcile anchored popouts vs.
  free draggable panels; default to one-panel-at-a-time with "close all / reset layout"; free
  multi-panel becomes an advanced preference (Settings → Behaviour). Touches
  `PanelManager.js`, `Panel.js`/`DraggablePanel.js`, `SettingsComponent.js`.
- **Minimap hover affordance** *(C1 · I1, old #8-polish)* — hover cursor on the 3×3 minimaps
  (hit-testing lives in `InputManager.getCoordsFromPointerEvent`).

## Verify recipe (for whatever fixes the audit spawns)

Headless preview (`/?headless=1`, `window.__hexlife`); the hidden browser boots in *mobile* mode
(0×0 viewport) — drive desktop panels via `panelManager.getPanel(...).show()` and mobile via
`COMMAND_SHOW_MOBILE_VIEW`. A Vite HMR full reload drops `?headless=1` — re-navigate with the
flag. `npm run test:run` + full `npm run lint` before committing.
