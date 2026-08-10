//! `WorldK` — the k-state tick engine behind `@hexlife/embed/ca`.
//!
//! **This module exists so that `World` does not change.** Explorer, the `<hexlife-world>`
//! determinism contract (seed 12345 => checksum 231200078 at tick 100) and the #37 model pipeline
//! all run on `World::run_tick`; making that loop generic over `k` would put every future k-state
//! edit on their code path. A separate struct makes "zero cost to the binary engine" a *structural*
//! guarantee instead of a benchmarked hope. What is shared is shared as free functions
//! (`compute_neighbor_indices`, the canonical neighbour tables) — nothing is duplicated.
//!
//! Two rule backends, because the tick loop generalizes for free but the rule *representation* does
//! not. The anisotropic index `self·k⁶ + Σ neighbourⱼ·kʲ` needs a k⁷-entry table: 128 B at k=2,
//! 16 KB at k=4, 2 MB at k=8, 268 MB at k=16. So:
//!
//! - [`BACKEND_NEIGHBORHOOD`] is the direct generalization of HexLife's rule space — anisotropic,
//!   dense k⁷ LUT, hard-capped at [`MAX_NEIGHBORHOOD_STATES`].
//! - [`BACKEND_BLOCK`] rewrites a 3-cell block at once from a k³-entry table, which scales to
//!   [`MAX_BLOCK_STATES`] and is the only way to get *exact* conservation (see below).
//!
//! ## Why block mode is mandatory rather than a nicety
//!
//! A radius-1 synchronous CA cannot conserve mass at any `k`. Two water cells sitting diagonally
//! above one empty cell each independently see "empty below me" and vacate; the empty cell sees
//! water above and fills. Two in, one out. Preventing that requires the losing cell to see its
//! competitor, which is two cells away — and radius 2 on hex is 18 neighbours, i.e. a k¹⁹ table.
//! Block partitioning fixes it by construction: arbitration is internal to the block, so a rule that
//! permutes multisets is exactly conservative with no bookkeeping. This is the lattice-gas approach
//! (FHP is the hexagonal precedent).

use wasm_bindgen::prelude::*;

use crate::compute_neighbor_indices;

/// Anisotropic radius-1 backend: one dense `k⁷` lookup, indexed by centre and all six neighbours.
pub const BACKEND_NEIGHBORHOOD: u8 = 0;
/// Block-partitioned backend: one `k³` lookup rewriting a whole 3-cell triangle at once.
pub const BACKEND_BLOCK: u8 = 1;

/// Hard cap for [`BACKEND_NEIGHBORHOOD`]. k=4 is a 16 KB table, which fits L1; k=5 is 78 KB and
/// spills to L2, k=8 is 2 MB and costs a cache miss per cell. Raise this with measurements, not
/// intuition — a mostly-empty grid touches only a few hundred entries whatever the table size, so
/// the cliff is workload-dependent and the high-entropy case is the one that falls off it.
pub const MAX_NEIGHBORHOOD_STATES: u8 = 4;

/// Hard cap for [`BACKEND_BLOCK`]. k³ = 4096 entries at k=16, which is still nothing.
pub const MAX_BLOCK_STATES: u8 = 16;

/// The block partition cycles through three phases (see [`WorldK::phase`]).
pub const BLOCK_PHASES: u64 = 3;

/// Side length in cells of the activity-tracking chunks, as a shift so the per-cell chunk lookup is
/// `col >> CHUNK_SHIFT` rather than a division.
///
/// The trade-off runs the opposite way from `World`'s `BLOCK_SIZE`. There the tiles are rescanned
/// from scratch every tick, so administration is the cost and big tiles win; here the bookkeeping is
/// a handful of counters per tick regardless, so the only thing granularity buys or loses is how
/// much settled area a single moving structure drags back into the active set. 32 keeps a lone
/// mover from waking a 4096-cell neighbourhood while leaving the per-tick halo pass (chunks × 7)
/// far below noise — 216 chunks on a 383k-cell grid.
///
/// Must stay a power of two and **even**: [`WorldK::chunk_halo_offsets`] relies on a chunk starting
/// on an even column, exactly as `World::halo_offsets` does.
const CHUNK_SHIFT: usize = 5;
const CHUNK_SIZE: usize = 1 << CHUNK_SHIFT;

/// Neighbour-table slots for the two axial directions that span a partition block.
///
/// In axial coordinates (`q = col`, `r = row − ⌊col/2⌋`) an up-triangle is
/// `{(q,r), (q+1,r), (q,r+1)}`, and for *both* column parities those two offsets land at
/// `n_order` 4 and 5 of the canonical tables — so the block's mates are plain reads out of
/// `neighbor_indices` with no parity branch and no second table.
///
/// This is derived, therefore it is pinned: `block_partition_matches_canonical_table` checks the
/// triangle against `neighbor_indices` itself rather than against the derivation.
const BLOCK_MATE_Q: usize = 4;
const BLOCK_MATE_R: usize = 5;

/// A chunk must be quiet this many ticks before [`BACKEND_NEIGHBORHOOD`] may skip it — see
/// [`WorldK::refresh_chunk_activity`] for the argument.
const QUIET_TICKS_NEIGHBORHOOD: u32 = 1;
/// The same for [`BACKEND_BLOCK`], where a block is only re-evaluated every [`BLOCK_PHASES`] ticks.
const QUIET_TICKS_BLOCK: u32 = QUIET_TICKS_NEIGHBORHOOD + BLOCK_PHASES as u32 - 1;

/// A k-state hexagonal cellular automaton on the same toroidal grid as [`crate::World`].
///
/// Cells are `u8` state values in `0..k`. Unlike `World` there are no `rule_indices` and no
/// `rule_usage_counters`: a k=3 rule index already exceeds `u8`, the rule-index colouring they exist
/// for does not survive `k > 2` (colour by *state* instead), and dropping them saves a store per
/// cell in the k-state path.
#[wasm_bindgen]
pub struct WorldK {
    k: usize,
    backend: u8,
    num_cells: usize,
    grid_cols: usize,
    grid_rows: usize,
    /// The current generation. In [`BACKEND_BLOCK`] this is also the write target — blocks partition
    /// the grid, so read-then-write within a block is exact and no second buffer is needed.
    state: Vec<u8>,
    /// The write target for [`BACKEND_NEIGHBORHOOD`]; empty in [`BACKEND_BLOCK`].
    next_state: Vec<u8>,
    /// Flattened 6-entries-per-cell neighbour table with toroidal wrapping already applied — the
    /// same layout, and the same free function, as `World`.
    neighbor_indices: Vec<u32>,
    /// Dense `k⁷` table for [`BACKEND_NEIGHBORHOOD`]; empty otherwise.
    neighborhood_rule: Vec<u8>,
    /// `k³` packed output triples for [`BACKEND_BLOCK`]; empty otherwise. Entry `s0·k² + s1·k + s2`
    /// holds the output in the same packing, so decoding is two divisions and applying it is three
    /// stores.
    block_rule: Vec<u16>,
    /// Per-state occupancy from the last [`WorldK::compute_census`]. Allocated once at construction
    /// so refreshing it cannot grow Wasm memory and detach JS views.
    census: Vec<u32>,
    tick_count: u64,
    last_changed_count: u32,
    // --- activity tracking (the k-state answer to `World`'s uniformity scan) ---------------------
    chunk_cols: usize,
    chunk_rows: usize,
    /// Consecutive ticks, ending with the previous one, in which nothing in this chunk changed.
    /// Saturating, so a chunk that settles forever does not wrap.
    chunk_quiet: Vec<u32>,
    /// Whether this chunk changed during the tick currently in progress (scratch, cleared per tick).
    chunk_changed: Vec<u8>,
    /// Whether this chunk must be recomputed this tick (scratch, derived per tick).
    chunk_active: Vec<u8>,
    /// Master switch for the skipping above. Off ⇒ every chunk is recomputed every tick, which is
    /// the reference behaviour every fast-path test is checked against.
    skipping_enabled: bool,
}

#[wasm_bindgen]
impl WorldK {
    /// Allocate a world. Every buffer is allocated here and never reallocated, so the pointers
    /// handed to JavaScript stay valid as long as Wasm memory is not grown.
    ///
    /// Fails rather than silently producing a wrong simulation:
    ///
    /// - `states` outside `2..=MAX_*_STATES` for the chosen backend;
    /// - odd `grid_cols`, which breaks the column wrap's parity (`World` inherits the same
    ///   requirement from `deriveGridDimensions`);
    /// - `grid_rows` not a multiple of 3 in [`BACKEND_BLOCK`], which puts a seam in the partition.
    ///   The embed's default of 64 rows fails this; block worlds need 63 or 66.
    #[wasm_bindgen(constructor)]
    pub fn new(grid_cols: i32, grid_rows: i32, states: u8, backend: u8) -> Result<WorldK, String> {
        if backend != BACKEND_NEIGHBORHOOD && backend != BACKEND_BLOCK {
            return Err(format!("WorldK: unknown backend {backend}."));
        }
        let max_states = if backend == BACKEND_BLOCK {
            MAX_BLOCK_STATES
        } else {
            MAX_NEIGHBORHOOD_STATES
        };
        if states < 2 || states > max_states {
            return Err(format!(
                "WorldK: states must be between 2 and {max_states} for this backend, received {states}."
            ));
        }
        if grid_cols < 2 || grid_rows < 2 {
            return Err("WorldK: the grid must be at least 2x2.".to_string());
        }
        if grid_cols % 2 != 0 {
            return Err(format!(
                "WorldK: grid_cols must be even so the column wrap preserves hex parity, received {grid_cols}."
            ));
        }
        if backend == BACKEND_BLOCK && grid_rows % 3 != 0 {
            return Err(format!(
                "WorldK: block mode needs grid_rows divisible by 3 or the triangular partition has a \
                 seam at the row wrap, received {grid_rows}. Use {} or {}.",
                grid_rows - grid_rows % 3,
                grid_rows - grid_rows % 3 + 3,
            ));
        }

        let cols = grid_cols as usize;
        let rows = grid_rows as usize;
        let num_cells = cols * rows;
        let k = states as usize;
        let chunk_cols = cols.div_ceil(CHUNK_SIZE);
        let chunk_rows = rows.div_ceil(CHUNK_SIZE);
        let num_chunks = chunk_cols * chunk_rows;

        let (neighborhood_rule, block_rule, next_state) = if backend == BACKEND_BLOCK {
            (Vec::new(), vec![0u16; k * k * k], Vec::new())
        } else {
            (vec![0u8; k.pow(7)], Vec::new(), vec![0u8; num_cells])
        };

        Ok(WorldK {
            k,
            backend,
            num_cells,
            grid_cols: cols,
            grid_rows: rows,
            state: vec![0; num_cells],
            next_state,
            neighbor_indices: compute_neighbor_indices(grid_cols, grid_rows, num_cells),
            neighborhood_rule,
            block_rule,
            census: vec![0; k],
            tick_count: 0,
            last_changed_count: 0,
            chunk_cols,
            chunk_rows,
            // Zero quiet ticks ⇒ every chunk is active on the first tick, which is what makes the
            // skipping argument's induction start from a computed generation.
            chunk_quiet: vec![0; num_chunks],
            chunk_changed: vec![0; num_chunks],
            chunk_active: vec![1; num_chunks],
            skipping_enabled: true,
        })
    }

    // --- shape ------------------------------------------------------------------------------

    pub fn num_cells(&self) -> usize {
        self.num_cells
    }
    pub fn states(&self) -> u8 {
        self.k as u8
    }
    pub fn backend(&self) -> u8 {
        self.backend
    }
    pub fn grid_cols(&self) -> usize {
        self.grid_cols
    }
    pub fn grid_rows(&self) -> usize {
        self.grid_rows
    }
    /// Number of entries the rule table for this world's backend must have (`k⁷` or `k³`).
    pub fn rule_len(&self) -> usize {
        if self.backend == BACKEND_BLOCK {
            self.block_rule.len()
        } else {
            self.neighborhood_rule.len()
        }
    }

    // --- pointer accessors ------------------------------------------------------------------
    // JavaScript builds typed-array views directly over Wasm linear memory from these. Only
    // `state_ptr` alternates, and only in BACKEND_NEIGHBORHOOD — see `run_tick`.

    pub fn state_ptr(&self) -> *const u8 {
        self.state.as_ptr()
    }
    pub fn next_state_ptr(&self) -> *const u8 {
        self.next_state.as_ptr()
    }
    pub fn census_ptr(&self) -> *const u32 {
        self.census.as_ptr()
    }
    /// Whether `run_tick` swaps `state` and `next_state` internally, so JavaScript knows whether it
    /// must mirror the swap on its views. True for [`BACKEND_NEIGHBORHOOD`] only: block mode
    /// rewrites disjoint blocks in place and has no second buffer at all.
    pub fn is_double_buffered(&self) -> bool {
        self.backend != BACKEND_BLOCK
    }

    // --- rules ------------------------------------------------------------------------------

    /// Install the dense anisotropic rule for [`BACKEND_NEIGHBORHOOD`].
    ///
    /// Entry `self·k⁶ + Σ neighbourⱼ·kʲ` (`j` in canonical neighbour order) holds the centre cell's
    /// next state. At `k = 2` this is bit-for-bit HexLife's own 128-entry ruleset indexing, which is
    /// what `k2_neighborhood_matches_binary_world` exploits.
    ///
    /// **Allocates** (the slice is copied in from JS), so callers holding typed-array views over the
    /// Wasm heap must rebuild them afterwards.
    pub fn set_neighborhood_rule(&mut self, rule: &[u8]) -> Result<(), String> {
        if self.backend != BACKEND_NEIGHBORHOOD {
            return Err("WorldK: this world uses the block backend.".to_string());
        }
        if rule.len() != self.neighborhood_rule.len() {
            return Err(format!(
                "WorldK: neighborhood rule needs k^7 = {} entries, received {}.",
                self.neighborhood_rule.len(),
                rule.len()
            ));
        }
        if let Some(bad) = rule.iter().position(|&v| v as usize >= self.k) {
            return Err(format!(
                "WorldK: rule entry {bad} is {}, which is not a state below k = {}.",
                rule[bad], self.k
            ));
        }
        self.neighborhood_rule.copy_from_slice(rule);
        self.mark_all_dirty();
        Ok(())
    }

    /// Install the `k³` block rule for [`BACKEND_BLOCK`].
    ///
    /// Both the index and the stored value pack a triple as `s0·k² + s1·k + s2` in the block's
    /// vertex order (base, `+q` mate, `+r` mate). Conservation and isotropy are *reported*, not
    /// enforced — non-conservative rules are legitimate (reactions, sources, sinks) and breaking
    /// isotropy is how you get gravity.
    ///
    /// **Allocates** — see [`WorldK::set_neighborhood_rule`].
    pub fn set_block_rule(&mut self, rule: &[u16]) -> Result<(), String> {
        if self.backend != BACKEND_BLOCK {
            return Err("WorldK: this world uses the neighborhood backend.".to_string());
        }
        let entries = self.block_rule.len();
        if rule.len() != entries {
            return Err(format!(
                "WorldK: block rule needs k^3 = {entries} entries, received {}.",
                rule.len()
            ));
        }
        if let Some(bad) = rule.iter().position(|&v| v as usize >= entries) {
            return Err(format!(
                "WorldK: block rule entry {bad} is {}, which is not a packed triple below k^3 = {entries}.",
                rule[bad]
            ));
        }
        self.block_rule.copy_from_slice(rule);
        self.mark_all_dirty();
        Ok(())
    }

    // --- state ------------------------------------------------------------------------------

    /// Overwrite every cell. **The only supported bulk write**: it validates the states and resets
    /// the activity tracker, which a direct poke through the `state_ptr` view would not.
    ///
    /// **Allocates** — see [`WorldK::set_neighborhood_rule`].
    pub fn set_cells(&mut self, cells: &[u8]) -> Result<(), String> {
        if cells.len() != self.num_cells {
            return Err(format!(
                "WorldK: expected {} cells, received {}.",
                self.num_cells,
                cells.len()
            ));
        }
        if let Some(bad) = cells.iter().position(|&v| v as usize >= self.k) {
            return Err(format!(
                "WorldK: cell {bad} is {}, which is not a state below k = {}.",
                cells[bad], self.k
            ));
        }
        self.state.copy_from_slice(cells);
        self.mark_all_dirty();
        Ok(())
    }

    /// Set one cell, marking its chunk (and therefore its readers) active again.
    pub fn set_cell(&mut self, index: usize, value: u8) -> Result<(), String> {
        if index >= self.num_cells {
            return Err(format!("WorldK: cell index {index} is outside the grid."));
        }
        if value as usize >= self.k {
            return Err(format!(
                "WorldK: cell value {value} is not a state below k = {}.",
                self.k
            ));
        }
        self.state[index] = value;
        // Cheaper than a full reset would be, and correct: only this chunk's readers are affected,
        // and `refresh_chunk_activity` already dilates by the halo.
        let chunk = self.chunk_of(index);
        self.chunk_quiet[chunk] = 0;
        Ok(())
    }

    /// Fill every cell with `value`.
    pub fn fill(&mut self, value: u8) -> Result<(), String> {
        if value as usize >= self.k {
            return Err(format!(
                "WorldK: fill value {value} is not a state below k = {}.",
                self.k
            ));
        }
        self.state.fill(value);
        self.mark_all_dirty();
        Ok(())
    }

    /// Force every chunk to be recomputed on the next tick.
    ///
    /// **Any write that bypasses the methods above — including a poke through the JS `state` view —
    /// must be followed by this**, or the activity tracker will happily skip the region that
    /// changed. `@hexlife/embed/ca` calls it for you on every mutation path.
    pub fn mark_all_dirty(&mut self) {
        self.chunk_quiet.fill(0);
    }

    /// Turn the chunk-skipping fast path off (or back on). Off is the dense reference behaviour;
    /// results are identical either way, which is the whole claim the fast-path tests check.
    pub fn set_skipping_enabled(&mut self, enabled: bool) {
        self.skipping_enabled = enabled;
        if !enabled {
            self.mark_all_dirty();
        }
    }

    // --- ticking ----------------------------------------------------------------------------

    /// Advance one generation and return the number of cells whose state changed.
    ///
    /// In [`BACKEND_NEIGHBORHOOD`] the current/next buffers are swapped internally, so JavaScript
    /// must mirror the swap on its views (`is_double_buffered` reports this). In [`BACKEND_BLOCK`]
    /// the grid is rewritten in place and no swap happens.
    pub fn run_tick(&mut self) -> u32 {
        self.refresh_chunk_activity();
        let changed = if self.backend == BACKEND_BLOCK {
            self.tick_block()
        } else {
            self.tick_neighborhood()
        };
        self.commit_chunk_activity();
        self.tick_count += 1;
        self.last_changed_count = changed;
        changed
    }

    /// Generations elapsed since construction. Also selects the block partition phase.
    pub fn tick_count(&self) -> u64 {
        self.tick_count
    }

    /// The block-partition phase the *next* `run_tick` will use, in `0..BLOCK_PHASES`. Meaningless
    /// for [`BACKEND_NEIGHBORHOOD`].
    pub fn phase(&self) -> u8 {
        (self.tick_count % BLOCK_PHASES) as u8
    }

    /// Cells that changed in the last `run_tick`.
    pub fn last_changed_count(&self) -> u32 {
        self.last_changed_count
    }

    /// Whether the world has reached a fixed point it can never leave.
    ///
    /// The rule is deterministic and time-invariant, so once a full partition cycle passes with no
    /// change the configuration maps to itself forever. One comparison per tick catches every still
    /// life; hosts use it to stop scheduling frames entirely.
    pub fn is_settled(&self) -> bool {
        let needed = if self.backend == BACKEND_BLOCK {
            QUIET_TICKS_BLOCK
        } else {
            QUIET_TICKS_NEIGHBORHOOD
        };
        self.chunk_quiet.iter().all(|&q| q >= needed)
    }

    // --- observables ------------------------------------------------------------------------

    /// Refresh the per-state occupancy counts behind `census_ptr` (one pass, no allocation).
    ///
    /// This is how conservation is checked from the outside: a conservative block rule must hold
    /// every entry of this histogram fixed forever.
    pub fn compute_census(&mut self) {
        self.census.fill(0);
        for &cell in &self.state {
            self.census[cell as usize] += 1;
        }
    }

    /// Occupancy of one state as of the last [`WorldK::compute_census`].
    pub fn census_of(&self, state: u8) -> u32 {
        self.census.get(state as usize).copied().unwrap_or(0)
    }

    /// Rolling hash of the current generation, using the same mixing constant as
    /// `World::checksum_state` so the two are directly comparable at `k = 2`.
    pub fn checksum_state(&self) -> i32 {
        let mut checksum: i32 = 0;
        for &val in &self.state {
            checksum = checksum.wrapping_mul(31).wrapping_add(val as i32);
        }
        checksum
    }

    /// Chunks recomputed during the last tick, out of `chunk_count()`. Diagnostic: it is the
    /// measured pay-off of the skipping path, and a host tuning a model can watch it settle.
    pub fn active_chunk_count(&self) -> u32 {
        self.chunk_active.iter().map(|&a| a as u32).sum()
    }

    pub fn chunk_count(&self) -> usize {
        self.chunk_active.len()
    }
}

// Private helpers, kept out of the `#[wasm_bindgen]` block so they aren't exported to JS.
impl WorldK {
    #[inline]
    fn chunk_of(&self, cell: usize) -> usize {
        let col = cell % self.grid_cols;
        let row = cell / self.grid_cols;
        (row >> CHUNK_SHIFT) * self.chunk_cols + (col >> CHUNK_SHIFT)
    }

    /// Every chunk offset a chunk's cells can reach, as `(delta_chunk_col, delta_chunk_row)`.
    ///
    /// Seven, not the nine of a 3x3 Moore square, for exactly the reason `World::halo_offsets`
    /// documents: a hex cell has six neighbours and in offset coordinates those are a
    /// parity-dependent subset of the eight. `CHUNK_SIZE` is even so a chunk always starts on an
    /// even column, fixing the left-hand reach at `(-1,-1)` and `(-1,0)`; the right-hand reach
    /// follows the parity of the chunk's last column, which is odd for every full chunk but takes
    /// the grid's parity for a partial final one.
    ///
    /// The relation is symmetric — `neighbor_table_is_in_range_and_symmetric` proves adjacency is
    /// mutual — so this doubles as "which chunks read from me", which is what the wake propagation
    /// in `refresh_chunk_activity` needs.
    fn chunk_halo_offsets(&self, chunk_col: usize) -> [(isize, isize); 7] {
        let last_col = ((chunk_col + 1) * CHUNK_SIZE).min(self.grid_cols) - 1;
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

    /// Decide which chunks must be recomputed this tick, and clear the per-tick change scratch.
    ///
    /// **The soundness argument, which is why this needs no quiescence or uniformity check.** Take
    /// [`BACKEND_NEIGHBORHOOD`]. A cell's next state is a pure function of its own value and its six
    /// neighbours'. If nothing in chunk `c` *or any chunk `c` can read from* changed during the
    /// previous tick, then this tick's inputs for every cell of `c` are identical to the previous
    /// tick's, so this tick's outputs are identical too — `c` cannot change, and the write buffer
    /// already holds the right bytes:
    ///
    /// > after the swap, `next_state` is the buffer that was read at tick `t−1`, i.e. it holds
    /// > generation `t−1`. "Nothing in `c` changed during tick `t−1`" says generation `t−1` equals
    /// > generation `t` there. So `next_state[c] == state[c]` already, and a skipped chunk costs
    /// > nothing at all — not even the copy.
    ///
    /// The induction starts from a computed generation because `chunk_quiet` is zeroed at
    /// construction and by every mutation path.
    ///
    /// [`BACKEND_BLOCK`] needs the same argument stretched over a full partition cycle: block `B` is
    /// only re-evaluated every [`BLOCK_PHASES`] ticks, so concluding that its output repeats
    /// requires its cells to be unchanged across all three intervening ticks — hence
    /// [`QUIET_TICKS_BLOCK`]. There the skip is free by construction, since the tick writes in place.
    ///
    /// Note what this buys over gating on a *uniform background*: it skips settled **structures**,
    /// not just vacuum. A percolation grid whose obstacles never move, or a pool of water that has
    /// come to rest, goes quiet even though it is nowhere near uniform. A chaotic rule keeps
    /// everything active every tick and simply pays the handful of counter updates below.
    fn refresh_chunk_activity(&mut self) {
        self.chunk_changed.fill(0);
        if !self.skipping_enabled {
            self.chunk_active.fill(1);
            return;
        }
        let needed = if self.backend == BACKEND_BLOCK {
            QUIET_TICKS_BLOCK
        } else {
            QUIET_TICKS_NEIGHBORHOOD
        };
        let chunk_cols = self.chunk_cols as isize;
        let chunk_rows = self.chunk_rows as isize;
        for chunk_row in 0..self.chunk_rows {
            for chunk_col in 0..self.chunk_cols {
                let mut active = 0u8;
                for (delta_col, delta_row) in self.chunk_halo_offsets(chunk_col) {
                    // `rem_euclid` rather than a range check so this stays correct on grids only one
                    // or two chunks wide, where a chunk's left and right neighbours are the same
                    // chunk, possibly itself. Testing a chunk against itself is harmless.
                    let neighbor_col = (chunk_col as isize + delta_col).rem_euclid(chunk_cols) as usize;
                    let neighbor_row = (chunk_row as isize + delta_row).rem_euclid(chunk_rows) as usize;
                    if self.chunk_quiet[neighbor_row * self.chunk_cols + neighbor_col] < needed {
                        active = 1;
                        break;
                    }
                }
                self.chunk_active[chunk_row * self.chunk_cols + chunk_col] = active;
            }
        }
    }

    /// Fold this tick's changes into the quiet counters. A skipped chunk provably did not change,
    /// so it simply keeps counting up.
    fn commit_chunk_activity(&mut self) {
        for (quiet, &changed) in self.chunk_quiet.iter_mut().zip(self.chunk_changed.iter()) {
            *quiet = if changed != 0 { 0 } else { quiet.saturating_add(1) };
        }
    }

    /// One dense anisotropic generation, walking the grid row by row.
    ///
    /// Row-major order matters for the same reason it does in `World::run_tick`: the cell index
    /// stays strictly increasing across the whole grid, so the walk through `neighbor_indices` — a
    /// table far larger than L2 — is the sequential access the prefetcher wants. Iterating chunk by
    /// chunk instead would jump `grid_cols * 6 * 4` bytes on every row step.
    ///
    /// Each row is split at chunk boundaries so a skipped chunk is skipped and, just as importantly,
    /// a change can be attributed to the exact chunk that owns it. Slicing per segment also restores
    /// the bounds-check hoist that a computed `end` would otherwise cost.
    fn tick_neighborhood(&mut self) -> u32 {
        let k = self.k;
        let cols = self.grid_cols;
        let chunk_cols = self.chunk_cols;
        let k6 = k.pow(6);

        // Disjoint field borrows so each segment can be sliced once.
        let state = &self.state;
        let rule = &self.neighborhood_rule;
        let neighbor_indices = &self.neighbor_indices;
        let chunk_active = &self.chunk_active;
        let chunk_changed = &mut self.chunk_changed;
        let next_state = &mut self.next_state;

        let mut changed: u32 = 0;
        for row in 0..self.grid_rows {
            let row_base = row * cols;
            let chunk_row_base = (row >> CHUNK_SHIFT) * chunk_cols;
            for chunk_col in 0..chunk_cols {
                let chunk = chunk_row_base + chunk_col;
                if chunk_active[chunk] == 0 {
                    continue;
                }
                let start = row_base + chunk_col * CHUNK_SIZE;
                let end = row_base + ((chunk_col + 1) * CHUNK_SIZE).min(cols);

                let current = &state[start..end];
                let neighbors = &neighbor_indices[start * 6..end * 6];
                let out = &mut next_state[start..end];

                let mut segment_changed = 0u32;
                for offset in 0..current.len() {
                    let c_state = current[offset];
                    let nbase = offset * 6;
                    // Horner from the highest neighbour place down, so the k-ary digits land in
                    // canonical neighbour order with one multiply each and no power table.
                    let mut index = 0usize;
                    for n_order in (0..6).rev() {
                        index = index * k + state[neighbors[nbase + n_order] as usize] as usize;
                    }
                    index += c_state as usize * k6;

                    let value = rule[index];
                    out[offset] = value;
                    if value != c_state {
                        segment_changed += 1;
                    }
                }
                if segment_changed != 0 {
                    chunk_changed[chunk] = 1;
                    changed += segment_changed;
                }
            }
        }

        // Cheap pointer swap; the allocations do not move, so the exposed pointers simply alternate
        // between the two fixed buffers.
        std::mem::swap(&mut self.state, &mut self.next_state);
        changed
    }

    /// One block-partition generation, in place.
    ///
    /// The partition: in axial coordinates take as block bases the index-3 sublattice
    /// `(q − r) ≡ φ (mod 3)`, where `φ = tick mod 3`; the up-triangle based at such a cell is
    /// `{(q,r), (q+1,r), (q,r+1)}`, whose members carry residues `φ`, `φ+1`, `φ+2`. Every cell is
    /// therefore in exactly one block per phase, and across the three phases a cell blocks with a
    /// different pair each time, covering all six of its neighbours.
    ///
    /// Substituting `q = col`, `r = row − ⌊col/2⌋` collapses the residue to
    /// `(col mod 2) − row (mod 3)`, which is why the scan below is just "in two rows out of every
    /// three, every other column is a base" rather than a precomputed base list — the walk stays
    /// row-major and strided by two, and costs no memory at all.
    ///
    /// All of that is derivation, so `block_partition_matches_canonical_table` and
    /// `block_phases_cover_all_six_neighbours` check the resulting triangles against
    /// `neighbor_indices` rather than against this comment.
    fn tick_block(&mut self) -> u32 {
        let k = self.k;
        let k2 = k * k;
        let phase = (self.tick_count % BLOCK_PHASES) as usize;
        let cols = self.grid_cols;
        let chunk_cols = self.chunk_cols;

        let mut changed: u32 = 0;
        for row in 0..self.grid_rows {
            // Even-column bases in rows where `−row ≡ φ`, odd-column bases where `1 − row ≡ φ`, and
            // one row class in three holds no base at all.
            let residue = row % 3;
            let base_parity = if residue == (3 - phase) % 3 {
                0usize
            } else if residue == (4 - phase) % 3 {
                1usize
            } else {
                continue;
            };

            let row_base = row * cols;
            let chunk_row_base = (row >> CHUNK_SHIFT) * chunk_cols;
            for chunk_col in 0..chunk_cols {
                if self.chunk_active[chunk_row_base + chunk_col] == 0 {
                    continue;
                }
                // A chunk starts on an even column, so the first base in it is at `base_parity`.
                let first = chunk_col * CHUNK_SIZE + base_parity;
                let end = ((chunk_col + 1) * CHUNK_SIZE).min(cols);
                let mut col = first;
                while col < end {
                    let base = row_base + col;
                    let mate_q = self.neighbor_indices[base * 6 + BLOCK_MATE_Q] as usize;
                    let mate_r = self.neighbor_indices[base * 6 + BLOCK_MATE_R] as usize;

                    let s0 = self.state[base] as usize;
                    let s1 = self.state[mate_q] as usize;
                    let s2 = self.state[mate_r] as usize;

                    let packed = self.block_rule[s0 * k2 + s1 * k + s2] as usize;
                    let o0 = (packed / k2) as u8;
                    let o1 = ((packed / k) % k) as u8;
                    let o2 = (packed % k) as u8;

                    // Blocks are disjoint, so writing back into `state` is exact — this is the whole
                    // reason block mode needs no second buffer and its skips are free.
                    for (cell, before, after) in
                        [(base, s0 as u8, o0), (mate_q, s1 as u8, o1), (mate_r, s2 as u8, o2)]
                    {
                        if after != before {
                            self.state[cell] = after;
                            // A block straddles up to three chunks, so a change is attributed to the
                            // chunk holding the cell that moved, not to the base's chunk.
                            let chunk = self.chunk_of(cell);
                            self.chunk_changed[chunk] = 1;
                            changed += 1;
                        }
                    }
                    col += 2;
                }
            }
        }
        changed
    }
}

// ---------------------------------------------------------------------------
// Unit tests. These run natively via `cargo test` alongside `World`'s, and none of them touch
// `World` — the point of the separation is that its goldens stay byte-identical.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use crate::World;

    /// Deterministic xorshift32, matching the generator `World`'s tests use.
    fn xorshift32(seed: &mut u32) -> u32 {
        let mut x = *seed;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        *seed = x;
        x
    }

    fn neighborhood_world(cols: i32, rows: i32, k: u8) -> WorldK {
        WorldK::new(cols, rows, k, BACKEND_NEIGHBORHOOD).expect("valid neighborhood world")
    }

    fn block_world(cols: i32, rows: i32, k: u8) -> WorldK {
        WorldK::new(cols, rows, k, BACKEND_BLOCK).expect("valid block world")
    }

    /// Fill a world's cells with a deterministic uniform draw over `0..k`.
    fn seed_cells(w: &mut WorldK, seed: &mut u32) {
        let k = w.k as u32;
        let cells: Vec<u8> = (0..w.num_cells).map(|_| (xorshift32(seed) % k) as u8).collect();
        w.set_cells(&cells).expect("seeded cells are in range");
    }

    /// A deterministic pseudo-random total rule over the whole `k⁷` table.
    fn random_neighborhood_rule(w: &WorldK, seed: &mut u32) -> Vec<u8> {
        let k = w.k as u32;
        (0..w.neighborhood_rule.len())
            .map(|_| (xorshift32(seed) % k) as u8)
            .collect()
    }

    /// The identity block rule: every block maps to itself. Trivially conservative and isotropic.
    fn identity_block_rule(k: usize) -> Vec<u16> {
        (0..(k * k * k) as u16).collect()
    }

    /// Recompute one neighborhood generation the plain dense way — every cell, no chunk activity,
    /// no skipping. Deliberately a fresh transcription rather than a call into the engine, so a bug
    /// in the fast path cannot hide by being present on both sides.
    fn dense_reference_tick(w: &WorldK) -> (Vec<u8>, u32) {
        let k = w.k;
        let k6 = k.pow(6);
        let mut next = vec![0u8; w.num_cells];
        let mut changed = 0u32;
        for i in 0..w.num_cells {
            let mut index = w.state[i] as usize * k6;
            let mut place = 1usize;
            for n_order in 0..6 {
                index += w.state[w.neighbor_indices[i * 6 + n_order] as usize] as usize * place;
                place *= k;
            }
            next[i] = w.neighborhood_rule[index];
            if next[i] != w.state[i] {
                changed += 1;
            }
        }
        (next, changed)
    }

    // --- construction -----------------------------------------------------------------------

    #[test]
    fn construction_refuses_configurations_that_would_simulate_wrongly() {
        // k below 2 or above the backend's cap.
        assert!(WorldK::new(64, 66, 1, BACKEND_NEIGHBORHOOD).is_err());
        assert!(WorldK::new(64, 66, 5, BACKEND_NEIGHBORHOOD).is_err(), "k^7 cap is 4");
        assert!(WorldK::new(64, 66, 5, BACKEND_BLOCK).is_ok(), "block mode scales past 4");
        assert!(WorldK::new(64, 66, 17, BACKEND_BLOCK).is_err());
        assert!(WorldK::new(64, 66, 2, 7).is_err(), "unknown backend");

        // Odd columns break the wrap's hex parity for either backend.
        assert!(WorldK::new(65, 66, 2, BACKEND_NEIGHBORHOOD).is_err());

        // THE block-mode precondition. The embed's default of 64 rows fails it, and the message has
        // to name a way out rather than silently producing a seam.
        // `WorldK` is deliberately not `Debug` (it owns megabytes of buffers), so unwrap the error
        // by hand rather than through `expect_err`.
        let err = match WorldK::new(64, 64, 4, BACKEND_BLOCK) {
            Err(message) => message,
            Ok(_) => panic!("64 rows is not a multiple of 3 and must be refused"),
        };
        assert!(err.contains("63") && err.contains("66"), "unhelpful message: {err}");
        assert!(WorldK::new(64, 63, 4, BACKEND_BLOCK).is_ok());
        assert!(WorldK::new(64, 66, 4, BACKEND_BLOCK).is_ok());
        // The neighborhood backend has no such constraint.
        assert!(WorldK::new(64, 64, 4, BACKEND_NEIGHBORHOOD).is_ok());
    }

    #[test]
    fn tick_buffers_stay_fixed_for_100k_ticks() {
        fn signature(world: &WorldK) -> [(usize, usize); 7] {
            [
                (world.state.as_ptr() as usize, world.state.capacity()),
                (world.next_state.as_ptr() as usize, world.next_state.capacity()),
                (world.neighbor_indices.as_ptr() as usize, world.neighbor_indices.capacity()),
                (world.neighborhood_rule.as_ptr() as usize, world.neighborhood_rule.capacity()),
                (world.block_rule.as_ptr() as usize, world.block_rule.capacity()),
                (world.chunk_quiet.as_ptr() as usize, world.chunk_quiet.capacity()),
                (world.chunk_active.as_ptr() as usize, world.chunk_active.capacity()),
            ]
        }

        for mut world in [neighborhood_world(8, 9, 4), block_world(8, 9, 8)] {
            let before = signature(&world);
            for _ in 0..100_000 {
                std::hint::black_box(world.run_tick());
            }
            assert_eq!(
                signature(&world),
                before,
                "a WorldK tick moved or grew a persistent buffer"
            );
        }
    }

    #[test]
    fn rule_and_cell_setters_reject_out_of_range_values() {
        let mut w = neighborhood_world(32, 32, 3);
        assert_eq!(w.rule_len(), 3usize.pow(7));
        assert!(w.set_neighborhood_rule(&vec![0u8; 10]).is_err(), "wrong length");
        let mut rule = vec![0u8; w.rule_len()];
        rule[5] = 3; // not a state below k = 3
        assert!(w.set_neighborhood_rule(&rule).is_err());
        rule[5] = 2;
        assert!(w.set_neighborhood_rule(&rule).is_ok());
        assert!(w.set_block_rule(&[0u16; 27]).is_err(), "wrong backend");

        assert!(w.set_cells(&vec![0u8; 10]).is_err());
        assert!(w.set_cells(&vec![3u8; w.num_cells]).is_err());
        assert!(w.set_cell(w.num_cells, 1).is_err());
        assert!(w.set_cell(0, 3).is_err());
        assert!(w.fill(9).is_err());

        let mut b = block_world(32, 33, 4);
        assert_eq!(b.rule_len(), 64);
        let mut block_rule = identity_block_rule(4);
        block_rule[0] = 64; // not a packed triple below k^3
        assert!(b.set_block_rule(&block_rule).is_err());
        assert!(b.set_neighborhood_rule(&vec![0u8; 4usize.pow(7)]).is_err(), "wrong backend");
    }

    // --- the neighborhood backend -----------------------------------------------------------

    #[test]
    fn k2_neighborhood_matches_binary_world() {
        // The k-state index `self·k⁶ + Σ nⱼ·kʲ` collapses at k=2 to `(self << 6) | mask`, which is
        // exactly `World`'s. So a k=2 WorldK handed the same 128-entry table must evolve
        // byte-identically to the binary engine — the sharpest possible check that the neighbour
        // ordering, the wrap and the index packing all generalize the original rather than
        // resembling it.
        let mut seed = 0x2468_ACEu32;
        let mut rule = vec![0u8; 128];
        for entry in rule.iter_mut() {
            *entry = (xorshift32(&mut seed) & 1) as u8;
        }

        let mut cell_seed = 0xC0FF_EEu32;
        let cells: Vec<u8> = (0..48 * 56).map(|_| (xorshift32(&mut cell_seed) & 1) as u8).collect();

        let mut binary = World::new(48, 56);
        binary.ruleset.copy_from_slice(&rule);
        binary.state.copy_from_slice(&cells);

        let mut k2 = neighborhood_world(48, 56, 2);
        k2.set_neighborhood_rule(&rule).unwrap();
        k2.set_cells(&cells).unwrap();

        assert_eq!(k2.checksum_state(), binary.checksum_state(), "same tick 0");
        for tick in 0..40 {
            binary.run_tick();
            k2.run_tick();
            assert_eq!(
                k2.state, binary.state,
                "k=2 WorldK diverged from World at tick {tick}"
            );
            assert_eq!(k2.last_changed_count(), binary.last_changed_count());
        }
    }

    #[test]
    fn neighborhood_tick_matches_dense_reference_across_grids_and_k() {
        // The claim of the skipping path is that skipping changes nothing. Check every tick against
        // a from-scratch dense recomputation, over grids that cross each chunk-tiling edge case
        // (exact multiples, partial chunks on both edges, grids narrower and shorter than one chunk,
        // and a grid two chunks wide where a chunk's left and right neighbours coincide).
        let grids = [(32i32, 32i32), (38, 29), (16, 12), (64, 96), (66, 35), (128, 64)];
        let mut seed = 0x5EED_1234u32;
        for &(cols, rows) in &grids {
            for k in 2..=MAX_NEIGHBORHOOD_STATES {
                let mut w = neighborhood_world(cols, rows, k);
                let rule = random_neighborhood_rule(&w, &mut seed);
                w.set_neighborhood_rule(&rule).unwrap();
                seed_cells(&mut w, &mut seed);

                for tick in 0..8 {
                    let (want_state, want_changed) = dense_reference_tick(&w);
                    let changed = w.run_tick();
                    assert_eq!(
                        w.state, want_state,
                        "state diverged: {cols}x{rows} k={k} tick {tick}"
                    );
                    assert_eq!(
                        changed, want_changed,
                        "changed count diverged: {cols}x{rows} k={k} tick {tick}"
                    );
                }
            }
        }
    }

    #[test]
    fn chunk_skipping_is_behaviour_neutral_on_a_settling_world() {
        // A rule that pushes the grid to a fixed point, run twice: once with skipping on and once
        // with it forced off. Every generation must agree, and the skipping run must actually end up
        // skipping — a test that only checked equality would pass if the fast path never fired.
        let k = 3u8;
        let mut w = neighborhood_world(64, 66, k);
        // "Take the majority-ish digit": next state = the centre's own value unless every neighbour
        // agrees on something else. Converges to frozen domains rather than churning.
        let k6 = (k as usize).pow(6);
        let mut rule = vec![0u8; (k as usize).pow(7)];
        for index in 0..rule.len() {
            let centre = index / k6;
            let mut digits = [0usize; 6];
            let mut rest = index % k6;
            for digit in digits.iter_mut() {
                *digit = rest % k as usize;
                rest /= k as usize;
            }
            let unanimous = digits.iter().all(|&d| d == digits[0]);
            rule[index] = if unanimous { digits[0] as u8 } else { centre as u8 };
        }

        let mut seed = 0xBEEF_0001u32;
        let cells: Vec<u8> = (0..w.num_cells).map(|_| (xorshift32(&mut seed) % k as u32) as u8).collect();
        w.set_neighborhood_rule(&rule).unwrap();
        w.set_cells(&cells).unwrap();

        let mut dense = neighborhood_world(64, 66, k);
        dense.set_neighborhood_rule(&rule).unwrap();
        dense.set_cells(&cells).unwrap();
        dense.set_skipping_enabled(false);

        let mut ever_skipped = false;
        for tick in 0..60 {
            let fast_changed = w.run_tick();
            let dense_changed = dense.run_tick();
            assert_eq!(w.state, dense.state, "skipping changed the outcome at tick {tick}");
            assert_eq!(fast_changed, dense_changed, "changed count diverged at tick {tick}");
            if (w.active_chunk_count() as usize) < w.chunk_count() {
                ever_skipped = true;
            }
        }
        assert!(ever_skipped, "the fast path never fired, so the equality above proves nothing");
        assert_eq!(dense.active_chunk_count() as usize, dense.chunk_count(), "skipping stayed off");
    }

    #[test]
    fn a_still_life_settles_and_then_costs_nothing() {
        // The centre-preserving rule freezes every cell. Once the grid is quiet the whole tick must
        // reduce to zero active chunks, which is the "stop scheduling frames" signal hosts want.
        let k = 3usize;
        let k6 = k.pow(6);
        let mut rule = vec![0u8; k.pow(7)];
        for (index, entry) in rule.iter_mut().enumerate() {
            *entry = (index / k6) as u8;
        }
        let mut w = neighborhood_world(64, 64, k as u8);
        w.set_neighborhood_rule(&rule).unwrap();
        let mut seed = 0xACE5u32;
        seed_cells(&mut w, &mut seed);

        let before = w.state.clone();
        assert_eq!(w.run_tick(), 0, "a still life changes nothing on the first tick either");
        // One quiet tick is the whole threshold for the neighborhood backend — the inputs to every
        // cell are provably identical to last tick's, so the next tick is already free.
        assert!(w.is_settled());
        w.run_tick();
        assert_eq!(w.active_chunk_count(), 0, "a settled world must do no work at all");
        for _ in 0..20 {
            w.run_tick();
        }
        assert_eq!(w.state, before, "a settled world must not drift");
    }

    #[test]
    fn external_writes_wake_the_activity_tracker() {
        // THE staleness hazard. A world that has gone quiet must notice a cell poked into it — via
        // any of the supported write paths — and recompute the affected neighbourhood.
        let k = 3usize;
        let k6 = k.pow(6);
        let mut rule = vec![0u8; k.pow(7)];
        for (index, entry) in rule.iter_mut().enumerate() {
            // Centre-preserving except that a cell with any state-1 neighbour becomes 1: a change
            // introduced anywhere spreads, so a missed wake-up is visible rather than subtle.
            let centre = (index / k6) as u8;
            let mut rest = index % k6;
            let mut touched = false;
            for _ in 0..6 {
                if rest % k == 1 {
                    touched = true;
                }
                rest /= k;
            }
            *entry = if touched { 1 } else { centre };
        }

        for write in 0..3 {
            let mut w = neighborhood_world(64, 64, k as u8);
            w.set_neighborhood_rule(&rule).unwrap();
            w.fill(0).unwrap();
            for _ in 0..5 {
                w.run_tick();
            }
            assert!(w.is_settled(), "an empty world under this rule settles");

            // Cell 0 sits in chunk 0; put the poke well inside the grid instead so the wake has to
            // travel through the halo rather than trivially covering everything.
            let target = 33 * 64 + 33;
            match write {
                0 => w.set_cell(target, 1).unwrap(),
                1 => {
                    let mut cells = vec![0u8; w.num_cells];
                    cells[target] = 1;
                    w.set_cells(&cells).unwrap();
                }
                _ => {
                    // The unsupported path — a direct poke — followed by the documented repair.
                    w.state[target] = 1;
                    w.mark_all_dirty();
                }
            }
            assert!(!w.is_settled(), "write {write} left the world looking settled");
            for _ in 0..12 {
                w.run_tick();
            }
            w.compute_census();
            assert!(
                w.census_of(1) > 1,
                "write {write}: the perturbation did not spread, so a chunk was wrongly skipped"
            );
        }
    }

    // --- the block partition ----------------------------------------------------------------

    #[test]
    fn block_partition_matches_canonical_table() {
        // The partition derivation is on paper; this checks the result against `neighbor_indices`.
        // For every phase: every cell belongs to exactly one block, and a block's three cells are
        // pairwise adjacent per the canonical neighbour table (i.e. they really are a triangle).
        for &(cols, rows) in &[(64i32, 66i32), (12, 33), (40, 63), (6, 6), (128, 96)] {
            let w = block_world(cols, rows, 2);
            let adjacent = |a: usize, b: usize| {
                (0..6).any(|n| w.neighbor_indices[a * 6 + n] as usize == b)
            };
            for phase in 0..BLOCK_PHASES as usize {
                let mut membership = vec![0u8; w.num_cells];
                for row in 0..w.grid_rows {
                    let residue = row % 3;
                    let base_parity = if residue == (3 - phase) % 3 {
                        0usize
                    } else if residue == (4 - phase) % 3 {
                        1usize
                    } else {
                        continue;
                    };
                    let mut col = base_parity;
                    while col < w.grid_cols {
                        let base = row * w.grid_cols + col;
                        let mate_q = w.neighbor_indices[base * 6 + BLOCK_MATE_Q] as usize;
                        let mate_r = w.neighbor_indices[base * 6 + BLOCK_MATE_R] as usize;
                        assert!(
                            adjacent(base, mate_q) && adjacent(base, mate_r) && adjacent(mate_q, mate_r),
                            "{cols}x{rows} phase {phase}: block at {base} is not a triangle"
                        );
                        for cell in [base, mate_q, mate_r] {
                            membership[cell] += 1;
                        }
                        col += 2;
                    }
                }
                for (cell, &count) in membership.iter().enumerate() {
                    assert_eq!(
                        count, 1,
                        "{cols}x{rows} phase {phase}: cell {cell} is in {count} blocks, not exactly one"
                    );
                }
            }
        }
    }

    #[test]
    fn block_phases_cover_all_six_neighbours() {
        // The reason there are three phases: over a full cycle a cell must block with each of its
        // six neighbours exactly once, or some pair of adjacent cells could never interact.
        let w = block_world(64, 66, 2);
        let mut mates: Vec<Vec<usize>> = vec![Vec::new(); w.num_cells];
        for phase in 0..BLOCK_PHASES as usize {
            for row in 0..w.grid_rows {
                let residue = row % 3;
                let base_parity = if residue == (3 - phase) % 3 {
                    0usize
                } else if residue == (4 - phase) % 3 {
                    1usize
                } else {
                    continue;
                };
                let mut col = base_parity;
                while col < w.grid_cols {
                    let base = row * w.grid_cols + col;
                    let mate_q = w.neighbor_indices[base * 6 + BLOCK_MATE_Q] as usize;
                    let mate_r = w.neighbor_indices[base * 6 + BLOCK_MATE_R] as usize;
                    for (a, b) in [(base, mate_q), (base, mate_r), (mate_q, mate_r)] {
                        mates[a].push(b);
                        mates[b].push(a);
                    }
                    col += 2;
                }
            }
        }
        for cell in 0..w.num_cells {
            let mut got = mates[cell].clone();
            got.sort_unstable();
            got.dedup();
            let mut want: Vec<usize> =
                (0..6).map(|n| w.neighbor_indices[cell * 6 + n] as usize).collect();
            want.sort_unstable();
            assert_eq!(got, want, "cell {cell} does not block with all six neighbours over a cycle");
        }
    }

    #[test]
    fn chunk_halo_covers_every_reader() {
        // The safety property behind the skipping path: if a cell's neighbour lives in a chunk the
        // halo does not check, a quiet chunk can be skipped while its input changed. Assert the
        // covering directly against the neighbour table, on grids whose last chunk column is full,
        // partial ending odd, and partial ending even (which flips the right-hand offsets).
        for &(cols, rows) in &[(64i32, 64i32), (66, 64), (64, 66), (38, 38), (16, 16), (128, 96)] {
            let w = neighborhood_world(cols, rows, 2);
            for i in 0..w.num_cells {
                let chunk_col = (i % w.grid_cols) >> CHUNK_SHIFT;
                let chunk_row = (i / w.grid_cols) >> CHUNK_SHIFT;
                let halo: Vec<usize> = w
                    .chunk_halo_offsets(chunk_col)
                    .iter()
                    .map(|&(delta_col, delta_row)| {
                        let neighbor_col =
                            (chunk_col as isize + delta_col).rem_euclid(w.chunk_cols as isize) as usize;
                        let neighbor_row =
                            (chunk_row as isize + delta_row).rem_euclid(w.chunk_rows as isize) as usize;
                        neighbor_row * w.chunk_cols + neighbor_col
                    })
                    .collect();
                for n in 0..6 {
                    let j = w.neighbor_indices[i * 6 + n] as usize;
                    assert!(
                        halo.contains(&w.chunk_of(j)),
                        "{cols}x{rows}: cell {i} neighbour {n} falls outside chunk ({chunk_col}, {chunk_row})'s halo"
                    );
                }
            }
        }
    }

    #[test]
    fn identity_block_rule_is_a_still_life() {
        let mut w = block_world(64, 66, 4);
        w.set_block_rule(&identity_block_rule(4)).unwrap();
        let mut seed = 0x1357u32;
        seed_cells(&mut w, &mut seed);
        let before = w.state.clone();
        for _ in 0..30 {
            assert_eq!(w.run_tick(), 0);
        }
        assert_eq!(w.state, before);
        assert!(w.is_settled());
    }

    #[test]
    fn conservative_block_rule_preserves_the_census_exactly() {
        // THE property block mode exists for, and the one a radius-1 synchronous CA cannot have at
        // any k. Build a rule that permutes each block's multiset — here, a cyclic rotation of the
        // triple, which is conservative by construction and also isotropic — and check every entry
        // of the per-state histogram holds over a long run.
        for k in [2usize, 4, 8, 16] {
            let mut w = block_world(96, 66, k as u8);
            w.set_block_rule(&rotation_block_rule(k)).unwrap();
            let mut seed = 0xFEED_0000u32 + k as u32;
            seed_cells(&mut w, &mut seed);

            w.compute_census();
            let want: Vec<u32> = w.census.clone();
            assert_eq!(want.iter().sum::<u32>() as usize, w.num_cells);

            for tick in 0..10_000 {
                w.run_tick();
                if tick % 97 == 0 || tick == 9_999 {
                    w.compute_census();
                    assert_eq!(w.census, want, "k={k}: census drifted by tick {tick}");
                }
            }
            // And the transport is real — a rotation that never moved anything would also conserve.
            assert!(w.last_changed_count() > 0, "k={k}: nothing actually moved");
        }
    }

    /// The cyclic block rotation `(s0, s1, s2) -> (s2, s0, s1)`: conservative by construction (it
    /// permutes the multiset), isotropic (equivariant under rotating the triple), and it fixes the
    /// all-background block, so empty regions stay quiet.
    fn rotation_block_rule(k: usize) -> Vec<u16> {
        let mut rule = vec![0u16; k * k * k];
        for s0 in 0..k {
            for s1 in 0..k {
                for s2 in 0..k {
                    rule[s0 * k * k + s1 * k + s2] = (s2 * k * k + s0 * k + s1) as u16;
                }
            }
        }
        rule
    }

    #[test]
    fn block_skipping_is_behaviour_neutral() {
        // Block mode's skip needs a full partition cycle of quiet, not one tick, because a block is
        // only re-evaluated every third tick. Run a compact blob of material in a large vacuum —
        // the shape a physical model actually has — against the same setup with skipping forced off.
        let k = 4usize;
        let rule = rotation_block_rule(k);

        // 8x3 chunks, so a blob confined to the left edge leaves a column of chunks that neither it
        // nor the torus wrap can reach.
        let (cols, rows) = (256usize, 96usize);
        let mut seed = 0x0BAD_F00Du32;
        let mut cells = vec![0u8; cols * rows];
        for row in 30..60 {
            for col in 4..28 {
                cells[row * cols + col] = (xorshift32(&mut seed) % k as u32) as u8;
            }
        }

        let mut fast = block_world(cols as i32, rows as i32, k as u8);
        fast.set_block_rule(&rule).unwrap();
        fast.set_cells(&cells).unwrap();

        let mut dense = block_world(cols as i32, rows as i32, k as u8);
        dense.set_block_rule(&rule).unwrap();
        dense.set_cells(&cells).unwrap();
        dense.set_skipping_enabled(false);

        let mut min_active = usize::MAX;
        for tick in 0..90 {
            let fast_changed = fast.run_tick();
            let dense_changed = dense.run_tick();
            assert_eq!(fast.state, dense.state, "block skipping changed the outcome at tick {tick}");
            assert_eq!(fast_changed, dense_changed, "changed count diverged at tick {tick}");
            min_active = min_active.min(fast.active_chunk_count() as usize);
        }
        assert!(
            min_active < fast.chunk_count(),
            "the block fast path never fired, so the equality above proves nothing"
        );
    }

    #[test]
    fn radius_one_cannot_conserve_mass_but_block_mode_does() {
        // THE argument for block mode, as an executable claim rather than a paragraph.
        //
        // A radius-1 synchronous CA cannot conserve mass at any k, because the cells competing for a
        // destination are two apart and so cannot see each other. Take the most natural gravity rule
        // the neighborhood backend can express — water vacates when any downward neighbour is open,
        // open space fills when any upward neighbour holds water — and the census moves on the very
        // first tick. (It moves in *both* directions for want of arbitration: two sources feeding one
        // destination lose mass, one source feeding three destinations duplicates it. Which one wins
        // depends on the configuration, and neither is something a physical model can tolerate.)
        //
        // Block mode holds the same census exactly, on the same initial cells, forever.
        const DOWNWARD: [usize; 3] = [0, 4, 5];
        const UPWARD: [usize; 3] = [1, 2, 3];

        let mut rule = vec![0u8; 128];
        for (index, entry) in rule.iter_mut().enumerate() {
            let centre = (index >> 6) & 1;
            let mask = index & 0x3F;
            *entry = if centre == 1 {
                // Water stays only where every downward neighbour is already occupied.
                u8::from(DOWNWARD.iter().all(|&n| mask & (1 << n) != 0))
            } else {
                u8::from(UPWARD.iter().any(|&n| mask & (1 << n) != 0))
            };
        }

        let (cols, rows) = (64usize, 66usize);
        let mut seed = 0x00C0_FFEEu32;
        let cells: Vec<u8> = (0..cols * rows)
            .map(|_| u8::from(xorshift32(&mut seed) % 100 < 12))
            .collect();
        let planted: u32 = cells.iter().map(|&c| c as u32).sum();
        assert!(planted > 0);

        let mut leaky = neighborhood_world(cols as i32, rows as i32, 2);
        leaky.set_neighborhood_rule(&rule).unwrap();
        leaky.set_cells(&cells).unwrap();
        leaky.run_tick();
        leaky.compute_census();
        assert_ne!(
            leaky.census_of(1),
            planted,
            "radius-1 gravity held the census exactly, which it cannot do — check the rule, not the engine"
        );

        let mut conserving = block_world(cols as i32, rows as i32, 2);
        conserving.set_block_rule(&rotation_block_rule(2)).unwrap();
        conserving.set_cells(&cells).unwrap();
        conserving.compute_census();
        let want = conserving.census.clone();
        assert_eq!(want[1], planted);
        for tick in 0..600 {
            conserving.run_tick();
            conserving.compute_census();
            assert_eq!(conserving.census, want, "block census drifted at tick {tick}");
        }
        assert!(conserving.last_changed_count() > 0, "nothing actually moved");
    }

    #[test]
    fn site_percolation_transition_sits_at_one_half() {
        // A real analytic check on the neighbour topology rather than a smoke test. Hex cell centres
        // form a TRIANGULAR lattice, and site percolation on the triangular lattice has p_c = 1/2
        // exactly — the only common lattice with a closed form (square is ≈0.5927, numerical only).
        // A wrong wrap, a wrong parity branch or a wrong neighbour table moves this threshold.
        //
        // Measured by spanning probability across the row axis on a non-wrapped strip: fill each
        // cell open with probability p, then flood from the top row and ask whether the bottom row
        // is reached.
        let cols = 96usize;
        let rows = 96usize;
        let w = neighborhood_world(cols as i32, rows as i32, 2);
        let mut seed = 0x9E37_79B9u32;

        let spanning_fraction = |p_per_mille: u32, seed: &mut u32| -> f64 {
            let trials = 40;
            let mut spanned = 0;
            for _ in 0..trials {
                let open: Vec<bool> = (0..cols * rows)
                    .map(|_| xorshift32(seed) % 1000 < p_per_mille)
                    .collect();
                // Flood fill from every open cell in row 0, refusing to cross the row wrap so the
                // strip has genuine top and bottom boundaries.
                let mut seen = vec![false; cols * rows];
                let mut stack: Vec<usize> = (0..cols).filter(|&c| open[c]).collect();
                for &c in &stack {
                    seen[c] = true;
                }
                let mut reached_bottom = false;
                while let Some(cell) = stack.pop() {
                    if cell / cols == rows - 1 {
                        reached_bottom = true;
                        break;
                    }
                    for n in 0..6 {
                        let next = w.neighbor_indices[cell * 6 + n] as usize;
                        let (from_row, to_row) = (cell / cols, next / cols);
                        // Vertical wrap only; the column wrap is left in place (it is a cylinder,
                        // which does not shift the threshold).
                        if from_row == 0 && to_row == rows - 1 {
                            continue;
                        }
                        if from_row == rows - 1 && to_row == 0 {
                            continue;
                        }
                        if open[next] && !seen[next] {
                            seen[next] = true;
                            stack.push(next);
                        }
                    }
                }
                if reached_bottom {
                    spanned += 1;
                }
            }
            spanned as f64 / trials as f64
        };

        // Well below p_c almost nothing spans; well above it almost everything does. The window is
        // deliberately wide (±0.08) because a 96x96 strip has real finite-size rounding — the point
        // is that the transition sits at 1/2 and not at 0.59, which is where a square-lattice
        // neighbourhood would put it.
        let below = spanning_fraction(420, &mut seed);
        let at = spanning_fraction(500, &mut seed);
        let above = spanning_fraction(580, &mut seed);
        assert!(below < 0.15, "p=0.42 should rarely span, got {below}");
        assert!(above > 0.85, "p=0.58 should almost always span, got {above}");
        assert!(
            (0.2..=0.8).contains(&at),
            "p=0.50 should sit inside the transition, got {at} — the threshold has moved off 1/2"
        );
    }

    #[test]
    fn checksum_and_census_track_the_current_generation() {
        let mut w = block_world(64, 66, 4);
        w.set_block_rule(&identity_block_rule(4)).unwrap();
        w.fill(2).unwrap();
        w.compute_census();
        assert_eq!(w.census_of(2) as usize, w.num_cells);
        assert_eq!(w.census_of(0), 0);
        assert_eq!(w.census_of(9), 0, "a state outside 0..k reads as zero rather than panicking");

        // The mixing constant matches World::checksum_state, so an all-2 grid hashes the same way a
        // binary engine would hash an all-2 grid.
        let mut want: i32 = 0;
        for _ in 0..w.num_cells {
            want = want.wrapping_mul(31).wrapping_add(2);
        }
        assert_eq!(w.checksum_state(), want);
    }

    #[test]
    fn phase_advances_with_the_tick_counter() {
        let mut w = block_world(64, 66, 2);
        w.set_block_rule(&identity_block_rule(2)).unwrap();
        assert_eq!((w.tick_count(), w.phase()), (0, 0));
        w.run_tick();
        assert_eq!((w.tick_count(), w.phase()), (1, 1));
        w.run_tick();
        assert_eq!((w.tick_count(), w.phase()), (2, 2));
        w.run_tick();
        assert_eq!((w.tick_count(), w.phase()), (3, 0));
        assert!(!w.is_double_buffered(), "block mode rewrites in place");

        let n = neighborhood_world(64, 64, 2);
        assert!(n.is_double_buffered());
    }
}
