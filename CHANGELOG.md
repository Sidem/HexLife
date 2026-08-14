# Changelog

Notable changes to **HexLife Explorer**. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The Reddit app lives in its own repository,
[Sidem/HexLife-Devvit](https://github.com/Sidem/HexLife-Devvit), and versions separately on Reddit's
review cadence. The embeddable `@hexlife/embed` package versions independently under
[`packages/hexlife-embed/`](packages/hexlife-embed/).

### What counts as breaking

A cellular automaton's contract is reproducibility, so the invariants that gate a **major** bump are
about worlds, not about the UI. A release must not silently change any of:

- **Ruleset codes** — a 32-char hex string must always mean the same 128 rules.
- **World codes** (`HXW1.…`) — a code must decode to the world it encoded, forever, including
  legacy `v1` codes without a brush field.
- **Share links** — `?r=`, `&g=`, `edit=1` must keep resolving.
- **`<hexlife-world>` attributes** — a public API that strangers' pages depend on.
- **Determinism** — same ruleset + seed + initial condition ⇒ same trajectory, tick for tick.

Breaking any of those is major even when the app looks identical. Redesigning the entire interface
is not major if every code above still resolves to the same world.

## [Unreleased]

### Changed

- **The 3D coffee puck is a tab on the coffee lab**, not its own page. Same extraction-yield
  dashboard, brew controls, and history log as the six-state 2D lab. `coffee-puck.html` redirects
  to `coffee-percolation.html#puck`.

### `@hexlife/embed` 1.13.5 — 2026-08-14

#### Fixed

- **HCP `setBlockAlternates` no longer walks fluid off-axis.** The 2D conjugate now flips once
  per 6-phase period. Flipping every tick over a 3-tick host window applied the mirror 2:1.

### `@hexlife/embed` 1.13.4 — 2026-08-14

#### Changed

- **HCP grains are spheres again**, the close-packed primitive, drawn as impostor quads (a
  camera-facing square and a ray-sphere hit). That is cheaper than the hex prisms (2 triangles
  instead of 24) and matches the lattice. Neighbouring grains touch at radius `R√3/2`; the holes
  between them are the HCP interstices.
- **Opacity looks into the bed.** Each grain keeps the requested alpha and later peels still
  draw the grains behind it, so lowering the slider reveals water paths instead of ghosting the
  whole silhouette. `auto-rotate="false"` on `<hexlife-hcp>` holds the camera.

### `@hexlife/embed` 1.13.3 — 2026-08-14

#### Fixed

- **HCP sites tile, and opacity no longer punches through the puck.** Occupied cells are hex
  prisms of circumradius `R`, so in-plane neighbours share an edge instead of floating as undersized
  spheres. Below 1, `opacity` depth-selects the nearest occupied site and blends only that winner
  (the torus-shell contract); `0.99` is almost solid. A centre-stream pour ranks by physical XY, and
  equal-weight mates no longer tilt into one lattice direction.

### `@hexlife/embed` 1.13.2 — 2026-08-14

#### Fixed

- **The HCP view had gravity pointing the wrong way.** Layer 0 is the shower; it is now drawn at
  the top of the canvas, so fluid falls down the screen. `opacity` is a live attribute on
  `<hexlife-hcp>` for seeing into the volume without relying only on the clip plane.

### `@hexlife/embed` 1.13.1 — 2026-08-14

#### Fixed

- **`<hexlife-hcp>` actually shows the lattice.** The camera far plane was a fixed 40 units, which
  clips a demo-size puck entirely (the volume is ~80 units across and the eye sits farther out than
  that). Near/far now scale with the volume. Orbit and auto-rotation keep drawing while the host
  holds `paused`. Dual-porosity on the puck page no longer throws `dualPalette is not defined`.

### `@hexlife/embed` 1.13.0 — 2026-08-14

#### Added

- **`@hexlife/embed/hcp` — a general k-state CA on the hexagonal close-packed lattice.** Twelve
  equidistant neighbours, a 6-phase tetrahedral block of size `k⁴`, gravity in slot 3. It is a
  **fourth** isolated Wasm artifact: root, `/sim`, `/ca`, `/stochastic`, `/solid` and `/spacetime`
  fetch none of it. `HexHcp`, `blockRuleFromTet`, `isConservative`, `isIsotropic`, and `HXP1` codes
  live on the DOM-free entry; `<hexlife-hcp>` is registered by `/hcp-element`.
- **A 3D coffee-puck lab** beside the existing 2D extraction page. The same six-state and
  sixteen-state families, rewritten for a tet whose apex is down. Pour and drip are bulk layer ops
  (`paintIf`, `clearStatesInLayer`), not a JS walk of the volume. An impermeable-grain bed should
  still deliver past the 2D packing cliff.

### Added

- **Solid Garden now shows you the object, not just a slice of it.** The whole run is drawn as one
  turnable solid — drag to spin it, scroll to zoom, and move the tick slider to cut a cross-section
  plane through it — with the flat view one click away for painting a starting state. The preview is
  fed the very states the extruder welds, so what you turn on screen is what is in the downloaded
  file.

### `@hexlife/embed` 1.12.0 — 2026-08-12

#### Added

- **`@hexlife/embed/spacetime` — a run drawn as a 3D solid.** The grid is the cross-section, time
  runs up, and one retained tick is one ray-marched layer you can turn, dolly and slice. It is the
  Explorer's own spacetime view, packaged: the same march, the same shaders, the same framing, so
  the two can never drift apart visually. Like `/solid` it **simulates nothing** — a host feeds it
  one generation per tick from whichever engine it likes — and it loads **no Wasm artifact at all.**
- **Cost that does not scale with the world.** The object is a fragment-shader construction, so a
  576-row world costs the same per frame as a 96-row one; what a bigger world costs is texture
  memory, one byte per cell per layer, reported by `stats.textureBytes`. `depth` is clamped to the
  device's `MAX_ARRAY_TEXTURE_LAYERS` — as low as 256 by the WebGL2 guarantee — and the granted
  depth is readable, so a host can subsample rather than lose the bottom of its object.
- **A palette change re-uploads nothing.** The layer byte *is* the colour-table index
  (`rule * 2 + state`), so `setPalette()` retints the entire history for the cost of a 1 KB table —
  and a binary world with no rule indices is already packed, so `pushLayer(sim.state)` uploads a
  live view of engine memory with no intermediate copy.
- **Drag to orbit, wheel or pinch to dolly**, on by default and to the same constants the Explorer
  uses, with `controls: false` for hosts that own their own gestures.

## [1.3.0] — 2026-08-11

### Printable solids

#### Added

- **A cellular automaton run can now become an object you can print.** The hex grid is the
  cross-section, each tick is a layer, live cells are matter — and the stack of them is a solid, in
  STL, PLY or 3MF. It arrives as `@hexlife/embed/solid` (see the package section below) and as a new
  demo page, [**Solid Garden**](https://sidem.github.io/HexLife/solid-garden.html), which grows a
  crystal from a single seed and hands you the file.
- **The demo tells you whether it will print as one piece before you download it.** A slicer will not
  join separate bodies; it will happily print forty loose fragments and let you discover that on the
  build plate. Solid Garden shows the component report — pieces, floating fragments, matter kept and
  dropped — along with the object's millimetre dimensions and the exact file size, live, as you
  change anything. The whole pipeline runs in about 34 ms, so nothing there is an estimate.
- **Five growth rules chosen so the result is guaranteed, not lucky.** Two cells that are diagonal
  neighbours on consecutive layers touch along a single vertical edge — a zero-thickness hinge that
  *reports* as connected and *prints* as two pieces. Bridge interpolation converts that contact into
  a real face, and under a vacuum-stable rule that is enough to prove every part of the object is
  connected down to the build plate. Every preset is vacuum-stable and starts from one cell, which is
  exactly the configuration the proof covers. Soup starts and other rules are there to be opted into,
  with the report explaining what they cost.

### `@hexlife/embed` 1.11.0 — 2026-08-11

#### Added

- **`@hexlife/embed/solid` — extrude a run into a printable solid.** A third separately loaded Wasm
  artifact that **simulates nothing**: it is a layer sink, so the binary, k-state and stochastic
  engines all feed the same buffer, and a page that never exports an object pays nothing for the
  mesher. Push one layer per tick, read the component report, export STL, PLY or 3MF.
- **Units that mean something.** `cellSize` (hexagon circumradius) and `layerHeight` are independent
  millimetres, so the object's Z aspect ratio is a print decision rather than an accident of how many
  ticks were run. 3MF carries them into the slicer; nothing has to be guessed at import.
- **A component report before you commit.** `finalize()` returns `componentCount`, `keptComponents`,
  `keptVoxels`, `droppedVoxels` and `floating`, plus `keepComponents: 'all' | 'largest' |
  'plate-connected'` and a `basePlate` that makes "plate-connected" mean reachable from the build
  surface.
- **Exports are reproducible.** Vertices weld on exact integer lattice coordinates rather than
  floats — no epsilon comparisons, no cracks — and nothing depends on hash iteration order or a
  per-process seed. Record `solidEngineVersion()` with the option block and the object reproduces
  exactly. One stated limit: for 3MF that covers the model, not the compressed container, because the
  deflate is the platform's.
- **`solidMemoryBytes()`** reports the artifact's linear memory so a host can budget a large run.

#### Performance

- **Greedy merging is the default and is worth 34.9×.** On a 30 × 36 × 100 reference volume it takes
  the mesh from 586,864 triangles to 16,796, the STL from 27.98 MiB to 0.80 MiB, and the 3MF to
  **0.125 MiB** — 1/224 of the unmerged STL. Peak engine memory for that export is 4.94 MiB, and the
  whole pipeline runs in 22 ms.
- **`merge: 'none'` is a supported setting, not a debug flag.** Merging necessarily leaves
  T-junctions; slicers intersect planes and never notice, strict manifold validators do. Both meshes
  bound exactly the same solid — the engine proves it by comparing their surface areas and enclosed
  volumes as exact integers rather than within a tolerance.

### Rule-aware palettes

#### Fixed

- **"Neighbor Counts" and "Symmetry Groups" showed different colors in an embed than in the
  Explorer.** The two palettes color by rule *structure*, and each surface computed that from its own
  formula: the Explorer switched into a per-group mode seeded from one table, while a page setting
  `palette="neighborGradient"` on `<hexlife-world>` or `<hexlife-grid>` sampled a ramp that restarted
  for each center state. Every one of the 128 lit entries disagreed. Both now read one authored table,
  locked together by tests, so a rule reads the same wherever it is shown.
- **The Chroma Lab card for these two presets previewed a gradient they do not have.** It sampled the
  ramp by rule index, which for a palette keyed by group means nothing; it now shows the real colors.

#### Changed

- **Both palettes were retuned to a saturated hue wheel on pure black** — one hue per group, seven
  for the live-neighbor counts and fourteen for the C6 orbits. The center bit is deliberately not a
  color channel any more: splitting the wheel in two to encode it cost more discrimination between
  groups than the bit was worth, so `0-g` and `1-g` share a hue and the palette answers "which group
  fired". The empty neighborhood is the one exception, where the wheel closes. Because every OFF
  output is now black, these two carry the birth/death flash guard for free and ignore the
  `flicker-proof` attribute. Chroma Lab tables you have already edited are untouched.

### Embed demo library

#### Added

- **Stage controls on every demo:** simulation speed, a world-size preset from 48 up to 216 rows, and
  a brush radius. They sit in their own group, apart from the model parameters, because none of them
  changes what is being simulated. Every size preset is a multiple of 3 so the block partition stays
  seamless, and the Cellular Synthesizer omits the speed slider because its tempo already is one.
- **Painting on six more demos.** Crystal Garden, Diffusion & Mixing Chamber, Wildfire Command,
  Butterfly Microscope and the Cellular Synthesizer are now drawable, joining Hex Ecology, Excitable
  Tissue and Hex Matter. Butterfly paints the *perturbed* world only, so "red = the consequence of
  your edit" stays true; Outbreak Counterfactuals stays unpaintable on purpose, since a stroke lands
  on one arm and two arms differing by anything but the declared policy are not a counterfactual.

#### Changed

- **A parameter change no longer restarts the world unless it has to.** Every control now declares
  whether it is a different *rule* over the same world, part of the authored generation zero, a
  different world shape, or a host-side setting. Rule changes — propagation mode, growth geometry,
  gravity, chemistry, wind, spread, burn and ash timing, infection and immunity, thermal scattering —
  are installed on the running world, keeping its cells, its ages and its generation count.
- **Crystal Garden grows crystals.** Growth now turns on an exact count of frozen neighbours, so
  "dendritic" produces genuine branching snowflakes, "faceted" fills concave corners into hexagonal
  plates, and "compact" keeps the solid disk the demo used to be the only version of.
- **Hex Ecology runs a cycle of three, four or five species**, with the palette, legend, brush
  materials and interventions all derived from the count.

### `@hexlife/embed` 1.10.1 — 2026-08-11

Documentation and package metadata only. No engine, element, or codec behaviour changed, and the
shipped `src/` is byte-identical to 1.10.0.

#### Changed

- **The package README is a landing page again, and the reference moved to
  [`docs/embed/`](docs/embed/README.md).** It had grown to 1,100 lines — a full manual rendered into
  npm's narrow single-column page, where a reader deciding whether to install had to scroll past the
  lattice-gas collision operator to reach the requirements. The README now answers "what is it, how
  do I install it, what does one world look like, where are the docs", and each surface —
  `<hexlife-world>`, `<hexlife-grid>`, `/sim`, `/render`, `/ca`, `/stochastic`, `/api`, determinism —
  gets its own page. Nothing was dropped in the move.
- **Package metadata for the npm page:** `keywords` (npm search reads them and there were none),
  `author`, `bugs`, and a `homepage` that now points at the documentation rather than the Explorer.

### `@hexlife/embed` 1.10.0 — 2026-08-10

#### Added

- **Brush radius on `<hexlife-ca>` and `<hexlife-stochastic>`.** Both elements take a `brush`
  attribute (0–40) and a `setBrushSize()` call, and a stroke now paints every cell within that radius
  of the interpolated hex line rather than only the cells a pointer event happened to land on. The
  default stays `0` — a single cell, exactly what these two elements have always painted — so no
  existing embed changes behaviour.
- **`k` up to 6 on the `'neighborhood'` backend**, raised from 4. The dense table is `k⁷`, so it is
  273 KB at k=6, and it is allocated from the world's own `k` — a k=2 or k=4 world is byte-for-byte
  the world it was and pays nothing for the higher cap.

#### Fixed

- **Demo pages resolved `@hexlife/embed/sim` to a second, private copy of the engine.** jsDelivr's
  `/+esm` alias bundles each subpath entry standalone, so `sim` carried its own `EmbedSim` module
  state and its own Wasm instance, and the analysis primitives were inspecting an engine nobody was
  running. Butterfly Microscope and the Cellular Synthesizer never got past "Loading Wasm…". Every
  demo import map now names the package's own files, which keep its shared chunks and therefore one
  engine.

### `@hexlife/embed` 1.9.0 — 2026-08-10

#### Added

- **A complete native stochastic simulation surface.** `WorldStochastic` now includes exact temporal
  activity skipping, a conserved six-channel lattice-gas backend, native census/transition metrics,
  exact reset and intervention state, and resumable `HXS1` codes. The engine remains isolated behind
  `@hexlife/embed/stochastic`, so binary and k-state consumers fetch and initialize zero stochastic
  bytes.
- **`<hexlife-stochastic>`.** The separately imported custom element renders the engine's Wasm state
  view directly, supports both stochastic backends, and exposes deterministic seed/rule/state
  lifecycle controls without moving the running grid through JavaScript.
- **Native demo analysis primitives.** Alternating block partitions replace Coffee's per-tick mirror
  permutations, `DifferenceMask` computes Butterfly's XOR view in Wasm, `BirthLaneMeter` replaces
  Synth's full-grid birth scan, and paired stochastic worlds can return a scalar native difference
  count.

#### Performance and correctness

- Wildfire, paired Outbreak, and Mixing now have native rule/initial-state builders whose real Wasm
  trajectories are pinned against the former JavaScript models. Dense and exact-skipping execution
  are byte-identical, and all native tick buffers remain fixed across 100,000 ticks.
- The frozen release audit covers demo, 103,800-cell, and 383,616-cell grids with seven measured runs.
  Native stochastic neighborhood workloads are 8.7×–64× faster at medium/large sizes, Coffee's
  native alternating path is 4.9×/3.1× faster than the same-browser host mirror path, and the worst
  demo engine p95 is 0.23 ms. The previously accepted six-channel gas and default-artifact size
  exceptions remain explicitly bounded in the audit record.

### `@hexlife/embed` 1.8.0 — 2026-08-10

#### Added

- **A separately loaded stochastic engine.** `@hexlife/embed/stochastic` initializes its own Wasm
  artifact, leaving root, binary, and k-state consumers at exactly zero stochastic download and
  initialization cost. `StochasticWorld` owns visible state, double buffers, per-state entry epochs,
  census, checksums, transition counts, reset state, and intervention writes in native memory.
- **Compiled probabilistic neighborhood rules.** `compileStochasticRule()` turns bounded transition
  rows into canonical `HSN1` bytes with 64 integer mask thresholds, inclusive age bounds, explicit
  priorities, stable streams, and strict validation. `independentNeighborChance()` authors isotropic
  or direction-dependent exposure without floating-point work in the tick loop.
- **Call-order-independent randomness.** New rules use versioned Philox4x32-10 counters keyed by
  seed, generation, cell, and stream. An explicit legacy-demo counter tag preserves the frozen
  Wildfire and paired Outbreak trajectories during later migration; it is never selected silently.

#### Performance and correctness

- One Wasm call advances dense generations with no host cell loop, full-grid tick upload, or
  tick-time allocation. Rust buffer-capacity tests cover 100,000 ticks.
- Native/Wasm RNG goldens match, and the real Wasm engine reproduces every Wildfire, baseline
  Outbreak, and intervention Outbreak cell and age through generation 80, including common random
  numbers and the generation-20 vaccination ring.
- GitHub Pages and npm publication workflows now install the pinned `wasm-pack` tool before building
  the independently generated stochastic artifact.

### `@hexlife/embed` 1.7.1 — 2026-08-09

#### Changed

- **One coherent package showcase.** The totalistic atlas, coffee extraction lab, and editable
  k-state CA builder now share a responsive presentation shell, cross-demo navigation, explicit npm
  attribution, and resource links. Both public READMEs present the three demos as one suite and
  explain the package surfaces, performance characteristics, and deliberate source/build layout.
- **Offline atlas keeps the same presentation.** Its single-file build now inlines the shared demo
  stylesheet alongside the JavaScript and Wasm, preserving the no-runtime-assets contract.

### `@hexlife/embed` 1.5.1 — 2026-08-07

#### Fixed

- **Renderer recreation on a reused canvas.** A renderer now performs its initial geometry fit even
  when the canvas backing dimensions already match, so repeated-toroidal drawing and host-driven
  resize/recreation never start with undefined repeat geometry.

### `@hexlife/embed` 1.5.0 — 2026-08-06

#### Added

- **Host-driven simulation and rendering entries.** `@hexlife/embed/sim` exposes the shared Wasm
  runtime with explicit dimensions, exact initial cells, idempotent cell assignments, multi-tick
  stepping, snapshots, disposal, and canonical LSB-first cell packing. `@hexlife/embed/render` draws
  externally owned state with the shared WebGL2 renderer, camera, toroidal repetition, hit-testing,
  selection, draft previews, and context recovery without owning a simulation.
- **Canonical host primitives.** `createDensityState()` gives Node and browser hosts HexLife's exact
  seeded density initialization without initializing Wasm, including deterministic seed `0` and the
  density `0`/`1` center-cell rule. The host-safe API now exports `normalizeRulesetHex()` for exact
  128-bit ruleset identities.

#### Changed

- **HexWorlds is the practical reference host.** Reusable simulation, rendering, geometry, and
  determinism behavior is developed and tested in this package before the application consumes an
  exact release.

## [1.2.0] — 2026-07-30

Auto-Explore now ranks with a model that was trained on this cellular automaton, instead of one
borrowed from photographs. The optional CLIP path is gone — code, worker, dependencies, settings,
and all.

### Added

- **A HexLife-native interest model ranks Auto-Explore, and it is the default.** Statistics still do
  the cheap screening and the hard kills, so a dead or saturated candidate is rejected without any
  model involvement. Every survivor of the confirmation burst then gets an exact 32-frame trajectory
  scored by a 21.5k-parameter model that runs from `public/models/hexlife-interest/` inside your own
  browser — no third-party host, no CDN, nothing downloaded at runtime. The same pass returns a
  32-value behavior descriptor that drives novelty pressure and the illumination archive.
- **A displayed score that means the same thing tomorrow.** The model's raw preference utility has no
  meaningful absolute scale, so the shipped artifact carries a calibration that maps it to its
  percentile against a frozen reference corpus. The transform is monotonic, so rankings are
  unchanged, but a 0.87 in one session is the same 0.87 in the next.
- **"Statistical only".** One radio button restores the deterministic, model-free objective exactly
  as it behaved before this release — same populations, same champions, same reset seeds, same banked
  scores, pinned by a golden test.

### Changed

- **Auto-Explore is organised into tabs.** Run status and Start / Pause / Stop / Stop &amp; Keep stay
  visible at all times; **Setup**, **Objective**, and **Finds** hold everything else. The tabs are
  keyboard-navigable (arrows, Home, End), remember which one you were on, and behave the same on
  mobile Discover as in the desktop panel. Owner-facing **Export selected** and **Evaluate selected**
  moved into a collapsed **Model Tools** area under Objective.
- **The curated library grew from 39 to 73 rulesets.** Public and personal entries now share one
  source-filtered list, and duplicate personal copies of built-in rules can be removed safely.
- **The keyboard shortcut viewer now uses the space it is given.** Resizing its desktop panel grows
  the keyboard in both directions; modifier layers now distinguish Ctrl from Ctrl+Shift; search
  spans keys, actions, categories, and every layer; and the categorized fallback is available from
  mobile More Options. `V` remains the Flat/3D Torus toggle, while recording moves to `Shift+V`
  (start/stop) and `Ctrl+Shift+V` (pause/resume) to remove the previous duplicate binding.
- **Torus-aware capture and re-centering.** Capture Studio now exports the active 3D projection, and
  hold-`H` wrap-around shifting works without losing the orbit strategy.
- **Ruleset relatives and family naming.** Saving a ruleset now shows its nearest named relatives in
  the strictest shared constraint space and can continue a family name with Roman-numeral suffixes.

### Removed

- **The optional CLIP perceptual objective, entirely.** The embedding service and its worker, the
  perceptual novelty and archive modules, the cell rasterizer, the noise-prompt contrast battery, the
  CLIP model picker, the perceptual status and progress UI, the `openEndedness` scoring term, the
  "Maximal Novelty" preset, and the embedding-based tag suggestions are all deleted. Because that
  term was always dropped-and-renormalized when absent, statistical scores are unchanged.
- **Text-prompt target search.** It only ever worked because CLIP had a text encoder; the native
  model has none, so a supervised prompt search would have been a control that could not work.

### Fixed

- **A run can no longer be stalled by the model.** Inference has a deadline, an abort signal wired to
  the run token, and a fallback to the confirmed statistical score. A failed load, a timeout, a bad
  descriptor, or a mid-flight Stop all degrade to statistics instead of leaving a generation pending.

### Notes for upgraders

- Nothing about worlds changed: ruleset codes, `HXW1.…` world codes, share links,
  `<hexlife-world>` attributes, and determinism are all untouched. Old share links and exported find
  packs still decode; fields that only meant something to the CLIP path are ignored on import.
- The old perceptual archive in local storage is discarded on first load and replaced by a
  native-descriptor archive that self-invalidates when the model changes. Your gallery of finds is
  not affected.
- The shipped model is labelled **beta**, not accepted. On the project's curated sanity panel it
  orders interesting-vs-boring pairs correctly 67% of the time against the statistical objective's
  44%, but it has not cleared the strict corpus gates (direct owner hard-pair votes, locked test
  cases, mixed-grid corpus coverage, quantization), and the manifest says so.

## [1.1.0] — 2026-07-27

### Added

- **3D Torus view.** The selected world can now be wrapped onto its actual toroidal topology and
  explored with drag-to-orbit, wheel-to-dolly, continuous rotation, adjustable speed and ring
  openness, and off-cell opacity from 1–100%. Vertical orbit is unbounded, so the camera can tumble
  repeatedly through both poles.
- **A visible way to pan and to get back out of a zoom.** While the selected view is zoomed in, an
  on-canvas chip shows the zoom level, names the gesture (`Ctrl-drag` or middle-drag on desktop),
  and offers **Reset view**. At 1× there is nothing to pan, so it stays out of the way.
- **"Paired start"** in the Ruleset Library — one switch deciding whether loading an entry also
  re-seeds the world with the starting cells its preview was made from.

### Changed

- **Settings are organized by task.** Display, Simulation, and 3D Torus now have persistent,
  keyboard-accessible tabs with grouped controls instead of one mixed scrolling list.
- **The app opens on structure, not static.** A first-time visitor now starts zoomed to where
  individual cells are legible, derived from the grid size so every grid preset opens at a
  comparable apparent cell size. Returning visitors keep their own camera.
- **Library cards carry one load button instead of two.** "Load" and "Load + IC" collapsed into a
  single **Load** governed by the new Paired start switch; the opposite load is still available
  per-entry from a saved ruleset's ⋯ menu. Roughly halves the controls in the Library tab.

### Fixed

- **Torus transparency remains continuous at every camera angle.** A nearest-layer depth pass stops
  side-on rays from accumulating multiple translucent shell intersections, while stable
  camera-relative shading keeps black off-cells visibly distinct from the black canvas.

## [1.0.0] — 2026-07-22

First tagged release. The project has been live and evolving for some time; this marks the point at
which it gets a version you can cite, link, and file bugs against.

### Added

- **Nine concurrent worlds**, each a hexagonal cellular automaton with its own ruleset and state —
  a Rust → WebAssembly tick engine, one Web Worker per world, one instanced WebGL2 draw call each.
- **128-bit rulesets** as 32-character hex with deterministic two-word mnemonic names, plus
  `B2/S35`-style notation for rules that reduce to neighbor counts and orbit notation (`B2o3p/S2`)
  for rotationally symmetric ones.
- **Rule-based coloring** — cells tinted by *which rule* set them, turning dynamics into a
  visible fingerprint.
- **Scrub-back history**, pattern copy/paste (hex-phase-aware), and a ruleset toolkit
  (generate / edit / mutate / clone / breed) with undo–redo.
- **Auto-Explore** *(alpha)* — evolutionary search for interesting rulesets, scored on structure,
  criticality, block-entropy dynamics, transport and optional CLIP-embedding novelty, banked into a
  deduplicated gallery.
- **Sharing** — share links (`?r=`), world codes (`HXW1.…`), portable `hexlife-pack` exports for
  the ruleset library and the Auto-Explore gallery, PNG snapshots and WebM recordings.
- **`<hexlife-world>` embed** — the simulation as a custom element for third-party pages.
- **Live Specimens on Reddit** — playable worlds as Reddit posts, sharing one engine with the
  Explorer. Shipped from `devvit/` in this release; since moved to
  [Sidem/HexLife-Devvit](https://github.com/Sidem/HexLife-Devvit).
- **Mobile UI**, guided tours and a Learning Hub, and a help panel that explains how to switch
  hardware acceleration on rather than refusing with an unactionable error.

### Notes

- The Wasm binary is committed, so `npm run dev` needs no Rust toolchain.
- At the time, `devvit/` could import from `src/embed/` and nowhere else in `src/`, enforced by a
  test. The Reddit app is now a separate repository consuming the published `@hexlife/embed`
  package, so that boundary is a package dependency rather than a lint.

[Unreleased]: https://github.com/Sidem/HexLife/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/Sidem/HexLife/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Sidem/HexLife/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Sidem/HexLife/releases/tag/v1.0.0
