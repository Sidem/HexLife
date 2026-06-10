use wasm_bindgen::prelude::*;

// This line allows Rust to print panic messages to the browser's developer console.
// extern crate console_error_panic_hook;
// use std::panic;

// CANONICAL SOURCE shared with the JS config. These two tables are duplicated verbatim as
// `NEIGHBOR_DIRS_ODD_R` / `NEIGHBOR_DIRS_EVEN_R` in `src/core/config.js`. They MUST stay
// byte-for-byte identical on both sides — a mismatch silently changes the simulation. Drift is
// guarded on each side: Rust by `neighbor_dirs_match_canonical` (in the tests module below); JS by
// tests/neighborDirs.test.js. If you edit one table, edit the other and update both pinned tests.
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

// ---------------------------------------------------------------------------
// Unit tests for the tick engine. These run natively via `cargo test` (the crate exposes an `rlib`
// target for this); wasm-bindgen types compile fine off-wasm. The `tests` submodule can reach
// `World`'s private fields because child modules see their ancestors' private items.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    /// The project's default ruleset (also `INITIAL_RULESET_CODE` in src/core/config.js).
    const DEFAULT_RULESET_HEX: &str = "12482080480080006880800180010117";

    /// Parse a 32-char big-endian hex ruleset into the 128-byte rule table, MSB-first, exactly the
    /// way JS `hexToRuleset` does (index 0 is the most-significant bit).
    fn parse_hex_ruleset(hex: &str) -> Vec<u8> {
        assert_eq!(hex.len(), 32, "ruleset hex must be 32 chars");
        let mut ruleset = vec![0u8; 128];
        for (ci, ch) in hex.chars().enumerate() {
            let v = ch.to_digit(16).expect("valid hex digit") as u8;
            for b in 0..4 {
                ruleset[ci * 4 + b] = (v >> (3 - b)) & 1;
            }
        }
        ruleset
    }

    /// Deterministic xorshift32 PRNG so tests are reproducible without external seeding.
    fn xorshift32(seed: &mut u32) -> u32 {
        let mut x = *seed;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        *seed = x;
        x
    }

    /// Build a world and fill its state with a deterministic ~50%-dense pattern.
    fn seeded_world(cols: i32, rows: i32, seed: u32) -> World {
        let mut w = World::new(cols, rows);
        let mut s = seed;
        for i in 0..w.num_cells {
            w.state[i] = (xorshift32(&mut s) & 1) as u8;
        }
        w
    }

    #[test]
    fn hex_ruleset_round_trips_against_known_bits() {
        let rs = parse_hex_ruleset("80000000000000000000000000000001");
        assert_eq!(rs[0], 1, "MSB maps to index 0");
        assert_eq!(rs[127], 1, "LSB maps to index 127");
        assert_eq!(rs.iter().filter(|&&b| b == 1).count(), 2);
    }

    #[test]
    fn neighbor_table_is_in_range_and_symmetric() {
        // Hexagonal adjacency on a torus is mutual: if j is one of i's six neighbors, i must be one
        // of j's. A bug in the parity branch or wrap arithmetic of compute_neighbor_indices breaks
        // this. (60 x 70 keeps both parities and a non-trivial torus.)
        let w = World::new(60, 70);
        let n = w.num_cells;
        for i in 0..n {
            let mut neigh = [0usize; 6];
            for k in 0..6 {
                let j = w.neighbor_indices[i * 6 + k] as usize;
                assert!(j < n, "neighbor index out of range");
                assert_ne!(j, i, "a cell must not be its own neighbor");
                neigh[k] = j;
            }
            // No duplicate neighbors.
            for a in 0..6 {
                for b in (a + 1)..6 {
                    assert_ne!(neigh[a], neigh[b], "duplicate neighbor for cell {i}");
                }
            }
            // Symmetry: i appears in each neighbor's own table.
            for &j in &neigh {
                let mut found = false;
                for k in 0..6 {
                    if w.neighbor_indices[j * 6 + k] as usize == i {
                        found = true;
                        break;
                    }
                }
                assert!(found, "adjacency {i}->{} not mutual", j);
            }
        }
    }

    #[test]
    fn neighbor_dirs_match_canonical() {
        // Pin the Rust copies of the hex neighbor-offset tables to their canonical values. The same
        // literals live in src/core/config.js (guarded by tests/neighborDirs.test.js). If you change
        // one side, change the other and update both pinned tests — drift silently alters the sim.
        assert_eq!(
            NEIGHBOR_DIRS_ODD_R,
            [[-1, 1], [-1, 0], [0, -1], [1, 0], [1, 1], [0, 1]],
        );
        assert_eq!(
            NEIGHBOR_DIRS_EVEN_R,
            [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [0, 1]],
        );
    }

    #[test]
    fn all_zero_ruleset_kills_everything() {
        let mut w = seeded_world(40, 46, 0xC0FFEE);
        // ruleset is already all zeros from World::new.
        let active = w.run_tick();
        assert_eq!(active, 0);
        assert!(w.state.iter().all(|&c| c == 0));
        assert_eq!(w.active_count(), 0);
    }

    #[test]
    fn all_one_ruleset_fills_everything() {
        let mut w = seeded_world(40, 46, 0x1234);
        for r in w.ruleset.iter_mut() {
            *r = 1;
        }
        let active = w.run_tick();
        assert_eq!(active as usize, w.num_cells);
        assert!(w.state.iter().all(|&c| c == 1));
    }

    #[test]
    fn center_preserving_ruleset_is_a_still_life() {
        // ruleset[idx] = center bit of idx. Every cell keeps its state regardless of neighbors, so
        // the grid is frozen and the checksum is invariant across ticks.
        let mut w = seeded_world(40, 46, 0xABCDEF);
        for idx in 0..128 {
            w.ruleset[idx] = ((idx >> 6) & 1) as u8;
        }
        let before: Vec<u8> = w.state.clone();
        let sum0 = w.checksum_state();
        for _ in 0..5 {
            w.run_tick();
        }
        assert_eq!(w.state, before, "still life must not change");
        assert_eq!(w.checksum_state(), sum0);
    }

    #[test]
    fn center_inverting_ruleset_has_period_two() {
        // ruleset[idx] = NOT(center bit). Every cell flips each tick, so after two ticks the grid
        // returns to its starting configuration.
        let mut w = seeded_world(40, 46, 0x55AA55);
        for idx in 0..128 {
            w.ruleset[idx] = 1 - (((idx >> 6) & 1) as u8);
        }
        let before: Vec<u8> = w.state.clone();
        w.run_tick();
        assert_ne!(w.state, before, "one tick should invert the grid");
        w.run_tick();
        assert_eq!(w.state, before, "two ticks should restore the grid");
    }

    #[test]
    fn run_tick_is_deterministic_across_worlds() {
        // Same dimensions + same seed + same ruleset => byte-identical evolution. This is the
        // engine-side guarantee behind WorldManager's deterministic reset.
        let ruleset = parse_hex_ruleset(DEFAULT_RULESET_HEX);
        let mut a = seeded_world(50, 58, 0x99);
        let mut b = seeded_world(50, 58, 0x99);
        a.ruleset.copy_from_slice(&ruleset);
        b.ruleset.copy_from_slice(&ruleset);
        for _ in 0..25 {
            a.run_tick();
            b.run_tick();
        }
        assert_eq!(a.state, b.state);
        assert_eq!(a.checksum_state(), b.checksum_state());
    }

    #[test]
    fn default_ruleset_golden_checksum_regression() {
        // Pins the hot path against accidental regressions: a fixed seed + the default ruleset must
        // reproduce these exact checksums. If the tick logic changes, this fails loudly. (Values
        // captured from the verified neighbor-table implementation.)
        let ruleset = parse_hex_ruleset(DEFAULT_RULESET_HEX);
        let mut w = seeded_world(48, 56, 0x2468ACE);
        w.ruleset.copy_from_slice(&ruleset);

        let initial = w.checksum_state();
        w.run_tick();
        let after_1 = w.checksum_state();
        for _ in 0..49 {
            w.run_tick();
        }
        let after_50 = w.checksum_state();

        assert_eq!(initial, GOLDEN_INITIAL, "seed pattern changed");
        assert_eq!(after_1, GOLDEN_AFTER_1, "single-tick evolution changed");
        assert_eq!(after_50, GOLDEN_AFTER_50, "50-tick evolution changed");
    }

    // Golden checksums for default_ruleset_golden_checksum_regression (48x56 grid, seed 0x2468ACE).
    const GOLDEN_INITIAL: i32 = 278795944;
    const GOLDEN_AFTER_1: i32 = 2137887712;
    const GOLDEN_AFTER_50: i32 = -205264731;
}
