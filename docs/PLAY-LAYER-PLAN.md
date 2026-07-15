# HexLife Explorer — Play Layer Plan

Gamification that **produces data**: every mechanic doubles as feedback (tags → catalog, votes →
scoring refit, codex → coverage, daily → shared benchmarks, predictions → calibration). Opt-in
presentation over the instrument — no lab tool gated behind progression, no XP, no streak guilt.
Local only (`PersistenceService`); nothing leaves the device unless the user shares/exports.

**Shipped (see PATCHNOTES):** tags (#13) + swipe-to-judge desktop (#14).  
**Open:** Codex (#15) → Daily (#17) → retention P1–P6 (#19–#24). UX audit (#18) shapes surface placement.

**Reusable seams:** `tags.js` / `tagSuggestions.js`; `VoteBank` / `WeightRefit` / `ExploreRaterView`.  
**Still open from S:** mobile versus-deck home in Discover (folds into P1).

---

## C — Codex *(C3 · I3 — #15, after #18)*

Personal field journal over behavior space. Overlay on `BehaviorArchive` statistical cells
(`ratio|entropy|σ` — **not** embedding `e:` keys).

### C1 — CodexService

- `CodexService.js`: key = statistical cellKey; value
  `{ firstSeen, count, best: { hex, name, score, thumb? }, rarityAtDiscovery }`.
- Persist `CODEX_PROGRESS`. Feed from confirmed explore finds + library saves with metrics. Never evict.
- Rarity tiers from novelty at discovery (honest “how novel when found”).
- Tests: insert / first-discovery / no-evict / rarity.

### C2 — UI

- 10×10 ratio×entropy grid (σ as layers); filled = best thumb + mnemonic; empty = `?`.
- Header progress; cell detail → load / save with tag suggestions.
- Desktop: Library tab. Mobile: Library section top. First-discovery toast (Settings-gated).
- `window.__hexlife.codexDebug` for headless.

**Acceptance:** short explore fills ≥1 cell headlessly; survives reload; load replays behavior
(deterministic seed + IC, same invariant as library “Load + IC”).

---

## D — Daily Hex *(C3 · I4 — #17)*

Wordle-shaped daily, **zero backend**: date = seed, determinism = referee, share link = proof.

### D1 — Generator (pure)

`DailyChallenge.js` → `challengeFor(dateKey)`: FNV-1a date → PRNG → base ruleset + IC + objective
template (survival band / exact lifespan / ignition / stabilize). Bit and/or cell budgets via
`hammingDistanceHex`. Same date ⇒ byte-identical everywhere. Unit-test determinism + eval helpers.

### D2 — Runner

`DailyChallengeService`: world 4, seeds via `_getResetSeed`, watches stats, success/fail. Mode on
existing grid (banner + exit), not a new world stack.

### D3 — Result + share

Emoji status grid + edits vs par + ShareCodec snapshot that **replays the solution**. Persist
`DAILY_RESULTS`. Streaks display-only, never gate.

### D4 — Surfaces

Mobile: Discover hero + tab badge. Desktop: Explore area + command palette.

**Acceptance:** fixed date identical across boots; scripted solve → share replays; no network.

---

## P — Retention follow-ups (#19–#24)

### P1 — Prediction mode *(#19)*

Static first frame → predict extinct / stable / cycling / explosive → reveal. Builds mobile deck
(S still owes). Labels → `PREDICTION_RESULTS`.

### P2 — Challenge-a-friend *(#20)*

Mint challenge from any world (ShareCodec extension); reuses D runner. Viral multiplier on Daily.

### P3 — Weekly Expedition *(#21)*

Date-seeded Codex niche or CLIP prompt; hunt via explore/breed/edit. Needs C.

### P4 — Ruleset lineage *(#22)*

Parentage on breed/mutate/clone in library metadata; family tree on cards. Prefer after #3 orchestrator.

### P5 — Field Notes *(#23)*

Quiet journal of genuine firsts (not badges). `FIELD_NOTES`. Needs C rarity tiers.

### P6 — PWA + daily badge *(#24)*

Manifest + SW (mind `/HexLife/` base + wasm precache versioning). No push. Needs D badge.

## Dependencies

- C before P3, P5. D before P2, P6 badge. P1 = shared mobile deck with S. P4 wants #3.
- Read #18 verdict before placing P surfaces.
