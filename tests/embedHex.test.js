import {readFile} from 'node:fs/promises'
import {describe, expect, it} from 'vitest'

import {
  HEX_DIRECTIONS,
  axialDistance,
  axialLine,
  axialNeighbor,
  axialToChunk,
  axialToPixel,
  chunkToAxial,
  directionVector,
  normalizeHexDirection,
  pixelToAxial,
  pixelToFractionalAxial,
  rotateAxial,
  rotateHexDirection,
  roundAxial,
  roundCube,
} from '../src/embed/hex.js'

describe('@hexlife/embed/hex public contract', () => {
  it('pins the six clockwise pointy-top directions', () => {
    expect(HEX_DIRECTIONS).toEqual([
      {index: 0, name: 'east', q: 1, r: 0},
      {index: 1, name: 'southeast', q: 0, r: 1},
      {index: 2, name: 'southwest', q: -1, r: 1},
      {index: 3, name: 'west', q: -1, r: 0},
      {index: 4, name: 'northwest', q: 0, r: -1},
      {index: 5, name: 'northeast', q: 1, r: -1},
    ])
    expect(HEX_DIRECTIONS.every(Object.isFrozen)).toBe(true)
    expect(Object.isFrozen(HEX_DIRECTIONS)).toBe(true)
  })

  it('looks up all six neighbors and wraps directions', () => {
    const center = {q: 4, r: -3}
    expect(HEX_DIRECTIONS.map(({index}) => axialNeighbor(center, index))).toEqual([
      {q: 5, r: -3},
      {q: 4, r: -2},
      {q: 3, r: -2},
      {q: 3, r: -3},
      {q: 4, r: -4},
      {q: 5, r: -4},
    ])
    expect(normalizeHexDirection(-1)).toBe(5)
    expect(directionVector(7)).toEqual({q: 0, r: 1})
    expect(axialNeighbor(center, 0, -2)).toEqual({q: 2, r: -3})
  })

  it('rotates directions and coordinates clockwise through six exact positions', () => {
    expect(Array.from({length: 6}, (_, step) => rotateHexDirection(0, step))).toEqual([
      0, 1, 2, 3, 4, 5,
    ])
    expect(Array.from({length: 6}, (_, step) => rotateAxial({q: 1, r: 0}, step))).toEqual([
      {q: 1, r: 0},
      {q: 0, r: 1},
      {q: -1, r: 1},
      {q: -1, r: 0},
      {q: 0, r: -1},
      {q: 1, r: -1},
    ])
    expect(rotateAxial({q: 4, r: 2}, -1, {q: 3, r: 2})).toEqual({q: 4, r: 1})
  })

  it('pins distance and inclusive line traversal, including a turn-adjacent diagonal', () => {
    expect(axialDistance({q: -2, r: 3}, {q: 3, r: -1})).toBe(5)
    expect(axialLine({q: 0, r: 0}, {q: 2, r: 1})).toEqual([
      {q: 0, r: 0},
      {q: 1, r: 0},
      {q: 1, r: 1},
      {q: 2, r: 1},
    ])
    expect(axialLine({q: -2, r: 4}, {q: -2, r: 4})).toEqual([{q: -2, r: 4}])
  })

  it('rounds cube coordinates with q, r, s tie priority', () => {
    expect(roundCube({q: 0.5, r: -1, s: 0.5})).toEqual({q: 0, r: -1, s: 1})
    expect(roundCube({q: 1, r: 0.5, s: -1.5})).toEqual({q: 1, r: 0, s: -1})
    expect(roundAxial({q: -1.49, r: 2.02})).toEqual({q: -1, r: 2})
    expect(() => roundCube({q: 1, r: 1, s: 1})).toThrow(/must equal 0/)
  })

  it('round-trips pointy-top pixels with arbitrary origin and negative coordinates', () => {
    const size = 17
    const origin = {x: 301.25, y: 177.75}
    for (const coordinate of [
      {q: 0, r: 0},
      {q: 8, r: -3},
      {q: -11, r: 7},
    ]) {
      const pixel = axialToPixel(coordinate, size, origin)
      expect(pixelToFractionalAxial(pixel, size, origin).q).toBeCloseTo(coordinate.q, 12)
      expect(pixelToFractionalAxial(pixel, size, origin).r).toBeCloseTo(coordinate.r, 12)
      expect(pixelToAxial(pixel, size, origin)).toEqual(coordinate)
    }
  })

  it('pins exact hit-test boundary behavior to cube q-first rounding', () => {
    const boundary = axialToPixel({q: 0.5, r: 0}, 20)
    expect(pixelToAxial(boundary, 20)).toEqual({q: 0, r: 0})
    expect(pixelToAxial({x: boundary.x - 1e-8, y: boundary.y}, 20)).toEqual({q: 0, r: 0})
    expect(pixelToAxial({x: boundary.x + 1e-8, y: boundary.y}, 20)).toEqual({q: 1, r: 0})
  })

  it('maps negative axial coordinates with floor division and round-trips every edge', () => {
    const fixtures = [
      [{q: 0, r: 0}, {chunkQ: 0, chunkR: 0, localQ: 0, localR: 0}],
      [{q: 15, r: 15}, {chunkQ: 0, chunkR: 0, localQ: 15, localR: 15}],
      [{q: 16, r: 16}, {chunkQ: 1, chunkR: 1, localQ: 0, localR: 0}],
      [{q: -1, r: -1}, {chunkQ: -1, chunkR: -1, localQ: 15, localR: 15}],
      [{q: -16, r: -17}, {chunkQ: -1, chunkR: -2, localQ: 0, localR: 15}],
      [{q: 17, r: -16}, {chunkQ: 1, chunkR: -1, localQ: 1, localR: 0}],
    ]
    for (const [coordinate, expected] of fixtures) {
      const address = axialToChunk(coordinate, 16)
      expect(address).toEqual(expected)
      expect(chunkToAxial(address, 16)).toEqual(coordinate)
    }
  })

  it('rejects invalid sizes, non-integer topology inputs, and invalid chunk locals', () => {
    expect(() => axialToPixel({q: 0, r: 0}, 0)).toThrow(/greater than 0/)
    expect(() => axialNeighbor({q: 0.5, r: 0}, 0)).toThrow(/safe integer/)
    expect(() => axialToChunk({q: 0, r: 0}, 2.5)).toThrow(/safe integer/)
    expect(() => chunkToAxial({chunkQ: 0, chunkR: 0, localQ: 16, localR: 0}, 16)).toThrow(
      /localQ out of range/,
    )
  })

  it('ships a DOM/Wasm-free typed package boundary', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../packages/hexlife-embed/package.json', import.meta.url), 'utf8'),
    )
    const prepare = await readFile(
      new URL('../scripts/prepare-embed-package.mjs', import.meta.url),
      'utf8',
    )
    const source = await readFile(new URL('../src/embed/hex.js', import.meta.url), 'utf8')
    expect(manifest.exports['./hex']).toEqual({
      types: './src/embed/hex.d.ts',
      import: './src/embed/hex.js',
      default: './src/embed/hex.js',
    })
    expect(manifest.sideEffects).not.toContain('./src/embed/hex.js')
    expect(prepare).toContain("['src/embed/hex.d.ts', 'dist/embed-package/src/embed/hex.d.ts']")
    expect(source).not.toMatch(/document|window|WebAssembly|wasm/i)
  })
})
