use wasm_bindgen::prelude::*;

// This line allows Rust to print panic messages to the browser's developer console.
// extern crate console_error_panic_hook;
// use std::panic;

// Define the neighbor directions just like in the JavaScript version.
// Using 'static' makes them globally available within the module.
const NEIGHBOR_DIRS_ODD_R: [[i32; 2]; 6] = [[-1, 1], [-1, 0], [0, -1], [1, 0], [1, 1], [0, 1]];
const NEIGHBOR_DIRS_EVEN_R: [[i32; 2]; 6] = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [0, 1]];

// The `#[wasm_bindgen]` attribute exposes the following struct or function to JavaScript.
//
// The `World` owns every per-cell simulation buffer inside Wasm linear memory. JavaScript
// builds typed-array *views* over these buffers via the exposed pointers, so a tick no longer
// copies the state/ruleset/output arrays back and forth across the JS<->Wasm boundary on every
// step. The only copies that remain are the (throttled) snapshots posted to the main thread for
// rendering.
#[wasm_bindgen]
pub struct World {
    num_cells: usize,
    state: Vec<u8>,
    next_state: Vec<u8>,
    rule_indices: Vec<u8>,
    next_rule_indices: Vec<u8>,
    ruleset: Vec<u8>,
    rule_usage_counters: Vec<u32>,
    last_active_count: u32,
    // Flattened neighbor-index lookup: 6 entries per cell (`neighbor_indices[i*6 + n_order]` is the
    // linear index of cell i's n_order-th neighbor, with toroidal wrapping already applied). The
    // grid dimensions are fixed for the World's lifetime, so the neighborhood never changes — we
    // compute it once here and the hot loops (`run_tick`, `block_entropy`) just index into it,
    // replacing the per-cell parity branch + 12 modulo ops with plain array reads.
    neighbor_indices: Vec<u32>,
}

/// Precompute the flattened 6-neighbor index table for a grid of the given dimensions. Called once
/// from the constructor; see the `neighbor_indices` field for the layout.
fn compute_neighbor_indices(grid_cols: i32, grid_rows: i32, num_cells: usize) -> Vec<u32> {
    let cols = grid_cols;
    let rows = grid_rows;
    let mut table = vec![0u32; num_cells * 6];
    for i in 0..num_cells {
        let c_col = i as i32 % cols;
        let c_row = i as i32 / cols;
        let dirs = if c_col % 2 != 0 {
            &NEIGHBOR_DIRS_ODD_R
        } else {
            &NEIGHBOR_DIRS_EVEN_R
        };
        for n_order in 0..6 {
            let n_col = (c_col + dirs[n_order][0] + cols) % cols;
            let n_row = (c_row + dirs[n_order][1] + rows) % rows;
            table[i * 6 + n_order] = (n_row * cols + n_col) as u32;
        }
    }
    table
}

#[wasm_bindgen]
impl World {
    /// Public constructor that can be called from JavaScript. All buffers are allocated once,
    /// here, and never reallocated for the lifetime of the `World` — so the pointers handed to
    /// JavaScript (and the views built over them) stay valid as long as Wasm memory is not grown.
    #[wasm_bindgen(constructor)]
    pub fn new(grid_cols: i32, grid_rows: i32) -> World {
        // Optional: Sets up a panic hook to log errors to the console.
        // panic::set_hook(Box::new(console_error_panic_hook::hook));
        let num_cells = (grid_cols.max(0) * grid_rows.max(0)) as usize;
        World {
            num_cells,
            state: vec![0; num_cells],
            next_state: vec![0; num_cells],
            rule_indices: vec![0; num_cells],
            next_rule_indices: vec![0; num_cells],
            ruleset: vec![0; 128],
            rule_usage_counters: vec![0; 128],
            last_active_count: 0,
            neighbor_indices: compute_neighbor_indices(grid_cols, grid_rows, num_cells),
        }
    }

    // --- Pointer accessors -------------------------------------------------
    // JavaScript reads these once after construction (and again after each `run_tick`, because the
    // double buffers are swapped internally) to build `Uint8Array`/`Uint32Array` views directly
    // over Wasm linear memory.

    pub fn num_cells(&self) -> usize {
        self.num_cells
    }
    pub fn state_ptr(&self) -> *const u8 {
        self.state.as_ptr()
    }
    pub fn next_state_ptr(&self) -> *const u8 {
        self.next_state.as_ptr()
    }
    pub fn rule_indices_ptr(&self) -> *const u8 {
        self.rule_indices.as_ptr()
    }
    pub fn next_rule_indices_ptr(&self) -> *const u8 {
        self.next_rule_indices.as_ptr()
    }
    pub fn ruleset_ptr(&self) -> *const u8 {
        self.ruleset.as_ptr()
    }
    pub fn rule_usage_counters_ptr(&self) -> *const u32 {
        self.rule_usage_counters.as_ptr()
    }

    /// Zero the per-rule usage counters (used on world reset / load).
    pub fn reset_rule_usage_counters(&mut self) {
        for c in self.rule_usage_counters.iter_mut() {
            *c = 0;
        }
    }

    /// Advance the simulation by one step.
    ///
    /// Reads `state` + `ruleset`, writes `next_state` + `next_rule_indices`, and increments the
    /// per-rule usage counters. The current/next buffers are then swapped internally, so after the
    /// call the new generation lives in `state` (and JavaScript must mirror the swap of its views).
    /// Returns the number of active cells in the new generation.
    pub fn run_tick(&mut self) -> u32 {
        let mut active: u32 = 0;

        for i in 0..self.num_cells {
            let c_state = self.state[i];

            let mut neighbor_mask: u8 = 0;

            // Neighbor indices (with toroidal wrapping) are precomputed once at construction, so the
            // mask is just six array reads — no parity branch or modulo arithmetic in the hot loop.
            let nbase = i * 6;
            for n_order in 0..6 {
                let neighbor_index = self.neighbor_indices[nbase + n_order] as usize;
                if self.state[neighbor_index] == 1 {
                    neighbor_mask |= 1 << n_order;
                }
            }

            // Determine the rule index and get the result from the ruleset.
            let rule_idx = ((c_state << 6) | neighbor_mask) as usize;
            let next_state_value = self.ruleset[rule_idx];

            self.next_state[i] = next_state_value;
            self.next_rule_indices[i] = rule_idx as u8;
            self.rule_usage_counters[rule_idx] += 1;
            if next_state_value == 1 {
                active += 1;
            }
        }

        // Promote the freshly computed generation to "current". This is a cheap pointer swap; the
        // underlying allocations do not move, so the pointers exposed above simply alternate
        // between the two fixed buffers.
        std::mem::swap(&mut self.state, &mut self.next_state);
        std::mem::swap(&mut self.rule_indices, &mut self.next_rule_indices);

        self.last_active_count = active;
        active
    }

    /// Number of active cells in the current generation (as of the last `run_tick`).
    pub fn active_count(&self) -> u32 {
        self.last_active_count
    }

    /// Rolling hash of the current state buffer, used for cycle detection.
    pub fn checksum_state(&self) -> i32 {
        let mut checksum: i32 = 0;
        for &val in &self.state {
            // `wrapping_*` matches the intended overflow behavior of the original JS checksum.
            checksum = checksum.wrapping_mul(31).wrapping_add(val as i32);
        }
        checksum
    }

    /// Normalized Shannon entropy of the 7-cell (center + 6 neighbors) block patterns over the
    /// current state buffer. Ported from JS so the full-grid scan runs in Wasm instead of on the
    /// worker's JS heap. Result is normalized into [0, 1] by dividing by 7 bits.
    pub fn block_entropy(&self) -> f64 {
        if self.num_cells == 0 {
            return 0.0;
        }

        // A block pattern is `(center_state << 6) | neighbor_mask`, i.e. exactly 128 possibilities.
        let mut counts = [0u32; 128];

        for i in 0..self.num_cells {
            let c_state = self.state[i];

            let mut neighbor_mask: u8 = 0;
            // Reuse the precomputed neighbor table (see `run_tick`).
            let nbase = i * 6;
            for n_order in 0..6 {
                let neighbor_index = self.neighbor_indices[nbase + n_order] as usize;
                if self.state[neighbor_index] == 1 {
                    neighbor_mask |= 1 << n_order;
                }
            }

            let block_pattern = ((c_state << 6) | neighbor_mask) as usize;
            counts[block_pattern] += 1;
        }

        let total = self.num_cells as f64;
        let mut entropy = 0.0;
        for &count in counts.iter() {
            if count > 0 {
                let probability = count as f64 / total;
                entropy -= probability * probability.log2();
            }
        }
        entropy / 7.0
    }
}
