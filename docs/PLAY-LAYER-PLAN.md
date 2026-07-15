# HexLife Explorer — Play Layer Plan (2026-07-13, updated 2026-07-14)

Gamification that **produces data**: every mechanic here doubles as a feedback channel (tags →
searchable catalog, votes → scoring refit, codex → coverage map, daily → deterministic shared
benchmarks, predictions → calibration labels). Guiding constraint: the play layer is an *opt-in
presentation layer over the instrument* — no lab tool is ever gated behind progression, no XP
bars, no cosmetic unlocks, no fake scarcity or streak-loss guilt. Everything banks locally
(localStorage via PersistenceService); nothing leaves the device unless the user copies a share
link or exports a pack.

Status: **T (tags) + S (swipe-to-judge desktop) shipped 2026-07-13** — details in PATCHNOTES /
git history. Open: **C (codex) → D (daily hex)**, then retention **P1–P6** (roadmap #19–#24).

**Shipped seams later items reuse:** `src/core/tags.js` + `tagSuggestions.js` + chip picker (T);
`VoteBank` / `WeightRefit` / desktop `ExploreRaterView` (S). **Still open from S (folds into P1):**
mobile versus-deck home in the Discover tab.

---

## C — The Codex: discovery as collection *(C3 · I3 — roadmap #15, NEXT after #18)*

A personal field journal over behavior space. `BehaviorArchive` already quantizes every
confirmed explore find into a descriptor cell (`ratio|entropy|σ` bins — 10×10×σ grid,
`descriptorFor(metrics)` is exported and pure). The Codex is a **persistent, lifetime** overlay
on that grid: which niches has this user ever discovered?

### C1 — CodexService (data)

- `src/core/CodexService.js` (registered like other services; a seam the WorldManager split
  should respect): map keyed by **statistical cellKey only** (embedding `e:` cells are opaque
  and unstable across models — excluded by design). Value:
  `{ firstSeen, count, best: { hex, name, score, thumb? }, rarityAtDiscovery }`.
- Persistence key `CODEX_PROGRESS`. Feed: subscribe to the explore find-banked flow (the same
  place `EXPLORE_FIND_ADDED` originates, *after* confirmation) — manual library saves with known
  metrics also count. Unlike the session gallery, the Codex never evicts.
- `rarityAtDiscovery`: derived from the embedding-novelty/archive-novelty score already computed
  at bank time, tiered (common / notable / rare / exceptional) by fixed thresholds. Honest
  labeling: rarity states *how novel it was when found*, not a fake global drop rate.
- Unit tests: insert/first-discovery/no-evict semantics, progress counts, rarity tiering on
  fixture finds.

### C2 — Codex UI

- **Grid view:** ratio × entropy as a 10×10 grid (σ collapsed by default, selectable as layers),
  filled cells show the best find's thumbnail + mnemonic name; empty cells render as `?`
  silhouettes. Header: "34 / 120 niches catalogued" (denominator = cells reachable in fixtures,
  not the raw grid product — count σ layers honestly).
- Cell detail on tap/click: the banked finds in that niche, each loadable (`COMMAND_SET_RULESET`)
  and saveable to the library with T's pre-suggested tags.
- **Desktop home:** a Codex tab inside the Library panel. **Mobile home:** a Codex section at the
  top of the Library tab. Same component, both mounts (the display-factory pattern).
- **First-discovery moment:** toast "New niche catalogued — *rare*" (existing toast system),
  gated by a Settings toggle (default on); no sounds, no confetti — the thumbnail is the reward.
- Optional DEV overlay parity: `?curate=1` already exists for the public library; a
  `codexDebug` handle on `window.__hexlife` is enough for testing.

**Acceptance:** running a short explore session fills ≥1 cell headlessly (assert via
`__hexlife`); progress survives reload; loading a codex entry reproduces the behavior
(deterministic seed + IC replay — the same invariant the library "Load + IC" path uses).

---

## D — Daily Hex: the deterministic daily *(C3 · I4 — roadmap #17)*

A Wordle-shaped daily challenge with **zero backend**: the date is the seed, determinism is the
referee, a share link is the replay proof. Strongest retention mechanic for mobile; also a
steady source of shared benchmarks (everyone attacks the same rule/IC).

### D1 — Challenge generator (pure)

- `src/core/DailyChallenge.js`: `challengeFor(dateKey)` — FNV-1a hash the UTC `YYYY-MM-DD`
  (+ fixed salt) into a PRNG seed (mulberry32 or the existing seeded-PRNG util), then
  deterministically draw: a **base ruleset** (seeded R-Sym generation via `RulesetService`), an
  **IC** (seeded density/patch config), and an **objective** from a template table. Challenge
  number = days since a fixed epoch.
- Objective templates — all verifiable from stats the worker already streams:
  - *Survival band:* population ratio within `[a,b]` at tick `T` (and not extinct before).
  - *Exact lifespan:* world goes extinct on tick `T ± tolerance`.
  - *Ignition:* reach ≥50% saturation from your drawn cells within `T` ticks (fewest cells = par).
  - *Stabilize:* reach a confirmed cycle (`isInCycle`) with period ≥ `p` before tick `T`.
- Player's lever, per template: edit the rule within a **bit budget**
  (`hammingDistanceHex(baseHex, playerHex) ≤ K` — helper already in utils.js) and/or edit the IC
  with a **cell budget**. Par = fewest edits; attempts unlimited.
- Same date ⇒ byte-identical challenge on every device. Unit tests: determinism across calls,
  objective evaluation helpers (pure, fed fixture stat streams), budget accounting.

### D2 — Runner + verification

- `DailyChallengeService`: sets up world 4 (center) with the challenge (all resets through
  `_getResetSeed` — the deterministic-reset invariant is what makes results honest), watches the
  selected world's stats stream, and declares success/failure against the objective. Runs are
  re-runnable; the service re-seeds identically each attempt.
- Guard: daily mode is a *mode* on the existing grid (banner + exit affordance), not a separate
  world stack — mirrors how explore borrows worlds today.

### D3 — Result + share card

- On completion: result card with the challenge number, edits used vs par, and the **emoji
  grid** — the 3×3 worlds' final `computeWorldStatus` mapped to emoji (alive ⬡ / extinct ✕→💀 /
  saturated ■→🟧 / cycling ↻→🔁). Copy-to-clipboard text block:
  `HexLife Daily #142 — solved, 3 edits (par 2)` + emoji rows + a share link.
- The share link is a full `ShareCodec` snapshot (ruleset + IC + seed): anyone opening it
  **replays the exact solution** — deterministic verification instead of trust.
- Local history: persistence key `DAILY_RESULTS` (`{dateKey: {solved, edits, ticks}}`), a simple
  month strip in the challenge view. Streaks are *displayed* (count of consecutive solved days)
  but never gate anything.

### D4 — Surfaces

- **Mobile:** hero card at the top of the Discover tab ("Daily Hex #142 — unplayed" badge dot on
  the tab). **Desktop:** an entry in the Explore/gallery area + a command-palette action
  ("Daily Hex"). Both open the same challenge component.

**Acceptance:** `challengeFor('2026-07-13')` identical across two headless boots; a scripted
solve produces success + a share link that replays to the same final status grid; no network
requests anywhere in the feature.

---

## P — Retention follow-ups (roadmap #19–#24, added 2026-07-14)

Smaller riders on shipped infrastructure. Each states its data channel (the play-layer test:
if it produces no data and gates no wonder, it doesn't belong). Sequence after D, informed by
the #18 UX-audit verdict; write a short per-item plan section (expand the sketch below) before
building.

### P1 — Prediction mode: "call it before it runs" *(C2 · I4 — #19)*

Show a rule + IC as a static first frame; the player predicts **extinct / stable / cycling /
explosive** before the simulation runs, then watches the reveal. CA outcomes are famously
counterintuitive — the reveal is the hook. Builds the *mobile card deck* S still owes (one deck
component, two card types: judge-versus and predict-reveal). Ground truth is
`computeWorldStatus` on the deterministic run; candidates drawn from gallery/library/seeded
generation. **Data channel:** predicted-vs-actual labels (persistence key
`PREDICTION_RESULTS`) = human-intuition calibration data; a personal accuracy curve is an
honest, non-fake progression stat. Acceptance sketch: deck plays headlessly with seeded
candidates; reveal always matches a fresh deterministic re-run; accuracy stat survives reload.

### P2 — Challenge-a-friend links *(C2 · I4 — #20, rider on D)*

Mint a challenge from **any** world state: current rule + IC + seed + an objective picked from
the D1 template table + a budget, encoded as a ShareCodec extension (same posture as explore
share links: old links must keep replaying byte-identically — new fields optional). Opening the
link enters daily-style challenge mode with "beat N edits (par)". Zero backend — determinism is
the referee. Turns every Daily share card into a two-way loop instead of a one-way brag.
**Data channel:** none beyond D's — this is the viral/social multiplier. Mostly free once D2's
runner exists.

### P3 — Weekly Expedition: a quest over auto-explore *(C2 · I3 — #21)*

Date-seeded like the daily but weekly: "this week's target niche" = a deterministic draw of an
(empty-for-most-users) Codex cell, or a CLIP `promptText` via the shipped target mode. The
player hunts it however they like — auto-explore, breeding, hand-editing — and the Codex
records the catch. Gives auto-explore (a tool you *watch*) a goal you *pursue*, and cross-links
the systems: daily brings you in, expedition keeps you exploring, Codex banks the result.
**Data channel:** coverage of rare behavior-space cells. Needs C shipped; reuses D1's
date-seeding helper.

### P4 — Ruleset lineage / pedigree *(C2 · I3 — #22)*

Record parentage on breed/mutate/clone (`{ parents: [hexA, hexB?], op, ts }` in library-entry
metadata — schema stays additive) and render a small family tree in the library card detail.
Naming + ancestry creates ownership ("my glider line, five generations deep") — the stickiest
honest retention force available. **Data channel:** real provenance, also valuable in community
packs (`LibraryPackCodec` passes it through sanitized). NB: the #3 `RulesetOrchestrator`
extraction is the natural place to hang parentage capture — do #3 first or together.

### P5 — Field Notes: milestone journal *(C1 · I2 — #23)*

A quiet log of genuine firsts — "first confirmed cycle with period > 30", "first *rare*-tier
niche", "solved 5 dailies under par" — rendered as dated journal entries with thumbnails, not
badges/achievements (the no-XP rule holds: entries record what happened, never gate or reward).
Reuses Codex rarity tiers + the toast system; persistence key `FIELD_NOTES`. **Data channel:**
none (pure investment surface) — keep it C1-small accordingly.

### P6 — PWA install + unplayed-daily badge *(C2 · I3 — #24, enabler)*

The daily's retention ceiling is capped by whether anything ever *reminds* the user. Manifest +
service worker (the app is fully client-side; offline is nearly free — mind the `/HexLife/`
base path and the wasm asset in the precache), home-screen icon, and D4's "unplayed" badge dot.
**No push notifications** — the icon on the home screen is the trigger. Verify the service
worker never caches stale wasm across deploys (version the precache with the build hash).

---

## Cross-feature dependencies

- C before P3 (expedition targets Codex cells) and before P5 (rarity tiers).
- D before P2 (challenge links reuse D1 templates + D2 runner) and before P6's badge.
- P1 builds the shared mobile deck that also becomes S's judging home — one component.
- P4 wants the #3 `RulesetOrchestrator` seam — pair them.
- #18's audit verdict may re-home any of these surfaces — read it before building P-items.
