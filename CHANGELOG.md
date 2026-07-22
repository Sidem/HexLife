# Changelog

Notable changes to **HexLife Explorer**. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The Reddit app under [`devvit/`](devvit/) versions separately, on Reddit's own review cadence — see
[`devvit/readme.md`](devvit/readme.md).

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

### Added

- **A visible way to pan and to get back out of a zoom.** While the selected view is zoomed in, an
  on-canvas chip shows the zoom level, names the gesture (`Ctrl-drag` or middle-drag on desktop),
  and offers **Reset view**. At 1× there is nothing to pan, so it stays out of the way.
- **"Paired start"** in the Ruleset Library — one switch deciding whether loading an entry also
  re-seeds the world with the starting cells its preview was made from.

### Changed

- **The app opens on structure, not static.** A first-time visitor now starts zoomed to where
  individual cells are legible, derived from the grid size so every grid preset opens at a
  comparable apparent cell size. Returning visitors keep their own camera.
- **Library cards carry one load button instead of two.** "Load" and "Load + IC" collapsed into a
  single **Load** governed by the new Paired start switch; the opposite load is still available
  per-entry from a saved ruleset's ⋯ menu. Roughly halves the controls in the Library tab.

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
- **Live Specimens on Reddit** ([`devvit/`](devvit/)) — playable worlds as Reddit posts, sharing
  one engine with the Explorer.
- **Mobile UI**, guided tours and a Learning Hub, and a help panel that explains how to switch
  hardware acceleration on rather than refusing with an unactionable error.

### Notes

- The Wasm binary is committed, so `npm run dev` needs no Rust toolchain.
- `devvit/` may import from `src/embed/` and nowhere else in `src/`; `tests/devvitBoundary.test.js`
  enforces that boundary.

[Unreleased]: https://github.com/Sidem/HexLife/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Sidem/HexLife/releases/tag/v1.0.0
