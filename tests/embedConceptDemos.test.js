import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
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
    expect(page).toContain('embed-concept-lab.css?v=20260810-deep-demos')
    expect(page).toContain('embed-concept-lab.js?v=20260810-stochastic-native')
    for (const entry of ['', 'ca/', 'ca-element/', 'sim/', 'stochastic/', 'stochastic-element/']) {
      expect(page).toContain(`@hexlife/embed@1.9.0/${entry}+esm`)
    }
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
    expect(host).toContain('blockRuleFromTable(8')
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

  it('declares finite and intentionally wrapped topologies without hidden seam hacks', () => {
    const host = read('public/embed-concept-lab.js')
    expect(host).toContain("topology: 'finite reflecting vessel'")
    expect(host).toContain("topology: 'sealed clearing rim'")
    expect(host).toContain("topology: 'sealed scar rim'")
    expect(host).toContain("topology: 'sealed stone vessel'")
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
