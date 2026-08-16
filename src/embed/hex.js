// @ts-check

/** @typedef {{q: number, r: number}} AxialCoordinate */
/** @typedef {{q: number, r: number, s: number}} CubeCoordinate */
/** @typedef {{x: number, y: number}} PixelPoint */
/** @typedef {0 | 1 | 2 | 3 | 4 | 5} HexDirection */

const SQRT_3 = Math.sqrt(3)
const ORIGIN = Object.freeze({x: 0, y: 0})

/**
 * Pointy-top axial directions in clockwise screen order (+Y is down): east, southeast, southwest,
 * west, northwest, northeast.
 */
export const HEX_DIRECTIONS = Object.freeze([
  Object.freeze({index: 0, name: 'east', q: 1, r: 0}),
  Object.freeze({index: 1, name: 'southeast', q: 0, r: 1}),
  Object.freeze({index: 2, name: 'southwest', q: -1, r: 1}),
  Object.freeze({index: 3, name: 'west', q: -1, r: 0}),
  Object.freeze({index: 4, name: 'northwest', q: 0, r: -1}),
  Object.freeze({index: 5, name: 'northeast', q: 1, r: -1}),
])

/** @param {number} direction @returns {HexDirection} */
export function normalizeHexDirection(direction) {
  assertInteger(direction, 'direction')
  return /** @type {HexDirection} */ (((direction % 6) + 6) % 6)
}

/** @param {number} direction */
export function directionVector(direction) {
  const value = HEX_DIRECTIONS[normalizeHexDirection(direction)]
  return {q: value.q, r: value.r}
}

/** @param {number} direction @param {number} [clockwiseSteps] */
export function rotateHexDirection(direction, clockwiseSteps = 1) {
  assertInteger(clockwiseSteps, 'clockwiseSteps')
  return normalizeHexDirection(normalizeHexDirection(direction) + clockwiseSteps)
}

/**
 * @param {AxialCoordinate} coordinate
 * @param {number} direction
 * @param {number} [distance]
 */
export function axialNeighbor(coordinate, direction, distance = 1) {
  assertIntegerAxial(coordinate, 'coordinate')
  assertInteger(distance, 'distance')
  const vector = directionVector(direction)
  return {q: coordinate.q + vector.q * distance, r: coordinate.r + vector.r * distance}
}

/**
 * Rotate an axial coordinate around `center`. Positive steps are clockwise in screen space.
 * @param {AxialCoordinate} coordinate
 * @param {number} clockwiseSteps
 * @param {AxialCoordinate} [center]
 */
export function rotateAxial(coordinate, clockwiseSteps, center = {q: 0, r: 0}) {
  assertIntegerAxial(coordinate, 'coordinate')
  assertIntegerAxial(center, 'center')
  assertInteger(clockwiseSteps, 'clockwiseSteps')
  let q = coordinate.q - center.q
  let r = coordinate.r - center.r
  const steps = normalizeHexDirection(clockwiseSteps)
  for (let step = 0; step < steps; step += 1) [q, r] = [-r, q + r]
  return {q: q + center.q, r: r + center.r}
}

/** @param {AxialCoordinate} coordinate @returns {CubeCoordinate} */
export function axialToCube(coordinate) {
  assertFiniteAxial(coordinate, 'coordinate')
  return {q: coordinate.q, r: coordinate.r, s: -coordinate.q - coordinate.r}
}

/** @param {CubeCoordinate} coordinate @returns {AxialCoordinate} */
export function cubeToAxial(coordinate) {
  assertFiniteCube(coordinate, 'coordinate')
  return {q: coordinate.q, r: coordinate.r}
}

/** @param {AxialCoordinate} from @param {AxialCoordinate} to */
export function axialDistance(from, to) {
  assertIntegerAxial(from, 'from')
  assertIntegerAxial(to, 'to')
  const dq = to.q - from.q
  const dr = to.r - from.r
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}

/**
 * Round a fractional cube coordinate. If errors tie, correction priority is q, then r, then s.
 * @param {CubeCoordinate} coordinate
 * @returns {CubeCoordinate}
 */
export function roundCube(coordinate) {
  assertFiniteCube(coordinate, 'coordinate')
  if (Math.abs(coordinate.q + coordinate.r + coordinate.s) > 1e-9) {
    throw new RangeError('coordinate.q + coordinate.r + coordinate.s must equal 0')
  }
  let q = Math.round(coordinate.q)
  let r = Math.round(coordinate.r)
  let s = Math.round(coordinate.s)
  const qError = Math.abs(q - coordinate.q)
  const rError = Math.abs(r - coordinate.r)
  const sError = Math.abs(s - coordinate.s)
  if (qError >= rError && qError >= sError) q = -r - s
  else if (rError >= sError) r = -q - s
  else s = -q - r
  return {q: normalizeZero(q), r: normalizeZero(r), s: normalizeZero(s)}
}

/** @param {AxialCoordinate} coordinate @returns {AxialCoordinate} */
export function roundAxial(coordinate) {
  assertFiniteAxial(coordinate, 'coordinate')
  return cubeToAxial(roundCube(axialToCube(coordinate)))
}

/**
 * Convert a pointy-top axial coordinate to a pixel center. `size` is the circumradius.
 * @param {AxialCoordinate} coordinate
 * @param {number} size
 * @param {PixelPoint} [origin]
 * @returns {PixelPoint}
 */
export function axialToPixel(coordinate, size, origin = ORIGIN) {
  assertFiniteAxial(coordinate, 'coordinate')
  assertSize(size)
  assertPoint(origin, 'origin')
  return {
    x: origin.x + size * SQRT_3 * (coordinate.q + coordinate.r / 2),
    y: origin.y + size * 1.5 * coordinate.r,
  }
}

/**
 * Convert a pixel point to a fractional pointy-top axial coordinate.
 * @param {PixelPoint} point
 * @param {number} size
 * @param {PixelPoint} [origin]
 * @returns {AxialCoordinate}
 */
export function pixelToFractionalAxial(point, size, origin = ORIGIN) {
  assertPoint(point, 'point')
  assertSize(size)
  assertPoint(origin, 'origin')
  const x = (point.x - origin.x) / size
  const y = (point.y - origin.y) / size
  return {q: (SQRT_3 / 3) * x - y / 3, r: (2 / 3) * y}
}

/** @param {PixelPoint} point @param {number} size @param {PixelPoint} [origin] */
export function pixelToAxial(point, size, origin = ORIGIN) {
  return roundAxial(pixelToFractionalAxial(point, size, origin))
}

/**
 * Inclusive shortest line. Boundary samples use `roundCube`'s q, r, s tie priority.
 * @param {AxialCoordinate} from
 * @param {AxialCoordinate} to
 * @returns {AxialCoordinate[]}
 */
export function axialLine(from, to) {
  assertIntegerAxial(from, 'from')
  assertIntegerAxial(to, 'to')
  const distance = axialDistance(from, to)
  if (distance === 0) return [{q: from.q, r: from.r}]
  const result = []
  for (let step = 0; step <= distance; step += 1) {
    const t = step / distance
    result.push(roundAxial({q: lerp(from.q, to.q, t), r: lerp(from.r, to.r, t)}))
  }
  return result
}

/**
 * Map an unbounded axial coordinate into square axial storage chunks. Division is mathematical
 * floor, so `q=-1` at size 16 maps to chunk -1, local 15.
 * @param {AxialCoordinate} coordinate
 * @param {number} chunkSize
 */
export function axialToChunk(coordinate, chunkSize) {
  assertIntegerAxial(coordinate, 'coordinate')
  assertChunkSize(chunkSize)
  const chunkQ = Math.floor(coordinate.q / chunkSize)
  const chunkR = Math.floor(coordinate.r / chunkSize)
  return {
    chunkQ,
    chunkR,
    localQ: coordinate.q - chunkQ * chunkSize,
    localR: coordinate.r - chunkR * chunkSize,
  }
}

/**
 * @param {{chunkQ: number, chunkR: number, localQ: number, localR: number}} address
 * @param {number} chunkSize
 * @returns {AxialCoordinate}
 */
export function chunkToAxial(address, chunkSize) {
  assertChunkSize(chunkSize)
  assertInteger(address?.chunkQ, 'chunkQ')
  assertInteger(address?.chunkR, 'chunkR')
  assertInteger(address?.localQ, 'localQ')
  assertInteger(address?.localR, 'localR')
  if (address.localQ < 0 || address.localQ >= chunkSize) throw new RangeError('localQ out of range')
  if (address.localR < 0 || address.localR >= chunkSize) throw new RangeError('localR out of range')
  return {
    q: address.chunkQ * chunkSize + address.localQ,
    r: address.chunkR * chunkSize + address.localR,
  }
}

/** @param {number} a @param {number} b @param {number} t */
function lerp(a, b, t) {
  return a + (b - a) * t
}

/** @param {number} value */
function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value
}

/** @param {unknown} value @param {string} name @returns {asserts value is number} */
function assertInteger(value, name) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer`)
}

/** @param {unknown} value @param {string} name @returns {asserts value is number} */
function assertFinite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`)
}

/** @param {AxialCoordinate | undefined | null} value @param {string} name */
function assertFiniteAxial(value, name) {
  assertFinite(value?.q, `${name}.q`)
  assertFinite(value?.r, `${name}.r`)
}

/** @param {AxialCoordinate | undefined | null} value @param {string} name */
function assertIntegerAxial(value, name) {
  assertInteger(value?.q, `${name}.q`)
  assertInteger(value?.r, `${name}.r`)
}

/** @param {CubeCoordinate | undefined | null} value @param {string} name */
function assertFiniteCube(value, name) {
  assertFinite(value?.q, `${name}.q`)
  assertFinite(value?.r, `${name}.r`)
  assertFinite(value?.s, `${name}.s`)
}

/** @param {PixelPoint | undefined | null} value @param {string} name */
function assertPoint(value, name) {
  assertFinite(value?.x, `${name}.x`)
  assertFinite(value?.y, `${name}.y`)
}

/** @param {number} size */
function assertSize(size) {
  assertFinite(size, 'size')
  if (size <= 0) throw new RangeError('size must be greater than 0')
}

/** @param {number} chunkSize */
function assertChunkSize(chunkSize) {
  assertInteger(chunkSize, 'chunkSize')
  if (chunkSize <= 0) throw new RangeError('chunkSize must be greater than 0')
}
