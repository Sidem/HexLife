import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('@hexlife/embed/render package boundary', () => {
  it('publishes the renderer-only entry with declarations and build input', () => {
    const manifest = JSON.parse(read('packages/hexlife-embed/package.json'))
    expect(manifest.exports['./render']).toEqual({
      types: './src/embed/render.d.ts',
      import: './src/embed/render.js',
      default: './src/embed/render.js',
    })
    expect(read('vite.embed.config.js')).toContain("render: 'src/embed/render.js'")
    expect(read('scripts/prepare-embed-package.mjs')).toContain("'src/embed/render.d.ts'")
  })

  it('owns no simulation and keeps draw separate from explicit state upload', () => {
    const source = read('src/embed/render.js')
    expect(source).not.toContain("from './EmbedSim.js'")
    expect(source).toContain('this._renderer.setExternalState(cells, ruleIndices)')
    expect(source).toMatch(/draw\(\) \{[\s\S]*this\._renderer\.drawCurrent\(\)/)
    expect(source).toMatch(/panBy\(deltaX, deltaY\) \{[\s\S]*setView/)
  })

  it('shares the flat shader toroidal mapping and canonical row-major hit result', () => {
    const shader = read('shaders/vertex.glsl')
    const source = read('src/embed/render.js')
    expect(shader).toContain('uniform bool u_repeatToroidal')
    expect(shader).toContain('round((center - u_pan) / period)')
    expect(shader).toContain('uniform vec2 u_repeatOffset')
    expect(source).toContain('index: hit.row * this.columns + hit.col')
  })

  it('keeps verified state and draft overlays on separate buffers', () => {
    const source = read('src/embed/EmbedRenderer.js')
    expect(source).toContain('this.stateBuffer')
    expect(source).toContain('this.ghostBuffer')
    expect(source).toContain('setDraftPreview(edits)')
    expect(source).toContain('this.ghostBytes[edit.index]')
  })
})
