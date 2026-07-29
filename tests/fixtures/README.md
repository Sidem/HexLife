# Auto-explore evaluation fixtures

Two captured datasets live here, both regenerated in-browser and **never hand-edited**:

| File | What it pins | Test |
|------|--------------|------|
| `exploreEvalFixtures.json` | the gliders-vs-churn ordering (2 rulesets × ICs) | `tests/interestingnessScore.test.js` |
| `interestingnessBenchmark.json` | public-library alignment over 80 labeled entries (#37) | `tests/interestingnessBenchmark.test.js` |

## Reference fixtures (`exploreEvalFixtures.json`)

`exploreEvalFixtures.json` holds real `EVALUATION_RESULT` objects for the two reference rulesets
from the project's reference-fixture recipe, captured headless. They pin the score's ordering
behaviour to **measured** engine metrics (including the v3.4 change-localization field) rather than guessed
numbers — `tests/interestingnessScore.test.js` asserts gliders-chaos out-ranks churn-sparse.

**Regenerate, never hand-edit.** Resets are seeded so the run is reproducible on the same grid
config (default `GRID_COLS`/`GRID_ROWS`). If you change the grid size or the engine metrics,
regenerate the whole file.

## Capture procedure

1. `npm run dev -- --port 5180`, then open
   `http://localhost:5180/HexLife/?headless=1&benchmark=1`.
2. Click **Capture 5 reference fixtures**. The dev-only runner captures all five cases in parallel.
3. Click **Download JSON** and replace `tests/fixtures/exploreEvalFixtures.json`.

## Notes on the captured numbers

- `churn_sparse_600` stops at tick ~216 because the worker detects the **period-84 cycle** there
  (`cycle.detected:true, period:84`) — this is the long-horizon trap v2's confirmation burst must catch.
- `gliders_seed_160` saturates within 2 ticks (`saturated:true`) — a hard kill, as expected.
- `gliders_chaos_160` shows the structure the v2 spatial term rewards: `spatialOrder.mean ≈ 0.23`
  vs churn's `≈ -0.02` (random mixing), and `spatialVariance ≈ 0.16` vs `≈ 0.10`.
- Stage 2 change localization is `≈0.412` for gliders-chaos vs `≈0.142` for churn-sparse. Their
  geometric mean (`≈0.242`) calibrates `changeOrderHalfSat`; the scored gap is now `≈0.431`.

---

# Public-library alignment benchmark (`interestingnessBenchmark.json`)

The instrument for roadmap **#37** (`docs/INTERESTINGNESS-PLAN.md`). Two fixture rulesets can show
gliders out-ranking churn; they cannot say whether the objective agrees with the project's curated
public library in general. This panel measures `pairwiseAccuracy` (fraction of
interesting-vs-boring pairs the scorer orders correctly) and `marginMean` over labeled entries.
`tests/interestingnessBenchmark.test.js` pins both at their captured values.

**Stage-2 baseline (2026-07-29, score v3.4): `pairwiseAccuracy` 0.444 (227/511),
`marginMean` −0.056; the 160-tick screen is 0.294 (150/511).** Before Stage 2 the same complete
panel measured 0.431 (220/511), −0.070, and 0.258. The original 16-positive Stage-0 slice remains
marked and improves from 0.509 (57/112) to 0.518 (58/112).

## The panel (80 entries)

| Class | Interesting | Boring |
|-------|-------------|--------|
| `free` (no rotational symmetry) | 16 | 4 |
| `r_sym` (rotationally symmetric) | 50 | 3 |
| `n_count` (outer-totalistic) | 6 | 0 |
| `totalistic` | 1 | 0 |

- **Positives** are all 73 curated public-library entries (`src/core/library/rulesets.json`). Public
  inclusion is the project's manual interestingness label; it is not a blinded or multi-rater human
  study. Every entry carries the library's `{hex, seed, initialState}`, including saved starts, so
  the capture is deterministic. An integrity test requires a one-to-one, index-preserving match:
  adding or reordering the library forces an explicit benchmark refresh.
- **Negatives** are the `churn` reference fixture plus six *high-scoring auto-explore finds* that are
  visually uniform static — the exact failure #37 exists to fix. They were produced by running
  auto-explore headless from a random seed ruleset (once in `single`/free mutation mode, once in
  `r_sym`), then eyeballing every candidate's state field before enshrining it. Reproduce any of
  them from the `hex` + `seed` + `initialState` in the JSON to re-verify by eye.
- **Why the class stratification matters:** symmetric rulesets have far better odds of being
  interesting, so an unstratified panel would let a scorer (or Stage 4's reward model) look good by
  learning "symmetric = good" instead of reading the dynamics. Hence `r_sym` *negatives* exist, and
  the test reports within-class accuracy (`free` 0.531, `r_sym` 0.367) next to the overall
  number. The library is itself heavily `r_sym`, so the overall number describes the real curated
  catalog distribution rather than a class-balanced research sample.
  Gap: the library has no boring `n_count`/`totalistic` rules, so those classes are positives-only.
- **Longitudinal slice:** the original 16 positives and all seven negatives carry
  `cohort: "stage0"`. Tests pin its current overall, screen, and within-class measurements
  independently of the expanded baseline, while this document records the pre-Stage-2 comparison.
- Each entry carries its `constraintClass` from `classifyRulesetConstraint()` (strictest of
  `totalistic ⊂ n_count ⊂ r_sym ⊂ free`); the test recomputes it from the hex as a hand-edit guard.

## Capture procedure

Same settings as the reference fixtures (`warmupTicks:20, sampleEvery:10`, probe on), captured
twice per entry: at the 160-tick **screen** length and at the 600-tick **confirm** length — the
long horizon is where boring rules give themselves away. Embeddings are **off** (the benchmark
gates the statistical pipeline; the embedding stages get synthetic unit tests instead).

1. `npm run dev -- --port 5180`, then open
   `http://localhost:5180/HexLife/?headless=1&benchmark=1`.
   `?headless=1` forces `fromUrl:true` and overwrites the `worldSettings` localStorage — capture in
   a throwaway browser profile, not your daily one.
2. Click **Capture 73 library entries + controls**. The dev-only runner uses all nine workers in
   parallel and rebuilds every screen/confirm metric from the current library plus the negative
   recipes in the existing fixture.
3. Click **Download JSON** and replace `tests/fixtures/interestingnessBenchmark.json`.
4. Run `npx vitest run tests/interestingnessBenchmark.test.js`. If the captured measurements moved,
   update the expanded `BASELINE_*` constants. The `STAGE0_*` constants should move only when scoring
   or engine behavior changes, never merely because the library grew. Record why in `PATCHNOTES.md`.
   `BENCH_TABLE=1` prints the complete per-entry ranking for diagnosis.

## Finding more negatives

The panel's negatives came from this loop — repeat it when a stage needs harder ones:

1. Set a random ruleset on every world
   (`EventBus.dispatch(EVENTS.COMMAND_SET_RULESET, { hexString, scope: 'all', resetOnNewRule: true })`
   — going through the command keeps the proxy stats fresh, which `start()` reads to seed the search).
2. `wm.autoExploreService.start({ maxGenerations: 12, mutationMode: 'single' | 'r_sym' })`, wait for
   `isRunning()` to clear (~40 s for 10 generations), then read `getGalleryEntries()`.
3. Replay each candidate (`_applyExploreRuleset` → `resetWorld(initialState, seed)` →
   `runEvaluation({ ticks: 600, … })`) and **look at the field** before labelling it. Reading
   `worlds[0].latestStateArray` as a coarse density map (blocks of 3×6 cells → shade characters)
   separates the two archetypes instantly: a boring find is uniform grain everywhere, an interesting
   one has discrete objects, voids and edges.

## Notes on the captured numbers

- Several genuine positives settle into long cycles by tick 600 and are cut to ×0.25 by
  `confirmCyclePenalty` — human-interesting rules are often long cyclers. `neg_churn_sparse` is
  likewise rejected by the cycle penalty, while change localization improves separation from the
  six non-cycling negative controls.
- The cheap 160-tick screen improves from 0.258 to 0.294 but remains weak, which is why finds are
  re-scored on the confirmation burst before banking.
