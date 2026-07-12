# Stage 2 — Decouple the Auto-Explore population from the 9 rendered worlds

*(Plan written 2026-07-12 from a code-grounded review. Roadmap item #1, C3·I4. Prerequisite for
Stage 3 (prompt-guided target search, `docs/EXPLORE-STAGE3-PROMPT-SEARCH-PLAN.md`). One session's
work; do NOT start Stage 3 in the same session.)*

## Problem

`AutoExploreService._runGeneration` evaluates exactly `this.wm.worlds.length` (= 9) candidates per
generation because the population *is* the visible 3×3 grid. 9 candidates/generation is one to two
orders of magnitude below what evolutionary/QD search normally uses; convergence is search-starved.

## Goal

`EXPLORE_CONFIG.populationSize` (default **9** → byte-identical to today). When larger, candidates
are evaluated on the existing 9 workers via a **per-worker queue** (candidate `c` runs on world
`c % 9`; each world works through its queue sequentially; all 9 worlds run concurrently; **no
cross-batch barrier** — a fast world starts its next candidate while a slow one is mid-confirm).
The minimap shows a rolling subset (each world displays whichever candidate it is currently
evaluating). No engine or worker changes are needed — each evaluation already owns its worker for
the duration of its bursts.

## Current code anatomy (all in `src/core/AutoExploreService.js`, ~48 KB)

| What | Where | Notes |
|---|---|---|
| `EXPLORE_CONFIG` | ~L121 | add `populationSize: 9` here |
| `_runGeneration(token)` | ~L483 | builds population, applies rulesets up front, `Promise.all` over `_screenAndConfirm(idx, hex, token)` with `idx` = world index; builds `perWorldScores[idx]`; ranks; picks champion + runner-up |
| `_buildPopulation(championHex, numWorlds, selectedIdx)` | ~L738 | champion at `selectedIdx`; other slots in ascending index order get crossover children first (`numChildren = min(crossoverChildren, others)`) then mutants; **one shared mulberry32 rng** seeded `(this._exploreBaseSeed + this.generation * 7919) >>> 0` — the *consumption order* of this rng is part of replay determinism |
| `_screenAndConfirm(worldIndex, hex, token)` | ~L587 | screen over IC suite → maybe confirm burst on the SAME world → maybe `_captureEmbedding` → maybe thumbnail. Fully self-contained per candidate; already safe to run as a queue item |
| `_evaluateCandidate(worldIndex, hex, token)` | ~L782 | loops the IC suite; calls `_seedFor(worldIndex, i)`; `proxy.resetWorld(ic.initialState, seed)` + `proxy.runEvaluation(...)` |
| `_seedFor(worldIndex, icIndex)` | ~L805 | `base + gen*9973 + worldIndex*97 + icIndex` — **must be re-keyed to candidateIndex** |
| `start(options)` | ~L261 | builds `_searchDescriptor.config` (persisted + shared via the `xc` blob) — `populationSize` must join it |

UI threading: `src/ui/components/ExploreComponent.js` collects the run options passed to
`start(options)` (same path `scoring`/`findThreshold` took in v3.1). Share links:
`src/services/ShareCodec.js` `encodeSearch`/`parseParams` carry the config as the opaque `xc` JSON
blob; `ExploreComponent._consumeSharedSearch()` sanitizes inbound values. Minimap badges:
`src/ui/MinimapOverlays.js` consumes `perWorldScores` from the `EXPLORE_PROGRESS` payload.

## Implementation order

### Step 0 — Characterization (golden) test FIRST, against the current code

Before touching anything, write `tests/autoExploreDeterminism.test.js` that pins today's exact
trajectory, so the refactor has a byte-identity oracle:

- Construct `AutoExploreService` with a **fake WorldManager**: 9 fake proxies whose
  `resetWorld(ic, seed)` records the seed and whose `runEvaluation(opts)` resolves synthetic
  metrics **deterministically derived from (currently-applied hex, last reset seed)** — e.g. hash
  hex+seed to vary `finalRatio`/`blockEntropy.mean`/`sigma`/`changed` so scores differ and champion
  selection is actually exercised. The fake wm needs: `worlds` (the proxies), `selectedWorldIndex`
  (use 4), a **real** `RulesetService` (`new RulesetService(Symmetry.precomputeSymmetryGroups())` —
  it's pure), `getCurrentRulesetHex()` (a fixed seed hex), `_applyExploreRuleset(idx, hex)`
  (records which hex ran on which world — the fake `runEvaluation` reads this),
  `_captureAutoExploreSnapshot()` → `{}`, `_setAllWorldsEnabledForExplore()` no-op.
- `vi.mock` `../src/services/PersistenceService.js` (vitest runs in node; `start()` calls
  `saveUISetting`). EventBus dispatches are harmless (plain module) but you may spy on
  `EXPLORE_PROGRESS` to await generation boundaries.
- Run `start({ baseSeed: 123456, maxGenerations: 3, mutationMode: 'r_sym' })`, wait for the stop
  (subscribe to the progress/stop path or poll `isRunning()` with resolved microtasks — the fake
  evals resolve immediately so the loop completes in a few event-loop turns).
- **Pin as inline golden values:** per generation, the full population hex array, every
  `(worldIndex, icIndex) → seed` passed to `resetWorld`, and the champion hex sequence. Get the
  values by running the test once with `console.log` and hard-coding the output.
- This test must pass UNCHANGED (with `populationSize: 9` defaulted) after every step below.

### Step 1 — Re-key `_seedFor` to candidate index

`_seedFor(candidateIndex, icIndex)` — same formula, same multipliers. For `populationSize: 9`,
candidate index == world index in the (single) batch, so seeds are unchanged.
**Collision analysis (verified):** collisions of `gen*9973 + c*97 + i` across triples require
`Δc ≈ 2776` at `Δg = 27` (since `9973 mod 97 = 79` and `|Δi| ≤ 6` can never bridge the residue for
smaller `Δg`), so any `populationSize ≤ 1024` is collision-free. Add a brute-force uniqueness unit
test: all `(gen ≤ 50, candidate < 144, ic < 7)` seeds distinct for a fixed base.

### Step 2 — Generalize `_buildPopulation`

Signature → `_buildPopulation(championHex, populationSize, selectedIdx)`. Keep the algorithm and
**rng consumption order identical**: champion at `selectedIdx` (guaranteed < 9 ≤ populationSize),
remaining candidate indices ascending, children first then mutants. For `populationSize: 9` the
produced array must be byte-identical (the golden test proves it).

### Step 3 — Per-worker queues in `_runGeneration`

Replace the `population.map(...)` + upfront `forEach(_applyExploreRuleset)` with:

```js
const results = new Array(population.length).fill(null);
const numWorlds = this.wm.worlds.length;
const workerLoops = [];
for (let w = 0; w < numWorlds; w++) {
    workerLoops.push((async () => {
        for (let c = w; c < population.length; c += numWorlds) {
            if (token !== this._runToken) return;
            this.wm._applyExploreRuleset(w, population[c]);   // rolling minimap display
            results[c] = await this._screenAndConfirm(w, population[c], token, c);
        }
    })());
}
await Promise.all(workerLoops);
```

- `_screenAndConfirm` gains a `candidateIndex` param, threaded into `_evaluateCandidate` →
  `_seedFor(candidateIndex, icIndex)`. The *world* index still selects the proxy.
- For `populationSize: 9` each loop body runs exactly once with `c === w` and the ruleset is
  applied immediately before evaluation instead of in an upfront batch — sim results are
  unaffected (the ruleset is set before every reset+burst); the golden test confirms.
- The post-eval ranking block iterates `results` (candidate-indexed) exactly as today.

### Step 4 — Badge mapping becomes per-slot

Keep the `EXPLORE_PROGRESS` payload field name `perWorldScores` (MinimapOverlays consumes it) but
document it as **per-displayed-slot**: `perWorldScores[c % 9]` is overwritten as candidates finish,
so at generation end it shows each slot's *last* candidate. Optional (nice-to-have, not
acceptance): dispatch an intermediate `_progressPayload('batch', …)` when each candidate completes
so badges update mid-generation.

### Step 5 — Config, UI, share links, persistence

- `EXPLORE_CONFIG.populationSize: 9` with a doc comment (clamp: integer, 9–144).
- `ExploreComponent`: a stepper/select ("Population" — 9/18/27/36/54/72/108/144, or a stepper in
  multiples of 9; multiples of 9 keep the queues balanced but any int works) next to the existing
  mutation-rate control; persist as UI setting `explorePopulationSize`; thread into `start` options.
- `_searchDescriptor.config.populationSize` (population changes the trajectory ⇒ replays need it);
  omit when 9 to keep old links short/valid, mirroring how `scoring` is omitted when default.
- `_consumeSharedSearch`: sanitize inbound (`Number.isInteger`, clamp [9, 144], else drop).
- **NB:** old share links (no `populationSize`) must replay byte-identically — defaulting to 9
  plus the golden test guarantees this. State this in the PATCHNOTES entry.

### Step 6 — Fold-in: DEV-only EventBus name guard (roadmap #7, cheap half)

While in here (this stage touches lots of dispatch call sites): in `src/services/EventBus.js`,
build a lazy `Set` of `Object.values(EVENTS)` and, gated behind `import.meta.env.DEV` (same gate
as the existing event-logging), `console.warn` from `dispatch`/`subscribe` when the name isn't a
registered value. Unit test: warns on a misspelled name, silent on a valid one. Do NOT attempt the
WorldManager god-object split in this session.

## Acceptance criteria

1. Golden characterization test green before and after — `populationSize: 9` is byte-identical
   (same populations, same seeds, same champions on a fixed `baseSeed`).
2. Seed-uniqueness brute-force test green (gen ≤ 50 × candidate < 144 × ic < 7).
3. With `populationSize: 36` in the fake-wm test: 36 candidates evaluated per generation, each
   candidate's seeds keyed by candidate index, per-slot badge array stays length 9.
4. Headless E2E (`?headless=1`, `window.__hexlife`): run a real 2-generation search at
   `populationSize: 27`; main thread stays responsive; gallery banks finds; stop-restore intact;
   share link round-trips `populationSize` and a replay with the same link reproduces the champion
   sequence (compare via `getSearchDescriptor()` + gallery hexes).
5. EventBus guard test green. Full `npm run lint` + `npm run test:run` + typecheck at the end
   (lint LAST, after the final edit — see CLAUDE.md gotcha).
6. PATCHNOTES.md entry + ROADMAP.md item checked off + short auto-memory handoff pointer.

## Known traps

- **Replay determinism is sacred.** Both rng consumers must be preserved exactly: the
  per-generation mulberry32 in `_buildPopulation` (derivation `(base + gen*7919) >>> 0` and its
  consumption order) and `_seedFor`. Any change breaks shared search links — the golden test is
  the tripwire.
- `_screenAndConfirm` already tolerates concurrent per-world use (v2.4 design: "NO cross-world
  barrier") — don't add one. The only new concurrency is sequential reuse of a world within a
  generation, which the confirm-on-same-world flow already handles.
- `retestFind` and Explore stop/restore (`_snapshot`) are world-based, not candidate-based —
  unaffected; don't touch. Remember the CLAUDE.md gotcha: stop-restore must not call
  `dispatchSelectedWorldUpdates`.
- Pause (`pause()`) suspends at the generation boundary in `_runLoop` — keep it there; do not try
  to pause mid-queue.
- `this.options.confirmTicks = Math.max(confirmTicks, evalTicks)` in `start()` — leave intact.
