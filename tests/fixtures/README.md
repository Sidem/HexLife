# Auto-explore evaluation fixtures

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
