import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {repeatOffsetsForViewport} from '../src/embed/repeatToroidal.js'

const shader = () => readFileSync(new URL('../shaders/vertex.glsl', import.meta.url), 'utf8')

describe('flat toroidal renderer repetition', () => {
  it('wraps each hex centre before adding its vertices', () => {
    const source = shader()
    expect(source).toContain('center -= round((center - u_pan) / period) * period')
    expect(source).toContain('vec2 pos = (a_position * u_hexSize) + center')
    expect(source).not.toContain('round((pos - u_pan) / period)')
  })

  it('uses one world at fitted zoom and enough copies when zoomed out', () => {
    expect(repeatOffsetsForViewport(1000, 800, 1, 1000, 1000, 1)).toEqual([{x: 0, y: 0}])

    const offsets = repeatOffsetsForViewport(1000, 800, 0.4, 1000, 1000, 1)
    expect(offsets).toHaveLength(9)
    expect(offsets).toContainEqual({x: -1000, y: -1000})
    expect(offsets).toContainEqual({x: 1000, y: 1000})
  })

  it('expands only the axis that extends beyond the nearest fundamental domain', () => {
    expect(repeatOffsetsForViewport(1800, 600, 0.5, 1000, 2000, 10)).toEqual([
      {x: -2000, y: 0},
      {x: -1000, y: 0},
      {x: 0, y: 0},
      {x: 1000, y: 0},
      {x: 2000, y: 0},
    ])
  })
})
