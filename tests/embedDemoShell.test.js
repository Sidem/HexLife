import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')

const DEMOS = [
  ['totalistic-256.html', 'totalistic-256.html'],
  ['public/coffee-percolation.html', 'coffee-percolation.html'],
  ['public/ca-builder.html', 'ca-builder.html'],
  ['public/solid-garden.html', 'solid-garden.html'],
]

describe('embed demo presentation shell', () => {
  it.each(DEMOS)('%s uses the common package-showcase wrapper', (sourcePath, route) => {
    const page = read(sourcePath)

    expect(page).toContain('class="demo-page"')
    expect(page).toContain('embed-demo-shell.css')
    expect(page).toMatch(/class="[^"]*\bdemo-shell\b[^"]*"/)
    expect(page).toContain('class="demo-masthead"')
    expect(page).toContain('class="demo-nav"')
    expect(page).toContain('href="./embed-demos.html"')
    expect(page).toContain(`href="./${route}" aria-current="page"`)
    expect(page).toContain('href="./totalistic-256.html"')
    expect(page).toContain('href="./coffee-percolation.html"')
    expect(page).toContain('href="./ca-builder.html"')
    expect(page).toContain('href="./solid-garden.html"')
    expect(page).toContain('class="demo-package-card"')
    expect(page).toContain('Built with the published npm package')
    expect(page).toContain('https://www.npmjs.com/package/@hexlife/embed')
    expect(page).toContain('class="demo-content"')
    expect(page).toContain('class="demo-footer"')
    expect(page).toContain('Built with <strong>@hexlife/embed</strong> from npm.')
  })

  it('keeps the shared shell in public while preserving each demo build boundary', () => {
    const config = read('vite.config.js')
    const shell = read('public/embed-demo-shell.css')

    expect(config).toContain("totalistic: 'totalistic-256.html'")
    expect(config).not.toMatch(/input:[\s\S]*(?:coffee-percolation|ca-builder)\.html'/)
    expect(shell).toContain('.demo-masthead')
    expect(shell).toContain('.demo-package-card')
    expect(shell).toContain('.demo-footer')
  })

  it('lists the complete showcase in both public readmes', () => {
    for (const readme of [read('README.md'), read('packages/hexlife-embed/README.md')]) {
      expect(readme).toContain('totalistic-256.html')
      expect(readme).toContain('coffee-percolation.html')
      expect(readme).toContain('ca-builder.html')
      expect(readme).toContain('embed-demos.html')
      expect(readme).toContain('@hexlife/embed')
    }
  })
})
