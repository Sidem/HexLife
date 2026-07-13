# HexLife Explorer — Play Layer Plan (2026-07-13)

Gamification that **produces data**: every mechanic here doubles as a feedback channel (tags →
searchable catalog, votes → scoring refit, codex → coverage map, daily → deterministic shared
benchmarks). Guiding constraint: the play layer is an *opt-in presentation layer over the
instrument* — no lab tool is ever gated behind progression, no XP bars, no cosmetic unlocks.

Four items, in build order: **T (tagging) → S (swipe-to-judge) → C (codex) → D (daily hex)**.
T is shared infrastructure; S fuses roadmap #7; C consumes T's vocabulary; D is standalone last.

---

## T — Smoother cataloguing: canonical tags + suggestions *(C2 · I3)* — ✅ SHIPPED 2026-07-13

Implemented as specced (T1–T4): `src/core/tags.js` (18-tag vocabulary), `src/core/analysis/
tagSuggestions.js` (stats + embedding suggestions + merge), `EmbeddingService.embedTags`, and the
`SaveRulesetModal` chip picker (canonical toggles + Suggested row + custom add), with the gallery
save path passing `metrics`/`cyclic` through. Details in PATCHNOTES. The spec below is retained for
reference.

**Today:** schema-v2 library entries already carry `tags: string[]`
(`LibraryController.normalizeRulesetEntry`), the library renders tag filter chips
(`RulesetLibraryComponent` builds the union), and `SaveRulesetModal` takes a free-text
comma-separated input. Free text means `glider`/`gliders`/`ship` fragmentation and most saves
get no tags at all.

### T1 — Canonical tag vocabulary

- New pure module `src/core/tags.js`: ~16–20 curated tags, each
  `{ id, label, description, promptText }`. Starting set (append-only, like the mnemonic word
  arrays): `gliders`, `ships`, `spirals`, `oscillators`, `still-life`, `growth`, `decay`,
  `chaos`, `waves`, `maze`, `mosaic`, `blobs`, `dots`, `symmetric`, `flicker`, `puffers`,
  `replicators`, `edge-of-chaos`. `promptText` is a CLIP-friendly phrase ("a pattern of small
  moving spaceship shapes"), used by T3.
- Community-pack relevance: canonical ids make imported packs merge into the same filter chips
  instead of forking the vocabulary. Free-form tags remain allowed (the field stays `string[]`).

### T2 — Chip picker in the save flow

- `SaveRulesetModal`: replace the bare text input with (a) toggle chips for canonical tags,
  (b) a **Suggested** row (T3/T4, pre-highlighted, one tap to accept), (c) a small free-text
  "add custom tag" affordance. Also add the same editor to the library card edit flow so old
  entries can be back-tagged.
- Explore-gallery save path (`RulesetDisplayFactory` card actions) passes suggestions through so
  a gallery find arrives at the modal pre-tagged.

### T3 — Embedding-based suggestions (when CLIP is enabled)

- `EmbeddingService.embedText(promptText)` each canonical tag **once**, lazily, and cache in the
  service (same never-throw contract; disabled/ERROR ⇒ skip silently to T4).
- For a candidate: cosine similarity of the world's frame embedding (`embed(frame)` — already
  computed for explore finds; for manual saves, embed the thumbnail-bake frame) against the tag
  bank; top 3–4 above a floor become Suggested chips.
- Pure ranking helper `suggestTagsFromEmbedding(embedding, tagBank)` under `src/core/analysis/`,
  unit-tested with fixture vectors.

### T4 — Stats-heuristic suggestions (always available, no CLIP)

- Pure helper `suggestTagsFromStats(metrics)` mapping already-computed metrics to tags:
  `isInCycle` → `oscillators`; high transport → `gliders`/`ships`; ratio→1 drift → `growth`;
  high blockEntropy plateau → `chaos`; very low entropy + stable ratio → `still-life`/`mosaic`.
  Thresholds as named constants; unit-tested against the interestingness fixture metrics.
- Merge rule: embedding suggestions win when present; heuristics fill remaining slots; never
  auto-apply — suggestions are one tap, not zero.

**Acceptance:** saving a gallery find offers ≥1 sensible suggestion with CLIP off (fixture
test), tag filter chips dedupe across public/personal/imported entries, no schema migration
(field already exists).

---

## S — Swipe-to-judge *(C3 · I4 — fuses roadmap #7 HITL validation)*

The Tinder-loop presentation of the already-planned human-in-the-loop interestingness rater.
The game mechanic *is* the data collection: pairwise "which is more interesting?" votes bank
locally and later drive an **opt-in** weight refit. This item replaces roadmap #7's standalone
entry — the plan below is a superset.

### S1 — Vote bank (core, UI-independent)

- `src/core/analysis/VoteBank.js`: append-only vote records
  `{ ts, aHex, bHex, winner: 'a'|'b'|'skip', aMetrics, bMetrics, aScore, bScore, source }`
  (metrics snapshot = per-component score breakdown both sides — the refit features).
  Persistence key `INTERESTINGNESS_VOTES` (name already reserved in roadmap #7); cap the bank
  (e.g. 2,000 votes, FIFO) so localStorage stays bounded.
- Pair selection helper `nextPair(candidates, votedPairs)`: prefer pairs with **similar current
  scores but different archive cells** (maximum information per vote), avoid repeats.
  Candidates: session gallery finds + personal-library entries that have thumbnails.
- Unit tests: bank round-trip, cap behavior, pair-selection preferences on fixtures.

### S2 — Judging surfaces

- **Mobile (primary):** a card-deck view in the Discover tab — two thumbnails stacked as a
  versus card; tap the better one (or swipe toward it), swipe up to skip. Big targets, one
  decision per screen, ~15-second sessions. Thumbnails come from the existing bake pipeline;
  cards without thumbs are skipped.
- **Desktop:** a "Rate finds" mode in the Explore panel gallery — same VoteBank, presented as a
  side-by-side A/B with keyboard arrows (←/→ pick, ↓ skip).
- Both fire `VOTE_RECORDED`; a small counter chip ("N votes banked") gives the collection loop
  visible progress without inventing points.

### S3 — Opt-in weight refit

- Pure helper `src/core/analysis/WeightRefit.js`: Bradley–Terry / logistic fit over vote pairs
  using the per-component score breakdowns as features; outputs a fitted weight vector +
  goodness summary. Unit-tested on synthetic votes with known ground-truth weights.
- Surface: Explore scoring section gains "Refit from my votes (N)" — shows before/after weights
  side by side and emits an **`exploreScoring` custom preset** (per roadmap #7: `SCORE_CONFIG`
  is never touched silently; applying the refit preset is an explicit user action, reversible by
  reselecting a stock preset).
- Guardrails: refuse refit below a minimum vote count (e.g. 50); label the preset "Personal
  (fit from N votes, YYYY-MM-DD)".

**Acceptance:** votes persist across reloads; refit on synthetic fixture recovers planted
weights within tolerance; stock presets byte-identical before/after (scoring invariants from the
explore arc hold); the deck never shows the same unordered pair twice in a session.

---

## C — The Codex: discovery as collection *(C3 · I3)*

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

## D — Daily Hex: the deterministic daily *(C3 · I4)*

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

## Data & privacy note

Everything banks locally (localStorage via PersistenceService). Nothing leaves the device unless
the user explicitly copies a share link or exports a pack — consistent with the existing
community-pack posture (export is user-initiated JSON).

## Cross-feature dependencies

- T before C (codex cell detail reuses the tag picker/suggestions) and before S only weakly
  (deck cards show tag chips — cosmetic).
- S is independent of mobile restructure M1 but its mobile deck *homes* in the Discover tab —
  ship the desktop rater first if S lands before M1.
- C and D both want M1's homes (Library / Discover) to exist; D also benefits from C+S being
  live (a daily player flows into judging and cataloguing).
