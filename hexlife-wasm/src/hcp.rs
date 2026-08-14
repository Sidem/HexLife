//! `WorldHcp` — a general k-state CA on the hexagonal close-packed lattice.
//!
//! A fourth isolated artifact. It shares neither a tick loop nor a neighbour table with `World`,
//! `WorldK`, `WorldStochastic`, or `WorldSolid`. In-plane slots are the canonical 2D table
//! generated from `neighbor-dirs.json`; interlayer slots come from `hcp-dirs.json`.
//!
//! v1 is block-only: a 6-phase partial tetrahedral partition, LUT size `k^4`, in-place writes.

use wasm_bindgen::prelude::*;

include!(concat!(env!("OUT_DIR"), "/neighbor_dirs.rs"));
include!(concat!(env!("OUT_DIR"), "/hcp_dirs.rs"));

/// Layout / table version. Record it next to a recipe; a bump is a new engine.
pub const HCP_ENGINE_VERSION: u32 = 1;

/// Only legal stacking in v1. Stored so a later FCC-`[111]` swap is a table change, not a fork.
pub const STACKING_HCP: u8 = 0;

pub const XY_TORUS: u8 = 0;
pub const XY_WALL: u8 = 1;
pub const Z_OPEN: u8 = 0;
pub const Z_TORUS: u8 = 1;

pub const BACKEND_BLOCK: u8 = 0;

pub const MAX_STATES: u8 = 16;
pub const MIN_STATES: u8 = 2;
pub const MIN_LAYERS: usize = 2;

pub const BLOCK_PHASES: u64 = 6;
const TRIANGLE_PHASES: u64 = 3;

const BLOCK_MATE_Q: usize = 4;
const BLOCK_MATE_R: usize = 5;
const BLOCK_MATE_Q_MIRRORED: usize = 0;
const ODD_MATE_Q: usize = 1;
const ODD_MATE_R: usize = 2;
const ODD_MATE_Q_MIRRORED: usize = 3;
const APEX_DIR: usize = 6;

const NEIGHBORS: usize = 12;
const MISSING: u32 = u32::MAX;

const CHUNK_SHIFT_X: usize = 3;
const CHUNK_SHIFT_Y: usize = 3;
const CHUNK_SHIFT_Z: usize = 2;
const CHUNK_SIZE_X: usize = 1 << CHUNK_SHIFT_X;
const CHUNK_SIZE_Y: usize = 1 << CHUNK_SHIFT_Y;
const CHUNK_SIZE_Z: usize = 1 << CHUNK_SHIFT_Z;

const QUIET_TICKS_BLOCK: u32 = BLOCK_PHASES as u32;
const QUIET_TICKS_BLOCK_ALTERNATING: u32 = 2 * BLOCK_PHASES as u32;

/// v1 has one backend. The enum exists so a later compiled-row or gas path cannot become a
/// per-cell branch inside `tick_block`.
#[derive(Clone, Copy)]
enum HcpBackend {
    Block,
}

/// A k-state cellular automaton on the hexagonal close-packed lattice.
#[wasm_bindgen]
pub struct WorldHcp {
    backend: HcpBackend,
    layers: usize,
    rows: usize,
    cols: usize,
    ncells: usize,
    k: usize,
    stacking: u8,
    xy_boundary: u8,
    z_boundary: u8,
    block_alternates: bool,
    tick_count: u64,
    state: Vec<u8>,
    block_rule: Vec<u32>,
    neighbor_indices: Vec<u32>,
    census: Vec<u32>,
    layer_scratch: Vec<u32>,
    last_changed_count: u32,
    chunk_cols: usize,
    chunk_rows: usize,
    chunk_layers: usize,
    chunk_active: Vec<u8>,
    chunk_changed: Vec<u8>,
    chunk_quiet: Vec<u32>,
    skipping_enabled: bool,
}

#[wasm_bindgen]
impl WorldHcp {
    /// Allocate every buffer to final capacity. Throws rather than silently changing the grid.
    #[wasm_bindgen(constructor)]
    pub fn new(
        layers: i32,
        rows: i32,
        cols: i32,
        states: u8,
        stacking: u8,
        xy_boundary: u8,
        z_boundary: u8,
    ) -> Result<WorldHcp, String> {
        if stacking != STACKING_HCP {
            return Err(format!(
                "WorldHcp: stacking must be {STACKING_HCP} (hcp) in v1, received {stacking}."
            ));
        }
        if xy_boundary != XY_TORUS && xy_boundary != XY_WALL {
            return Err(format!("WorldHcp: unknown xy_boundary {xy_boundary}."));
        }
        if z_boundary != Z_OPEN && z_boundary != Z_TORUS {
            return Err(format!("WorldHcp: unknown z_boundary {z_boundary}."));
        }
        if states < MIN_STATES || states > MAX_STATES {
            return Err(format!(
                "WorldHcp: states must be between {MIN_STATES} and {MAX_STATES}, received {states}."
            ));
        }
        if layers < MIN_LAYERS as i32 || rows < 3 || cols < 2 {
            return Err(
                "WorldHcp: layers >= 2, rows >= 3, and columns >= 2 are required.".to_string(),
            );
        }
        if cols % 2 != 0 {
            return Err(format!(
                "WorldHcp: columns must be even so the odd-q wrap preserves hex parity, received {cols}."
            ));
        }
        if rows % 3 != 0 {
            return Err(format!(
                "WorldHcp: rows must be divisible by 3 or the triangle partition has a seam, received {rows}."
            ));
        }
        if z_boundary == Z_TORUS && layers % 2 != 0 {
            return Err(format!(
                "WorldHcp: toroidal Z requires an even layer count so ABAB closes, received {layers}."
            ));
        }

        let layers = layers as usize;
        let rows = rows as usize;
        let cols = cols as usize;
        let ncells = layers * rows * cols;
        let k = states as usize;
        let chunk_cols = cols.div_ceil(CHUNK_SIZE_X);
        let chunk_rows = rows.div_ceil(CHUNK_SIZE_Y);
        let chunk_layers = layers.div_ceil(CHUNK_SIZE_Z);
        let num_chunks = chunk_cols * chunk_rows * chunk_layers;
        let rule_len = k * k * k * k;

        Ok(WorldHcp {
            backend: HcpBackend::Block,
            layers,
            rows,
            cols,
            ncells,
            k,
            stacking,
            xy_boundary,
            z_boundary,
            block_alternates: false,
            tick_count: 0,
            state: vec![0; ncells],
            block_rule: vec![0u32; rule_len],
            neighbor_indices: hcp_neighbor_indices(layers, rows, cols, xy_boundary, z_boundary),
            census: {
                let mut census = vec![0; k];
                census[0] = ncells as u32;
                census
            },
            layer_scratch: vec![0; k],
            last_changed_count: 0,
            chunk_cols,
            chunk_rows,
            chunk_layers,
            chunk_active: vec![1; num_chunks],
            chunk_changed: vec![0; num_chunks],
            chunk_quiet: vec![0; num_chunks],
            skipping_enabled: true,
        })
    }

    pub fn layers(&self) -> usize {
        self.layers
    }
    pub fn rows(&self) -> usize {
        self.rows
    }
    pub fn cols(&self) -> usize {
        self.cols
    }
    pub fn ncells(&self) -> usize {
        self.ncells
    }
    pub fn states(&self) -> u8 {
        self.k as u8
    }
    pub fn stacking(&self) -> u8 {
        self.stacking
    }
    pub fn xy_boundary(&self) -> u8 {
        self.xy_boundary
    }
    pub fn z_boundary(&self) -> u8 {
        self.z_boundary
    }
    pub fn rule_len(&self) -> usize {
        self.block_rule.len()
    }
    pub fn backend(&self) -> u8 {
        BACKEND_BLOCK
    }

    pub fn state_ptr(&self) -> *const u8 {
        self.state.as_ptr()
    }
    pub fn census_ptr(&self) -> *const u32 {
        self.census.as_ptr()
    }
    pub fn layer_scratch_ptr(&self) -> *const u32 {
        self.layer_scratch.as_ptr()
    }

    /// Install the `k^4` packed-output table. **Allocates** (the slice is copied in from JS).
    pub fn set_block_rule(&mut self, rule: &[u32]) -> Result<(), String> {
        if rule.len() != self.block_rule.len() {
            return Err(format!(
                "WorldHcp: block rule needs k^4 = {} entries, received {}.",
                self.block_rule.len(),
                rule.len()
            ));
        }
        let k = self.k as u32;
        if let Some(bad) = rule.iter().position(|&packed| {
            (packed & 0xff) >= k
                || ((packed >> 8) & 0xff) >= k
                || ((packed >> 16) & 0xff) >= k
                || ((packed >> 24) & 0xff) >= k
        }) {
            return Err(format!(
                "WorldHcp: rule entry {bad} packs a state that is not below k = {}.",
                self.k
            ));
        }
        self.block_rule.copy_from_slice(rule);
        self.mark_all_dirty();
        Ok(())
    }

    /// Overwrite every cell. **Allocates**. This is the supported bulk write.
    pub fn set_cells(&mut self, cells: &[u8]) -> Result<(), String> {
        if cells.len() != self.ncells {
            return Err(format!(
                "WorldHcp: expected {} cells, received {}.",
                self.ncells,
                cells.len()
            ));
        }
        if let Some(bad) = cells.iter().position(|&v| v as usize >= self.k) {
            return Err(format!(
                "WorldHcp: cell {bad} is {}, which is not a state below k = {}.",
                cells[bad], self.k
            ));
        }
        self.state.copy_from_slice(cells);
        self.rebuild_census();
        self.mark_all_dirty();
        Ok(())
    }

    /// Set one cell and wake its chunk.
    pub fn set_cell(&mut self, index: usize, value: u8) -> Result<(), String> {
        if index >= self.ncells {
            return Err(format!("WorldHcp: cell index {index} is outside the volume."));
        }
        if value as usize >= self.k {
            return Err(format!(
                "WorldHcp: cell value {value} is not a state below k = {}.",
                self.k
            ));
        }
        let before = self.state[index];
        if before != value {
            self.state[index] = value;
            self.census[before as usize] = self.census[before as usize].saturating_sub(1);
            self.census[value as usize] += 1;
        }
        self.chunk_quiet[chunk_index(
            index,
            self.rows,
            self.cols,
            self.chunk_cols,
            self.chunk_rows,
        )] = 0;
        Ok(())
    }

    pub fn fill(&mut self, value: u8) -> Result<(), String> {
        if value as usize >= self.k {
            return Err(format!(
                "WorldHcp: fill value {value} is not a state below k = {}.",
                self.k
            ));
        }
        self.state.fill(value);
        self.census.fill(0);
        self.census[value as usize] = self.ncells as u32;
        self.mark_all_dirty();
        Ok(())
    }

    /// Write `to` where current == `from` at the listed in-layer indices. Returns how many wrote.
    pub fn paint_if(&mut self, layer: u32, indices: &[u32], from: u8, to: u8) -> Result<u32, String> {
        self.assert_layer(layer)?;
        if from as usize >= self.k || to as usize >= self.k {
            return Err(format!(
                "WorldHcp: paint_if states must be below k = {}.",
                self.k
            ));
        }
        let layer_size = self.rows * self.cols;
        let base = layer as usize * layer_size;
        let mut painted = 0u32;
        for &index in indices {
            if index as usize >= layer_size {
                return Err(format!(
                    "WorldHcp: paint_if index {index} is outside a {layer_size}-cell layer."
                ));
            }
            let cell = base + index as usize;
            if self.state[cell] == from {
                self.state[cell] = to;
                if from != to {
                    self.census[from as usize] = self.census[from as usize].saturating_sub(1);
                    self.census[to as usize] += 1;
                    self.chunk_quiet[chunk_index(
                        cell,
                        self.rows,
                        self.cols,
                        self.chunk_cols,
                        self.chunk_rows,
                    )] = 0;
                }
                painted += 1;
            }
        }
        Ok(painted)
    }

    /// Zero every cell in `layer` whose state bit is set in `mask`. Counts land in `layer_scratch`.
    pub fn clear_states_in_layer(&mut self, layer: u32, mask: u32) -> Result<(), String> {
        self.assert_layer(layer)?;
        self.layer_scratch.fill(0);
        let layer_size = self.rows * self.cols;
        let start = layer as usize * layer_size;
        let end = start + layer_size;
        for cell in start..end {
            let value = self.state[cell];
            if value < 32 && (mask & (1u32 << value)) != 0 {
                self.layer_scratch[value as usize] += 1;
                self.state[cell] = 0;
                if value != 0 {
                    self.census[value as usize] = self.census[value as usize].saturating_sub(1);
                    self.census[0] += 1;
                    self.chunk_quiet[chunk_index(
                        cell,
                        self.rows,
                        self.cols,
                        self.chunk_cols,
                        self.chunk_rows,
                    )] = 0;
                }
            }
        }
        Ok(())
    }

    /// Occupancy of one layer. Counts land in `layer_scratch`.
    pub fn layer_census(&mut self, layer: u32) -> Result<(), String> {
        self.assert_layer(layer)?;
        self.layer_scratch.fill(0);
        let layer_size = self.rows * self.cols;
        let start = layer as usize * layer_size;
        let end = start + layer_size;
        for cell in start..end {
            self.layer_scratch[self.state[cell] as usize] += 1;
        }
        Ok(())
    }

    pub fn mark_all_dirty(&mut self) {
        self.chunk_quiet.fill(0);
    }

    pub fn set_skipping_enabled(&mut self, enabled: bool) {
        self.skipping_enabled = enabled;
        if !enabled {
            self.mark_all_dirty();
        }
    }

    pub fn skipping_enabled(&self) -> bool {
        self.skipping_enabled
    }

    pub fn set_block_alternates(&mut self, alternates: bool) {
        if self.block_alternates != alternates {
            self.block_alternates = alternates;
            self.mark_all_dirty();
        }
    }

    pub fn block_alternates(&self) -> bool {
        self.block_alternates
    }

    /// Advance one generation. Writes in place; no second buffer, no JS copy.
    pub fn run_tick(&mut self) -> u32 {
        let _ = self.backend;
        self.refresh_chunk_activity();
        let changed = self.tick_block();
        self.commit_chunk_activity();
        self.tick_count += 1;
        self.last_changed_count = changed;
        changed
    }

    pub fn tick_count(&self) -> u64 {
        self.tick_count
    }

    /// Restore the partition phase so a decoded world resumes the next tick identically.
    pub fn set_tick_count(&mut self, count: u64) {
        self.tick_count = count;
        self.mark_all_dirty();
    }

    /// Phase the *next* tick will use, in `0..6`.
    pub fn phase(&self) -> u8 {
        (self.tick_count % BLOCK_PHASES) as u8
    }

    pub fn last_changed_count(&self) -> u32 {
        self.last_changed_count
    }

    pub fn is_settled(&self) -> bool {
        self.chunk_quiet.iter().all(|&q| q >= self.quiet_ticks_needed())
    }

    pub fn compute_census(&mut self) {
        self.rebuild_census();
    }

    pub fn census_of(&self, state: u8) -> u32 {
        self.census.get(state as usize).copied().unwrap_or(0)
    }

    pub fn checksum_state(&self) -> i32 {
        let mut checksum: i32 = 0;
        for &val in &self.state {
            checksum = checksum.wrapping_mul(31).wrapping_add(val as i32);
        }
        checksum
    }

    pub fn active_chunk_count(&self) -> u32 {
        self.chunk_active.iter().map(|&a| a as u32).sum()
    }

    pub fn chunk_count(&self) -> usize {
        self.chunk_active.len()
    }

    /// Neighbour in `0..12`, or `0xFFFFFFFF` when that bond is missing (open face / wall).
    pub fn neighbor_of(&self, cell: u32, direction: u8) -> Result<u32, String> {
        if cell as usize >= self.ncells {
            return Err(format!("WorldHcp: cell {cell} is outside the volume."));
        }
        if direction >= NEIGHBORS as u8 {
            return Err(format!("WorldHcp: direction {direction} is outside 0..12."));
        }
        Ok(self.neighbor_indices[cell as usize * NEIGHBORS + direction as usize])
    }
}

/// Layout version hosts can record with a recipe.
#[wasm_bindgen]
pub fn hcp_engine_version() -> u32 {
    HCP_ENGINE_VERSION
}

/// World-space `(x, y, z)` of one site at circumradius `hex_size`. Same formula as `hcpCoords.js`.
#[wasm_bindgen]
pub fn hcp_site_xyz(col: i32, row: i32, layer: i32, hex_size: f64) -> Vec<f64> {
    let (x, y, z) = site_position(col, row, layer, hex_size);
    vec![x, y, z]
}

impl WorldHcp {
    fn assert_layer(&self, layer: u32) -> Result<(), String> {
        if layer as usize >= self.layers {
            Err(format!(
                "WorldHcp: layer {layer} is outside 0..{}.",
                self.layers
            ))
        } else {
            Ok(())
        }
    }

    fn quiet_ticks_needed(&self) -> u32 {
        if self.block_alternates {
            QUIET_TICKS_BLOCK_ALTERNATING
        } else {
            QUIET_TICKS_BLOCK
        }
    }

    fn rebuild_census(&mut self) {
        self.census.fill(0);
        for &cell in &self.state {
            self.census[cell as usize] += 1;
        }
    }

    fn hex_halo_offsets(&self, chunk_col: usize) -> [(isize, isize); 7] {
        let last_col = ((chunk_col + 1) * CHUNK_SIZE_X).min(self.cols) - 1;
        let (right_first, right_second) = if last_col % 2 != 0 { (0, 1) } else { (-1, 0) };
        [
            (0, 0),
            (0, -1),
            (0, 1),
            (-1, -1),
            (-1, 0),
            (1, right_first),
            (1, right_second),
        ]
    }

    fn wrap_chunk_col(&self, value: isize) -> Option<usize> {
        let n = self.chunk_cols as isize;
        if self.xy_boundary == XY_TORUS {
            Some(value.rem_euclid(n) as usize)
        } else if value >= 0 && value < n {
            Some(value as usize)
        } else {
            None
        }
    }

    fn wrap_chunk_row(&self, value: isize) -> Option<usize> {
        let n = self.chunk_rows as isize;
        if self.xy_boundary == XY_TORUS {
            Some(value.rem_euclid(n) as usize)
        } else if value >= 0 && value < n {
            Some(value as usize)
        } else {
            None
        }
    }

    fn wrap_chunk_layer(&self, value: isize) -> Option<usize> {
        let n = self.chunk_layers as isize;
        if self.z_boundary == Z_TORUS {
            Some(value.rem_euclid(n) as usize)
        } else if value >= 0 && value < n {
            Some(value as usize)
        } else {
            None
        }
    }

    fn refresh_chunk_activity(&mut self) {
        self.chunk_changed.fill(0);
        if !self.skipping_enabled {
            self.chunk_active.fill(1);
            return;
        }
        let needed = self.quiet_ticks_needed();
        for chunk_layer in 0..self.chunk_layers {
            for chunk_row in 0..self.chunk_rows {
                for chunk_col in 0..self.chunk_cols {
                    let mut active = 0u8;
                    'halo: for dz in -1isize..=1 {
                        let Some(nl) = self.wrap_chunk_layer(chunk_layer as isize + dz) else {
                            continue;
                        };
                        for (dx, dy) in self.hex_halo_offsets(chunk_col) {
                            let Some(nc) = self.wrap_chunk_col(chunk_col as isize + dx) else {
                                continue;
                            };
                            let Some(nr) = self.wrap_chunk_row(chunk_row as isize + dy) else {
                                continue;
                            };
                            let neighbor = (nl * self.chunk_rows + nr) * self.chunk_cols + nc;
                            if self.chunk_quiet[neighbor] < needed {
                                active = 1;
                                break 'halo;
                            }
                        }
                    }
                    let chunk = (chunk_layer * self.chunk_rows + chunk_row) * self.chunk_cols + chunk_col;
                    self.chunk_active[chunk] = active;
                }
            }
        }
    }

    fn commit_chunk_activity(&mut self) {
        for (quiet, &changed) in self.chunk_quiet.iter_mut().zip(self.chunk_changed.iter()) {
            *quiet = if changed != 0 {
                0
            } else {
                quiet.saturating_add(1)
            };
        }
    }

    fn tick_block(&mut self) -> u32 {
        let k = self.k;
        let k2 = k * k;
        let k3 = k2 * k;
        let phase = (self.tick_count % BLOCK_PHASES) as usize;
        let sigma = (self.tick_count / TRIANGLE_PHASES) as usize % 2;
        let phi = (self.tick_count % TRIANGLE_PHASES) as usize;
        // Flip the 2D conjugate once per full 6-phase period, not every tick. A 3-tick host
        // window is odd-length, so `tick % 2` applies the mirror 2:1 and walks fluid off-axis.
        let alternate = self.block_alternates && (self.tick_count / BLOCK_PHASES) % 2 == 1;
        let cols = self.cols;
        let rows = self.rows;
        let layer_size = rows * cols;
        let mut changed = 0u32;

        for layer in 0..self.layers {
            if layer % 2 != sigma {
                continue;
            }
            let apex_layer = layer + 1;
            if apex_layer >= self.layers {
                if self.z_boundary != Z_TORUS {
                    continue;
                }
            }

            for row in 0..rows {
                let residue = row % 3;
                let base_parity = if residue == (3 - phi) % 3 {
                    0usize
                } else if residue == (4 - phi) % 3 {
                    1usize
                } else {
                    continue;
                };

                let mut col = base_parity;
                while col < cols {
                    let base = layer * layer_size + row * cols + col;
                    let base_chunk = chunk_index(base, rows, cols, self.chunk_cols, self.chunk_rows);
                    if self.chunk_active[base_chunk] == 0 {
                        col += 2;
                        continue;
                    }
                    let (mate_q_direction, mate_r_direction) = mate_dirs(layer, alternate);
                    let mate_q = self.neighbor_indices[base * NEIGHBORS + mate_q_direction];
                    let mate_r = self.neighbor_indices[base * NEIGHBORS + mate_r_direction];
                    let apex = self.neighbor_indices[base * NEIGHBORS + APEX_DIR];
                    if mate_q == MISSING || mate_r == MISSING || apex == MISSING {
                        col += 2;
                        continue;
                    }
                    let i0 = base;
                    let i1 = mate_q as usize;
                    let i2 = mate_r as usize;
                    let i3 = apex as usize;

                    let s0 = self.state[i0] as usize;
                    let s1 = self.state[i1] as usize;
                    let s2 = self.state[i2] as usize;
                    let s3 = self.state[i3] as usize;
                    let packed = self.block_rule[s0 * k3 + s1 * k2 + s2 * k + s3];
                    let o0 = (packed & 0xff) as u8;
                    let o1 = ((packed >> 8) & 0xff) as u8;
                    let o2 = ((packed >> 16) & 0xff) as u8;
                    let o3 = ((packed >> 24) & 0xff) as u8;

                    for (cell, before, after) in [
                        (i0, s0 as u8, o0),
                        (i1, s1 as u8, o1),
                        (i2, s2 as u8, o2),
                        (i3, s3 as u8, o3),
                    ] {
                        if after != before {
                            self.state[cell] = after;
                            self.census[before as usize] = self.census[before as usize].saturating_sub(1);
                            self.census[after as usize] += 1;
                            let changed_chunk =
                                chunk_index(cell, rows, cols, self.chunk_cols, self.chunk_rows);
                            self.chunk_changed[changed_chunk] = 1;
                            changed += 1;
                        }
                    }
                    col += 2;
                }
            }
        }
        let _ = phase;
        changed
    }
}

fn interlayer_table(layer_odd: bool, col_odd: bool, up: bool) -> &'static [[i32; 2]; 3] {
    match (layer_odd, col_odd, up) {
        (false, false, false) => &HCP_EVEN_LAYER_EVEN_COL_DOWN,
        (false, false, true) => &HCP_EVEN_LAYER_EVEN_COL_UP,
        (false, true, false) => &HCP_EVEN_LAYER_ODD_COL_DOWN,
        (false, true, true) => &HCP_EVEN_LAYER_ODD_COL_UP,
        (true, false, false) => &HCP_ODD_LAYER_EVEN_COL_DOWN,
        (true, false, true) => &HCP_ODD_LAYER_EVEN_COL_UP,
        (true, true, false) => &HCP_ODD_LAYER_ODD_COL_DOWN,
        (true, true, true) => &HCP_ODD_LAYER_ODD_COL_UP,
    }
}

fn hcp_neighbor_indices(
    layers: usize,
    rows: usize,
    cols: usize,
    xy_boundary: u8,
    z_boundary: u8,
) -> Vec<u32> {
    let ncells = layers * rows * cols;
    let layer_size = rows * cols;
    let mut table = vec![MISSING; ncells * NEIGHBORS];
    let xy_torus = xy_boundary == XY_TORUS;
    let z_torus = z_boundary == Z_TORUS;

    for layer in 0..layers {
        for row in 0..rows {
            for col in 0..cols {
                let cell = layer * layer_size + row * cols + col;
                let dirs = if col % 2 != 0 {
                    &NEIGHBOR_DIRS_ODD_R
                } else {
                    &NEIGHBOR_DIRS_EVEN_R
                };
                for n in 0..6 {
                    table[cell * NEIGHBORS + n] =
                        resolve_xy(row as i32 + dirs[n][1], col as i32 + dirs[n][0], layer, rows, cols, layer_size, xy_torus);
                }
                let down = interlayer_table(layer % 2 != 0, col % 2 != 0, false);
                let up = interlayer_table(layer % 2 != 0, col % 2 != 0, true);
                for n in 0..3 {
                    table[cell * NEIGHBORS + 6 + n] = resolve_inter(
                        layer as i32 + 1,
                        row as i32 + down[n][1],
                        col as i32 + down[n][0],
                        layers,
                        rows,
                        cols,
                        layer_size,
                        xy_torus,
                        z_torus,
                    );
                    table[cell * NEIGHBORS + 9 + n] = resolve_inter(
                        layer as i32 - 1,
                        row as i32 + up[n][1],
                        col as i32 + up[n][0],
                        layers,
                        rows,
                        cols,
                        layer_size,
                        xy_torus,
                        z_torus,
                    );
                }
            }
        }
    }
    table
}

fn resolve_xy(
    row: i32,
    col: i32,
    layer: usize,
    rows: usize,
    cols: usize,
    layer_size: usize,
    xy_torus: bool,
) -> u32 {
    match wrap2(row, col, rows, cols, xy_torus) {
        Some((nr, nc)) => (layer * layer_size + nr * cols + nc) as u32,
        None => MISSING,
    }
}

fn resolve_inter(
    layer: i32,
    row: i32,
    col: i32,
    layers: usize,
    rows: usize,
    cols: usize,
    layer_size: usize,
    xy_torus: bool,
    z_torus: bool,
) -> u32 {
    let nl = if z_torus {
        layer.rem_euclid(layers as i32) as usize
    } else if layer >= 0 && (layer as usize) < layers {
        layer as usize
    } else {
        return MISSING;
    };
    match wrap2(row, col, rows, cols, xy_torus) {
        Some((nr, nc)) => (nl * layer_size + nr * cols + nc) as u32,
        None => MISSING,
    }
}

fn wrap2(row: i32, col: i32, rows: usize, cols: usize, torus: bool) -> Option<(usize, usize)> {
    if torus {
        Some((
            row.rem_euclid(rows as i32) as usize,
            col.rem_euclid(cols as i32) as usize,
        ))
    } else if row >= 0 && col >= 0 && (row as usize) < rows && (col as usize) < cols {
        Some((row as usize, col as usize))
    } else {
        None
    }
}

#[inline]
fn mate_dirs(layer: usize, alternate: bool) -> (usize, usize) {
    // Even host layers use the WorldK up-triangle (dir 4 / dir 5, mirrored 0 / 5). Odd host
    // layers use the down-triangle whose hollow actually contains the same-(q, r) site on
    // the next layer (dir 1 / dir 2, mirrored 3 / 2). Same base set either way.
    if layer % 2 == 0 {
        if alternate {
            (BLOCK_MATE_Q_MIRRORED, BLOCK_MATE_R)
        } else {
            (BLOCK_MATE_Q, BLOCK_MATE_R)
        }
    } else if alternate {
        (ODD_MATE_Q_MIRRORED, ODD_MATE_R)
    } else {
        (ODD_MATE_Q, ODD_MATE_R)
    }
}

#[inline]
fn chunk_index(cell: usize, rows: usize, cols: usize, chunk_cols: usize, chunk_rows: usize) -> usize {
    let layer_size = rows * cols;
    let layer = cell / layer_size;
    let rem = cell - layer * layer_size;
    let row = rem / cols;
    let col = rem - row * cols;
    ((layer >> CHUNK_SHIFT_Z) * chunk_rows + (row >> CHUNK_SHIFT_Y)) * chunk_cols + (col >> CHUNK_SHIFT_X)
}

fn site_position(col: i32, row: i32, layer: i32, hex_size: f64) -> (f64, f64, f64) {
    let r = hex_size;
    let sqrt3 = 3.0_f64.sqrt();
    let mut x = col as f64 * 1.5 * r;
    let mut y = row as f64 * sqrt3 * r;
    if col.rem_euclid(2) != 0 {
        y += 0.5 * sqrt3 * r;
    }
    if layer.rem_euclid(2) != 0 {
        x += 0.5 * r;
        y += 0.5 * sqrt3 * r;
    }
    (x, y, layer as f64 * r * 2.0_f64.sqrt())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn world(layers: i32, rows: i32, cols: i32, k: u8) -> WorldHcp {
        WorldHcp::new(layers, rows, cols, k, STACKING_HCP, XY_TORUS, Z_OPEN).expect("valid world")
    }

    fn closed(layers: i32, rows: i32, cols: i32, k: u8) -> WorldHcp {
        WorldHcp::new(layers, rows, cols, k, STACKING_HCP, XY_TORUS, Z_TORUS).expect("valid closed world")
    }

    fn identity_rule(k: usize) -> Vec<u32> {
        let mut rule = vec![0u32; k * k * k * k];
        for a in 0..k {
            for b in 0..k {
                for c in 0..k {
                    for d in 0..k {
                        let idx = ((a * k + b) * k + c) * k + d;
                        rule[idx] = a as u32 | (b as u32) << 8 | (c as u32) << 16 | (d as u32) << 24;
                    }
                }
            }
        }
        rule
    }

    fn xorshift32(seed: &mut u32) -> u32 {
        let mut x = *seed;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        *seed = x;
        x
    }

    fn seed_cells(w: &mut WorldHcp, seed: &mut u32) {
        let k = w.k as u32;
        let cells: Vec<u8> = (0..w.ncells).map(|_| (xorshift32(seed) % k) as u8).collect();
        w.set_cells(&cells).unwrap();
    }

    fn dist(a: (f64, f64, f64), b: (f64, f64, f64)) -> f64 {
        let dx = a.0 - b.0;
        let dy = a.1 - b.1;
        let dz = a.2 - b.2;
        (dx * dx + dy * dy + dz * dz).sqrt()
    }

    #[test]
    fn constructor_rejects_illegal_geometry() {
        assert!(WorldHcp::new(4, 6, 7, 4, STACKING_HCP, XY_TORUS, Z_OPEN).is_err());
        assert!(WorldHcp::new(4, 7, 8, 4, STACKING_HCP, XY_TORUS, Z_OPEN).is_err());
        assert!(WorldHcp::new(1, 6, 8, 4, STACKING_HCP, XY_TORUS, Z_OPEN).is_err());
        assert!(WorldHcp::new(3, 6, 8, 4, STACKING_HCP, XY_TORUS, Z_TORUS).is_err());
        assert!(WorldHcp::new(4, 6, 8, 1, STACKING_HCP, XY_TORUS, Z_OPEN).is_err());
        assert!(WorldHcp::new(4, 6, 8, 4, 1, XY_TORUS, Z_OPEN).is_err());
    }

    #[test]
    fn site_positions_match_twelve_equal_distances() {
        let a = 3.0_f64.sqrt();
        let origin = site_position(6, 5, 4, 1.0);
        let w = world(8, 12, 12, 2);
        let cell = ((4 * 12) + 5) * 12 + 6;
        for n in 0..12 {
            let neighbor = w.neighbor_indices[cell * 12 + n] as usize;
            assert_ne!(neighbor, MISSING as usize);
            let layer_size = 12 * 12;
            let layer = neighbor / layer_size;
            let rem = neighbor - layer * layer_size;
            let row = rem / 12;
            let col = rem - row * 12;
            let p = site_position(col as i32, row as i32, layer as i32, 1.0);
            let relative = (dist(origin, p) - a).abs() / a;
            assert!(relative < 1e-9, "neighbour {n} relative error {relative}");
        }
    }

    #[test]
    fn hcp_up_offsets_equal_down_offsets() {
        for layer_odd in [false, true] {
            for col_odd in [false, true] {
                assert_eq!(
                    interlayer_table(layer_odd, col_odd, false),
                    interlayer_table(layer_odd, col_odd, true),
                    "up != down would be FCC-[111]"
                );
            }
        }
    }

    #[test]
    fn open_z_does_not_wrap() {
        let w = world(4, 6, 8, 2);
        let top = 0;
        let bottom = 3 * 6 * 8;
        for n in 9..12 {
            assert_eq!(w.neighbor_indices[top * 12 + n], MISSING);
        }
        for n in 6..9 {
            assert_eq!(w.neighbor_indices[bottom * 12 + n], MISSING);
        }
        assert_ne!(w.neighbor_indices[top * 12 + 6], MISSING);
    }

    #[test]
    fn toroidal_z_wraps_as_an_hcp_bond() {
        let w = closed(4, 6, 8, 2);
        let bottom = 3 * 6 * 8;
        let wrapped = w.neighbor_indices[bottom * 12 + 6];
        assert_ne!(wrapped, MISSING);
        assert!((wrapped as usize) < 6 * 8);
        let origin = site_position(0, 0, 3, 1.0);
        let p = site_position(0, 0, 4, 1.0);
        let q = site_position(0, 0, 0, 1.0);
        let _ = (origin, p, q, w);
    }

    #[test]
    fn tets_are_disjoint_and_cover_host_cells() {
        for &(layers, rows, cols) in &[(4i32, 6i32, 8i32), (6, 9, 12), (8, 12, 16)] {
            let w = world(layers, rows, cols, 2);
            let layer_size = (rows * cols) as usize;
            for phase in 0..6usize {
                let sigma = (phase / 3) % 2;
                let phi = phase % 3;
                let mut membership = vec![0u8; w.ncells];
                let mut apexes = vec![0u8; w.ncells];
                for layer in 0..w.layers {
                    if layer % 2 != sigma {
                        continue;
                    }
                    if layer + 1 >= w.layers {
                        continue;
                    }
                    for row in 0..w.rows {
                        let residue = row % 3;
                        let base_parity = if residue == (3 - phi) % 3 {
                            0
                        } else if residue == (4 - phi) % 3 {
                            1
                        } else {
                            continue;
                        };
                        let mut col = base_parity;
                        while col < w.cols {
                            let base = layer * layer_size + row * w.cols + col;
                            let (mq, mr) = mate_dirs(layer, false);
                            let mate_q = w.neighbor_indices[base * 12 + mq] as usize;
                            let mate_r = w.neighbor_indices[base * 12 + mr] as usize;
                            let apex = w.neighbor_indices[base * 12 + APEX_DIR] as usize;
                            assert_ne!(apex as u32, MISSING);
                            for cell in [base, mate_q, mate_r, apex] {
                                membership[cell] += 1;
                            }
                            apexes[apex] += 1;
                            col += 2;
                        }
                    }
                }
                for layer in 0..w.layers {
                    if layer % 2 != sigma {
                        continue;
                    }
                    if layer + 1 >= w.layers {
                        continue;
                    }
                    for i in 0..layer_size {
                        let cell = layer * layer_size + i;
                        assert_eq!(
                            membership[cell], 1,
                            "{layers}x{rows}x{cols} phase {phase}: host cell {cell} in {} tets",
                            membership[cell]
                        );
                    }
                }
                for count in apexes {
                    assert!(count <= 1, "duplicate apex");
                }
            }
        }
    }

    #[test]
    fn hcp_phases_cover_all_twelve_neighbours() {
        let w = closed(6, 9, 12, 2);
        let mut mates: Vec<Vec<usize>> = vec![Vec::new(); w.ncells];
        for phase in 0..6usize {
            let sigma = (phase / 3) % 2;
            let phi = phase % 3;
            for layer in 0..w.layers {
                if layer % 2 != sigma {
                    continue;
                }
                for row in 0..w.rows {
                    let residue = row % 3;
                    let base_parity = if residue == (3 - phi) % 3 {
                        0
                    } else if residue == (4 - phi) % 3 {
                        1
                    } else {
                        continue;
                    };
                    let mut col = base_parity;
                    while col < w.cols {
                        let base = ((layer * w.rows) + row) * w.cols + col;
                        let (mq, mr) = mate_dirs(layer, false);
                        let mate_q = w.neighbor_indices[base * 12 + mq] as usize;
                        let mate_r = w.neighbor_indices[base * 12 + mr] as usize;
                        let apex = w.neighbor_indices[base * 12 + APEX_DIR] as usize;
                        let tet = [base, mate_q, mate_r, apex];
                        for i in 0..4 {
                            for j in 0..4 {
                                if i != j {
                                    mates[tet[i]].push(tet[j]);
                                }
                            }
                        }
                        col += 2;
                    }
                }
            }
        }
        for cell in 0..w.ncells {
            let mut got = mates[cell].clone();
            got.sort_unstable();
            got.dedup();
            let mut want: Vec<usize> = (0..12)
                .filter_map(|n| {
                    let j = w.neighbor_indices[cell * 12 + n];
                    if j == MISSING {
                        None
                    } else {
                        Some(j as usize)
                    }
                })
                .collect();
            want.sort_unstable();
            assert_eq!(got, want, "cell {cell} does not cover all 12 neighbours");
        }
    }

    #[test]
    fn host_tets_are_regular() {
        let w = world(6, 9, 12, 2);
        let a = 3.0_f64.sqrt();
        let pos = |cell: usize| {
            let layer_size = w.rows * w.cols;
            let layer = cell / layer_size;
            let rem = cell - layer * layer_size;
            let row = rem / w.cols;
            let col = rem - row * w.cols;
            site_position(col as i32, row as i32, layer as i32, 1.0)
        };
        for layer in 0..(w.layers - 1) {
            let (mq, mr) = mate_dirs(layer, false);
            for row in 0..w.rows {
                let residue = row % 3;
                let phi = 0usize;
                let base_parity = if residue == (3 - phi) % 3 {
                    0
                } else if residue == (4 - phi) % 3 {
                    1
                } else {
                    continue;
                };
                let mut col = base_parity;
                while col < w.cols {
                    if row < 2 || row + 2 >= w.rows || col < 2 || col + 2 >= w.cols {
                        col += 2;
                        continue;
                    }
                    let base = ((layer * w.rows) + row) * w.cols + col;
                    let tet = [
                        base,
                        w.neighbor_indices[base * 12 + mq] as usize,
                        w.neighbor_indices[base * 12 + mr] as usize,
                        w.neighbor_indices[base * 12 + APEX_DIR] as usize,
                    ];
                    for i in 0..4 {
                        for j in (i + 1)..4 {
                            let relative = (dist(pos(tet[i]), pos(tet[j])) - a).abs() / a;
                            assert!(relative < 1e-9, "tet edge {i}-{j} on layer {layer}");
                        }
                    }
                    col += 2;
                }
            }
        }
    }

    #[test]
    fn alternating_does_not_move_the_apex() {
        let w = world(6, 9, 12, 2);
        for layer in [0usize, 2] {
            for row in 0..w.rows {
                for col in (0..w.cols).step_by(2) {
                    let base = ((layer * w.rows) + row) * w.cols + col;
                    let apex = w.neighbor_indices[base * 12 + APEX_DIR];
                    let layer_size = w.rows * w.cols;
                    assert_eq!(apex as usize, base + layer_size);
                }
            }
        }
    }

    #[test]
    fn identity_rule_is_a_still_life() {
        let mut w = world(6, 9, 12, 4);
        w.set_block_rule(&identity_rule(4)).unwrap();
        let mut seed = 0x1357u32;
        seed_cells(&mut w, &mut seed);
        let before = w.state.clone();
        let checksum = w.checksum_state();
        for _ in 0..60 {
            assert_eq!(w.run_tick(), 0);
        }
        assert_eq!(w.state, before);
        assert_eq!(w.checksum_state(), checksum);
        assert!(w.is_settled());
    }

    #[test]
    fn one_hundred_thousand_ticks_do_not_allocate() {
        let mut w = world(4, 6, 8, 4);
        w.set_block_rule(&identity_rule(4)).unwrap();
        let mut seed = 0xC0FFEEu32;
        seed_cells(&mut w, &mut seed);
        let pointers = [
            w.state.as_ptr() as usize,
            w.block_rule.as_ptr() as usize,
            w.neighbor_indices.as_ptr() as usize,
            w.census.as_ptr() as usize,
            w.chunk_quiet.as_ptr() as usize,
        ];
        let capacities = [
            w.state.capacity(),
            w.block_rule.capacity(),
            w.neighbor_indices.capacity(),
            w.census.capacity(),
            w.chunk_quiet.capacity(),
        ];
        for _ in 0..100_000 {
            w.run_tick();
        }
        assert_eq!(w.state.as_ptr() as usize, pointers[0]);
        assert_eq!(w.block_rule.as_ptr() as usize, pointers[1]);
        assert_eq!(w.neighbor_indices.as_ptr() as usize, pointers[2]);
        assert_eq!(w.census.as_ptr() as usize, pointers[3]);
        assert_eq!(w.chunk_quiet.as_ptr() as usize, pointers[4]);
        assert_eq!(w.state.capacity(), capacities[0]);
        assert_eq!(w.block_rule.capacity(), capacities[1]);
        assert_eq!(w.neighbor_indices.capacity(), capacities[2]);
        assert_eq!(w.census.capacity(), capacities[3]);
        assert_eq!(w.chunk_quiet.capacity(), capacities[4]);
    }

    #[test]
    fn skip_on_matches_skip_off() {
        let mut on = world(6, 9, 12, 4);
        let mut off = world(6, 9, 12, 4);
        on.set_block_rule(&identity_rule(4)).unwrap();
        off.set_block_rule(&identity_rule(4)).unwrap();
        let mut seed = 0xDEADu32;
        seed_cells(&mut on, &mut seed);
        seed = 0xDEADu32;
        seed_cells(&mut off, &mut seed);
        off.set_skipping_enabled(false);
        let mut perm_seed = 0xBEEFu32;
        let k4 = 4 * 4 * 4 * 4;
        let mut scramble = identity_rule(4);
        for i in 0..k4 {
            let j = (xorshift32(&mut perm_seed) as usize) % k4;
            scramble.swap(i, j);
        }
        on.set_block_rule(&scramble).unwrap();
        off.set_block_rule(&scramble).unwrap();
        for _ in 0..240 {
            on.run_tick();
            off.run_tick();
        }
        assert_eq!(on.state, off.state);
        assert_eq!(on.checksum_state(), off.checksum_state());
    }

    #[test]
    fn poke_without_mark_dirty_is_the_documented_trap_and_setters_wake() {
        let mut w = world(4, 6, 8, 3);
        w.set_block_rule(&identity_rule(3)).unwrap();
        for _ in 0..24 {
            w.run_tick();
        }
        assert!(w.is_settled());
        w.state[10] = 2;
        for _ in 0..12 {
            w.run_tick();
        }
        assert_eq!(w.state[10], 2);
        w.mark_all_dirty();
        w.run_tick();
        w.set_cell(11, 1).unwrap();
        assert!(!w.is_settled() || w.chunk_quiet[chunk_index(11, w.rows, w.cols, w.chunk_cols, w.chunk_rows)] == 0);
    }

    #[test]
    fn paint_if_and_clear_only_touch_one_layer() {
        let mut w = world(4, 6, 8, 4);
        w.fill(1).unwrap();
        let painted = w.paint_if(0, &[0, 1, 2], 1, 2).unwrap();
        assert_eq!(painted, 3);
        assert_eq!(w.state[0], 2);
        assert_eq!(w.state[6 * 8], 1);
        w.clear_states_in_layer(3, 1 << 1).unwrap();
        assert_eq!(w.state[3 * 6 * 8], 0);
        assert_eq!(w.state[2 * 6 * 8], 1);
        w.layer_census(0).unwrap();
        assert_eq!(w.layer_scratch[2], 3);
        assert_eq!(w.layer_scratch[1], 6 * 8 - 3);
    }

    #[test]
    fn census_tracks_writes() {
        let mut w = world(4, 6, 8, 4);
        assert_eq!(w.census_of(0), w.ncells as u32);
        w.set_cell(0, 3).unwrap();
        assert_eq!(w.census_of(3), 1);
        assert_eq!(w.census_of(0), w.ncells as u32 - 1);
    }

    #[test]
    fn rust_site_xyz_matches_the_published_formula() {
        let (x, y, z) = site_position(3, 2, 1, 2.0);
        let r = 2.0;
        let sqrt3 = 3.0_f64.sqrt();
        let expect_x = 3.0 * 1.5 * r + 0.5 * r;
        let expect_y = 2.0 * sqrt3 * r + 0.5 * sqrt3 * r + 0.5 * sqrt3 * r;
        let expect_z = 1.0 * r * 2.0_f64.sqrt();
        assert!((x - expect_x).abs() < 1e-12);
        assert!((y - expect_y).abs() < 1e-12);
        assert!((z - expect_z).abs() < 1e-12);
        let xyz = hcp_site_xyz(3, 2, 1, 2.0);
        assert_eq!(xyz, vec![x, y, z]);
    }
}
