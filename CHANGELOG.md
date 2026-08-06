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
