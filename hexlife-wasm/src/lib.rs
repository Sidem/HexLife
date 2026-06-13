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
    // Grid dimensions, retained so per-cell `(col, row)` can be recovered from the linear index
    // (the neighbor table bakes the dims in but doesn't keep them). Used by the active-cell centroid.
    grid_cols: usize,
    grid_rows: usize,
    state: Vec<u8>,
    next_state: Vec<u8>,
    rule_indices: Vec<u8>,
    next_rule_indices: Vec<u8>,
    ruleset: Vec<u8>,
    rule_usage_counters: Vec<u32>,
    last_active_count: u32,
    // Number of cells whose state flipped in the last `run_tick` (`next != current`). A cheap
    // activity/turnover proxy for the auto-explore evaluation burst — one extra compare per cell,
    // behavior-neutral.
    last_changed_count: u32,
    // Flattened neighbor-index lookup: 6 entries per cell (`neighbor_indices[i*6 + n_order]` is the
    // linear index of cell i's n_order-th neighbor, with toroidal wrapping already applied). The
    // grid dimensions are fixed for the World's lifetime, so the neighborhood never changes — we
    // compute it once here and the hot loops (`run_tick`, `block_entropy`) just index into it,
    // replacing the per-cell parity branch + 12 modulo ops with plain array reads.
    neighbor_indices: Vec<u32>,
    // --- Damage-spreading probe (auto-explore branching-parameter measure) ---
    // A second simulation lane: a copy of `state` with one cell flipped, advanced in lockstep with
    // the main lane (same ruleset, same neighbor table). The Hamming distance between the two lanes
    // over time estimates the branching parameter σ (does a single-cell perturbation grow, hold, or
    // die?). Buffers are lazily allocated on `start_probe` and freed on `stop_probe` so a non-probing
    // World pays nothing. While `probe_active`, every `run_tick` also advances the probe lane (≈2×
    // tick cost — evaluation-only). The probe lane never touches the usage counters or `next_state`,
    // so probe-off ticks stay byte-identical to today.
    probe_active: bool,
    probe_state: Vec<u8>,
    probe_next_state: Vec<u8>,
    // --- Active-cell centroid (auto-explore transport / mobility measure) ---
    // The centroid of the active cells expressed as a per-axis CIRCULAR mean angle (radians, in
    // (-π, π]). On a torus the only correct centroid is the circular mean: map each axis coordinate
    // to an angle θ = 2π·coord/dim, accumulate Σsin/Σcos, and take atan2 of the resultant. A plain
    // arithmetic mean would be wrong across the wrap seam. `compute_active_centroid` fills these in
    // one alloc-free pass; the worker samples them and turns the inter-sample displacement into a
    // mean drift speed (`metrics.transport.meanSpeed`). Both default to 0 (no active cells ⇒ 0).
    centroid_col_angle: f64,
    centroid_row_angle: f64,
    // Per-axis CONCENTRATION = mean resultant length R = |Σ(sin,cos)|/N_active, in [0,1]. R≈1 when the
    // active cells cluster in a narrow arc (a compact structure — the centroid angle is meaningful);
    // R≈0 when they spread around the whole torus (a dense/uniform field — the near-zero resultant's
    // angle is pure NOISE that jitters as cells flip). The worker GATES each axis's centroid
    // displacement by this so spread-out churn can't masquerade as motion; only a coherent, localized
    // mass contributes to the transport speed.
    centroid_col_concentration: f64,
    centroid_row_concentration: f64,
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
            grid_cols: grid_cols.max(0) as usize,
            grid_rows: grid_rows.max(0) as usize,
            state: vec![0; num_cells],
            next_state: vec![0; num_cells],
            rule_indices: vec![0; num_cells],
            next_rule_indices: vec![0; num_cells],
            ruleset: vec![0; 128],
            rule_usage_counters: vec![0; 128],
            last_active_count: 0,
            last_changed_count: 0,
            neighbor_indices: compute_neighbor_indices(grid_cols, grid_rows, num_cells),
            probe_active: false,
            probe_state: Vec::new(),
            probe_next_state: Vec::new(),
            centroid_col_angle: 0.0,
            centroid_row_angle: 0.0,
            centroid_col_concentration: 0.0,
            centroid_row_concentration: 0.0,
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
        let mut changed: u32 = 0;

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
            if next_state_value != c_state {
                changed += 1;
            }
        }

        // Promote the freshly computed generation to "current". This is a cheap pointer swap; the
        // underlying allocations do not move, so the pointers exposed above simply alternate
        // between the two fixed buffers.
        std::mem::swap(&mut self.state, &mut self.next_state);
        std::mem::swap(&mut self.rule_indices, &mut self.next_rule_indices);

        self.last_active_count = active;
        self.last_changed_count = changed;

        // While a damage probe is running, advance its lane in lockstep so the Hamming distance
        // tracks the same generation count as the main lane. Probe-off ⇒ this is skipped entirely.
        if self.probe_active {
            self.run_probe_tick();
        }

        active
    }

    /// Number of active cells in the current generation (as of the last `run_tick`).
    pub fn active_count(&self) -> u32 {
        self.last_active_count
    }

    /// Number of cells that flipped state in the last `run_tick` (turnover/activity proxy).
    pub fn last_changed_count(&self) -> u32 {
        self.last_changed_count
    }

    /// Begin a damage-spreading probe: copy the current state into the probe lane and flip exactly
    /// one cell (`flip_index`). Subsequent `run_tick` calls advance both lanes; `probe_hamming`
    /// reports the divergence. Lazily allocates the probe buffers on first use. An out-of-range
    /// `flip_index` is ignored (the probe then starts as an exact copy — Hamming 0).
    pub fn start_probe(&mut self, flip_index: usize) {
        if self.probe_state.len() != self.num_cells {
            self.probe_state = vec![0; self.num_cells];
            self.probe_next_state = vec![0; self.num_cells];
        }
        self.probe_state.copy_from_slice(&self.state);
        if flip_index < self.num_cells {
            self.probe_state[flip_index] ^= 1;
        }
        self.probe_active = true;
    }

    /// Hamming distance between the main lane and the probe lane (number of differing cells). Zero
    /// when no probe is active.
    pub fn probe_hamming(&self) -> u32 {
        if !self.probe_active {
            return 0;
        }
        let mut distance: u32 = 0;
        for i in 0..self.num_cells {
            if self.state[i] != self.probe_state[i] {
                distance += 1;
            }
        }
        distance
    }

    /// Stop the probe and free its buffers (a non-probing World pays no per-tick or memory cost).
    pub fn stop_probe(&mut self) {
        self.probe_active = false;
        self.probe_state = Vec::new();
        self.probe_next_state = Vec::new();
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

    /// Spatial-order join-count statistic over the current state buffer (auto-explore spatial term).
    ///
    /// One pass over the flattened `neighbor_indices` table counts the heterogeneous
    /// (active↔inactive) unique neighbor pairs `J` — each undirected edge is counted once by only
    /// considering `neighbor_idx > cell_idx`, so the total unique-edge count is `3N` on the wrapped
    /// hex grid (6 neighbors per cell ÷ 2). With density `p = active/N`, the random-mixing
    /// expectation is `E[J] = 3N · 2p(1−p)`. Returns `1 − J/E[J]` clamped to [−1, 1]:
    /// positive ⇒ clustered/domain structure, negative ⇒ anti-clustered (checkerboard-like),
    /// ≈0 ⇒ well-mixed noise. Returns 0 when `E[J] == 0` (p ∈ {0, 1}: an empty or full grid).
    /// No allocation — safe to call on the live state without detaching JS views.
    pub fn spatial_order(&self) -> f64 {
        if self.num_cells == 0 {
            return 0.0;
        }
        let mut active: u32 = 0;
        let mut hetero: u32 = 0;
        for i in 0..self.num_cells {
            let s_i = self.state[i];
            if s_i == 1 {
                active += 1;
            }
            let nbase = i * 6;
            for n_order in 0..6 {
                let j = self.neighbor_indices[nbase + n_order] as usize;
                // Count each undirected edge once (only the larger-indexed endpoint).
                if j > i && self.state[j] != s_i {
                    hetero += 1;
                }
            }
        }
        let n = self.num_cells as f64;
        let p = active as f64 / n;
        let expected = 3.0 * n * 2.0 * p * (1.0 - p);
        if expected == 0.0 {
            return 0.0;
        }
        (1.0 - (hetero as f64) / expected).clamp(-1.0, 1.0)
    }

    /// Block-pattern entropy of the current state as `[mean, variance]` (auto-explore spatial-
    /// heterogeneity term). `mean` equals {@link World::block_entropy} — the normalized Shannon
    /// entropy of the 7-cell block-pattern distribution, expressible as the average per-cell
    /// surprisal `−log2(p(pattern))/7`. `variance` is the across-cell variance of that surprisal:
    /// near zero when local structure is spatially uniform (every region looks the same) and large
    /// when the field mixes very-common patterns (ordered regions) with very-rare ones (disordered
    /// regions). Computed in one pass over the cells to build the 128-bucket histogram, then a
    /// cheap 128-bucket finalize (`Var = E[s²] − E[s]²`).
    ///
    /// NB: returning a `Vec<f64>` allocates in Wasm linear memory; callers holding typed-array
    /// views over the heap must `refreshSimViews()` afterwards (see the worker notes).
    pub fn block_entropy_stats(&self) -> Vec<f64> {
        if self.num_cells == 0 {
            return vec![0.0, 0.0];
        }

        let mut counts = [0u32; 128];
        for i in 0..self.num_cells {
            let c_state = self.state[i];
            let mut neighbor_mask: u8 = 0;
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
        // The mean surprisal equals the Shannon entropy; the variance is E[s²] − mean². Each cell of
        // pattern k shares the same surprisal s_k = −log2(p_k)/7 (normalized by 7 bits to match
        // block_entropy's [0,1] scale), so we can finalize over the 128 buckets weighted by p_k.
        let mut mean = 0.0;
        let mut mean_sq = 0.0;
        for &count in counts.iter() {
            if count > 0 {
                let p = count as f64 / total;
                let surprisal = -p.log2() / 7.0;
                mean += p * surprisal;
                mean_sq += p * surprisal * surprisal;
            }
        }
        let variance = (mean_sq - mean * mean).max(0.0);
        vec![mean, variance]
    }

    /// Recompute the active-cell centroid as a per-axis circular mean and stash it in
    /// `centroid_col_angle` / `centroid_row_angle` (radians, in (-π, π]). The circular mean is the
    /// ONLY correct centroid on a torus: each axis coordinate maps to an angle θ = 2π·coord/dim,
    /// we accumulate Σsin/Σcos, and take atan2 of the resultant vector. A simple arithmetic mean
    /// would jump discontinuously across the wrap seam and mis-measure a structure straddling it.
    ///
    /// One pass, NO allocation (scalar accumulators + four scalar field writes), so it never grows
    /// Wasm linear memory and JS typed-array views stay valid — no `refreshSimViews()` needed after.
    /// With no active cells the resultant is the zero vector and all four outputs default to 0.
    pub fn compute_active_centroid(&mut self) {
        self.centroid_col_angle = 0.0;
        self.centroid_row_angle = 0.0;
        self.centroid_col_concentration = 0.0;
        self.centroid_row_concentration = 0.0;
        if self.num_cells == 0 || self.grid_cols == 0 || self.grid_rows == 0 {
            return;
        }
        use std::f64::consts::PI;
        let col_step = 2.0 * PI / self.grid_cols as f64;
        let row_step = 2.0 * PI / self.grid_rows as f64;
        let cols = self.grid_cols;
        let (mut sin_c, mut cos_c, mut sin_r, mut cos_r) = (0.0, 0.0, 0.0, 0.0);
        let mut active = 0u32;
        for i in 0..self.num_cells {
            if self.state[i] == 1 {
                let col = (i % cols) as f64;
                let row = (i / cols) as f64;
                let ac = col * col_step;
                let ar = row * row_step;
                sin_c += ac.sin();
                cos_c += ac.cos();
                sin_r += ar.sin();
                cos_r += ar.cos();
                active += 1;
            }
        }
        if active > 0 {
            let n = active as f64;
            self.centroid_col_angle = sin_c.atan2(cos_c);
            self.centroid_row_angle = sin_r.atan2(cos_r);
            // Mean resultant length per axis: |Σ(sin,cos)| / N_active, clamped to [0,1] (it already is
            // by construction; the min guards float drift). 1 = tightly clustered, 0 = spread/uniform.
            self.centroid_col_concentration = ((sin_c * sin_c + cos_c * cos_c).sqrt() / n).min(1.0);
            self.centroid_row_concentration = ((sin_r * sin_r + cos_r * cos_r).sqrt() / n).min(1.0);
        }
    }

    /// Column-axis active-cell centroid angle from the last `compute_active_centroid` (radians).
    pub fn centroid_col_angle(&self) -> f64 {
        self.centroid_col_angle
    }

    /// Row-axis active-cell centroid angle from the last `compute_active_centroid` (radians).
    pub fn centroid_row_angle(&self) -> f64 {
        self.centroid_row_angle
    }

    /// Column-axis centroid concentration (mean resultant length, [0,1]) — see the field doc.
    pub fn centroid_col_concentration(&self) -> f64 {
        self.centroid_col_concentration
    }

    /// Row-axis centroid concentration (mean resultant length, [0,1]) — see the field doc.
    pub fn centroid_row_concentration(&self) -> f64 {
        self.centroid_row_concentration
    }
}

// Private helpers (kept out of the `#[wasm_bindgen]` block so they aren't exported to JS).
impl World {
    /// Advance the probe lane by one generation using the same ruleset + neighbor table as the main
    /// lane. Mirrors `run_tick`'s core but writes only `probe_next_state` and touches neither the
    /// usage counters nor the main-lane buffers — so a running probe never perturbs the simulation.
    fn run_probe_tick(&mut self) {
        for i in 0..self.num_cells {
            let c_state = self.probe_state[i];

            let mut neighbor_mask: u8 = 0;
            let nbase = i * 6;
            for n_order in 0..6 {
                let neighbor_index = self.neighbor_indices[nbase + n_order] as usize;
                if self.probe_state[neighbor_index] == 1 {
                    neighbor_mask |= 1 << n_order;
                }
            }

            let rule_idx = ((c_state << 6) | neighbor_mask) as usize;
            self.probe_next_state[i] = self.ruleset[rule_idx];
        }
        std::mem::swap(&mut self.probe_state, &mut self.probe_next_state);
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

    #[test]
    fn changed_count_matches_state_diff() {
        // The all-zero ruleset sends every active cell to 0 and leaves dead cells dead, so the
        // changed-count after one tick must equal the number of cells that were active beforehand.
        let mut w = seeded_world(40, 46, 0xBADF00D);
        let initially_active = w.state.iter().filter(|&&c| c == 1).count() as u32;
        w.run_tick();
        assert_eq!(w.last_changed_count(), initially_active);

        // A still life (center-preserving) changes nothing.
        let mut s = seeded_world(40, 46, 0x13579);
        for idx in 0..128 {
            s.ruleset[idx] = ((idx >> 6) & 1) as u8;
        }
        s.run_tick();
        assert_eq!(s.last_changed_count(), 0);

        // A center-inverting ruleset flips every cell each tick.
        let mut inv = seeded_world(40, 46, 0x2468);
        for idx in 0..128 {
            inv.ruleset[idx] = 1 - (((idx >> 6) & 1) as u8);
        }
        inv.run_tick();
        assert_eq!(inv.last_changed_count() as usize, inv.num_cells);
    }

    #[test]
    fn probe_damage_holds_for_still_life() {
        // Center-preserving ruleset: every cell is frozen, so a single-cell perturbation neither
        // spreads nor heals — Hamming distance stays pinned at 1.
        let mut w = seeded_world(40, 46, 0xC0DE);
        for idx in 0..128 {
            w.ruleset[idx] = ((idx >> 6) & 1) as u8;
        }
        w.start_probe(123);
        assert_eq!(w.probe_hamming(), 1, "probe starts one cell apart");
        for _ in 0..10 {
            w.run_tick();
            assert_eq!(w.probe_hamming(), 1, "damage neither spreads nor heals");
        }
        w.stop_probe();
        assert_eq!(w.probe_hamming(), 0, "no distance reported once probe is off");
    }

    #[test]
    fn probe_damage_holds_for_center_inverting() {
        // Center-inverting ruleset: both lanes flip in lockstep every tick, so the one perturbed
        // cell stays perturbed — Hamming distance remains 1 across ticks.
        let mut w = seeded_world(40, 46, 0xFEED);
        for idx in 0..128 {
            w.ruleset[idx] = 1 - (((idx >> 6) & 1) as u8);
        }
        w.start_probe(200);
        assert_eq!(w.probe_hamming(), 1);
        for _ in 0..10 {
            w.run_tick();
            assert_eq!(w.probe_hamming(), 1, "lockstep flip preserves the single difference");
        }
    }

    #[test]
    fn probe_damage_dies_for_saturating_ruleset() {
        // All-ones ruleset drives both lanes to a fully-active grid after a single tick, so any
        // initial perturbation is erased — Hamming distance collapses to 0.
        let mut w = seeded_world(40, 46, 0xABBA);
        for r in w.ruleset.iter_mut() {
            *r = 1;
        }
        w.start_probe(50);
        assert_eq!(w.probe_hamming(), 1);
        w.run_tick();
        assert_eq!(w.probe_hamming(), 0, "saturation heals the perturbation");
    }

    #[test]
    fn probe_does_not_perturb_main_lane() {
        // A running probe must leave the main lane byte-identical to an un-probed run: same seed +
        // ruleset, one world probing and one not, must evolve to identical state/checksum.
        let ruleset = parse_hex_ruleset(DEFAULT_RULESET_HEX);
        let mut probed = seeded_world(48, 56, 0x2468ACE);
        let mut plain = seeded_world(48, 56, 0x2468ACE);
        probed.ruleset.copy_from_slice(&ruleset);
        plain.ruleset.copy_from_slice(&ruleset);
        probed.start_probe(777);
        for _ in 0..30 {
            probed.run_tick();
            plain.run_tick();
        }
        assert_eq!(probed.state, plain.state, "probe must not alter the main lane");
        assert_eq!(probed.checksum_state(), plain.checksum_state());
    }

    #[test]
    fn spatial_order_matches_manual_join_count() {
        // Validate the getter against an independent recomputation of the join-count statistic on
        // a seeded arbitrary state (the "manual count" sanity check).
        let w = seeded_world(40, 46, 0x5EED);
        let n = w.num_cells;
        let mut active = 0u32;
        let mut hetero = 0u32;
        for i in 0..n {
            if w.state[i] == 1 {
                active += 1;
            }
            for k in 0..6 {
                let j = w.neighbor_indices[i * 6 + k] as usize;
                if j > i && w.state[j] != w.state[i] {
                    hetero += 1;
                }
            }
        }
        let p = active as f64 / n as f64;
        let expected = 3.0 * n as f64 * 2.0 * p * (1.0 - p);
        let want = (1.0 - hetero as f64 / expected).clamp(-1.0, 1.0);
        assert!(
            (w.spatial_order() - want).abs() < 1e-9,
            "spatial_order {} != manual {}",
            w.spatial_order(),
            want
        );
    }

    #[test]
    fn spatial_order_near_zero_for_random_fill() {
        // A ~50% random fill is well-mixed: J ≈ E[J], so the statistic sits near 0.
        let w = seeded_world(60, 70, 0x1234);
        let v = w.spatial_order();
        assert!(v.abs() < 0.1, "random fill should be ~0, got {v}");
    }

    #[test]
    fn spatial_order_positive_for_solid_block() {
        // Left half solid, right half empty: heterogeneous edges only along the two column
        // boundaries, far below the random expectation, so the statistic is strongly positive.
        let mut w = World::new(40, 46);
        for i in 0..w.num_cells {
            w.state[i] = if (i % 40) < 20 { 1 } else { 0 };
        }
        let v = w.spatial_order();
        assert!(v > 0.5, "clustered block should be >0.5, got {v}");
    }

    #[test]
    fn spatial_order_negative_for_striped() {
        // Row-parity stripes are anti-clustered on the triangular adjacency (4 of 6 neighbors flip
        // parity), giving J > E[J] and a negative statistic. 46 rows wrap cleanly (even).
        let mut w = World::new(40, 46);
        for i in 0..w.num_cells {
            w.state[i] = ((i / 40) % 2) as u8;
        }
        let v = w.spatial_order();
        assert!(v < 0.0, "anti-clustered stripes should be <0, got {v}");
    }

    #[test]
    fn spatial_order_zero_for_uniform_grids() {
        // p ∈ {0, 1} ⇒ E[J] == 0 ⇒ defined as 0.
        let empty = World::new(40, 46);
        assert_eq!(empty.spatial_order(), 0.0);
        let mut full = World::new(40, 46);
        for c in full.state.iter_mut() {
            *c = 1;
        }
        assert_eq!(full.spatial_order(), 0.0);
    }

    #[test]
    fn block_entropy_stats_mean_matches_block_entropy() {
        let w = seeded_world(48, 56, 0x2468ACE);
        let stats = w.block_entropy_stats();
        assert_eq!(stats.len(), 2);
        assert!(
            (stats[0] - w.block_entropy()).abs() < 1e-12,
            "mean {} must equal block_entropy {}",
            stats[0],
            w.block_entropy()
        );
    }

    #[test]
    fn block_entropy_stats_variance_zero_for_uniform() {
        // All-zero and all-one grids each have a single block pattern: surprisal 0 everywhere.
        let empty = World::new(40, 46);
        let es = empty.block_entropy_stats();
        assert_eq!(es[0], 0.0);
        assert_eq!(es[1], 0.0);

        let mut full = World::new(40, 46);
        for c in full.state.iter_mut() {
            *c = 1;
        }
        let fs = full.block_entropy_stats();
        assert_eq!(fs[0], 0.0);
        assert_eq!(fs[1], 0.0);
    }

    #[test]
    fn block_entropy_stats_variance_positive_for_mixed() {
        // Half uniform (all zero), half random: one very-common pattern plus many rare ones, so the
        // per-cell surprisal varies across the field and the variance is strictly positive.
        let mut w = World::new(60, 70);
        let mut s = 0xC0FFEEu32;
        for i in 0..w.num_cells {
            w.state[i] = if (i % 60) < 30 {
                0
            } else {
                (xorshift32(&mut s) & 1) as u8
            };
        }
        let stats = w.block_entropy_stats();
        assert!(stats[1] > 0.0, "mixed field should have positive variance, got {}", stats[1]);
    }

    #[test]
    fn active_centroid_circular_mean_of_known_points() {
        use std::f64::consts::PI;
        // Empty grid ⇒ angles AND concentrations default to 0.
        let mut empty = World::new(40, 46);
        empty.compute_active_centroid();
        assert_eq!(empty.centroid_col_angle(), 0.0);
        assert_eq!(empty.centroid_row_angle(), 0.0);
        assert_eq!(empty.centroid_col_concentration(), 0.0);
        assert_eq!(empty.centroid_row_concentration(), 0.0);

        // A single active cell sits exactly at its own circular-mean angle (θ = 2π·coord/dim) and is
        // maximally concentrated (a single point ⇒ R = 1 on both axes).
        let cols = 40usize;
        let mut one = World::new(cols as i32, 46);
        let (col, row) = (10usize, 0usize);
        one.state[row * cols + col] = 1;
        one.compute_active_centroid();
        assert!((one.centroid_col_angle() - 2.0 * PI * col as f64 / cols as f64).abs() < 1e-9);
        assert!((one.centroid_row_angle() - 0.0).abs() < 1e-9);
        assert!((one.centroid_col_concentration() - 1.0).abs() < 1e-12);
        assert!((one.centroid_row_concentration() - 1.0).abs() < 1e-12);

        // A FULL grid spreads active cells evenly around the torus on both axes, so the resultant
        // vector collapses to ~0 and the concentration ⇒ ~0. This is the churn-gating guarantee: a
        // dense/uniform field's centroid angle is meaningless noise and must not register as motion.
        let mut full = World::new(cols as i32, 46);
        for c in full.state.iter_mut() {
            *c = 1;
        }
        full.compute_active_centroid();
        assert!(full.centroid_col_concentration() < 1e-9, "full grid col R must be ~0");
        assert!(full.centroid_row_concentration() < 1e-9, "full grid row R must be ~0");
    }

    #[test]
    fn active_centroid_tracks_translation_and_holds_for_still_life() {
        use std::f64::consts::PI;
        // Signed shortest angle between two circular-mean angles, and the torus displacement (in
        // cells) it implies — mirrors the worker's transport accumulation exactly.
        fn shortest(a: f64, b: f64) -> f64 {
            let d = b - a;
            d.sin().atan2(d.cos())
        }
        fn displacement(cols: f64, rows: f64, c0: f64, r0: f64, c1: f64, r1: f64) -> f64 {
            let dcol = shortest(c0, c1) * cols / (2.0 * PI);
            let drow = shortest(r0, r1) * rows / (2.0 * PI);
            (dcol * dcol + drow * drow).sqrt()
        }

        let cols = 40i32;
        let rows = 46i32;

        // A "copy neighbor-d" ruleset (next = bit d of the neighbor mask) translates a lone active
        // cell by one fixed neighbor step each tick — the cell stays single, it just moves.
        let mut mover = World::new(cols, rows);
        let d = 3usize;
        for idx in 0..128 {
            mover.ruleset[idx] = ((idx >> d) & 1) as u8;
        }
        let center = (rows / 2 * cols + cols / 2) as usize;
        mover.state[center] = 1;
        mover.compute_active_centroid();
        let (c0, r0) = (mover.centroid_col_angle(), mover.centroid_row_angle());
        mover.run_tick();
        assert_eq!(mover.active_count(), 1, "the mover stays a single cell (it just translated)");
        mover.compute_active_centroid();
        let (c1, r1) = (mover.centroid_col_angle(), mover.centroid_row_angle());
        let dist = displacement(cols as f64, rows as f64, c0, r0, c1, r1);
        assert!(dist > 0.5, "a translating mover yields non-zero centroid speed, got {dist}");

        // A still life (center-preserving ruleset) leaves every cell — and so the centroid — put.
        let mut still = seeded_world(cols, rows, 0xACE5);
        for idx in 0..128 {
            still.ruleset[idx] = ((idx >> 6) & 1) as u8;
        }
        still.compute_active_centroid();
        let (sc0, sr0) = (still.centroid_col_angle(), still.centroid_row_angle());
        for _ in 0..5 {
            still.run_tick();
        }
        still.compute_active_centroid();
        let (sc1, sr1) = (still.centroid_col_angle(), still.centroid_row_angle());
        let sdist = displacement(cols as f64, rows as f64, sc0, sr0, sc1, sr1);
        assert!(sdist < 1e-9, "a still life yields ~0 centroid speed, got {sdist}");
    }

    // Golden checksums for default_ruleset_golden_checksum_regression (48x56 grid, seed 0x2468ACE).
    const GOLDEN_INITIAL: i32 = 278795944;
    const GOLDEN_AFTER_1: i32 = 2137887712;
    const GOLDEN_AFTER_50: i32 = -205264731;
}
