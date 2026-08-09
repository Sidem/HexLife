<div align="center">

<img src="favicon.svg" alt="HexLife Explorer logo" width="96" height="96" />

# HexLife Explorer

**A high-performance laboratory for cellular automata on a hexagonal grid.**

Design rules, paint and preserve patterns, compare nine worlds, and watch complex behavior emerge.

[**▶ Try the Live Demo**](https://sidem.github.io/HexLife/) · [**r/hexlife**](https://www.reddit.com/r/hexlife/) · [Releases](https://github.com/Sidem/HexLife/releases) · [Changelog](CHANGELOG.md)

[![Build](https://github.com/Sidem/HexLife/actions/workflows/deploy.yml/badge.svg)](https://github.com/Sidem/HexLife/actions/workflows/deploy.yml)
[![Release](https://img.shields.io/github/v/release/Sidem/HexLife?sort=semver)](https://github.com/Sidem/HexLife/releases)
[![@hexlife/embed](https://img.shields.io/npm/v/@hexlife/embed?logo=npm&label=%40hexlife%2Fembed&color=CB3837)](https://www.npmjs.com/package/@hexlife/embed)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Rust](https://img.shields.io/badge/Rust-WebAssembly-orange?logo=rust&logoColor=white)
![WebGL2](https://img.shields.io/badge/WebGL2-instanced-990000?logo=webgl&logoColor=white)

<br>

<img src="docs/media/mossy-bramble.gif" alt="A rotationally symmetric ruleset named mossy bramble growing from a single hexagonal seed, with rule-based coloring" width="49%" /> <img src="docs/media/mossy-bramble-mono.gif" alt="The same mossy bramble ruleset rendered in plain monochrome cell states" width="49%" />

<sub>One ruleset, two views — [<em>mossy bramble</em>](https://sidem.github.io/HexLife/?r=1208058540338537121906D3452DB35F) growing from a seed. Left: rule-based coloring, where the rule that fired determines each cell's color. Right: plain cell states.</sub>

</div>

---

HexLife Explorer sits at the crossroads of **artificial life**, **complex systems**, and
**generative art**. Its two-state worlds wrap at both edges, so the simulation surface is a torus
rather than a box. The app gives you both a fast sandbox for direct experimentation and a set of
tools for preserving, comparing, measuring, and sharing what you find.

The simulation core is written in **Rust → WebAssembly**. Each of the nine worlds runs in its own
**Web Worker**, while **WebGL2 instancing** keeps rendering responsive as rules, seeds, and grid
sizes change.

## ✨ Highlights

- **Nine worlds at once** — a 3×3 grid with one world enlarged, so you can compare rules, seeds, and
  mutations side by side in real time.
- **Rulesets as first-class objects** — edit all 128 transitions through three lenses, mutate, breed,
  undo, and name them; every ruleset is a 32-character hex code with a deterministic mnemonic name.
- **Deep pattern tooling** — hex-aware brushes, region copy/paste with 60° rotation and mirroring,
  saved starting states, and a personal pattern library.
- **See the rules, not just the cells** — rule-based coloring, curated and color-vision-friendly
  palettes, live entropy and population plots, and per-rule firing analysis.
- **Rewind and branch** — scrub the selected world back 240 ticks, replay it, and fork from any
  earlier state.
- **3D torus view** — project the selected world onto a live torus and orbit it without changing the
  simulation.
- **Export anything** — PNG/JPEG, WebM, animated GIF, seamless cycle loops, share links, and portable
  `HXW1.…` world codes.
- **Auto-Explore** *(alpha)* — an evolutionary search for interesting rulesets, ranked by a
  HexLife-native model that runs entirely in your browser.

## 🚀 Quick start

The easiest way in is the [**live demo**](https://sidem.github.io/HexLife/) — no install, no account.

To run it locally you need [Node.js 20](https://nodejs.org/) and a browser with WebGL2 and hardware
acceleration enabled:

```bash
git clone https://github.com/Sidem/HexLife.git
cd HexLife
npm install
npm run dev
```

Vite serves the app at `http://localhost:5173`. The compiled Wasm engine is checked into the
repository, so development mode does **not** require Rust.

| Command | What it does |
| :--- | :--- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Rebuild Wasm and create the production bundle in `dist/` |
| `npm run preview` | Preview the production bundle locally |
| `npm run test:run` | Run the Explorer's Vitest suites once |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Type-check opt-in JavaScript and declarations |
| `cargo test --manifest-path hexlife-wasm/Cargo.toml` | Run the Rust engine tests |

<details>
<summary>Rebuilding the Rust/Wasm engine</summary>

<br>

Install [Rust](https://rustup.rs/) and
[`wasm-pack`](https://rustwasm.github.io/wasm-pack/), then run:

```bash
npm run build:wasm
```

</details>

## 🧠 How HexLife rules work

- **Hexagonal neighborhood** — every cell has six neighbors. Consecutive columns are staggered by
  half a hex.
- **Toroidal world** — opposite edges connect. Activity leaving one side re-enters from the other.
- **Two states** — a cell is active or inactive.
- **128 local configurations** — the center cell plus its six neighbors contain seven binary values,
  giving 2⁷ possible inputs. One output bit for each input makes a ruleset exactly 128 bits, or 32
  hexadecimal characters.

That encoding is the project's reproducibility contract: the same ruleset, starting state, and seed
produce the same trajectory.

## 🧪 What you can do

Each section below expands to the full feature list.

<details>
<summary><b>Run and compare worlds</b> — nine worlds, scrub history, zoom/pan, 3D torus view</summary>

<br>

- Run **nine independent worlds** in a 3×3 grid, with one world enlarged for inspection.
- Select, enable, disable, or ruleset-lock worlds; copy a ruleset or exact cell state between them.
- Play, pause, single-step, change simulation speed, reset, or clear one world or all enabled worlds.
- Rewind the selected world through a **240-tick scrub history**, replay it, and branch by editing
  any earlier state.
- Switch among four grid-size presets, from a quick small world to a huge 576×666-cell world.
- Zoom and pan the flat grid, reset the camera from the on-canvas zoom chip, or hold `H` and drag to
  re-center a pattern across the wrap-around boundary.
- Switch the selected world to a live **3D torus view** on desktop. Orbit, dolly, tumble through the
  poles, auto-rotate, and adjust rotation speed, ring openness, and off-cell transparency without
  changing the underlying world.

</details>

<details>
<summary><b>Design and evolve rulesets</b> — 128-rule editing, mutation, breeding, naming</summary>

<br>

- Work with the complete **128-rule transition table** as a 32-character hexadecimal ruleset.
- Edit rules through three lenses: all 128 configurations, 14 center/neighbor-count groups, or 28
  rotational-symmetry groups.
- Generate random, neighbor-count, totalistic, or rotationally symmetric rulesets with an adjustable
  output bias.
- Mutate by bit or structural group, invert rules, clone them across worlds, or mark any worlds as
  parents and breed new offspring from the genepool.
- Choose whether a rule operation affects the selected world or all worlds, whether it resets cells,
  and whether ruleset-locked worlds are protected.
- Undo and redo ruleset changes, inspect recent ruleset history, or paste a hex code directly.
- Read deterministic mnemonic names plus compact `B2/S35`-style or rotational-orbit notation when a
  ruleset has that structure.
- When saving a ruleset, see its nearest named relatives and optionally continue an existing family
  name.

</details>

<details>
<summary><b>Create starting states and patterns</b> — seeds, brushes, hex-aware copy/paste</summary>

<br>

- Give each world its own **random fill**, configurable **clumps**, or an exact **saved start**.
- Use presets and live previews, reproduce seeded resets, or apply the same starting state to all
  nine worlds for controlled comparisons.
- Paint while the simulation runs or pauses, with adjustable hex-radius brushes in invert, draw, or
  erase mode.
- Select and copy a rectangular region, then stamp it without losing the staggered hex phase.
- Rotate patterns in 60° steps, mirror them horizontally or vertically, and keep a personal pattern
  library with names, tags, and a link back to the source ruleset.
- Save a selected world—cells, ruleset, and tick count—to JSON, load it later, or capture its cells
  as a reusable starting state for any world.

</details>

<details>
<summary><b>Visualize and measure behavior</b> — rule-based coloring, palettes, live metrics</summary>

<br>

- Toggle between plain active/inactive cells and **rule-based coloring**, where color reveals which
  transition fired.
- Use Chroma Lab's ready-made and color-vision-friendly palettes, global hue shift, custom gradients,
  or hand-picked colors for neighbor-count and symmetry families.
- Overlay ruleset glyphs, breeding-parent and lock indicators, and extinct, saturated, or cycling
  status badges on the minimaps.
- Plot live population ratio, binary entropy, and hex-block entropy.
- Measure the selected world's behavior with the same interestingness metrics used by Auto-Explore,
  and inspect which birth and survival rules are firing most often.

</details>

<details>
<summary><b>Keep, export, and share discoveries</b> — library, capture studio, world codes, Reddit</summary>

<br>

- Browse one unified **Ruleset Library** containing the curated public catalog and your personal
  saves, with generated previews, paired starting states, search, sorting, source filters, tags, and
  structural-constraint filters.
- Save names, descriptions, tags, thumbnails, seeds, and paired starting states. Import or export
  personal rulesets as sanitized, versioned `hexlife-pack` JSON files.
- Share a lightweight URL for a ruleset/setup, copy a portable initial-condition code, or copy an
  **`HXW1.…` world code** containing the selected world's exact ruleset, cells, grid, brush, and
  palette settings.
- Use Capture Studio to export the selected world or the full canvas as **PNG/JPEG**, **WebM**, or
  **animated GIF** at preset or custom resolutions.
- Export a detected cycle as a seamless GIF, or arm a perfect-run recording that starts from the
  current state and closes on a detected cycle.
- Turn a world code into a playable **Live Specimen** on Reddit. The separate
  [HexLife-Devvit](https://github.com/Sidem/HexLife-Devvit) app supports play, restart, zoom,
  drawing, ruleset inspection, and posting an exact remix from inside Reddit.

</details>

<details>
<summary><b>Learn and work efficiently</b> — guided missions, command palette, mobile UI</summary>

<br>

- Follow guided missions, experiments, and feature tours in the Learning Hub.
- Use the desktop command palette (`Ctrl`/`⌘`+`K`) or the full keyboard shortcut system.
- Use a dedicated responsive mobile interface with touch drawing, pinch zoom, world navigation, and
  a bottom tab bar.
- Keep preferences, panels, palettes, personal libraries, saved starts, patterns, and world setup in
  local browser storage.
- Get actionable hardware-acceleration guidance if WebGL2 is available but disabled.

</details>

## 🧭 Auto-Explore (experimental)

Auto-Explore is an **alpha** evolutionary search for rulesets with potentially interesting
behavior. It runs candidate populations, banks promising finds into a gallery, and hands those finds
back to the normal save/share/breed workflow. The panel keeps the run status and the
Start / Pause / Stop / Stop &amp; Keep controls always in view, with everything else behind three tabs:
**Setup** (mutation rate and mode, population size, initial conditions, evaluation length, budget),
**Objective** (how candidates are ranked, plus the scoring weights), and **Finds** (the gallery,
head-to-head rating, and pack import/export).

Two objectives are available:

- **Native beta** (default) — statistics screen and hard-kill candidates cheaply; every survivor then
  gets an exact 32-frame trajectory scored by a small HexLife-native model that runs entirely in your
  browser from `public/models/hexlife-interest/`. Nothing is downloaded from a third party. Its
  displayed 0–1 score is the model's percentile against a frozen reference corpus, so it is stable
  across sessions. If the model fails to load, times out, or errors, the run silently falls back to
  the statistical score rather than stalling.
- **Statistical only** — the deterministic, model-free objective. Byte-identical to the pre-model
  search, and the right choice for reproducibility work.

> [!NOTE]
> The native model is explicitly a **beta**. It clearly beats the statistical objective on a curated
> sanity panel, but it has not passed the project's strict corpus-acceptance gates (owner hard-pair
> votes, locked test cases, mixed-grid corpus coverage, quantization). Treat all rankings as
> suggestions, not ground truth, and expect the controls and scoring behavior to keep evolving.

## 🧩 Embed a world in your own page

The [`@hexlife/embed`](https://www.npmjs.com/package/@hexlife/embed) package provides two custom
elements. `<hexlife-world>` is a single world — a ruleset or exact world code, seed, density, rows,
speed, palette, and paused/drawing/zoom policies, with play, pause, reset, tick, brush-size,
checksum and world-code APIs. It is the element the Reddit app uses.

```bash
npm install @hexlife/embed
```

```js
import '@hexlife/embed';
```

```html
<hexlife-world
  ruleset="12482080480080006880800180010117"
  seed="4242"
  rows="192"
  speed="30"
  paused
  draw>
</hexlife-world>
```

`<hexlife-grid>` is many worlds in **one** WebGL context. A browser gives a page about sixteen
contexts and force-loses the oldest past that, so a wall of `<hexlife-world>` elements silently
stops being a wall at sixteen; the grid puts N simulations behind one context and draws each into
its own viewport instead. Every world shares one grid, seed, density, palette and clock, so the only
difference between two tiles is the rule.

> ### [**▶ 256 worlds, one rule class**](https://sidem.github.io/HexLife/totalistic-256.html)
>
> All **256** totalistic rules at once — a hex cell plus six neighbours has eight possible live
> counts, so a rule keyed on that total has exactly 2⁸ forms. The whole class, not a sample, on one
> 16×16 map of 96×112-cell worlds sharing an initial condition. Switch the constraint and the same
> map becomes a random slice of a space too big to draw: 256 of the 2¹⁴ outer-totalistic rules, of
> the 2²⁶ dihedral or 2²⁸ rotational ones, or of all 2¹²⁸. Built entirely with this package; the
> 2.75M cells it draws each frame cost about 0.8 ms.

```html
<hexlife-grid layout="16x16" rows="96" seed="12345" palette="monochrome" flicker-proof></hexlife-grid>
```

> ### [**▶ Coffee extraction lab**](https://sidem.github.io/HexLife/coffee-percolation.html)
>
> The k-state half of the package, on `<hexlife-ca>`. Six states — air, water, saturated water, and
> dry, wet and spent grounds — where fluid and grounds are each conserved **exactly** and the only
> things crossing the boundary are the pour and the drip. Set the packing, the bed and the pour
> pattern, and try to spend the whole puck. The packing slider is really a percolation experiment:
> yield collapses from 59% to 7% as pore space crosses 0.5, which is `p_c` for site percolation on
> the triangular lattice — exactly, and on no other common grid. The page also runs a four-state
> version under both backends at once, which is the shortest statement of why `'block'` exists at all.

```html
<hexlife-ca states="6" rows="150" backend="block"></hexlife-ca>
```

```js
// T00–TFF *is* the totalistic class — nothing sampled away.
grid.rulesets = Array.from({length: 256}, (_, i) => 'T' + i.toString(16).padStart(2, '0'));
```

Full attribute and API reference: [`packages/hexlife-embed/README.md`](packages/hexlife-embed/README.md).
The package is built from `src/embed/` with `npm run build:embed`; the standalone CDN and in-app
“Copy embed code” workflows remain open.

For an offline copy of the 256-world sampler, run `npm run build:standalone` and open
`dist/totalistic-256-standalone.html` directly in a browser. It is one self-contained file: the
page code and Wasm engine are inlined, so it does not need a server or a network connection.

## 🏗️ Architecture

| Layer | Implementation |
| :--- | :--- |
| Simulation | Rust/Wasm `World::run_tick`; per-cell buffers stay in Wasm linear memory |
| Concurrency | One Web Worker and one `WorldProxy` per world |
| Rendering | WebGL2 instanced hexes, per-world framebuffers, dirty-gated composition, optional 3D torus projection |
| App control | `WorldManager` plus a publish/subscribe `EventBus` between logic and the vanilla-JS UI |
| Persistence | Versioned codecs plus `localStorage` for browser-local libraries and preferences |
| Reuse boundary | `src/embed/` provides the DOM-free shared API and the `<hexlife-world>` browser entry |

<details>
<summary>Repository layout</summary>

<br>

| Path | What it contains |
| :--- | :--- |
| `index.html`, `src/` | Explorer application, UI, renderer, services, and JavaScript simulation orchestration |
| `hexlife-wasm/` | Rust tick engine compiled to WebAssembly |
| `src/embed/` | Reusable single-world runtime and host boundary |
| `packages/hexlife-embed/` | Metadata and documentation for the published embed package |
| `tests/` | Explorer unit, regression, determinism, and codec tests |

The Explorer and the separate Reddit app share the engine, ruleset descriptors, and world codec
through the versioned `@hexlife/embed` package.

</details>

## 🤝 Share and contribute rulesets

**To post a Live Specimen:**

1. In the Explorer, open **Share** and choose **Copy post kit & open r/hexlife**.
2. On the subreddit, use **⋯ → New HexLife post**.
3. Paste the `HXW1.…` line into the form and use the suggested title.

Reddit does not provide a public URL that opens an installed app's creation form, so this handoff
cannot be completed automatically from the Explorer.

**To propose a ruleset for the bundled public catalog:**

1. Save it to your personal library with a name, a description, at least one standard tag, and a
   paired starting condition. Those four are what turn a personal save into a usable catalog entry,
   and the Explorer checks for them before it lets the submission out.
2. Open its **⋯** menu and choose **Submit to public library**. This opens a prefilled
   [ruleset submission issue](https://github.com/Sidem/HexLife/issues/new?template=ruleset-submission.yml)
   carrying the entry and a link that loads the rule — nothing else from your browser.
3. Say how you want to be credited in the form's **Credit** field. Accepted entries are merged into
   [`src/core/library/rulesets.json`](src/core/library/rulesets.json) with that credit on the card;
   leave it blank to be credited as your GitHub username.

Prefer to open the pull request yourself? The same menu still offers **Copy as public-library JSON**,
which puts the exact committed entry shape on your clipboard. Either way, leave the thumbnail out —
the app bakes and caches those locally from the paired start.

General bug reports and feature proposals are welcome in
[GitHub Issues](https://github.com/Sidem/HexLife/issues). Code contributions should pass
`npm run lint`, `npm run typecheck`, `npm run test:run`, and the Rust tests — the same quality gate
CI enforces on every push.

## ⌨️ Keyboard shortcuts

The in-app viewer is generated from the live shortcut registry and is the authoritative reference.
It supports modifier layers, full-registry search, and a categorized mobile list.

| Keys | Action |
| :--- | :--- |
| `Ctrl`/`⌘`+`K` | Open the desktop command palette |
| `P` or `Space` | Play / pause |
| `V` | Toggle flat / 3D torus view |
| `↑` / `↓` | Change speed; hold to ramp |
| `←` / `→` | Step backward / forward while paused |
| `1`–`9` | Select a world in the 3×3 layout |
| `Shift`+`1`–`9` | Enable / disable a world |
| `G` / `M` / `Shift`+`M` | Generate / clone-and-mutate / mutate |
| `R` / `Shift`+`R` | Reset all / reset selected |
| `Escape` | Close the active popout or top-most panel |

<details>
<summary>More shortcuts</summary>

<br>

| Keys | Action |
| :--- | :--- |
| `Shift`+`V` | Start recording with the last settings / stop and save |
| `Ctrl`/`⌘`+`Shift`+`V` | Pause / resume the active recording |
| Hold `H` + drag | Shift the world across its wrap-around boundary |
| `L` | Lock / unlock the selected world's ruleset |
| `B` / `Shift`+`B` | Mark a breeding parent / breed offspring |
| `O` / `I` | Clone the selected ruleset to all / invert it |
| `C` / `Shift`+`C` | Clear all / clear selected |
| `D` / `Shift`+`D` | Restore default starts / copy selected start to all, then reset |
| `T` / `Shift`+`T` | Capture a saved start for selected / all worlds |
| `Ctrl`/`⌘`+`C` / `Ctrl`/`⌘`+`V` | Copy / paste a cell-region pattern |
| `Ctrl`/`⌘`+Numpad `1`–`9` | Copy the selected world's exact state to another world |
| `R` / `Shift`+`R` while placing | Rotate a pattern 60° clockwise / counter-clockwise |
| `F` / `Shift`+`F` while placing | Mirror a pattern horizontally / vertically |
| `Ctrl`/`⌘`+`Z` / `Ctrl`/`⌘`+`Shift`+`Z` | Undo / redo a ruleset change |
| `N` / `E` / `S` / `A` | Open Ruleset Actions / Editor / World Setup / Analysis |

</details>

## 🏷️ Versioning & releases

Explorer releases use [Semantic Versioning](https://semver.org/), with the version single-sourced
in `package.json`. The running build also shows its Git commit in **Settings**, because the GitHub
Pages demo deploys from every push to `main` and may be ahead of the latest tag.

Breaking changes are defined by reproducibility rather than UI shape: ruleset codes, `HXW1.…` world
codes, share links, `<hexlife-world>` attributes, and deterministic trajectories must keep their
meaning. See the public [CHANGELOG](CHANGELOG.md) for release notes and [`CITATION.cff`](CITATION.cff)
for citation metadata.

The [HexLife-Devvit](https://github.com/Sidem/HexLife-Devvit) app versions and ships separately on
Reddit's review cadence.

## 📄 License

Released under the [MIT License](LICENSE) — © 2025 Sidem.
