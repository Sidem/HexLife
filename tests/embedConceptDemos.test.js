import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  openCentralMembrane,
  sealPerimeter,
  sealVerticalSeam,
} from '../public/embed-concept-boundaries.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')

const CONCEPTS = [
  ['living-postcard', 'living-postcard.html'],
  ['crystal-garden', 'crystal-garden.html'],
  ['hex-ecology', 'hex-ecology.html'],
  ['excitable-tissue', 'excitable-tissue.html'],
  ['mixing-chamber', 'mixing-chamber.html'],
  ['wildfire-command', 'wildfire-command.html'],
  ['outbreak-counterfactuals', 'outbreak-counterfactuals.html'],
  ['butterfly-microscope', 'butterfly-microscope.html'],
  ['containment', 'containment.html'],
  ['cellular-synth', 'cellular-synth.html'],
  ['evolution-arena', 'evolution-arena.html'],
  ['hex-matter', 'hex-matter.html'],
]

describe('embed concept demo library', () => {
  it.each(CONCEPTS)('%s has a dedicated published-package page', (id, route) => {
    const page = read(`public/${route}`)
    expect(page).toContain(`data-concept="${id}"`)
    expect(page).toContain('embed-demo-shell.css')
    expect(page).toContain('embed-concept-lab.css?v=20260809-boundaries')
    expect(page).toContain('embed-concept-lab.js?v=20260809-boundaries')
    expect(page).toContain('@hexlife/embed@1.7.1/+esm')
    expect(page).toContain('@hexlife/embed@1.7.1/ca/+esm')
    expect(page).toContain('@hexlife/embed@1.7.1/ca-element/+esm')
    expect(page).not.toContain('@hexlife/embed@latest')
  })

  it('orders every concept exactly once from simple to complex', () => {
    const library = read('public/embed-demos.html')
    let cursor = -1
    for (const [, route] of CONCEPTS) {
      const next = library.indexOf(`href="./${route}"`)
      expect(next).toBeGreaterThan(cursor)
      expect(library.match(new RegExp(`href="\\./${route.replace('.', '\\.')}"`, 'g'))).toHaveLength(1)
      cursor = next
    }
    expect(library).toContain('01 · SIMPLEST')
    expect(library).toContain('12 · MOST COMPLEX')
  })

  it('keeps models and application behaviors in one shared package-consumer host', () => {
    const host = read('public/embed-concept-lab.js')
    expect(host).toContain("import '@hexlife/embed'")
    expect(host).toContain("from '@hexlife/embed/ca'")
    expect(host).toContain("import '@hexlife/embed/ca-element'")
    expect(host).toContain('ruleFromTable(4')
    expect(host).toContain('blockRuleFromTable(8')
    expect(host).toContain('snapshotCells()')
    expect(host).toContain("document.createElement('hexlife-grid')")
    expect(host).toContain('world.world.lastChangedCount')
    expect(host).toContain('world.caCode()')
    expect(host).toContain('world.worldCode()')
    expect(host).toContain('new AudioContext()')
  })

  it('seals the mixing reservoirs at the toroidal seam and opens only the visible gate', () => {
    const rows = 12
    const columns = 18
    const cells = new Uint8Array(rows * columns)
    const middle = columns / 2
    for (let row = 0; row < rows; row++) {
      cells.fill(1, row * columns, row * columns + middle)
      cells.fill(2, row * columns + middle, (row + 1) * columns)
      for (let offset = -1; offset <= 1; offset++) {
        cells[row * columns + middle + offset] = 3
      }
    }

    sealVerticalSeam(cells, rows, columns, 3)
    openCentralMembrane(cells, rows, columns)

    for (let row = 0; row < rows; row++) {
      expect(cells[row * columns + columns - 1]).toBe(3)
      expect(cells[row * columns]).toBe(3)
      expect(cells[row * columns + 1]).toBe(3)
    }
    for (let row = Math.floor(rows * 0.38); row < Math.ceil(rows * 0.62); row++) {
      expect([...cells.slice(row * columns + middle - 1, row * columns + middle + 2)]).toEqual([0, 0, 0])
    }
    expect(cells[middle - 1]).toBe(3)
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

  it('declares which concept topologies are sealed and which intentionally wrap', () => {
    const host = read('public/embed-concept-lab.js')
    expect(host).toContain("topology: 'two sealed reservoirs'")
    expect(host).toContain("topology: 'sealed clearing rim'")
    expect(host).toContain("topology: 'sealed scar rim'")
    expect(host).toContain("topology: 'sealed stone vessel'")
    expect(host).toContain("topology: 'intentional toroidal habitat'")
    expect(host).toContain("topology: 'intentional toroidal population'")
    expect(host).toContain('return sealVerticalSeam(cells, rows, columns, 3)')
    expect(host.match(/sealPerimeter\(cells, rows, columns, [034]\)/g)).toHaveLength(4)
    expect(host).toContain('const weights = [1 + wind, 1 + wind, 1, 1, 1, 1]')
  })

  it('links the library from both Explorer menus', () => {
    expect(read('index.html')).toContain('href="embed-demos.html"')
    expect(read('src/ui/views/MoreView.js')).toContain('href="embed-demos.html"')
  })
})
