# Auto-explore evaluation fixtures

Two captured datasets live here, both regenerated in-browser and **never hand-edited**:

| File | What it pins | Test |
|------|--------------|------|
| `exploreEvalFixtures.json` | the gliders-vs-churn ordering (2 rulesets × ICs) | `tests/interestingnessScore.test.js` |
| `interestingnessBenchmark.json` | human-alignment baseline over a 23-ruleset labeled panel (#37 Stage 0) | `tests/interestingnessBenchmark.test.js` |

## Reference fixtures (`exploreEvalFixtures.json`)

`exploreEvalFixtures.json` holds real `EVALUATION_RESULT` objects for the two reference rulesets
from CLAUDE.md's "Reference fixtures" note, captured headless. They pin the v2 score's ordering
behaviour to **measured** engine metrics (including the v2.1 spatial fields) rather than guessed
numbers — `tests/interestingnessScore.test.js` asserts gliders-chaos out-ranks churn-sparse.

**Regenerate, never hand-edit.** Resets are seeded so the run is reproducible on the same grid
config (default `GRID_COLS`/`GRID_ROWS`). If you change the grid size or the engine metrics, re-run
the snippet below and overwrite the file.

## Capture procedure

1. `npm run dev`, open `http://localhost:5173/HexLife/?headless=1` (exposes `window.__hexlife`).
2. In the devtools console (or the preview `preview_eval` tool) run:

```js
await (async () => {
  const wm = window.__hexlife.worldManager;
  const ICS = {
    chaos: { mode: 'density', params: { density: 0.5 } },
    sparse: { mode: 'density', params: { density: 0.05 } },
    seed: { mode: 'cluster', params: { count: 1, density: 1.0, densityVariation: 0, diameter: 14, diameterVariation: 0, eccentricity: 0, orientation: 0, orientationVariation: 0, gaussianStdDev: 1.5 } },
  };
  const capture = async (hex, icLabel, seed, ticks) => {
    const proxy = wm.worlds[0];
    wm._applyExploreRuleset(0, hex);
    proxy.resetWorld(ICS[icLabel], seed);
    const r = await proxy.runEvaluation({ ticks, sampleEvery: 10, warmupTicks: 20, probe: { enabled: true, probeTicks: 64 } });
    const { probeHamming, ruleUsageDelta, ...rest } = r;
    if (rest.blockEntropy?.samples) { rest.blockEntropy = { ...rest.blockEntropy }; delete rest.blockEntropy.samples; }
    rest.ruleUsageDelta = Array.from(new Uint32Array(ruleUsageDelta));
    return rest;
  };
  const CHURN = '4CAC74B122612B1EEBE3FFFDDCFBFFB7';
  const GLIDERS = '12482080480080006880800180010117';
  return {
    churn_sparse_160:  await capture(CHURN,   'sparse', 1781242654715, 160),
    churn_sparse_600:  await capture(CHURN,   'sparse', 1781242654715, 600),
    gliders_chaos_160: await capture(GLIDERS, 'chaos',  4242,           160),
    gliders_sparse_160:await capture(GLIDERS, 'sparse', 4242,           160),
    gliders_seed_160:  await capture(GLIDERS, 'seed',   4242,           160),
  };
})();
```

3. Copy the returned object into `exploreEvalFixtures.json` (keep the `_meta` block).

## Notes on the captured numbers

- `churn_sparse_600` stops at tick ~216 because the worker detects the **period-84 cycle** there
  (`cycle.detected:true, period:84`) — this is the long-horizon trap v2's confirmation burst must catch.
- `gliders_seed_160` saturates within 2 ticks (`saturated:true`) — a hard kill, as expected.
- `gliders_chaos_160` shows the structure the v2 spatial term rewards: `spatialOrder.mean ≈ 0.23`
  vs churn's `≈ -0.02` (random mixing), and `spatialVariance ≈ 0.16` vs `≈ 0.10`.
- These four predate the v2.9 `transport` metric, so they carry no `transport` field (the score
  drops-and-renormalizes it). `interestingnessBenchmark.json` was captured after and does carry it.

---

# Human-alignment benchmark (`interestingnessBenchmark.json`)

The instrument for roadmap **#37** (`docs/INTERESTINGNESS-PLAN.md`, Stage 0). Two fixture rulesets
can show gliders out-ranking churn; they cannot say whether the objective agrees with a human in
general. This panel can: it measures `pairwiseAccuracy` (fraction of interesting-vs-boring pairs the
scorer orders correctly) and `marginMean` over labeled entries, and
`tests/interestingnessBenchmark.test.js` pins both at the values measured when it was captured.

**Baseline at capture (2026-07-22, score v3.1): `pairwiseAccuracy` 0.509 (57/112), `marginMean`
−0.001.** A coin flip — that is the point. Stage 0 buys the needle, not the fix.

## The panel (23 entries)

| Class | Interesting | Boring |
|-------|-------------|--------|
| `free` (no rotational symmetry) | 6 | 4 |
| `r_sym` (rotationally symmetric) | 6 | 3 |
| `n_count` (outer-totalistic) | 3 | 0 |
| `totalistic` | 1 | 0 |

- **Positives** are curated public-library entries (`src/core/library/rulesets.json`) — human-picked
  by definition — one per distinct named behaviour family, stratified across constraint classes.
  Each carries the library's own `{hex, seed, initialState}`, so the capture is deterministic.
  `lib09_spontaneous_gliders` is the same ruleset as the `gliders` reference fixture.
- **Negatives** are the `churn` reference fixture plus six *high-scoring auto-explore finds* that are
  visually uniform static — the exact failure #37 exists to fix. They were produced by running
  auto-explore headless from a random seed ruleset (once in `single`/free mutation mode, once in
  `r_sym`), then eyeballing every candidate's state field before enshrining it. Reproduce any of
  them from the `hex` + `seed` + `initialState` in the JSON to re-verify by eye.
- **Why the class stratification matters:** symmetric rulesets have far better odds of being
  interesting, so an unstratified panel would let a scorer (or Stage 4's reward model) look good by
  learning "symmetric = good" instead of reading the dynamics. Hence `r_sym` *negatives* exist, and
  the test reports within-class accuracy (`free` 0.583, `r_sym` 0.389) next to the overall number.
  Gap: the library has no boring `n_count`/`totalistic` rules, so those classes are positives-only.
- Each entry carries its `constraintClass` (roadmap #38's classifier: strictest of
  `totalistic ⊂ n_count ⊂ r_sym ⊂ free`); the test recomputes it from the hex as a hand-edit guard.

## Capture procedure

Same settings as the reference fixtures (`warmupTicks:20, sampleEvery:10`, probe on), captured
twice per entry: at the 160-tick **screen** length and at the 600-tick **confirm** length — the
long horizon is where boring rules give themselves away. Embeddings are **off** (the benchmark
gates the statistical pipeline; the embedding stages get synthetic unit tests instead).

1. `npm run dev`, open `http://localhost:5180/HexLife/?headless=1` (exposes `window.__hexlife`).
   `?headless=1` forces `fromUrl:true` and overwrites the `worldSettings` localStorage — capture in
   a throwaway browser profile, not your daily one.
2. Run the snippet below in the devtools console. It rebuilds the whole file, `_meta` included.
   Editing the panel = editing `POS_LIB` / `NEG` here, not the JSON.
3. Save the returned object as `interestingnessBenchmark.json` (`JSON.stringify(out, null, 1)`).
4. Re-run `npx vitest run tests/interestingnessBenchmark.test.js`. If the baselines moved, update the
   `BASELINE_*` constants **and** the committed per-entry table in that file, and say why in
   `PATCHNOTES.md` — a moved baseline is a scoring-behaviour change, not fixture churn.
   `BENCH_TABLE=1` on the vitest run prints the fresh table to paste in.

```js
await (async () => {
  const wm = window.__hexlife.worldManager;
  const { describeRuleset } = await import('/HexLife/src/core/rulesetDescriptor.js');
  const lib = await (await fetch('/HexLife/src/core/library/rulesets.json')).json();

  // Roadmap #38's strictest-class check, inlined (mirrors tests/interestingnessBenchmark.test.js).
  const constraintClass = (hex) => {
    const d = describeRuleset(hex);
    if (!d) return 'invalid';
    if (d.type === 'raw') return 'free';
    if (d.type === 'r-sym') return 'r_sym';
    const b = new Set(d.birth.map(Number)); const s = new Set(d.survival.map(Number));
    for (let k = 1; k <= 6; k++) if (b.has(k) !== s.has(k - 1)) return 'n_count';
    return 'totalistic';
  };

  // Positives: curated-library indices. Negatives: hex + IC + seed, verified by eye (see above).
  const POS_LIB = [2, 3, 15, 23, 25, 34, 8, 9, 10, 14, 27, 29, 11, 13, 19, 20];
  const NEG = [ /* copy the `id`/`note`/`source`/`hex`/`icLabel`/`seed`/`initialState` blocks
                   straight out of the current interestingnessBenchmark.json entries */ ];

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  const panel = [
    ...POS_LIB.map((i) => ({
      id: `lib${String(i).padStart(2, '0')}_${slug(lib[i].name)}`,
      label: 'interesting', source: `library:${i}`, note: lib[i].name,
      hex: lib[i].hex, icLabel: `library:${lib[i].initialState.mode}`, seed: lib[i].seed,
      initialState: lib[i].initialState,
    })),
    ...NEG.map((n) => ({ ...n, label: 'boring' })),
  ];

  const capture = async (e, ticks) => {
    const proxy = wm.worlds[0];
    wm._applyExploreRuleset(0, e.hex);
    proxy.resetWorld(e.initialState, e.seed);
    const r = await proxy.runEvaluation({ ticks, sampleEvery: 10, warmupTicks: 20, probe: { enabled: true, probeTicks: 64 } });
    const { probeHamming, ruleUsageDelta, worldIndex, type, ...rest } = r;
    if (rest.blockEntropy?.samples) { rest.blockEntropy = { ...rest.blockEntropy }; delete rest.blockEntropy.samples; }
    rest.ruleUsageDelta = Array.from(new Uint32Array(ruleUsageDelta));
    rest.icLabel = e.icLabel;
    return rest;
  };

  const entries = [];
  for (const e of panel) {
    const metrics = await capture(e, 160);
    const confirmMetrics = await capture(e, 600);
    entries.push({ ...e, constraintClass: constraintClass(e.hex), metrics, confirmMetrics });
  }
  return {
    _meta: {
      description: 'Human-labeled interestingness benchmark panel (#37 Stage 0). Real EVALUATION_RESULT captures for a curated set of human-interesting rulesets and hand-verified boring ones. Regenerated by the snippet in README.md - never hand-edit.',
      capture: { warmupTicks: 20, sampleEvery: 10, probeTicks: 64, screenTicks: 160, confirmTicks: 600, embeddings: 'off', gridCols: 222, gridRows: 192 },
      capturedAt: '2026-07-22',
      counts: { total: entries.length, interesting: entries.filter((x) => x.label === 'interesting').length, boring: entries.filter((x) => x.label === 'boring').length },
      byClass: entries.reduce((acc, x) => { const k = `${x.constraintClass}/${x.label}`; acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
    },
    entries,
  };
})();
```

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

- Three genuine positives (`lib11`/`lib13` Game-of-life-like, `lib08` Oscillators 2) settle into long
  cycles by tick 600 and are cut to ×0.25 by `confirmCyclePenalty` — human-interesting rules are
  often long cyclers. `neg_churn_sparse` is likewise rejected by the *cycle* penalty, not by any
  structure term: no term in v3.1 decisively separates the other six negatives from the positives.
- The cheap 160-tick screen ranks the panel at 0.348 — **worse than chance** — which is why finds are
  re-scored on the confirmation burst before banking.
