/**
 * Paint a stable state across the vertical torus seam.
 *
 * `radius = 1` covers the three columns `last, 0, 1`, so a transition cannot couple the two
 * visually opposite sides of a chamber through the canonical column wrap.
 */
export function sealVerticalSeam(cells, rows, columns, state, radius = 1) {
  for (let row = 0; row < rows; row++) {
    for (let offset = -radius; offset <= radius; offset++) {
      const column = (offset + columns) % columns;
      cells[row * columns + column] = state;
    }
  }
  return cells;
}

/** Paint a stable-state border that isolates a finite rectangle from both toroidal wraps. */
export function sealPerimeter(cells, rows, columns, state, width = 2) {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (
        row < width
        || row >= rows - width
        || column < width
        || column >= columns - width
      ) {
        cells[row * columns + column] = state;
      }
    }
  }
  return cells;
}

/** Open a centered gate through a three-column internal membrane, leaving the torus seam sealed. */
export function openCentralMembrane(cells, rows, columns) {
  const middle = Math.floor(columns / 2);
  for (let row = Math.floor(rows * 0.38); row < Math.ceil(rows * 0.62); row++) {
    for (let offset = -1; offset <= 1; offset++) {
      cells[row * columns + middle + offset] = 0;
    }
  }
  return cells;
}
