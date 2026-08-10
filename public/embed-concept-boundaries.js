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
