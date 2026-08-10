# Stochastic Phase 0 baseline audit

Frozen **2026-08-10**, before any `WorldStochastic` implementation. This directory is the durable
measurement authority for the later implementation and release audits. Results may be repeated, but
the contract's tiers, workloads, method, statistics, and thresholds must not be changed after looking
at implementation results. A change requires a dated rationale in a reviewed tracked file first.

## Frozen evidence

| File | Authority |
|---|---|
| `stochastic-phase0-contract.json` | Grid tiers, workload matrix, seven-run method, measurements, and thresholds |
| `stochastic-phase0-browser-baseline.json` | Exact source-engine and current JavaScript-host timings, renderer cost, heap samples, and 100k-tick Wasm-memory probes |
| `stochastic-phase0-native-baseline.json` | Release-native `World` and `WorldK` timings |
| `stochastic-phase0-artifacts.json` | Raw/gzip/SHA-256 inventory of the existing Wasm and built package entries |
| `stochastic-phase0-network-baseline.json` | Cold root-only and ca-only imports from independent fresh origins |
| `../stochastic/js-oracles.json` | Exact current Mixing, Wildfire, and paired Outbreak trajectories |
| `../../../public/embed-demo-manifest.js` | Machine-readable ownership and migration-debt checklist for every public demo/reference |

The browser capture used Chrome 151 on Windows 11, an AMD Ryzen 7 5800X, 16 logical cores, and
32 GiB RAM. Native results used Cargo's release profile on the same machine (`rustc 1.87.0`);
package artifacts were built with Node 20.17.0, npm 10.8.2, Vite 6.3.5, and
`@hexlife/embed` 1.7.1.

## Static hot-path audit

Counts describe the dense work before compiler vectorization. Precomputed topology means none of the
three existing per-cell engine loops performs coordinate wrapping, parity selection, or neighbor
modulo arithmetic.

| Path | Persistent storage | Dense running work | Allocation/copy boundary | Sparse/settled path |
|---|---|---|---|---|
| `World` | 4 cell-byte lanes (`state`, `next`, current/next rule index) + six `u32` neighbor indices = 28 B/cell; two 1-B/8x8-block classifiers; fixed 128-B rule and 512-B counters. Optional probe adds 2 B/cell only while enabled. | Uniformity prepass, then per mixed cell: center + six neighbor-index + six neighbor-state + rule reads; next-state, rule-index, and counter writes; six neighbor tests plus active/changed tests; zero division/modulo. | One JS→Wasm tick call; zero tick allocation; zero full-grid JS→Wasm bytes. Binary render uploads state + rule index = 2N bytes and one draw. | Exact 8x8 uniform-block scan/dilation replaces the six gathers with fills and closed-form counters. |
| `WorldK/neighborhood` | State + next = 2 B/cell; six `u32` neighbors = 24 B/cell; dense `k^7` bytes; census `4k`; chunk quiet/changed/active = 6 B per 32x32 chunk. | Per active cell: center + six index + six state + rule reads, one state write, six Horner multiplies, change test; zero division/modulo and no per-cell backend dispatch. | One tick call; zero allocation/copy. k-state render uploads N bytes and one draw. | Change-propagation halo skips a 32x32 chunk for free when its inputs are proven unchanged. |
| `WorldK/block` | State = 1 B/cell; six `u32` neighbors = 24 B/cell; `2k^3`-byte rule; same 6-B/chunk activity metadata; no next buffer. | Per 3-cell triangle: two neighbor-index, three state, and one rule read; two divisions + two modulos to unpack; up to three state writes. Backend dispatch is once per tick. | One tick call; zero allocation/copy. k-state render uploads N bytes and one draw. | Three-phase change propagation skips settled chunks; disjoint blocks update in place. |
| Native alternating block | **Absent in Phase 0.** The frozen comparator is exact Coffee host conjugation below. | Phase 1+ implementation must preserve the mirror-oracle trajectory. | Target: zero host permutations and zero full-grid copy. | Must retain `WorldK` change propagation. |
| `WorldStochastic/neighborhood` | **Absent by design in Phase 0.** | Frozen comparators are Wildfire and Outbreak below. | Target: zero tick allocation and zero full-grid copy. | Frozen dense-regression and sparse-speedup thresholds apply. |
| `WorldStochastic/lattice-gas` | **Absent by design in Phase 0.** | Frozen comparator is Mixing below. | Target: zero tick allocation and zero full-grid copy. | Frozen dense-regression and low-occupancy speedup thresholds apply. |

The native tests retain every persistent vector pointer and capacity across 100,000 ticks for
`World`, `WorldK/neighborhood`, and `WorldK/block`. The browser probe independently observed
13,369,344-byte Wasm memory before and after 100,000 ticks of each path: **0 bytes growth** in all
three cases. Existing source loops allocate no collections, and browser records report zero tick
allocations and zero JS→Wasm bytes for all existing engine paths.

### Current host-model and demo debts

| Surface/path | Frozen per-tick debt |
|---|---|
| Mixing / gas | Persistent cells + velocity = 2 B/cell. Every tick allocates claims (1N), destinations (4N), next cells (1N), and next velocity (1N): four allocations / 7 B per cell of scratch, two full-grid loops, then the demo copies N visible bytes into Wasm. |
| Wildfire | Persistent cells + `u16` age = 3 B/cell. Every tick allocates a 1N next grid, scans N cells with up to six neighbor reads, mutates ages, then copies N visible bytes into Wasm. |
| Outbreak | Same 3 B/cell persistent + 1N allocation and full scan per world; Counterfactuals runs two worlds, two allocations, and two N-byte visible-grid writes under a host-owned common-random schedule. |
| Coffee | `WorldK/block` is native, but a persistent `u32` mirror map and 1N scratch drive two full-grid permutations on every odd tick. The state is a Wasm view, so this is zero boundary-copy bytes, but it makes an average one host permutation/tick and calls `markAllDirty()`, defeating chunk skipping. |
| Butterfly | Two native `World`s, followed by two N-byte snapshots, one N-cell host XOR, one N-byte mask allocation, and an N-byte mask upload to the display world each tick. |
| Synth | Native `World`, followed by an N-byte snapshot and N-cell birth scan each beat; the host birth-index array is unbounded up to N entries instead of eight bounded lanes. |

The manifest test pins these debts against the exact current source expressions. Interventions,
audio, controls, and bounded aggregates remain legitimate host work; the listed running-path scans,
permutations, allocations, and full-grid replacement writes do not.

## Dynamic baseline results

Every matrix cell has seven measured runs after warmup. Raw runs are in the JSON fixtures; the
following values are orientation summaries, not substitutes for them.

### Browser/Wasm and exact JavaScript hosts (ms/tick, median / p95)

| Workload | Demo 6,048 | Medium 103,800 | Large 383,616 |
|---|---:|---:|---:|
| `World` 50% noise | 0.05 / 0.06 | 0.86 / 1.11 | 3.13 / 3.70 |
| `WorldK/neighborhood` cyclic ecology | 0.04 / 0.05 | 0.63 / 0.79 | 2.20 / 2.40 |
| `WorldK/block` reactive matter | 0.03 / 0.03 | 0.56 / 0.57 | 1.97 / 2.13 |
| Coffee extraction, native block only | 0.02 / 0.02 | 0.04 / 0.04 | 0.60 / 0.70 |
| Coffee exact host mirror oracle | 0.03 / 0.03 | 0.61 / 0.67 | 1.87 / 3.17 |
| Wildfire sparse front | 0.14 / 0.35 | 2.76 / 2.91 | 9.40 / 10.47 |
| Wildfire dense hazard | 0.20 / 0.24 | 3.66 / 5.04 | 12.80 / 14.80 |
| Outbreak single / paired | 0.32 / 0.39 / 0.57 / 0.63 | 6.58 / 7.13 / 9.64 / 11.60 | 16.70 / 38.60 / 34.20 / 35.27 |
| Gas 24% occupancy | 0.11 / 0.12 | 1.64 / 1.81 | 5.27 / 5.87 |
| Gas collision-heavy | 0.15 / 0.19 | 2.86 / 3.00 | 10.03 / 10.73 |

The combined single/paired Outbreak row is `single median/p95 / paired median/p95`. The separate
combined-frame runs include the current host→Wasm grid write and GPU draw: the worst demo p95 was
paired Outbreak at 0.79 ms. The current pages therefore clear 16.7 ms and consume far below 25% of
even the fastest current 26 TPS tick budget. At large size, single Outbreak p95 (38.60 ms) and paired
Outbreak median (34.20 ms) establish the clearest host-scaling debt.

The long-task observer saw 60 tasks (p50 117 ms, p95 545 ms) while the harness synchronously built
and executed the entire 69-case matrix. Those are retained as harness diagnostics; they are not a
claim about one demo frame, which is measured separately above.

### Release-native existing engines (large, ms/tick median / p95)

| Path/workload | Large result |
|---|---:|
| `World` empty / 0.2% sparse / 50% noise | 0.15 / 0.15 · 0.16 / 0.21 · 1.87 / 1.91 |
| `WorldK/neighborhood` settled / ecology / tissue | 0.01 / 0.01 · 1.27 / 1.37 · 1.29 / 1.34 |
| `WorldK/block` settled / matter | 0.009 / 0.009 · 1.48 / 1.57 |
| k=16 block-table shape proxy | 1.33 / 1.40 |

The native Coffee row is deliberately named a table-shape proxy: the authored transition builder
and exact conjugation live in JavaScript and are therefore measured exactly only in the browser
fixture. It must not be used as a Coffee parity claim.

## Artifact and import boundary

- Existing Wasm: 59,727 raw / 24,705 gzip bytes; generated glue: 29,863 / 8,250 bytes.
- Built package inventory: 500,564 raw / 179,952 gzip bytes in total, with per-file hashes retained.
- No filename or built artifact contains a stochastic engine; `stochasticArtifactPresent` is false.
- Cold root-only import: 98.1 ms import, 161.1 ms through element initialization, 11 requests.
- Cold ca-only import: 49.5 ms import, 52.0 ms through Wasm initialization, 0.7 ms first world,
  7 requests.
- Both captures made **zero stochastic requests and instantiated zero stochastic bytes**. A
  stochastic-only fixture is intentionally unavailable until the separate Phase 1 artifact exists.

The cold captures used two independent, never-before-used localhost origins so browser cache state
could not leak from root into `/ca`. Transfer-size inventories are in the network fixture.

## Frozen thresholds and audit conclusion

The contract fixes: old-engine median regression ≤3% and repeatable regression ≤5%; existing
artifact gzip growth ≤0.5%; exactly zero stochastic requests/bytes for uninvolved imports; zero new
tick allocation and zero normal full-grid stochastic JS→Wasm copy; demo p95 <16.7 ms and simulation
<25% of tick budget; native stochastic ≥2x faster at medium and ≥3x at large; dense skip overhead
≤5%; native Coffee ≥2x faster at medium/large; and optional Butterfly/Synth analysis <10% tick cost
with zero unused-path cost.

**Phase 0 passes.** Ownership, exact differential behavior, workloads, raw measurements, machine and
build metadata, artifacts, import boundaries, debts, and thresholds are frozen. Phase 1 may add the
separate artifact and RNG scaffolding without redefining how success will be measured.

## Phase 1 artifact/RNG record — 2026-08-10

`stochastic-phase1-artifacts.json` records the additive artifact boundary after the Phase 1 shell:

- `hexlife_stochastic_wasm_bg.wasm`: 22,417 raw / 9,985 gzip bytes; generated loader glue:
  8,728 / 2,422 bytes.
- The self-contained package `/stochastic` entry is 67,194 raw / 16,781 gzip bytes.
- A cold stochastic-only browser import took 19.4 ms, 21.8 ms through initialization, and 0.8 ms
  to allocate the first 6,048-cell shell world; its isolated memory was 1,376,256 bytes.
- Only `src/embed/stochastic.js` imports the second artifact. Root and `/ca` retain their frozen zero
  stochastic request/instantiation boundary.
- The default Wasm remains 59,727 raw bytes and is 24,703 gzip bytes versus Phase 0's 24,705, inside
  the frozen 0.5% ceiling.

Native Rust and real browser-Wasm tests share four Philox4x32-10 golden vectors. The version-1
mapping is counter words `[cell, stream, generation-low, generation-high]` and key words
`[seed-low, seed-high]`; changing that mapping is a stochastic reproducibility break.

## Reproduction

```text
npm run build:embed
npm run audit:stochastic
npm run benchmark:stochastic:native
npm run dev -- --port 5180 --strictPort
# Open /HexLife/tests/performance/stochastic-phase0.html and run the frozen matrix.
# Open root-only.html and ca-only.html on separate fresh origins for cold import captures.
```

Fixture regeneration is intentionally explicit: add `--write` to the oracle, artifact, or native
scripts only when recording an approved baseline update. The ordinary audit command verifies rather
than rewrites the frozen evidence.
