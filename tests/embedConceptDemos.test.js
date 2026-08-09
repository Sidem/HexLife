import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

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
    expect(page).toContain('embed-concept-lab.css?v=20260809-concepts')
    expect(page).toContain('embed-concept-lab.js?v=20260809-concepts')
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

  it('links the library from both Explorer menus', () => {
    expect(read('index.html')).toContain('href="embed-demos.html"')
    expect(read('src/ui/views/MoreView.js')).toContain('href="embed-demos.html"')
  })
})
