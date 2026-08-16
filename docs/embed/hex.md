[← `@hexlife/embed` docs](./README.md)

# `/hex` — unbounded pointy-top axial geometry

`@hexlife/embed/hex` is a zero-dependency geometry module for hosts that need a hexagonal map but
do not need a HexLife cellular automaton. It has no DOM, WebGL, or Wasm dependency and is safe in
Node, browser workers, and browsers.

```ts
import {
  HEX_DIRECTIONS,
  axialNeighbor,
  axialToChunk,
  axialToPixel,
  pixelToAxial,
  rotateHexDirection,
} from '@hexlife/embed/hex'
```

## Frozen coordinate convention

- Axial coordinates are `{q, r}`; the implicit cube coordinate is `s = -q - r`.
- Hexes are pointy-top. `size` is a hexagon's circumradius (center to corner).
- Pixel +X points right and +Y points down. The optional pixel origin defaults to `{x: 0, y: 0}`.
- Direction indices are clockwise in that screen coordinate system:

| Index | Name | `q` | `r` |
| ---: | :--- | ---: | ---: |
| 0 | east | 1 | 0 |
| 1 | southeast | 0 | 1 |
| 2 | southwest | -1 | 1 |
| 3 | west | -1 | 0 |
| 4 | northwest | 0 | -1 |
| 5 | northeast | 1 | -1 |

Positive rotation steps are clockwise. Directions normalize modulo six, so `-1` is northeast and
`7` is southeast. Topology operations require safe integer axial coordinates; pixel conversion and
rounding accept finite fractional coordinates.

## Geometry

```ts
const next = axialNeighbor({q: 4, r: -3}, 1) // {q: 4, r: -2}
const facing = rotateHexDirection(1, 2)       // 3 (west)
const rotated = rotateAxial({q: 1, r: 0}, 1) // {q: 0, r: 1}
const distance = axialDistance({q: 0, r: 0}, {q: 3, r: -1}) // 3
```

`HEX_DIRECTIONS` is a frozen six-entry table. `directionVector()` returns a mutable `{q, r}` copy.
`axialToCube()` and `cubeToAxial()` expose the equivalent three-axis representation.

`roundCube()` rounds each axis, then corrects the axis with the largest error so `q + r + s = 0`.
Exact error ties prefer `q`, then `r`, then `s`. `roundAxial()` uses exactly that policy. This makes
pixel hit testing and line traversal deterministic even on a mathematical cell boundary.

`axialLine(from, to)` returns both endpoints and every shortest-path sample between them. A zero-
length line returns one coordinate.

## Pixels and hit testing

```ts
const origin = {x: canvas.width / 2, y: canvas.height / 2}
const center = axialToPixel({q: -2, r: 5}, 18, origin)
const fractional = pixelToFractionalAxial(pointer, 18, origin)
const picked = pixelToAxial(pointer, 18, origin)
```

The pointy-top transform is:

```text
x = origin.x + size × √3 × (q + r/2)
y = origin.y + size × 3/2 × r
```

`pixelToFractionalAxial()` is its inverse. `pixelToAxial()` additionally applies the pinned cube
rounding policy and is the placement/picking helper.

## Unbounded storage chunks

`axialToChunk(coordinate, chunkSize)` divides q and r independently into fixed-size square axial
chunks and returns `{chunkQ, chunkR, localQ, localR}`. It uses mathematical floor division, never
truncation toward zero:

```ts
axialToChunk({q: -1, r: -17}, 16)
// {chunkQ: -1, chunkR: -2, localQ: 15, localR: 15}
```

Local coordinates are always in `[0, chunkSize)`. `chunkToAxial()` is the checked inverse. Chunk
shape is a storage convention, not a world boundary: axial coordinates remain unbounded and
non-toroidal.

## Complete exports

- Direction protocol: `HEX_DIRECTIONS`, `normalizeHexDirection`, `directionVector`,
  `rotateHexDirection`, `axialNeighbor`, `rotateAxial`.
- Coordinate math: `axialToCube`, `cubeToAxial`, `axialDistance`, `roundCube`, `roundAxial`,
  `axialLine`.
- Pixels: `axialToPixel`, `pixelToFractionalAxial`, `pixelToAxial`.
- Storage: `axialToChunk`, `chunkToAxial`.

The declaration exports `AxialCoordinate`, `CubeCoordinate`, `PixelPoint`, `HexDirection`,
`HexDirectionName`, `HexDirectionDefinition`, and `ChunkAddress`.
