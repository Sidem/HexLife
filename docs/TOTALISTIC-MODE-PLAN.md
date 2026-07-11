# Implementation plan — "Totalistic" ruleset constraint mode

**Goal:** add a *plain totalistic* mode beside the existing `n_count` / `r_sym` constraint modes in
every place a constraint mode can be chosen: ruleset **generation**, **mutation**, and **breeding
(crossover)**, including the Auto-Explore mutation-mode switch. Binary states and radius-1
neighborhood stay exactly as they are. This is purely a new *projection* inside the existing
128-entry rule space — **no change** to the engine (`hexlife-wasm`), workers, serialization
(32-char hex), save format, share links, rendering, or library.

---

## 1. Canonical terminology (use these names EVERYWHERE — no variations)

| Concept | Canonical name | Rules |
|---|---|---|
| Mode value string | `'totalistic'` | The string used in mode switches, persisted settings, event payloads, and `RulesetService` branches. Follows the full-word precedent of `'random'`, `'single'`, `'uniform'` (do NOT abbreviate to `t_sum`, `t_count`, etc.). |
| UI label | `Totalistic` | The visible text in every switch/select. Same label in the Generate pane, Mutate pane, Breed pane, and Explore pane. |
| The bucket key | **totalistic sum** | `sum = centerState + countSetBits(neighborMask)`, an integer in `[0, 7]`. In code, name the loop variable `sum`. In comments/JSDoc, write "totalistic sum". |
| Bucket | **totalistic-sum bucket** | The set of all rule indices `(cs << 6) | mask` with `cs + countSetBits(mask) === sum`. There are exactly **8** buckets. |
| Helper | `getEffectiveRuleForTotalisticSum` | Static method on `RulesetService`, mirroring `getEffectiveRuleForNeighborCount`. |

Definition to put in the `RulesetService` JSDoc (once, on `generateRandomRulesetHex`, and referenced
from the other two): *"`totalistic`: one output per totalistic sum (centerState + active-neighbor
count, 0–7) — the classic plain-totalistic CA constraint. 8 buckets, so the whole space is 2^8 = 256
rulesets; strictly coarser than `n_count` (a totalistic ruleset is an n_count ruleset whose
(cs=1, n) bucket always equals its (cs=0, n+1) bucket)."*

**Uniformity fix rolled into this change:** `getBreedModeConfig()` in
`src/ui/controllers/RulesetActionController.js` currently labels `r_sym` as `'Symmetry'` while the
generate and mutate lists label it `'R-Sym'`. Change the breed label to `'R-Sym'` so all four
surfaces use identical labels.

**Option ordering rule:** in every list, place `Totalistic` **immediately after `N-Count`**
(coarser constraint next to its nearest relative). Do not reorder existing entries.

---

## 2. Semantics (must match the existing `n_count` mode's conventions exactly)

- **Generation** (`generateRandomRulesetHex`): draw **one** rng value per totalistic sum, in
  **ascending sum order** (`sum = 0 … 7`, so exactly 8 draws); output `rng() < bias ? 1 : 0`;
  write that output to every index in the bucket. (Bias applies per *bucket*, exactly like
  `n_count` applies it per neighbor-count bucket — not per rule entry.)
- **Mutation** (`generateMutatedHex`): iterate `sum = 0 … 7`; with probability `mutationRate`
  flip the whole bucket. The new output is seeded from the **reference ruleset's** effective
  output for that sum: `1 - current` if uniform, `Math.round(rng())` if mixed (`2`) — byte-for-byte
  the same pattern as the `n_count` branch. No caller changes needed:
  `WorldManager._generateMutatedHex` (line ~687) already passes the parsed selected-world ruleset
  as `referenceRuleset`, and `AutoExploreService._buildPopulation` (line ~681) already passes one too.
- **Crossover** (`crossoverPoolHexes`): per totalistic sum, draw one parent via the existing
  `pickParent()` and copy its outputs across the whole bucket — mirroring the `n_count` branch.
  (`crossoverHexes` delegates to `crossoverPoolHexes`, so it gets the mode for free.)
- **Rng draw order is part of the contract** (tests inject deterministic rngs): generation = 8
  draws ascending by sum; mutation = 1 gate-draw per sum ascending (+1 extra draw only when the
  reference bucket is mixed); crossover = 1 parent-draw per sum ascending, then the existing
  post-mutation loop.

Edge notes (document in code only if a comment is warranted, no special-casing needed):
sum 0 is reachable only by (cs=0, 0 neighbors) and sum 7 only by (cs=1, 6 neighbors) — the loops
handle this naturally.

---

## 3. File-by-file changes

### 3.1 `src/core/RulesetService.js` (all logic lives here)

1. **`generateRandomRulesetHex(bias, generationMode, rng)`** — add a branch before the final
   `else` (which must remain the `random` fallback):
   ```js
   } else if (generationMode === 'totalistic') {
       for (let sum = 0; sum <= 7; sum++) {
           const out = rng() < bias ? 1 : 0;
           for (let cs = 0; cs <= 1; cs++) {
               for (let m = 0; m < 64; m++) {
                   if (cs + Symmetry.countSetBits(m) === sum) tempRuleset[(cs << 6) | m] = out;
               }
           }
       }
   }
   ```
   Update the JSDoc mode list (currently documents `n_count` / `r_sym` / default) with the
   canonical `totalistic` line from §1.

2. **New static helper** (place next to `getEffectiveRuleForNeighborCount`, same doc style):
   ```js
   /**
    * The effective output shared by every rule entry whose totalistic sum
    * (centerState + active-neighbor count) equals `sum`, or 2 ("mixed") if the
    * outputs disagree or the ruleset is missing/invalid.
    * @param {Uint8Array|null} ruleset
    * @param {number} sum - Totalistic sum in [0, 7].
    * @returns {0|1|2}
    */
   static getEffectiveRuleForTotalisticSum(ruleset, sum) {
       if (!ruleset) return 2;
       let firstOutput = -1;
       for (let cs = 0; cs <= 1; cs++) {
           for (let mask = 0; mask < 64; mask++) {
               if (cs + Symmetry.countSetBits(mask) !== sum) continue;
               const output = ruleset[(cs << 6) | mask];
               if (firstOutput === -1) firstOutput = output;
               else if (firstOutput !== output) return 2;
           }
       }
       return firstOutput === -1 ? 2 : firstOutput;
   }
   ```

3. **`generateMutatedHex(sourceHex, mutationRate, mutationMode, referenceRuleset, rng)`** — add:
   ```js
   } else if (mutationMode === 'totalistic') {
       for (let sum = 0; sum <= 7; sum++) {
           if (rng() < mutationRate) {
               const currentEffectiveOutput = RulesetService.getEffectiveRuleForTotalisticSum(referenceRuleset, sum);
               const newOutput = (currentEffectiveOutput === 2) ? Math.round(rng()) : 1 - currentEffectiveOutput;
               for (let cs = 0; cs <= 1; cs++) {
                   for (let mask = 0; mask < 64; mask++) {
                       if (cs + Symmetry.countSetBits(mask) === sum) rules[(cs << 6) | mask] = newOutput;
                   }
               }
           }
       }
   }
   ```
   Update the JSDoc mode list and the `@param {string} mutationMode` description.

4. **`crossoverPoolHexes(hexes, mode, rng, postMutationRate)`** — add before the final
   `else` (uniform fallback):
   ```js
   } else if (mode === 'totalistic') {
       for (let sum = 0; sum <= 7; sum++) {
           const parent = pickParent();
           for (let cs = 0; cs <= 1; cs++) {
               for (let mask = 0; mask < 64; mask++) {
                   if (cs + Symmetry.countSetBits(mask) === sum) {
                       const idx = (cs << 6) | mask;
                       child[idx] = parent[idx];
                   }
               }
           }
       }
   }
   ```
   Update the JSDoc union on **both** `crossoverHexes` and `crossoverPoolHexes` from
   `'uniform'|'r_sym'|'n_count'` to `'uniform'|'r_sym'|'n_count'|'totalistic'`, and add a
   one-line mode description mirroring the existing `n_count` line.

### 3.2 `src/ui/controllers/RulesetActionController.js`

- `getGenerationConfig()` → `[ Random, N-Count, Totalistic, R-Sym ]`:
  add `{ value: 'totalistic', text: 'Totalistic' }` immediately after the `n_count` entry.
- `getMutationModeConfig()` → `[ Single, R-Sym, N-Count, Totalistic ]`: same insertion rule.
- `getBreedModeConfig()` → `[ Uniform, R-Sym, N-Count, Totalistic ]`: same insertion rule, **and**
  change the existing `r_sym` entry's text from `'Symmetry'` to `'R-Sym'` (§1 uniformity fix).
- No changes to the getters/setters: the persisted settings (`rulesetGenerationMode`,
  `mutateMode`, `breedMode`) store the raw value string, so `'totalistic'` persists with zero
  migration.

### 3.3 `src/ui/components/ExploreComponent.js`

- In the Mutation Mode `SwitchComponent` (`#explore-mutation-mode-mount`, ~line 161), add
  `{ value: 'totalistic', text: 'Totalistic' }` after the `n_count` item.
- `AutoExploreService` passes the persisted mode string straight through to
  `RulesetService.generateMutatedHex` — **no `AutoExploreService.js` change**. (Its
  `crossoverMode` option has no UI; it now also accepts `'totalistic'` for free via §3.1.4.)

### 3.4 `src/services/EventBus.js` (JSDoc only)

Extend the payload unions on four events (lines ~188–199):
- `COMMAND_GENERATE_RANDOM_RULESET`: `generationMode: 'random'|'n_count'|'r_sym'|'totalistic'`
- `COMMAND_MUTATE_RULESET`: `mode: 'single'|'r_sym'|'n_count'|'totalistic'`
- `COMMAND_CLONE_AND_MUTATE`: `mode: 'single'|'r_sym'|'n_count'|'totalistic'`
- `COMMAND_BREED_WORLDS`: `mode: 'uniform'|'r_sym'|'n_count'|'totalistic'`

(`src/docs/EventBus.MD` does not enumerate mode values — verified — so no change there.)

### 3.5 `tests/rulesetService.test.js`

Follow the file's existing conventions (the `seq(values)` cycling rng helper, `service` built in
`beforeAll`, hex fixtures `ALL_ZERO`/`ALL_ONE`). Add a local invariant helper:

```js
// True iff every rule entry with the same totalistic sum (centerState + neighbor count) agrees.
function isTotalistic(rules) {
    for (let sum = 0; sum <= 7; sum++) {
        let first = -1;
        for (let cs = 0; cs <= 1; cs++) {
            for (let mask = 0; mask < 64; mask++) {
                if (cs + countSetBits(mask) !== sum) continue;
                const out = rules[(cs << 6) | mask];
                if (first === -1) first = out;
                else if (first !== out) return false;
            }
        }
    }
    return true;
}
```

New test groups (mirror the structure of the existing `n_count` / `r_sym` groups further down the
file — read them first and match their style):

1. **`getEffectiveRuleForTotalisticSum`** — `null` ruleset → 2; `ALL_ZERO` → 0 for every sum
   0–7; a hand-built ruleset where one bucket disagrees internally → 2 for that sum.
2. **Generation** — `generateRandomRulesetHex(0.5, 'totalistic', seq([0, 0.9]))`:
   result satisfies `isTotalistic`; buckets alternate 1/0 by ascending sum (sum 0,2,4,6 → 1;
   sum 1,3,5,7 → 0) — this pins the 8-draw ascending rng contract. Also assert the totalistic ⊂
   n_count nesting on the output: for every `cs`/`nan`, `getEffectiveRuleForNeighborCount` is not
   2, and the (cs=1, n) output equals the (cs=0, n+1) output.
3. **Mutation** — (a) rate 1, totalistic source as its own reference, rng always passing →
   every bucket flips and the result is still totalistic (equals the inverted source);
   (b) rng never passing → identity; (c) a mixed reference bucket consumes the extra
   `Math.round(rng())` draw (pin the draw order with `seq`).
4. **Crossover** — two distinct totalistic parents, `postMutationRate` 0: child satisfies
   `isTotalistic` and every bucket matches one parent wholesale; a 1-parent pool is the identity.

### 3.6 Explicitly NOT changed (do not touch)

- `hexlife-wasm/` (engine), `WorldWorker.js`, `WorldProxy.js` — the engine only ever sees a
  128-entry table; it has no notion of how it was generated.
- `WorldManager.js` — `_generateMutatedHex` already forwards the reference ruleset for any mode.
- `utils.js` hex codecs, `ShareCodec.js`, save format, `PersistenceService.js` keys, library JSON.
- `Symmetry.js` — totalistic needs no orbit machinery, only the existing `countSetBits`.
- `RulesetEditorComponent.js` — the "Neighbor Count (14 groups)" view already displays/edits
  totalistic rulesets correctly (paired buckets simply show agreeing outputs). A dedicated
  8-group editor view is out of scope.
- `TopInfoBar.js` / `CommandPalette.js` hardcoded `'r_sym'` quick-action defaults, and
  `tourSteps.js` (it references existing per-value element ids like
  `ruleset-actions-mutate-mode-r_sym`; new options get new ids, nothing collides).

---

## 4. Verification & acceptance

1. `npm run test:run` — all suites green, including the new tests above.
2. `npm run lint` and `npm run typecheck` — clean. **Run the full lint after the final edit**
   (project rule: a per-file lint has previously missed a late edit and broken CI).
3. Headless smoke check (`/?headless=1`, `window.__hexlife`): dispatch
   `EventBus.dispatch(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, { bias: 0.5, generationMode: 'totalistic', resetScopeForThisChange: 'all' })`
   and assert the selected world's parsed ruleset satisfies the `isTotalistic` invariant.
   NB: right after a programmatic ruleset commit the proxy's cached hex is briefly stale — poll
   before asserting (known gotcha).
4. Acceptance criteria:
   - The **Totalistic** option appears with identical labeling in all four surfaces: Generate
     pane, Mutate pane, Breed pane, Explore (Auto-Explore mutation mode).
   - Generated/mutated/bred rulesets in this mode always satisfy the totalistic invariant.
   - All existing modes are byte-identical to before (no reordering of rng draws in existing
     branches; existing tests untouched and green).
   - The breed pane's `r_sym` label reads `R-Sym` (uniformity fix).
