import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
import {isVacuumStable} from '../src/core/rulesetHex.js'
import {sealPerimeter} from '../public/embed-concept-boundaries.js'
import {
  combinedExposureProbability,
  createGasModel,
  createOutbreakModel,
  createWildfireModel,
  neighborIndex,
} from '../public/embed-concept-models.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')

const CONCEPTS = [
  ['crystal-garden', 'crystal-garden.html'],
  ['hex-ecology', 'hex-ecology.html'],
  ['excitable-tissue', 'excitable-tissue.html'],
  ['mixing-chamber', 'mixing-chamber.html'],
  ['wildfire-command', 'wildfire-command.html'],
  ['outbreak-counterfactuals', 'outbreak-counterfactuals.html'],
  ['butterfly-microscope', 'butterfly-microscope.html'],
  ['cellular-synth', 'cellular-synth.html'],
  ['hex-matter', 'hex-matter.html'],
]

describe('embed concept demo library', () => {
  it.each(CONCEPTS)('%s has a dedicated published-package page', (id, route) => {
    const page = read(`public/${route}`)
    expect(page).toContain(`data-concept="${id}"`)
    expect(page).toContain('embed-demo-shell.css')
    expect(page).toContain('embed-concept-lab.css?v=20260811-run-history')
    expect(page).toContain('embed-concept-lab.js?v=20260811-run-history')
    // The package's OWN files, never jsDelivr's `/+esm` aliases. `+esm` re-bundles each subpath
    // entry standalone, so `@hexlife/embed/sim` would carry a private copy of `EmbedSim` — its own
    // module state and its own Wasm instance — and the analysis primitives would be inspecting a
    // different engine from the one the elements run. That is exactly how Butterfly and Synth broke.
    for (const entry of ['index', 'ca', 'ca-element', 'sim', 'stochastic', 'stochastic-element']) {
      expect(page).toContain(`@hexlife/embed@1.10.0/src/embed/${entry}.js`)
    }
    expect(page).not.toContain('+esm')
    expect(page).not.toContain('@hexlife/embed@latest')
  })

  it('orders the retained concepts exactly once from simple to complex', () => {
    const library = read('public/embed-demos.html')
    let cursor = -1
    for (const [, route] of CONCEPTS) {
      const next = library.indexOf(`href="./${route}"`)
      expect(next).toBeGreaterThan(cursor)
      expect(library.match(new RegExp(`href="\\./${route.replace('.', '\\.')}"`, 'g'))).toHaveLength(1)
      cursor = next
    }
    expect(library).toContain('01 · SIMPLEST')
    expect(library).toContain('09 · MOST COMPLEX')
    expect(library).not.toContain('Living Postcard')
    expect(library).not.toContain('Containment')
    expect(library).not.toContain('Evolution Arena')
  })

  it('keeps the models and application behaviors in one package-consumer host', () => {
    const host = read('public/embed-concept-lab.js')
    expect(host).toContain("import '@hexlife/embed'")
    expect(host).toContain("from '@hexlife/embed/ca'")
    expect(host).toContain("import '@hexlife/embed/ca-element'")
    expect(host).toContain('ruleFromTable(4')
    // Hex Matter's table is built from the model module, so the arity travels with it.
    expect(host).toContain('blockRuleFromTable(MATTER_STATES')
    expect(host).toContain("from './hex-matter-model.js'")
    expect(host).toContain('world.world.lastChangedCount')
    expect(host).toContain('world.caCode()')
    expect(host).toContain('world.worldCode()')
    expect(host).toContain('world.stochasticCode()')
    expect(host).toContain('new AudioContext()')
    expect(host).toContain('difference-overlay')
    expect(host).toContain('Custom 32-character ruleset')
  })

  it('runs every stochastic demo on the engine, seeded by the frozen builders', () => {
    const host = read('public/embed-concept-lab.js')
    // The rules, seeds and interventions all come from the one module the differential tests use.
    expect(host).toContain("import('./embed-stochastic-rules.js')")
    expect(host).toContain('stochastic.wildfireInitialState')
    expect(host).toContain('stochastic.outbreakInitialState')
    expect(host).toContain('stochastic.mixingChamber')
    expect(host).toContain('world.seed = BigInt(stochastic[item.seedName])')
    // Three `<hexlife-stochastic>` demos and no `<hexlife-ca>` standing in for one.
    expect(host).toContain("document.createElement('hexlife-stochastic')")
    expect(host.match(/kind: 'stochastic-/g)).toHaveLength(3)
  })

  it('keeps the lattice gas finite and conserves each species exactly', () => {
    const model = createGasModel(18, 24)
    model.reset({density: 38, scatter: 12})
    const count = (state) => model.cells.filter((cell) => cell === state).length
    const before = [count(1), count(2)]
    const middle = 12
    const crossed = () => [...model.cells].filter((state, index) => (
      (state === 1 && index % 24 > middle) || (state === 2 && index % 24 < middle)
    )).length
    for (let tick = 0; tick < 80; tick++) model.step()
    expect(crossed()).toBe(0)
    model.openMembrane()
    for (let tick = 0; tick < 160; tick++) model.step()
    expect([count(1), count(2)]).toEqual(before)
    expect(crossed()).toBeGreaterThan(0)
    for (let column = 0; column < 24; column++) {
      expect(model.cells[column]).toBe(3)
      expect(model.cells[17 * 24 + column]).toBe(3)
    }
    expect(neighborIndex(0, 0, 18, 24, false)).toBe(-1)
  })

  it('isolates finite demos from both row and column wraps', () => {
    const rows = 9
    const columns = 12
    const cells = new Uint8Array(rows * columns).fill(1)
    sealPerimeter(cells, rows, columns, 7, 2)
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const border = row < 2 || row >= rows - 2 || column < 2 || column >= columns - 2
        expect(cells[row * columns + column]).toBe(border ? 7 : 1)
      }
    }
  })

  it('records the whole outbreak run and reads it arm against arm', () => {
    const host = read('public/embed-concept-lab.js')
    expect(host).toContain("import {RunHistory, toCsv} from './lab-history.js'")
    expect(host).toContain('new RunHistory({channels: OUTBREAK_CHANNELS')
    // The side-by-side statistics and the full-run section are what make this demo readable; the
    // rolling 90-sample trace every other demo draws is exactly what a counterfactual cannot use.
    expect(host).toContain('renderOutbreakArms')
    expect(host).toContain('class="arm-table"')
    expect(host).toContain('id="chart-prevalence"')
    expect(host).toContain('id="chart-cases"')
    // Peaks are read off the history, which measures them over every generation — never off the
    // thinned curve, which may not contain the peak at all.
    expect(host).toContain("history.peak('baselineInfectious')")
    expect(host).toContain("history.peak('policyInfectious')")
    // Anything that changes the study mid-run has to be in the record, or the curve has a kink in
    // it that nothing on the page explains.
    expect(host).toContain('history.mark(left.generation')
    expect(host).toContain('toCsv(OUTBREAK_CSV_COLUMNS, history.records())')
  })

  it('declares finite and intentionally wrapped topologies without hidden seam hacks', () => {
    const host = read('public/embed-concept-lab.js')
    expect(host).toContain("topology: 'finite reflecting vessel'")
    expect(host).toContain("topology: 'sealed clearing rim'")
    expect(host).toContain("topology: 'sealed scar rim'")
    expect(host).toContain("topology: 'sealed stone basin'")
    expect(host).toContain("topology: 'intentional toroidal habitat'")
    expect(host).toContain("topology: 'intentional toroidal population'")
    expect(host).not.toContain('sealVerticalSeam')
  })

  it('uses monotonic per-neighbor infection probability and deterministic schedules', () => {
    expect(combinedExposureProbability(0.12, 0)).toBe(0)
    expect(combinedExposureProbability(0.12, 3)).toBeGreaterThan(combinedExposureProbability(0.12, 2))
    const first = createOutbreakModel(18, 24)
    const second = createOutbreakModel(18, 24)
    const params = {infection: 18, infectiousTicks: 5, immunityTicks: 30, coverage: 0, efficacy: 85}
    first.reset(params)
    second.reset(params)
    for (let tick = 0; tick < 20; tick++) { first.step(); second.step() }
    expect(first.cells).toEqual(second.cells)
    expect(first.totalInfections).toBe(second.totalInfections)
  })

  it('supports wind-free spread and delayed ash recovery deterministically', () => {
    const first = createWildfireModel(18, 24)
    const second = createWildfireModel(18, 24)
    const params = {forest: 90, spread: 40, wind: 'none', windBoost: 4, burnTicks: 1, ashTicks: 4, regrowth: 20}
    first.reset(params)
    second.reset(params)
    for (let tick = 0; tick < 12; tick++) { first.step(); second.step() }
    expect(first.cells).toEqual(second.cells)
    expect(first.cells.some((cell) => cell === 2 || cell === 3)).toBe(true)
  })

  it('links the library from both Explorer menus', () => {
    expect(read('index.html')).toContain('href="embed-demos.html"')
    expect(read('src/ui/views/MoreView.js')).toContain('href="embed-demos.html"')
  })
})

describe('Solid Garden', () => {
  const page = () => read('public/solid-garden.html')
  const host = () => read('public/solid-garden.js')

  it('is a package consumer pinned to an exact published version', () => {
    const html = page()
    // Every subpath resolves from the package's OWN files at one exact version. `@latest` lags a
    // publish by hours, and `/+esm` re-bundles each entry standalone — which would hand `/solid`
    // its own module state and its own Wasm instance, separate from the engine feeding it.
    for (const entry of ['api', 'sim', 'render', 'solid']) {
      expect(html).toMatch(
        new RegExp(`"@hexlife/embed/${entry}": "https://cdn\\.jsdelivr\\.net/npm/@hexlife/embed@\\d+\\.\\d+\\.\\d+/src/embed/${entry}\\.js"`),
      )
    }
    expect(html).not.toContain('+esm')
    expect(html).not.toContain('@hexlife/embed@latest')

    // One version across the import map and the card that advertises it.
    const versions = new Set([...html.matchAll(/@hexlife\/embed@(\d+\.\d+\.\d+)/g)].map((m) => m[1]))
    expect(versions.size, `one pinned version, saw ${[...versions].join(', ')}`).toBe(1)
  })

  it('wears the shared demo shell and is reachable from the library', () => {
    const html = page()
    expect(html).toContain('data-concept="solid-garden"')
    expect(html).toContain('embed-demo-shell.css')
    expect(html).toContain('href="./solid-garden.html" aria-current="page"')
    expect(html).toContain('Built with the published npm package')
    expect(read('public/embed-demos.html')).toContain('href="./solid-garden.html"')
  })

  it('lives in public/, where an import-map page has to live', () => {
    // Vite resolves inline-module specifiers itself, so an import-map page can never be a build
    // input — naming one would also replace Vite's default input set rather than extend it.
    const config = read('vite.config.js')
    expect(config).not.toContain('solid-garden.html')
  })

  it('defaults to the configuration the connectivity guarantee actually covers', () => {
    const html = page()
    const source = host()
    // §5.3's guarantee needs a vacuum-stable rule AND bridge with at least one sub-layer. The
    // default has to be the configuration that provably prints as one piece, not one that usually
    // does — soup and `interpolate: none` are what a user opts into afterwards.
    expect(html).toContain('<option value="bridge" selected>')
    expect(html).toMatch(/id="sub-layers"[^>]*value="1"/)
    expect(html).toMatch(/<option value="seed">A single seed<\/option>[\s\S]*<option value="soup">/)
    expect(html).toContain('<option value="plate-connected" selected>')
    // And the claim is conditioned on both halves rather than asserted whenever it looks true.
    expect(source).toContain(
      "const guaranteed = stable && options.interpolate === 'bridge' && options.subLayers >= 1",
    )
  })

  it('offers only vacuum-stable presets that can grow from one cell', () => {
    const source = host()
    const presets = [...source.matchAll(/hex: '([0-9A-F]{32})'/g)].map((match) => match[1])
    expect(presets.length).toBeGreaterThanOrEqual(4)
    for (const hex of presets) {
      // Vacuum stability is exactly "the empty neighbourhood stays empty", which is rule index 0 —
      // the high bit of the first hex character. So the whole predicate is the leading digit.
      expect(isVacuumStable(hex), `${hex} is vacuum-stable`).toBe(true)
    }
    expect(new Set(presets).size).toBe(presets.length)
  })

  it('reads the report before it offers a download', () => {
    const source = host()
    expect(source).toContain("stack.finalize({keepComponents: options.keepComponents})")
    expect(source).toContain('setVerdict(report, stable, options)')
    // A slicer will not join separate bodies, so the page has to say so rather than hand over a
    // file that quietly prints as thirty-seven pieces.
    expect(source).toContain('separate bodies')
    expect(source).toContain('ui.download.disabled = true')
  })

  it('hides its own overlay with an author rule, not the bare hidden attribute', () => {
    // `hidden` works through a *user-agent* `display: none`, which loses to any author `display` on
    // the same element — and `.garden-overlay` sets `display: grid`. Without the restatement the
    // overlay sits fully opaque over the canvas forever and a page that finished building looks
    // permanently stuck on "Growing…". This shipped once; it does not get to ship twice.
    const css = read('public/solid-garden.css')
    const rule = css.slice(css.indexOf('.garden-overlay[hidden]'))
    expect(css).toContain('.garden-overlay[hidden]')
    expect(rule.slice(0, 60)).toContain('display: none')

    // Same trap, same fix, for the draw-tool group.
    expect(css).toContain('.garden-draw-tools[hidden]')
  })

  it('is reachable from every other demo in the library', () => {
    // A demo nobody can navigate to is not in the library. The concept pages render their nav from
    // the shared host, so that string is the tenth page.
    for (const file of [
      'totalistic-256.html',
      'public/coffee-percolation.html',
      'public/ca-builder.html',
      'public/embed-demos.html',
      'public/embed-concept-lab.js',
    ]) {
      expect(read(file), `${file} links Solid Garden`).toContain('./solid-garden.html')
    }
  })

  it('lets a visitor draw the initial state instead of only seeding one', () => {
    const html = page()
    const source = host()
    expect(html).toContain('<option value="draw">')
    expect(html).toContain('id="draw-clear"')
    expect(html).toContain('id="draw-random"')
    expect(html).toContain('id="draw-centre"')
    // The hit test is the renderer's own inverse of its layout. A second copy of the hexagon
    // geometry in the page is exactly the drift the geometry contract exists to prevent.
    expect(source).toContain('renderer.hitTest(')
    // A drawing has to survive a grid change, and row-major means a flat copy would shear it.
    expect(source).toContain('function fitDrawn')
  })

  it('opens the grid up to the engine ceiling rather than an arbitrary one', () => {
    const html = page()
    const source = host()
    const max = (id) => Number(/max="(\d+)"/.exec(html.match(new RegExp(`<input id="${id}"[^>]*>`))[0])[1])
    expect(max('rows')).toBeGreaterThanOrEqual(128)
    expect(max('cols')).toBeGreaterThanOrEqual(128)
    expect(max('ticks')).toBeGreaterThanOrEqual(200)
    // Columns must stay even: the odd-q lattice does not close otherwise and the engine refuses.
    expect(html).toMatch(/<input id="cols"[^>]*step="2"/)
    // Past the real ceiling the page has to explain what to reduce, not surface a raw constructor
    // error — so it knows the ceiling itself.
    expect(source).toContain('const MAX_VOXELS = 1 << 24')
    expect(source).toContain('past the engine')
  })

  it('moves data in bulk and never loops over cells', () => {
    const source = host()
    // The one permitted copy per tick, and its scrubber twin — both bulk, neither a loop.
    expect(source).toContain('layer.set(world.state)')
    expect(source).toContain('snapshots.push(world.state.slice())')
    expect(source).toContain('stack.free()')
    expect(source).toContain('world.dispose?.()')
    // Nothing may read the volume one voxel at a time from JavaScript.
    expect(source).not.toContain('voxelAt')
    // The tick loop's body is exactly the four bulk statements above.
    const loop = source.slice(source.indexOf('for (let tick = 0; tick < options.ticks; tick++)'))
    const body = loop.slice(loop.indexOf('{') + 1, loop.indexOf('}'))
    expect(body).not.toMatch(/\bfor\b|\bwhile\b|\.forEach\(/)
  })
})
