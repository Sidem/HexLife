use wasm_bindgen::prelude::*;

use crate::compute_neighbor_indices;

/// Reproducibility version for the tuple-to-counter mapping and Philox round function below.
pub const STOCHASTIC_RNG_VERSION: u32 = 1;

pub const RNG_LEGACY_DEMO: u8 = 0;
pub const RNG_PHILOX_V1: u8 = 1;
const RULE_MAGIC: &[u8; 4] = b"HSN1";
const RULE_HEADER_BYTES: usize = 8;
const RULE_ROW_BYTES: usize = 272;
const THRESHOLD_COUNT: usize = 64;
const MAX_STATES: usize = 16;
const MAX_TRANSITIONS: usize = 64;
const NO_NEIGHBOR_STATE: u8 = u8::MAX;
const FLAG_RESET_EPOCH: u8 = 1;

pub const BACKEND_NEIGHBORHOOD: u8 = 0;
pub const BACKEND_LATTICE_GAS: u8 = 1;

// ---- Lattice-gas backend constants ---------------------------------------------------------

const GAS_MAGIC: &[u8; 4] = b"HSG1";
const GAS_HEADER_BYTES: usize = 12;
/// Two bits per velocity channel over six canonical directions.
const GAS_CONFIGURATIONS: usize = 1 << 12;
const GAS_CONFIG_MASK: u16 = 0x0FFF;
/// Wall marker carried in the channel word itself. The `walls` byte buffer stays authoritative for
/// export, but the tick reads only `channels`, which halves the scattered loads the gather makes.
const GAS_WALL_BIT: u16 = 0x8000;
const GAS_RULE_BYTES: usize = GAS_HEADER_BYTES + GAS_CONFIGURATIONS * 8;
/// vacuum Â· amber Â· cyan Â· mixed Â· wall.
const GAS_VISIBLE_STATES: u8 = 5;
const GAS_VACUUM: u8 = 0;
const GAS_AMBER: u8 = 1;
const GAS_CYAN: u8 = 2;
const GAS_MIXED: u8 = 3;
const GAS_WALL: u8 = 4;
/// Stable compiled stream ids. Changing one changes every gas trajectory, so they are constants
/// rather than anything derived from rule ordering.
const STREAM_GAS_COLLISION: u32 = 0x4741_5301;
const STREAM_GAS_SCATTER: u32 = 0x4741_5302;

/// Rotate all six two-bit velocity channels by `step` positions counter-clockwise.
#[inline]
fn rotate_channels(config: u16, step: u32) -> u16 {
    let shift = 2 * step;
    ((config << shift) | (config >> (12 - shift))) & GAS_CONFIG_MASK
}

/// Amber count, cyan count, and visible state for one packed configuration, as
/// `visible << 16 | cyan << 8 | amber`. Precomputed once so the tick needs no per-channel scan.
#[inline]
fn gas_profile_of(config: u16) -> u32 {
    let (mut amber, mut cyan) = (0u32, 0u32);
    for direction in 0..6 {
        match (config >> (2 * direction)) & 3 {
            1 => amber += 1,
            2 => cyan += 1,
            _ => {}
        }
    }
    let visible = if amber == 0 && cyan == 0 {
        GAS_VACUUM
    } else if cyan == 0 {
        GAS_AMBER
    } else if amber == 0 {
        GAS_CYAN
    } else {
        GAS_MIXED
    };
    (u32::from(visible) << 16) | (cyan << 8) | amber
}

/// Whether every channel of a packed configuration holds a legal species (0, 1, or 2).
#[inline]
fn gas_config_is_legal(config: u16) -> bool {
    (0..6).all(|direction| (config >> (2 * direction)) & 3 != 3)
}

/// Side length in cells of the activity-tracking chunks, as a shift so the per-cell chunk lookup is
/// `col >> CHUNK_SHIFT`. Must stay a power of two and **even**, because [`chunk_halo_offsets`]
/// relies on a chunk starting on an even column. Matches `WorldK` so the two engines' activity
/// diagnostics are directly comparable.
const CHUNK_SHIFT: usize = 5;
const CHUNK_SIZE: usize = 1 << CHUNK_SHIFT;

/// A stochastic chunk may sleep after a single quiet tick. `WorldK`'s block backend needs three
/// because its partition has a phase cycle; the stochastic neighborhood tick has none, and the two
/// extra reasons time alone can change a cell â€” an age deadline and a live hazard â€” are tracked
/// explicitly rather than approximated by waiting.
const QUIET_TICKS: u32 = 1;

/// `chunk_deadline` sentinel: no cell in this chunk has a future age at which a row with non-zero
/// probability becomes applicable.
const NO_DEADLINE: u32 = u32::MAX;

/// Epochs are rebased this often so `generation - entered_generation` can never approach the `u32`
/// half-range. Ages saturate at `u16::MAX`, so clamping the stored distance to that value is exact.
const EPOCH_REBASE_INTERVAL: u32 = 1 << 24;

/// Elapsed age, saturating rather than wrapping.
///
/// Saturation is what makes [`WorldStochastic::refresh_chunk_activity`] sound: a wrapping age would
/// make every expired row applicable again 65,536 ticks later, so no cell could ever be proven
/// permanently dormant.
#[inline]
fn saturating_age(generation: u32, entered: u32) -> u16 {
    let delta = generation.wrapping_sub(entered);
    if delta > u16::MAX as u32 {
        u16::MAX
    } else {
        delta as u16
    }
}

/// The age a cell will hold after the tick currently being computed, saturating.
#[inline]
fn saturating_age_after(generation: u32, entered: u32) -> u16 {
    let delta = generation.wrapping_sub(entered);
    if delta >= u16::MAX as u32 {
        u16::MAX
    } else {
        (delta + 1) as u16
    }
}

const PHILOX_M0: u32 = 0xD251_1F53;
const PHILOX_M1: u32 = 0xCD9E_8D57;
const PHILOX_W0: u32 = 0x9E37_79B9;
const PHILOX_W1: u32 = 0xBB67_AE85;
const PHILOX_ROUNDS: usize = 10;

#[inline]
fn mul_hi_lo(a: u32, b: u32) -> (u32, u32) {
    let product = u64::from(a) * u64::from(b);
    ((product >> 32) as u32, product as u32)
}

/// The full four-word Philox4x32-10 block for one counter tuple.
///
/// Counter words are `[counter_index, stream_id, generation_lo, generation_hi]`; key words are the
/// low/high halves of `seed`. No mutable cursor exists, so skipping a cell or reordering rule rows
/// cannot shift any other cell's stream.
#[inline]
fn philox4(seed: u64, generation: u64, counter_index: u32, stream_id: u32) -> [u32; 4] {
    let mut counter = [
        counter_index,
        stream_id,
        generation as u32,
        (generation >> 32) as u32,
    ];
    let mut key = [seed as u32, (seed >> 32) as u32];

    for _ in 0..PHILOX_ROUNDS {
        let (hi0, lo0) = mul_hi_lo(PHILOX_M0, counter[0]);
        let (hi1, lo1) = mul_hi_lo(PHILOX_M1, counter[2]);
        counter = [
            hi1 ^ counter[1] ^ key[0],
            lo1,
            hi0 ^ counter[3] ^ key[1],
            lo0,
        ];
        key[0] = key[0].wrapping_add(PHILOX_W0);
        key[1] = key[1].wrapping_add(PHILOX_W1);
    }

    counter
}

/// Counter-based Philox4x32-10 sample for one stochastic decision: word 0 of the block above.
#[wasm_bindgen]
pub fn random_u32(seed: u64, generation: u64, cell_index: u32, stream_id: u32) -> u32 {
    philox4(seed, generation, cell_index, stream_id)[0]
}

#[inline]
fn legacy_demo_random_u32(seed: u64, generation: u64, cell_index: u32, stream_id: u32) -> u32 {
    let mut value = (seed as u32)
        ^ (generation as u32)
            .wrapping_add(1)
            .wrapping_mul(0x9E37_79B1)
        ^ cell_index.wrapping_add(1).wrapping_mul(0x85EB_CA6B)
        ^ stream_id;
    value ^= value >> 16;
    value = value.wrapping_mul(0x7FEB_352D);
    value ^= value >> 15;
    value = value.wrapping_mul(0x846C_A68B);
    value ^ (value >> 16)
}

trait CounterRng {
    fn sample(seed: u64, generation: u64, cell_index: u32, stream_id: u32) -> u32;

    /// Four consecutive cells' samples for one stream, produced together.
    ///
    /// Philox already computes four words per invocation; `sample` throws three of them away. The
    /// lattice gas draws once per occupied site, so amortizing one block over four sites removes
    /// most of that waste. This mapping is part of the versioned reproducibility contract and is
    /// deliberately *not* used by the neighborhood backend, whose per-row tuple is already frozen.
    fn sample_block(seed: u64, generation: u64, block_index: u32, stream_id: u32) -> [u32; 4];
}

struct PhiloxV1;
impl CounterRng for PhiloxV1 {
    #[inline]
    fn sample(seed: u64, generation: u64, cell_index: u32, stream_id: u32) -> u32 {
        random_u32(seed, generation, cell_index, stream_id)
    }

    #[inline]
    fn sample_block(seed: u64, generation: u64, block_index: u32, stream_id: u32) -> [u32; 4] {
        philox4(seed, generation, block_index, stream_id)
    }
}

struct LegacyDemo;
impl CounterRng for LegacyDemo {
    #[inline]
    fn sample(seed: u64, generation: u64, cell_index: u32, stream_id: u32) -> u32 {
        legacy_demo_random_u32(seed, generation, cell_index, stream_id)
    }

    #[inline]
    fn sample_block(seed: u64, generation: u64, block_index: u32, stream_id: u32) -> [u32; 4] {
        std::array::from_fn(|word| {
            legacy_demo_random_u32(seed, generation, block_index * 4 + word as u32, stream_id)
        })
    }
}

#[derive(Clone)]
struct TransitionRow {
    from: u8,
    to: u8,
    neighbor_state: u8,
    reset_epoch: bool,
    min_age: u16,
    max_age: u16,
    stream_id: u32,
    thresholds: [u32; THRESHOLD_COUNT],
}

/// Dense stochastic-neighborhood world. Every per-cell buffer has final capacity at construction;
/// installing a rule may replace only the bounded compiled row table and canonical rule bytes.
#[wasm_bindgen]
pub struct WorldStochastic {
    rows: u32,
    columns: u32,
    grid_cols: usize,
    num_cells: usize,
    seed: u64,
    generation: u64,
    states: u8,
    rng_tag: u8,
    backend: u8,
    visible_state: Vec<u8>,
    next_visible_state: Vec<u8>,
    entered_generation: Vec<u32>,
    next_entered_generation: Vec<u32>,
    initial_state: Vec<u8>,
    initial_entered_generation: Vec<u32>,
    elapsed_age_scratch: Vec<u16>,
    neighbor_indices: Vec<u32>,
    rule_bytes: Vec<u8>,
    transitions: Vec<TransitionRow>,
    row_offsets: [u16; MAX_STATES + 1],
    age_tracked: [bool; MAX_STATES],
    census: [u32; MAX_STATES],
    transition_counts: [u32; MAX_TRANSITIONS],
    last_changed_count: u32,
    /// The generation a reset returns to; see `resume_at_generation`.
    initial_generation: u64,
    chunk_cols: usize,
    chunk_rows: usize,
    /// Consecutive ticks, ending with the previous one, in which no cell of this chunk changed
    /// visible state. Saturating, so a chunk that settles forever does not wrap.
    chunk_quiet: Vec<u32>,
    /// Whether this chunk changed during the tick in progress (scratch, cleared per tick).
    chunk_changed: Vec<u8>,
    /// Whether this chunk must be recomputed this tick (derived per tick).
    chunk_active: Vec<u8>,
    /// Whether some cell of this chunk holds a live stochastic hazard: a row that is age-applicable
    /// on the *next* tick with a non-zero probability for the current neighbor mask.
    chunk_hazard: Vec<u8>,
    /// Ticks from now until the earliest age at which some row of this chunk becomes applicable
    /// with non-zero probability. [`NO_DEADLINE`] when no cell has one.
    chunk_deadline: Vec<u32>,
    skipping_enabled: bool,

    // ---- Lattice-gas backend. Empty vectors on a neighborhood world, and vice versa. ----
    /// Six two-bit velocity channels per site, packed little-end-first by canonical direction.
    channels: Vec<u16>,
    next_channels: Vec<u16>,
    walls: Vec<u8>,
    initial_channels: Vec<u16>,
    initial_walls: Vec<u8>,
    /// Collision table over every packed configuration: low half primary, high half alternate.
    gas_outcomes: Vec<u32>,
    /// Probability of taking the alternate outcome, read only when the two differ.
    gas_thresholds: Vec<u32>,
    /// `visible << 16 | cyan << 8 | amber` for every packed configuration.
    gas_profile: Vec<u32>,
    gas_scatter: u32,
    species_counts: [u32; 3],
    collision_count: u32,
}

#[wasm_bindgen]
impl WorldStochastic {
    #[wasm_bindgen(constructor)]
    pub fn new(columns: u32, rows: u32, seed: u64) -> Result<WorldStochastic, String> {
        Self::with_backend(columns, rows, seed, BACKEND_NEIGHBORHOOD)
    }

    /// A lattice-gas world. A separate constructor rather than a runtime switch so neither backend
    /// allocates the other's per-cell buffers.
    pub fn new_lattice_gas(columns: u32, rows: u32, seed: u64) -> Result<WorldStochastic, String> {
        Self::with_backend(columns, rows, seed, BACKEND_LATTICE_GAS)
    }

    fn with_backend(
        columns: u32,
        rows: u32,
        seed: u64,
        backend: u8,
    ) -> Result<WorldStochastic, String> {
        if columns == 0 || rows == 0 {
            return Err("WorldStochastic: rows and columns must be positive".into());
        }
        if columns % 2 != 0 {
            return Err("WorldStochastic: columns must be even so torus parity closes".into());
        }
        let num_cells = usize::try_from(u64::from(columns) * u64::from(rows))
            .map_err(|_| "WorldStochastic: grid is too large for this target")?;
        let columns_i32 = i32::try_from(columns)
            .map_err(|_| "WorldStochastic: columns exceed the supported range")?;
        let rows_i32 =
            i32::try_from(rows).map_err(|_| "WorldStochastic: rows exceed the supported range")?;

        let grid_cols = columns as usize;
        let neighborhood = backend == BACKEND_NEIGHBORHOOD;
        let gas = backend == BACKEND_LATTICE_GAS;
        // Only the neighborhood backend tracks activity; Â§6 ships the gas dense, with no unproven
        // skipping scheme, so its chunk vectors stay empty rather than merely unused.
        let (chunk_cols, chunk_rows) = if neighborhood {
            (grid_cols.div_ceil(CHUNK_SIZE), (rows as usize).div_ceil(CHUNK_SIZE))
        } else {
            (0, 0)
        };
        let num_chunks = chunk_cols * chunk_rows;
        let epochs = if neighborhood { num_cells } else { 0 };

        Ok(WorldStochastic {
            rows,
            columns,
            grid_cols,
            num_cells,
            seed,
            generation: 0,
            states: 0,
            rng_tag: RNG_PHILOX_V1,
            backend,
            visible_state: vec![0; num_cells],
            next_visible_state: vec![0; num_cells],
            entered_generation: vec![0; epochs],
            next_entered_generation: vec![0; epochs],
            initial_state: vec![0; if neighborhood { num_cells } else { 0 }],
            initial_entered_generation: vec![0; epochs],
            elapsed_age_scratch: vec![0; num_cells],
            neighbor_indices: compute_neighbor_indices(columns_i32, rows_i32, num_cells),
            rule_bytes: Vec::new(),
            transitions: Vec::new(),
            row_offsets: [0; MAX_STATES + 1],
            age_tracked: [false; MAX_STATES],
            census: [0; MAX_STATES],
            transition_counts: [0; MAX_TRANSITIONS],
            last_changed_count: 0,
            initial_generation: 0,
            chunk_cols,
            chunk_rows,
            // Zero quiet ticks and a live hazard everywhere â‡’ the first tick recomputes the whole
            // grid, which is what makes the induction in `refresh_chunk_activity` start from a
            // computed generation.
            chunk_quiet: vec![0; num_chunks],
            chunk_changed: vec![0; num_chunks],
            chunk_active: vec![1; num_chunks],
            chunk_hazard: vec![1; num_chunks],
            chunk_deadline: vec![0; num_chunks],
            skipping_enabled: neighborhood,
            channels: vec![0; if gas { num_cells } else { 0 }],
            next_channels: vec![0; if gas { num_cells } else { 0 }],
            walls: vec![0; if gas { num_cells } else { 0 }],
            initial_channels: vec![0; if gas { num_cells } else { 0 }],
            initial_walls: vec![0; if gas { num_cells } else { 0 }],
            gas_outcomes: Vec::new(),
            gas_thresholds: Vec::new(),
            gas_profile: if gas {
                (0..GAS_CONFIGURATIONS)
                    .map(|config| gas_profile_of(config as u16))
                    .collect()
            } else {
                Vec::new()
            },
            gas_scatter: 0,
            species_counts: [0; 3],
            collision_count: 0,
        })
    }

    pub fn backend(&self) -> u8 {
        self.backend
    }

    pub fn rows(&self) -> u32 {
        self.rows
    }

    pub fn columns(&self) -> u32 {
        self.columns
    }

    pub fn num_cells(&self) -> usize {
        self.num_cells
    }

    pub fn states(&self) -> u8 {
        self.states
    }

    pub fn seed(&self) -> u64 {
        self.seed
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn state_ptr(&self) -> *const u8 {
        self.visible_state.as_ptr()
    }

    pub fn next_state_ptr(&self) -> *const u8 {
        self.next_visible_state.as_ptr()
    }

    pub fn elapsed_ages_ptr(&self) -> *const u16 {
        self.elapsed_age_scratch.as_ptr()
    }

    pub fn census_ptr(&self) -> *const u32 {
        self.census.as_ptr()
    }

    pub fn transition_counts_ptr(&self) -> *const u32 {
        self.transition_counts.as_ptr()
    }

    pub fn transition_count_len(&self) -> usize {
        self.transitions.len()
    }

    pub fn rule_ptr(&self) -> *const u8 {
        self.rule_bytes.as_ptr()
    }

    pub fn rule_len(&self) -> usize {
        self.rule_bytes.len()
    }

    pub fn last_changed_count(&self) -> u32 {
        self.last_changed_count
    }

    pub fn rng_sample(&self, cell_index: u32, stream_id: u32) -> Result<u32, String> {
        if usize::try_from(cell_index).map_or(true, |index| index >= self.num_cells) {
            return Err(format!(
                "WorldStochastic: cell index {cell_index} is outside 0..{}",
                self.num_cells
            ));
        }
        Ok(random_u32(
            self.seed,
            self.generation,
            cell_index,
            stream_id,
        ))
    }

    /// Install canonical `HSN1` bytes. Allocation is allowed here; `run_tick` never allocates.
    pub fn set_neighborhood_rule(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.require_backend(BACKEND_NEIGHBORHOOD)?;
        let (states, rng_tag, transitions, row_offsets, age_tracked) = parse_rule(bytes)?;
        if self.visible_state.iter().any(|&state| state >= states) {
            return Err(
                "WorldStochastic: current cells contain a state outside the new rule".into(),
            );
        }

        self.states = states;
        self.rng_tag = rng_tag;
        self.rule_bytes = bytes.to_vec();
        self.transitions = transitions;
        self.row_offsets = row_offsets;
        self.age_tracked = age_tracked;
        self.transition_counts.fill(0);
        self.normalize_untracked_epochs();
        self.recompute_census();
        self.mark_all_active();
        Ok(())
    }

    /// Replace the reset snapshot and reset the world to generation zero.
    pub fn set_initial_state(&mut self, cells: &[u8], elapsed_ages: &[u16]) -> Result<(), String> {
        self.validate_cells_and_ages(cells, elapsed_ages)?;
        self.generation = 0;
        self.initial_generation = 0;
        self.visible_state.copy_from_slice(cells);
        self.next_visible_state.copy_from_slice(cells);
        for index in 0..self.num_cells {
            let age = if self.age_tracked[cells[index] as usize] {
                elapsed_ages[index]
            } else {
                0
            };
            let entered = 0u32.wrapping_sub(u32::from(age));
            self.entered_generation[index] = entered;
            self.next_entered_generation[index] = entered;
        }
        self.initial_state.copy_from_slice(&self.visible_state);
        self.initial_entered_generation
            .copy_from_slice(&self.entered_generation);
        self.transition_counts.fill(0);
        self.last_changed_count = 0;
        self.recompute_census();
        self.mark_all_active();
        Ok(())
    }

    /// Intervention-only bulk replacement at the current generation.
    pub fn set_cells(&mut self, cells: &[u8], elapsed_ages: &[u16]) -> Result<(), String> {
        self.validate_cells_and_ages(cells, elapsed_ages)?;
        let generation = self.generation as u32;
        self.visible_state.copy_from_slice(cells);
        for index in 0..self.num_cells {
            let age = if self.age_tracked[cells[index] as usize] {
                elapsed_ages[index]
            } else {
                0
            };
            self.entered_generation[index] = generation.wrapping_sub(u32::from(age));
        }
        self.recompute_census();
        self.mark_all_active();
        Ok(())
    }

    pub fn set_cell(&mut self, index: usize, value: u8) -> Result<(), String> {
        self.require_backend(BACKEND_NEIGHBORHOOD)?;
        self.ensure_rule()?;
        if index >= self.num_cells {
            return Err(format!(
                "WorldStochastic: cell index {index} is out of range"
            ));
        }
        if value >= self.states {
            return Err(format!(
                "WorldStochastic: state {value} is outside 0..{}",
                self.states
            ));
        }
        let previous = self.visible_state[index];
        if previous != value {
            self.census[previous as usize] -= 1;
            self.census[value as usize] += 1;
            self.visible_state[index] = value;
        }
        self.entered_generation[index] = self.generation as u32;
        // Only this chunk's own hazard/deadline metadata is invalidated; `refresh_chunk_activity`
        // already dilates a zero quiet counter over the halo, so its readers wake too.
        let chunk = self.chunk_of(index);
        self.chunk_quiet[chunk] = 0;
        self.chunk_hazard[chunk] = 1;
        self.chunk_deadline[chunk] = 0;
        Ok(())
    }

    // ---- Lattice-gas backend ---------------------------------------------------------------

    /// Install a canonical `HSG1` collision table. Allocation is allowed here; `run_tick` never
    /// allocates. The table is rejected unless every reachable entry conserves both species.
    pub fn set_gas_rule(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.require_backend(BACKEND_LATTICE_GAS)?;
        let (rng_tag, scatter, outcomes, thresholds) = parse_gas_rule(bytes)?;
        self.rng_tag = rng_tag;
        self.gas_scatter = scatter;
        self.gas_outcomes = outcomes;
        self.gas_thresholds = thresholds;
        self.rule_bytes = bytes.to_vec();
        self.states = GAS_VISIBLE_STATES;
        self.collision_count = 0;
        self.project_gas_state();
        Ok(())
    }

    /// Replace the reset snapshot: six species channels per cell, plus the wall bitmap.
    ///
    /// Walls hold no particles, so any channel written on a wall site is dropped rather than
    /// silently leaking mass on the first tick.
    pub fn set_gas_initial_state(&mut self, channels: &[u8], walls: &[u8]) -> Result<(), String> {
        self.require_backend(BACKEND_LATTICE_GAS)?;
        self.write_gas_cells(channels, walls)?;
        self.generation = 0;
        self.initial_generation = 0;
        self.initial_channels.copy_from_slice(&self.channels);
        self.initial_walls.copy_from_slice(&self.walls);
        self.last_changed_count = 0;
        self.collision_count = 0;
        Ok(())
    }

    /// Intervention-only bulk replacement at the current generation.
    pub fn set_gas_cells(&mut self, channels: &[u8], walls: &[u8]) -> Result<(), String> {
        self.require_backend(BACKEND_LATTICE_GAS)?;
        self.write_gas_cells(channels, walls)
    }

    /// Open or close one lattice site's barrier. This is the whole membrane API: opening a gate
    /// edits the native wall buffer only and never replaces the grid.
    pub fn set_wall(&mut self, index: usize, is_wall: bool) -> Result<(), String> {
        self.require_backend(BACKEND_LATTICE_GAS)?;
        if index >= self.num_cells {
            return Err(format!(
                "WorldStochastic: cell index {index} is out of range"
            ));
        }
        self.walls[index] = u8::from(is_wall);
        if is_wall {
            // Sealing a site discards whatever was on it. Conservation is a property of the tick,
            // not of an intervention that deletes lattice sites.
            self.channels[index] = GAS_WALL_BIT;
        } else {
            self.channels[index] &= GAS_CONFIG_MASK;
        }
        self.project_gas_state();
        Ok(())
    }

    pub fn channels_ptr(&self) -> *const u16 {
        self.channels.as_ptr()
    }

    pub fn walls_ptr(&self) -> *const u8 {
        self.walls.as_ptr()
    }

    /// Exact particle count for one species: 1 = amber, 2 = cyan. Conserved by every legal table.
    pub fn species_count(&self, species: u8) -> u32 {
        self.species_counts
            .get(species as usize)
            .copied()
            .unwrap_or(0)
    }

    /// Sites whose incoming configuration was rewritten by the collision table on the last tick.
    pub fn collision_count(&self) -> u32 {
        self.collision_count
    }

    pub fn reset(&mut self) -> Result<(), String> {
        if self.backend == BACKEND_LATTICE_GAS {
            self.ensure_gas_rule()?;
            self.generation = self.initial_generation;
            self.channels.copy_from_slice(&self.initial_channels);
            self.walls.copy_from_slice(&self.initial_walls);
            self.last_changed_count = 0;
            self.collision_count = 0;
            self.project_gas_state();
            return Ok(());
        }
        self.ensure_rule()?;
        self.generation = self.initial_generation;
        self.visible_state.copy_from_slice(&self.initial_state);
        self.next_visible_state.copy_from_slice(&self.initial_state);
        self.entered_generation
            .copy_from_slice(&self.initial_entered_generation);
        self.next_entered_generation
            .copy_from_slice(&self.initial_entered_generation);
        self.transition_counts.fill(0);
        self.last_changed_count = 0;
        self.recompute_census();
        self.mark_all_active();
        Ok(())
    }

    /// Turn exact activity skipping off (or back on). Off forces the dense reference path for every
    /// tick; re-enabling wakes the whole grid so the metadata is rebuilt from a computed generation.
    pub fn set_skipping_enabled(&mut self, enabled: bool) {
        // Â§6 ships the lattice gas dense; no unproven gas skipping scheme enters v1.
        if self.backend != BACKEND_NEIGHBORHOOD {
            return;
        }
        self.skipping_enabled = enabled;
        self.mark_all_active();
    }

    pub fn skipping_enabled(&self) -> bool {
        self.skipping_enabled
    }

    /// Chunks recomputed during the last tick, out of [`WorldStochastic::chunk_count`].
    pub fn active_chunk_count(&self) -> u32 {
        self.chunk_active.iter().map(|&active| u32::from(active)).sum()
    }

    pub fn chunk_count(&self) -> usize {
        self.chunk_active.len()
    }

    /// Advance one generation.
    ///
    /// The backend is dispatched exactly once, here â€” never inside a per-cell loop. For the
    /// neighborhood backend `run_tick_dense` is the reference and the skipping path must agree with
    /// it on state, ages, census, transition counts, and both checksums after every tick.
    pub fn run_tick(&mut self) -> Result<u32, String> {
        if self.backend == BACKEND_LATTICE_GAS {
            self.ensure_gas_rule()?;
            return Ok(match self.rng_tag {
                RNG_LEGACY_DEMO => self.run_tick_gas::<LegacyDemo>(),
                _ => self.run_tick_gas::<PhiloxV1>(),
            });
        }
        self.ensure_rule()?;
        self.maybe_rebase_epochs();
        let changed = match (self.skipping_enabled, self.rng_tag) {
            (false, RNG_LEGACY_DEMO) => self.run_tick_dense::<LegacyDemo>(),
            (false, RNG_PHILOX_V1) => self.run_tick_dense::<PhiloxV1>(),
            (true, RNG_LEGACY_DEMO) => self.run_tick_skipping::<LegacyDemo>(),
            (true, RNG_PHILOX_V1) => self.run_tick_skipping::<PhiloxV1>(),
            _ => unreachable!("parse_rule rejects unknown RNG tags"),
        };
        Ok(changed)
    }

    /// Clamp every stored epoch to at most `u16::MAX` ticks back so the `u32` distance can never
    /// approach the half-range. Exact, because [`saturating_age`] already saturates there.
    /// Resume the current world at `generation`, preserving every elapsed age exactly.
    ///
    /// Epochs are absolute generations, so moving the clock means moving them by the same delta â€”
    /// otherwise a decoded code would restore the right cells with the wrong ages. The current
    /// world also becomes the reset target, which is the `HXS1` capture policy: a code is the exact
    /// world it was taken from, and resetting returns to that world rather than to generation zero.
    pub fn resume_at_generation(&mut self, generation: u64) {
        let delta = (generation as u32).wrapping_sub(self.generation as u32);
        self.generation = generation;
        self.initial_generation = generation;
        if self.backend != BACKEND_NEIGHBORHOOD {
            self.initial_channels.copy_from_slice(&self.channels);
            self.initial_walls.copy_from_slice(&self.walls);
            return;
        }
        for index in 0..self.num_cells {
            self.entered_generation[index] = self.entered_generation[index].wrapping_add(delta);
            self.next_entered_generation[index] =
                self.next_entered_generation[index].wrapping_add(delta);
        }
        self.initial_state.copy_from_slice(&self.visible_state);
        self.initial_entered_generation
            .copy_from_slice(&self.entered_generation);
        self.mark_all_active();
    }

    pub fn rebase_epochs(&mut self) {
        if self.backend != BACKEND_NEIGHBORHOOD {
            return;
        }
        let generation = self.generation as u32;
        let horizon = u32::from(u16::MAX);
        for index in 0..self.num_cells {
            for buffer in [&mut self.entered_generation, &mut self.next_entered_generation] {
                let delta = generation.wrapping_sub(buffer[index]);
                if delta > horizon {
                    buffer[index] = generation.wrapping_sub(horizon);
                }
            }
        }
    }

    pub fn compute_elapsed_ages(&mut self) {
        if self.backend != BACKEND_NEIGHBORHOOD {
            self.elapsed_age_scratch.fill(0);
            return;
        }
        let generation = self.generation as u32;
        for index in 0..self.num_cells {
            let state = self.visible_state[index] as usize;
            self.elapsed_age_scratch[index] = if self.age_tracked[state] {
                saturating_age(generation, self.entered_generation[index])
            } else {
                0
            };
        }
    }

    pub fn checksum_state(&self) -> u32 {
        fnv1a(self.visible_state.iter().copied())
    }

    /// Hash of everything a code must restore beyond the visible state: epochs for the neighborhood
    /// backend, velocity channels and walls for the gas.
    pub fn checksum_auxiliary(&self) -> u32 {
        if self.backend == BACKEND_LATTICE_GAS {
            let mut hash = 0x811C_9DC5u32;
            for index in 0..self.num_cells {
                for byte in self.channels[index].to_le_bytes() {
                    hash ^= u32::from(byte);
                    hash = hash.wrapping_mul(0x0100_0193);
                }
                hash ^= u32::from(self.walls[index]);
                hash = hash.wrapping_mul(0x0100_0193);
            }
            return hash;
        }
        let generation = self.generation as u32;
        let mut hash = 0x811C_9DC5u32;
        for index in 0..self.num_cells {
            let state = self.visible_state[index] as usize;
            let age = if self.age_tracked[state] {
                saturating_age(generation, self.entered_generation[index])
            } else {
                0
            };
            for byte in age.to_le_bytes() {
                hash ^= u32::from(byte);
                hash = hash.wrapping_mul(0x0100_0193);
            }
        }
        hash
    }
}

impl WorldStochastic {
    fn require_backend(&self, backend: u8) -> Result<(), String> {
        if self.backend == backend {
            Ok(())
        } else if backend == BACKEND_LATTICE_GAS {
            Err("WorldStochastic: this world uses the neighborhood backend".into())
        } else {
            Err("WorldStochastic: this world uses the lattice-gas backend".into())
        }
    }

    fn ensure_gas_rule(&self) -> Result<(), String> {
        if self.gas_outcomes.is_empty() {
            Err("WorldStochastic: install a lattice-gas rule first".into())
        } else {
            Ok(())
        }
    }

    /// Validate and install channels + walls at the current generation.
    fn write_gas_cells(&mut self, channels: &[u8], walls: &[u8]) -> Result<(), String> {
        self.ensure_gas_rule()?;
        if channels.len() != self.num_cells * 6 || walls.len() != self.num_cells {
            return Err(format!(
                "WorldStochastic: expected {} channels and {} walls, received {} and {}",
                self.num_cells * 6,
                self.num_cells,
                channels.len(),
                walls.len()
            ));
        }
        if let Some(species) = channels.iter().copied().find(|&species| species > 2) {
            return Err(format!(
                "WorldStochastic: channel species {species} is outside 0..=2"
            ));
        }
        for index in 0..self.num_cells {
            let wall = walls[index] != 0;
            self.walls[index] = u8::from(wall);
            let mut config = 0u16;
            if wall {
                config = GAS_WALL_BIT;
            } else {
                for direction in 0..6 {
                    config |= u16::from(channels[index * 6 + direction]) << (2 * direction);
                }
            }
            self.channels[index] = config;
        }
        self.project_gas_state();
        Ok(())
    }

    /// Rebuild the visible-state buffer, census, exact species totals, and the export wall bitmap.
    fn project_gas_state(&mut self) {
        self.census.fill(0);
        self.species_counts = [0; 3];
        for index in 0..self.num_cells {
            let config = self.channels[index];
            let wall = config & GAS_WALL_BIT != 0;
            self.walls[index] = u8::from(wall);
            let visible = if wall {
                GAS_WALL
            } else {
                let profile = self.gas_profile[config as usize];
                self.species_counts[1] += profile & 0xFF;
                self.species_counts[2] += (profile >> 8) & 0xFF;
                (profile >> 16) as u8
            };
            self.visible_state[index] = visible;
            self.next_visible_state[index] = visible;
            self.census[visible as usize] += 1;
        }
    }

    /// One conserved lattice-gas generation: stream, reflect, collide, and project in a single pass.
    ///
    /// Streaming is written as a **gather** rather than a scatter. Site `c`'s channel `e` has
    /// exactly one possible source: the particle arriving from `m = neighbor(c, e+3)` travelling
    /// along `e` â€” or, when `m` is a wall, `c`'s own channel `e+3` bouncing back, since a wall holds
    /// no particles and the two cases are mutually exclusive. That inverse relation is exact for the
    /// canonical table (`opposite_direction_is_the_exact_inverse` pins it), so the gather needs no
    /// clearing pass, no read-modify-write, and no second traversal: the collision table and the
    /// visible projection both apply to the configuration while it is still in a register.
    fn run_tick_gas<R: CounterRng>(&mut self) -> u32 {
        const OPPOSITE: [usize; 6] = [3, 4, 5, 0, 1, 2];
        let generation = self.generation;
        let seed = self.seed;
        let scatter = self.gas_scatter;
        let num_cells = self.num_cells;
        let mut changed = 0u32;
        let mut collisions = 0u32;
        let mut census = [0u32; MAX_STATES];
        let mut amber = 0u32;
        let mut cyan = 0u32;
        // One scatter block covers four consecutive sites; the walk is sequential, so it is redrawn
        // once every four cells rather than once per cell.
        let mut scatter_block = [0u32; 4];
        let mut scatter_block_index = u32::MAX;

        // Disjoint field borrows, so each buffer is bounds-checked against a hoisted slice instead
        // of through `self` on every one of the six gathers.
        let channels = &self.channels;
        let neighbor_indices = &self.neighbor_indices;
        let outcomes = &self.gas_outcomes;
        let thresholds = &self.gas_thresholds;
        let profiles = &self.gas_profile;
        let next_channels = &mut self.next_channels;
        let visible_state = &mut self.visible_state;

        for index in 0..num_cells {
            let own = channels[index];
            if own & GAS_WALL_BIT != 0 {
                next_channels[index] = GAS_WALL_BIT;
                census[GAS_WALL as usize] += 1;
                continue;
            }
            let neighbors = &neighbor_indices[index * 6..index * 6 + 6];
            let mut incoming = 0u16;
            for channel in 0..6 {
                let opposite = OPPOSITE[channel];
                let source_config = channels[neighbors[opposite] as usize];
                // Branchless: a wall source contributes this cell's own bounce-back instead.
                let wall_mask = 0u16.wrapping_sub(source_config >> 15);
                let arriving = (source_config >> (2 * channel)) & 3;
                let reflected = (own >> (2 * opposite)) & 3;
                incoming |= ((reflected & wall_mask) | (arriving & !wall_mask)) << (2 * channel);
            }
            let packed = outcomes[incoming as usize];
            let primary = packed as u16;
            let alternate = (packed >> 16) as u16;
            let mut config = primary;
            if primary != alternate {
                let threshold = thresholds[incoming as usize];
                let take_alternate = threshold == u32::MAX
                    || (threshold != 0
                        && R::sample(seed, generation, index as u32, STREAM_GAS_COLLISION)
                            < threshold);
                if take_alternate {
                    config = alternate;
                }
            }
            collisions += u32::from(config != incoming);
            // Vacuum sites skip only the random draw, not the table lookup: the empty entry is the
            // identity and rotating nothing is still nothing, so this is exact, and the counter RNG
            // is tuple-addressed, so a sample not drawn here shifts no other cell's stream.
            if scatter != 0 && config != 0 {
                let block_index = (index >> 2) as u32;
                if block_index != scatter_block_index {
                    scatter_block =
                        R::sample_block(seed, generation, block_index, STREAM_GAS_SCATTER);
                    scatter_block_index = block_index;
                }
                let sample = scatter_block[index & 3];
                if sample < scatter {
                    // Â±60Â° with equal probability. The compiler forces `scatter` even, so given
                    // `sample < scatter` the low bit is an exactly fair coin â€” species-exact, and
                    // chirality-free over a run without spending a second Philox block.
                    config = rotate_channels(config, if sample & 1 == 0 { 1 } else { 5 });
                }
            }

            next_channels[index] = config;
            let profile = profiles[config as usize];
            amber += profile & 0xFF;
            cyan += (profile >> 8) & 0xFF;
            let visible = (profile >> 16) as u8;
            census[visible as usize] += 1;
            changed += u32::from(visible != visible_state[index]);
            visible_state[index] = visible;
        }

        self.census = census;
        self.species_counts = [0, amber, cyan];
        std::mem::swap(&mut self.channels, &mut self.next_channels);
        self.generation = self.generation.wrapping_add(1);
        self.last_changed_count = changed;
        self.collision_count = collisions;
        changed
    }

    fn ensure_rule(&self) -> Result<(), String> {
        if self.states == 0 {
            Err("WorldStochastic: install a neighborhood rule first".into())
        } else {
            Ok(())
        }
    }

    fn validate_cells_and_ages(&self, cells: &[u8], ages: &[u16]) -> Result<(), String> {
        self.require_backend(BACKEND_NEIGHBORHOOD)?;
        self.ensure_rule()?;
        if cells.len() != self.num_cells || ages.len() != self.num_cells {
            return Err(format!(
                "WorldStochastic: expected {} cells and ages, received {} and {}",
                self.num_cells,
                cells.len(),
                ages.len()
            ));
        }
        if let Some((index, state)) = cells
            .iter()
            .copied()
            .enumerate()
            .find(|(_, state)| *state >= self.states)
        {
            return Err(format!(
                "WorldStochastic: cell {index} has state {state}, outside 0..{}",
                self.states
            ));
        }
        Ok(())
    }

    fn recompute_census(&mut self) {
        self.census.fill(0);
        for &state in &self.visible_state {
            if usize::from(state) < MAX_STATES {
                self.census[state as usize] += 1;
            }
        }
    }

    /// Wake every chunk and discard its hazard/deadline metadata.
    fn mark_all_active(&mut self) {
        self.chunk_quiet.fill(0);
        self.chunk_active.fill(1);
        self.chunk_hazard.fill(1);
        self.chunk_deadline.fill(0);
    }

    /// Stamp the epoch of every cell whose state has no age-bounded row.
    ///
    /// Such epochs are unobservable â€” [`WorldStochastic::compute_elapsed_ages`] and
    /// [`WorldStochastic::checksum_auxiliary`] both report zero for them, and any transition *into*
    /// an age-tracked state writes a fresh epoch. That is exactly why a skipped chunk may leave them
    /// stale. Normalizing here means installing a rule that newly tracks a state cannot inherit one.
    fn normalize_untracked_epochs(&mut self) {
        let generation = self.generation as u32;
        for index in 0..self.num_cells {
            if !self.age_tracked[self.visible_state[index] as usize] {
                self.entered_generation[index] = generation;
                self.next_entered_generation[index] = generation;
            }
        }
    }

    fn maybe_rebase_epochs(&mut self) {
        if (self.generation as u32) % EPOCH_REBASE_INTERVAL == 0 {
            self.rebase_epochs();
        }
    }

    #[inline]
    fn chunk_of(&self, cell: usize) -> usize {
        let col = cell % self.grid_cols;
        let row = cell / self.grid_cols;
        (row >> CHUNK_SHIFT) * self.chunk_cols + (col >> CHUNK_SHIFT)
    }

    /// Every chunk offset a chunk's cells can reach, as `(delta_chunk_col, delta_chunk_row)`.
    ///
    /// Seven rather than a 3Ã—3 Moore square: a hex cell has six neighbors and in offset coordinates
    /// those are a parity-dependent subset of the eight. `CHUNK_SIZE` is even, so a chunk always
    /// starts on an even column; the right-hand reach follows the parity of its last column.
    /// Adjacency is mutual, so this doubles as "which chunks read from me".
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

    /// Decide which chunks must be recomputed this tick.
    ///
    /// **Why deterministic change propagation alone is unsound here.** In `WorldK` a cell's next
    /// state is a pure function of its own value and its neighbors', so identical inputs guarantee
    /// an identical output. A stochastic cell's next state also depends on the generation, which
    /// advances whether or not anything changed. A chunk may therefore sleep only when all three
    /// reasons a tick could ever alter it are absent:
    ///
    /// 1. **Causal wake** â€” this chunk or a chunk it reads from changed on the previous tick, so its
    ///    inputs are not the ones the last evaluation saw.
    /// 2. **Hazard wake** â€” some cell holds a row that is age-applicable next tick with a non-zero
    ///    probability for its current mask. Sampling must happen again even though nothing moved.
    /// 3. **Temporal wake** â€” some cell reaches an age at which such a row *becomes* applicable.
    ///    Stored as ticks-from-now, decremented for sleeping chunks in `commit_chunk_activity`.
    ///
    /// Reasons 2 and 3 are recorded during the evaluation that last touched the chunk, using the
    /// mask it saw. That mask is only stale if a halo cell changed, which is reason 1.
    ///
    /// When all three are absent the chunk's cells provably keep their state, so â€” exactly as in
    /// `WorldK` â€” the write buffer already holds the right bytes and a skipped chunk costs nothing
    /// at all, not even a copy.
    fn refresh_chunk_activity(&mut self) {
        self.chunk_changed.fill(0);
        if !self.skipping_enabled {
            self.chunk_active.fill(1);
            return;
        }
        let chunk_cols = self.chunk_cols as isize;
        let chunk_rows = self.chunk_rows as isize;
        for chunk_row in 0..self.chunk_rows {
            for chunk_col in 0..self.chunk_cols {
                let chunk = chunk_row * self.chunk_cols + chunk_col;
                let mut active =
                    u8::from(self.chunk_hazard[chunk] != 0 || self.chunk_deadline[chunk] == 0);
                if active == 0 {
                    for (delta_col, delta_row) in self.chunk_halo_offsets(chunk_col) {
                        // `rem_euclid` rather than a range check so this stays correct on grids only
                        // one or two chunks wide, where a chunk's left and right neighbors are the
                        // same chunk, possibly itself.
                        let neighbor_col =
                            (chunk_col as isize + delta_col).rem_euclid(chunk_cols) as usize;
                        let neighbor_row =
                            (chunk_row as isize + delta_row).rem_euclid(chunk_rows) as usize;
                        if self.chunk_quiet[neighbor_row * self.chunk_cols + neighbor_col]
                            < QUIET_TICKS
                        {
                            active = 1;
                            break;
                        }
                    }
                }
                self.chunk_active[chunk] = active;
                if active != 0 {
                    // The pass below rebuilds both from the cells it is about to evaluate.
                    self.chunk_hazard[chunk] = 0;
                    self.chunk_deadline[chunk] = NO_DEADLINE;
                }
            }
        }
    }

    /// Fold this tick's changes into the quiet counters and advance sleeping chunks' deadlines.
    fn commit_chunk_activity(&mut self) {
        for chunk in 0..self.chunk_active.len() {
            self.chunk_quiet[chunk] = if self.chunk_changed[chunk] != 0 {
                0
            } else {
                self.chunk_quiet[chunk].saturating_add(1)
            };
            if self.chunk_active[chunk] == 0 && self.chunk_deadline[chunk] != NO_DEADLINE {
                self.chunk_deadline[chunk] -= 1;
            }
        }
    }

    /// One cell's transition. `TRACK` compiles the activity bookkeeping in or out entirely, so the
    /// dense reference path pays nothing for a wake analysis it never reads.
    #[inline]
    fn step_cell<R: CounterRng, const TRACK: bool>(
        &mut self,
        index: usize,
        generation_u32: u32,
        next_generation: u32,
    ) -> CellOutcome {
        let state = self.visible_state[index];
        let state_index = state as usize;
        let tracked = self.age_tracked[state_index];
        let entered = self.entered_generation[index];
        let age_after_tick = if tracked {
            saturating_age_after(generation_u32, entered)
        } else {
            0
        };
        // The age this cell would carry into the next tick if nothing about it changed. Saturating,
        // so an expired row stays expired instead of coming back 65,536 ticks later.
        let age_next = if tracked {
            age_after_tick.saturating_add(1)
        } else {
            0
        };
        let mut next_state = state;
        let mut next_entered = if tracked { entered } else { next_generation };
        let mut hazard = false;
        let mut deadline = NO_DEADLINE;
        let start = self.row_offsets[state_index] as usize;
        let end = self.row_offsets[state_index + 1] as usize;
        let mut cached_neighbor_state = NO_NEIGHBOR_STATE;
        let mut cached_mask = 0usize;

        for row_index in start..end {
            let row = &self.transitions[row_index];
            let (min_age, max_age, neighbor_state) = (row.min_age, row.max_age, row.neighbor_state);
            let applicable = age_after_tick >= min_age && age_after_tick <= max_age;
            // Age applicability is two comparisons; the mask is six indirect loads. Without activity
            // tracking an inapplicable row is dropped before paying for it.
            if !TRACK && !applicable {
                continue;
            }
            let mask = if neighbor_state == NO_NEIGHBOR_STATE {
                0
            } else if neighbor_state == cached_neighbor_state {
                cached_mask
            } else {
                let mut mask = 0usize;
                let base = index * 6;
                for direction in 0..6 {
                    let neighbor = self.neighbor_indices[base + direction] as usize;
                    if self.visible_state[neighbor] == neighbor_state {
                        mask |= 1 << direction;
                    }
                }
                cached_neighbor_state = neighbor_state;
                cached_mask = mask;
                mask
            };
            let threshold = row.thresholds[mask];

            if TRACK && threshold != 0 {
                // The earliest age at which this row could fire, given the mask it sees now.
                let target = min_age.max(age_next);
                if target <= max_age {
                    let wait = u32::from(target - age_next);
                    if wait == 0 {
                        hazard = true;
                    } else if wait < deadline {
                        deadline = wait;
                    }
                }
            }

            if !applicable || threshold == 0 {
                continue;
            }
            let (to, reset_epoch, stream_id) = (row.to, row.reset_epoch, row.stream_id);
            let passes = threshold == u32::MAX
                || R::sample(self.seed, self.generation, index as u32, stream_id) < threshold;
            if !passes {
                continue;
            }

            next_state = to;
            if reset_epoch || to != state {
                next_entered = next_generation;
            }
            self.transition_counts[row_index] = self.transition_counts[row_index].wrapping_add(1);
            // A row that fires is by definition not dormant, even when `to == from` leaves the
            // visible state alone and only the epoch and the counter move.
            hazard = true;
            break;
        }

        if !self.age_tracked[next_state as usize] {
            next_entered = next_generation;
        }
        self.next_visible_state[index] = next_state;
        self.next_entered_generation[index] = next_entered;

        CellOutcome {
            previous_state: state,
            next_state,
            hazard,
            deadline,
        }
    }

    /// Dense reference tick: every cell, every generation, no activity metadata at all.
    fn run_tick_dense<R: CounterRng>(&mut self) -> u32 {
        self.census.fill(0);
        let generation_u32 = self.generation as u32;
        let next_generation = generation_u32.wrapping_add(1);
        let mut changed = 0u32;

        for index in 0..self.num_cells {
            let outcome = self.step_cell::<R, false>(index, generation_u32, next_generation);
            self.census[outcome.next_state as usize] += 1;
            changed += u32::from(outcome.next_state != outcome.previous_state);
        }

        self.finish_tick(changed)
    }

    /// Activity-skipping tick. Walks row-major and splits each row at chunk boundaries so the
    /// `neighbor_indices` access the prefetcher wants stays sequential while a change can still be
    /// attributed to the exact chunk that owns it.
    fn run_tick_skipping<R: CounterRng>(&mut self) -> u32 {
        self.refresh_chunk_activity();
        let generation_u32 = self.generation as u32;
        let next_generation = generation_u32.wrapping_add(1);
        let cols = self.grid_cols;
        let chunk_cols = self.chunk_cols;
        let mut changed = 0u32;

        for row in 0..self.rows as usize {
            let row_base = row * cols;
            let chunk_row_base = (row >> CHUNK_SHIFT) * chunk_cols;
            for chunk_col in 0..chunk_cols {
                let chunk = chunk_row_base + chunk_col;
                if self.chunk_active[chunk] == 0 {
                    continue;
                }
                let start = row_base + chunk_col * CHUNK_SIZE;
                let end = row_base + ((chunk_col + 1) * CHUNK_SIZE).min(cols);

                let mut segment_changed = 0u32;
                let mut index = start;
                // Once one cell proves the chunk hazardous, the chunk is already committed to
                // running next tick and no further wake analysis in it can change that â€” so the
                // rest of the chunk runs the same body the dense reference path does. In a fully
                // hazardous world that reduces the tracking overhead to the first cell of a chunk.
                if self.chunk_hazard[chunk] == 0 {
                    let mut segment_deadline = NO_DEADLINE;
                    while index < end {
                        let outcome =
                            self.step_cell::<R, true>(index, generation_u32, next_generation);
                        if outcome.next_state != outcome.previous_state {
                            segment_changed += 1;
                            // Incremental rather than a refill: a skipped chunk contributes the same
                            // counts it did last tick, so there is nothing to recount.
                            self.census[outcome.previous_state as usize] -= 1;
                            self.census[outcome.next_state as usize] += 1;
                        }
                        index += 1;
                        if outcome.hazard {
                            self.chunk_hazard[chunk] = 1;
                            break;
                        }
                        if outcome.deadline < segment_deadline {
                            segment_deadline = outcome.deadline;
                        }
                    }
                    if segment_deadline < self.chunk_deadline[chunk] {
                        self.chunk_deadline[chunk] = segment_deadline;
                    }
                }
                while index < end {
                    let outcome = self.step_cell::<R, false>(index, generation_u32, next_generation);
                    if outcome.next_state != outcome.previous_state {
                        segment_changed += 1;
                        self.census[outcome.previous_state as usize] -= 1;
                        self.census[outcome.next_state as usize] += 1;
                    }
                    index += 1;
                }

                if segment_changed != 0 {
                    self.chunk_changed[chunk] = 1;
                    changed += segment_changed;
                }
            }
        }

        self.commit_chunk_activity();
        self.finish_tick(changed)
    }

    fn finish_tick(&mut self, changed: u32) -> u32 {
        std::mem::swap(&mut self.visible_state, &mut self.next_visible_state);
        std::mem::swap(
            &mut self.entered_generation,
            &mut self.next_entered_generation,
        );
        self.generation = self.generation.wrapping_add(1);
        self.last_changed_count = changed;
        changed
    }
}

struct CellOutcome {
    previous_state: u8,
    next_state: u8,
    hazard: bool,
    deadline: u32,
}

fn parse_rule(
    bytes: &[u8],
) -> Result<
    (
        u8,
        u8,
        Vec<TransitionRow>,
        [u16; MAX_STATES + 1],
        [bool; MAX_STATES],
    ),
    String,
> {
    if bytes.len() < RULE_HEADER_BYTES || &bytes[..4] != RULE_MAGIC {
        return Err("WorldStochastic: rule must start with canonical HSN1 bytes".into());
    }
    let states = bytes[4];
    if !(2..=MAX_STATES as u8).contains(&states) {
        return Err(format!(
            "WorldStochastic: rule states must be in 2..={MAX_STATES}"
        ));
    }
    let rng_tag = bytes[5];
    if rng_tag != RNG_LEGACY_DEMO && rng_tag != RNG_PHILOX_V1 {
        return Err(format!("WorldStochastic: unsupported RNG tag {rng_tag}"));
    }
    let count = u16::from_le_bytes([bytes[6], bytes[7]]) as usize;
    if count > MAX_TRANSITIONS {
        return Err(format!(
            "WorldStochastic: at most {MAX_TRANSITIONS} transition rows are supported"
        ));
    }
    let expected = RULE_HEADER_BYTES + count * RULE_ROW_BYTES;
    if bytes.len() != expected {
        return Err(format!(
            "WorldStochastic: rule has {} bytes, expected {expected}",
            bytes.len()
        ));
    }

    let mut transitions = Vec::with_capacity(count);
    let mut age_tracked = [false; MAX_STATES];
    let mut previous_key: Option<(u8, u16)> = None;
    for row_index in 0..count {
        let offset = RULE_HEADER_BYTES + row_index * RULE_ROW_BYTES;
        let row = &bytes[offset..offset + RULE_ROW_BYTES];
        let from = row[0];
        let to = row[1];
        let neighbor_state = row[2];
        let flags = row[3];
        let min_age = u16::from_le_bytes([row[4], row[5]]);
        let max_age = u16::from_le_bytes([row[6], row[7]]);
        let priority = u16::from_le_bytes([row[8], row[9]]);
        if row[10] != 0 || row[11] != 0 {
            return Err(format!(
                "WorldStochastic: row {row_index} has non-zero reserved bytes"
            ));
        }
        let stream_id = u32::from_le_bytes([row[12], row[13], row[14], row[15]]);

        if from >= states || to >= states {
            return Err(format!(
                "WorldStochastic: row {row_index} references an invalid state"
            ));
        }
        if neighbor_state != NO_NEIGHBOR_STATE && neighbor_state >= states {
            return Err(format!(
                "WorldStochastic: row {row_index} has an invalid neighbor state"
            ));
        }
        if flags & !FLAG_RESET_EPOCH != 0 {
            return Err(format!(
                "WorldStochastic: row {row_index} has unknown flags"
            ));
        }
        if min_age > max_age {
            return Err(format!(
                "WorldStochastic: row {row_index} has an empty age range"
            ));
        }
        let key = (from, priority);
        if let Some((previous_from, previous_priority)) = previous_key {
            if from < previous_from || (from == previous_from && priority > previous_priority) {
                return Err("WorldStochastic: transition rows are not canonically ordered".into());
            }
            if from == previous_from && priority == previous_priority {
                return Err(format!(
                    "WorldStochastic: rows for state {from} share ambiguous priority {priority}"
                ));
            }
        }
        previous_key = Some(key);

        let mut thresholds = [0u32; THRESHOLD_COUNT];
        for (mask, threshold) in thresholds.iter_mut().enumerate() {
            let start = 16 + mask * 4;
            *threshold =
                u32::from_le_bytes([row[start], row[start + 1], row[start + 2], row[start + 3]]);
        }
        age_tracked[from as usize] |= min_age > 0 || max_age < u16::MAX;
        transitions.push(TransitionRow {
            from,
            to,
            neighbor_state,
            reset_epoch: flags & FLAG_RESET_EPOCH != 0,
            min_age,
            max_age,
            stream_id,
            thresholds,
        });
    }

    let mut row_offsets = [0u16; MAX_STATES + 1];
    let mut cursor = 0usize;
    for state in 0..MAX_STATES {
        row_offsets[state] = cursor as u16;
        while cursor < transitions.len() && transitions[cursor].from as usize == state {
            cursor += 1;
        }
    }
    row_offsets[MAX_STATES] = cursor as u16;

    Ok((states, rng_tag, transitions, row_offsets, age_tracked))
}

/// Parse canonical `HSG1` bytes into the two flat collision tables.
///
/// Species conservation is checked here rather than trusted, for every reachable entry: a table
/// that could create or destroy a particle is refused at load, not discovered as drift later.
#[allow(clippy::type_complexity)]
fn parse_gas_rule(bytes: &[u8]) -> Result<(u8, u32, Vec<u32>, Vec<u32>), String> {
    if bytes.len() != GAS_RULE_BYTES || &bytes[..4] != GAS_MAGIC {
        return Err(format!(
            "WorldStochastic: gas rule must be {GAS_RULE_BYTES} canonical HSG1 bytes"
        ));
    }
    if bytes[4] != 2 {
        return Err("WorldStochastic: gas rules carry exactly two species".into());
    }
    let rng_tag = bytes[5];
    if rng_tag != RNG_LEGACY_DEMO && rng_tag != RNG_PHILOX_V1 {
        return Err(format!("WorldStochastic: unsupported RNG tag {rng_tag}"));
    }
    if bytes[6] != 0 || bytes[7] != 0 {
        return Err("WorldStochastic: gas rule has non-zero reserved flags".into());
    }
    let scatter = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
    if scatter & 1 != 0 {
        // The tick reuses the scatter sample's low bit as the Â±60Â° coin. That is only exactly fair
        // when the threshold is even, so the compiler quantizes to even and the loader insists.
        return Err("WorldStochastic: gas scatter threshold must be even".into());
    }

    let read = |offset: usize| {
        u32::from_le_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ])
    };
    let mut outcomes = Vec::with_capacity(GAS_CONFIGURATIONS);
    let mut thresholds = Vec::with_capacity(GAS_CONFIGURATIONS);
    let threshold_base = GAS_HEADER_BYTES + GAS_CONFIGURATIONS * 4;
    for config in 0..GAS_CONFIGURATIONS {
        let packed = read(GAS_HEADER_BYTES + config * 4);
        let threshold = read(threshold_base + config * 4);
        let source = config as u16;
        let primary = packed as u16;
        let alternate = (packed >> 16) as u16;
        if !gas_config_is_legal(source) {
            // Unreachable by streaming, but pinned to the identity so the bytes stay canonical.
            if primary != source || alternate != source || threshold != 0 {
                return Err(format!(
                    "WorldStochastic: gas rule entry {config} is unreachable and must be the identity"
                ));
            }
            outcomes.push(packed);
            thresholds.push(threshold);
            continue;
        }
        let expected = gas_profile_of(source) & 0xFFFF;
        for outcome in [primary, alternate] {
            if !gas_config_is_legal(outcome) {
                return Err(format!(
                    "WorldStochastic: gas rule entry {config} produces an illegal configuration"
                ));
            }
            if gas_profile_of(outcome) & 0xFFFF != expected {
                return Err(format!(
                    "WorldStochastic: gas rule entry {config} does not conserve both species"
                ));
            }
        }
        outcomes.push(packed);
        thresholds.push(threshold);
    }
    Ok((rng_tag, scatter, outcomes, thresholds))
}

/// Whether `bytes` is a well-formed `HSG1` table that conserves both species everywhere.
#[wasm_bindgen]
pub fn is_conservative_gas_rule(bytes: &[u8]) -> bool {
    parse_gas_rule(bytes).is_ok()
}

fn fnv1a(bytes: impl Iterator<Item = u8>) -> u32 {
    let mut hash = 0x811C_9DC5u32;
    for byte in bytes {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compiled_rule(states: u8, rng: u8, rows: &[(u8, u8, u8, u16, u32, u32)]) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(RULE_HEADER_BYTES + rows.len() * RULE_ROW_BYTES);
        bytes.extend_from_slice(RULE_MAGIC);
        bytes.push(states);
        bytes.push(rng);
        bytes.extend_from_slice(&(rows.len() as u16).to_le_bytes());
        for &(from, to, neighbor, min_age, stream, threshold) in rows {
            bytes.extend_from_slice(&[from, to, neighbor, FLAG_RESET_EPOCH]);
            bytes.extend_from_slice(&min_age.to_le_bytes());
            bytes.extend_from_slice(&u16::MAX.to_le_bytes());
            bytes.extend_from_slice(&0u16.to_le_bytes());
            bytes.extend_from_slice(&0u16.to_le_bytes());
            bytes.extend_from_slice(&stream.to_le_bytes());
            for _ in 0..THRESHOLD_COUNT {
                bytes.extend_from_slice(&threshold.to_le_bytes());
            }
        }
        bytes
    }

    #[test]
    fn philox_rng_golden_vectors_are_stable() {
        let vectors = [
            ((0, 0, 0, 0), 1_713_891_541),
            ((1, 0, 0, 0), 3_823_634_032),
            (
                (0x0123_4567_89AB_CDEF, 0x0FED_CBA9_8765_4321, 42, 7),
                2_762_555_518,
            ),
            ((u64::MAX, u64::MAX, u32::MAX, u32::MAX), 1_083_123_565),
        ];
        for ((seed, generation, cell, stream), expected) in vectors {
            assert_eq!(random_u32(seed, generation, cell, stream), expected);
            // The blocked variant the gas uses must keep word 0 identical to the published scalar
            // mapping, or every existing golden trajectory would shift.
            assert_eq!(
                philox4(seed, generation, cell, stream)[0],
                expected,
                "block word 0 is the scalar sample"
            );
        }
        // The remaining three words are genuinely different draws, not repeats.
        let block = philox4(99, 7, 3, 11);
        assert_eq!(block.len(), 4);
        assert!(block.windows(2).any(|pair| pair[0] != pair[1]));
    }

    #[test]
    fn world_validates_geometry_and_canonical_rule_bytes() {
        assert!(WorldStochastic::new(7, 6, 1).is_err());
        assert!(WorldStochastic::new(8, 0, 1).is_err());
        let mut world = WorldStochastic::new(8, 6, 0xCAFE).unwrap();
        assert!(world.set_neighborhood_rule(b"bad").is_err());
        let rule = compiled_rule(2, RNG_PHILOX_V1, &[(0, 1, NO_NEIGHBOR_STATE, 0, 7, 0)]);
        world.set_neighborhood_rule(&rule).unwrap();
        assert_eq!(world.states, 2);
        assert_eq!(world.visible_state.capacity(), 48);
        assert_eq!(world.next_visible_state.capacity(), 48);
        assert_eq!(world.neighbor_indices.capacity(), 48 * 6);
    }

    #[test]
    fn probability_endpoints_and_age_deadline_are_exact() {
        let mut never = WorldStochastic::new(8, 6, 1).unwrap();
        never
            .set_neighborhood_rule(&compiled_rule(
                2,
                RNG_PHILOX_V1,
                &[(0, 1, NO_NEIGHBOR_STATE, 0, 1, 0)],
            ))
            .unwrap();
        never.set_initial_state(&[0; 48], &[0; 48]).unwrap();
        for _ in 0..20 {
            assert_eq!(never.run_tick().unwrap(), 0);
        }

        let mut timer = WorldStochastic::new(8, 6, 1).unwrap();
        timer
            .set_neighborhood_rule(&compiled_rule(
                2,
                RNG_PHILOX_V1,
                &[(0, 1, NO_NEIGHBOR_STATE, 3, 1, u32::MAX)],
            ))
            .unwrap();
        timer.set_initial_state(&[0; 48], &[0; 48]).unwrap();
        assert_eq!(timer.run_tick().unwrap(), 0);
        assert_eq!(timer.run_tick().unwrap(), 0);
        assert_eq!(timer.run_tick().unwrap(), 48);
    }

    fn buffer_signature(world: &WorldStochastic) -> Vec<(usize, usize)> {
        let mut signature = vec![
            (
                world.visible_state.as_ptr() as usize,
                world.visible_state.capacity(),
            ),
            (
                world.next_visible_state.as_ptr() as usize,
                world.next_visible_state.capacity(),
            ),
            (
                world.entered_generation.as_ptr() as usize,
                world.entered_generation.capacity(),
            ),
            (
                world.next_entered_generation.as_ptr() as usize,
                world.next_entered_generation.capacity(),
            ),
            (
                world.neighbor_indices.as_ptr() as usize,
                world.neighbor_indices.capacity(),
            ),
            (
                world.transitions.as_ptr() as usize,
                world.transitions.capacity(),
            ),
        ];
        for chunks in [&world.chunk_quiet, &world.chunk_deadline] {
            signature.push((chunks.as_ptr() as usize, chunks.capacity()));
        }
        for chunks in [
            &world.chunk_changed,
            &world.chunk_active,
            &world.chunk_hazard,
        ] {
            signature.push((chunks.as_ptr() as usize, chunks.capacity()));
        }
        signature
    }

    #[test]
    fn both_tick_paths_keep_every_persistent_buffer_fixed() {
        for skipping in [true, false] {
            let mut world = WorldStochastic::new(8, 6, 1).unwrap();
            world
                .set_neighborhood_rule(&compiled_rule(
                    2,
                    RNG_PHILOX_V1,
                    &[
                        (0, 1, NO_NEIGHBOR_STATE, 0, 1, 1),
                        (1, 0, NO_NEIGHBOR_STATE, 0, 2, 1),
                    ],
                ))
                .unwrap();
            world.set_initial_state(&[0; 48], &[0; 48]).unwrap();
            world.set_skipping_enabled(skipping);
            let before = buffer_signature(&world);
            for _ in 0..100_000 {
                std::hint::black_box(world.run_tick().unwrap());
            }
            assert_eq!(buffer_signature(&world), before, "skipping = {skipping}");
        }
    }

    // ---- Activity-skipping identity ------------------------------------------------------------

    #[derive(Clone)]
    struct Row {
        from: u8,
        to: u8,
        neighbor: u8,
        min_age: u16,
        max_age: u16,
        priority: u16,
        stream: u32,
        reset: bool,
        thresholds: [u32; THRESHOLD_COUNT],
    }

    fn row(from: u8, to: u8) -> Row {
        Row {
            from,
            to,
            neighbor: NO_NEIGHBOR_STATE,
            min_age: 0,
            max_age: u16::MAX,
            priority: 0,
            stream: 0,
            reset: true,
            thresholds: [0; THRESHOLD_COUNT],
        }
    }

    fn quantize(probability: f64) -> u32 {
        if probability <= 0.0 {
            0
        } else if probability >= 1.0 {
            u32::MAX
        } else {
            ((probability * 4_294_967_296.0).ceil() as u64).min(u32::MAX as u64 - 1) as u32
        }
    }

    fn uniform(mut candidate: Row, probability: f64, stream: u32) -> Row {
        candidate.thresholds = [quantize(probability); THRESHOLD_COUNT];
        candidate.stream = stream;
        candidate
    }

    fn exposure(mut candidate: Row, neighbor: u8, per_neighbor: f64, stream: u32) -> Row {
        candidate.neighbor = neighbor;
        candidate.stream = stream;
        for (mask, threshold) in candidate.thresholds.iter_mut().enumerate() {
            let matching = (mask as u32).count_ones();
            *threshold = quantize(1.0 - (1.0 - per_neighbor).powi(matching as i32));
        }
        candidate
    }

    fn aged(mut candidate: Row, min_age: u16, max_age: u16) -> Row {
        candidate.min_age = min_age;
        candidate.max_age = max_age;
        candidate
    }

    fn build_rule(states: u8, rng: u8, rows: &[Row]) -> Vec<u8> {
        let mut ordered = rows.to_vec();
        ordered.sort_by(|a, b| a.from.cmp(&b.from).then(b.priority.cmp(&a.priority)));
        let mut bytes = Vec::with_capacity(RULE_HEADER_BYTES + ordered.len() * RULE_ROW_BYTES);
        bytes.extend_from_slice(RULE_MAGIC);
        bytes.push(states);
        bytes.push(rng);
        bytes.extend_from_slice(&(ordered.len() as u16).to_le_bytes());
        for entry in &ordered {
            bytes.extend_from_slice(&[
                entry.from,
                entry.to,
                entry.neighbor,
                if entry.reset { FLAG_RESET_EPOCH } else { 0 },
            ]);
            bytes.extend_from_slice(&entry.min_age.to_le_bytes());
            bytes.extend_from_slice(&entry.max_age.to_le_bytes());
            bytes.extend_from_slice(&entry.priority.to_le_bytes());
            bytes.extend_from_slice(&0u16.to_le_bytes());
            bytes.extend_from_slice(&entry.stream.to_le_bytes());
            for threshold in entry.thresholds {
                bytes.extend_from_slice(&threshold.to_le_bytes());
            }
        }
        bytes
    }

    fn wildfire_rule(spread: f64, burn: u16, ash: u16, regrowth: f64) -> Vec<u8> {
        build_rule(
            4,
            RNG_PHILOX_V1,
            &[
                exposure(row(1, 2), 2, spread, 101),
                uniform(aged(row(2, 3), burn, u16::MAX), 1.0, 102),
                uniform(aged(row(3, 1), ash, u16::MAX), regrowth, 103),
            ],
        )
    }

    fn outbreak_rule(infection: f64, infectious: u16, immunity: u16, efficacy: f64) -> Vec<u8> {
        build_rule(
            4,
            RNG_PHILOX_V1,
            &[
                exposure(row(0, 1), 1, infection, 307),
                uniform(aged(row(1, 2), infectious, u16::MAX), 1.0, 308),
                uniform(aged(row(2, 0), immunity, u16::MAX), 1.0, 309),
                exposure(row(3, 1), 1, infection * (1.0 - efficacy), 307),
            ],
        )
    }

    /// Deterministic scatter that does not borrow the engine's own RNG.
    fn scatter(seed: u32, index: usize) -> u32 {
        let mut value = seed ^ (index as u32).wrapping_add(1).wrapping_mul(0x85EB_CA6B);
        value ^= value >> 16;
        value = value.wrapping_mul(0x7FEB_352D);
        value ^= value >> 15;
        value
    }

    struct Observation {
        generation: u64,
        changed: u32,
        state: Vec<u8>,
        ages: Vec<u16>,
        census: [u32; MAX_STATES],
        counts: [u32; MAX_TRANSITIONS],
        checksum: u32,
        auxiliary: u32,
    }

    fn observe(world: &mut WorldStochastic) -> Observation {
        world.compute_elapsed_ages();
        Observation {
            generation: world.generation(),
            changed: world.last_changed_count(),
            state: world.visible_state.clone(),
            ages: world.elapsed_age_scratch.clone(),
            census: world.census,
            counts: world.transition_counts,
            checksum: world.checksum_state(),
            auxiliary: world.checksum_auxiliary(),
        }
    }

    fn assert_same(skipped: &Observation, dense: &Observation, label: &str) {
        assert_eq!(skipped.generation, dense.generation, "{label}: generation");
        assert_eq!(skipped.changed, dense.changed, "{label}: changed count");
        assert_eq!(skipped.state, dense.state, "{label}: visible state");
        assert_eq!(skipped.ages, dense.ages, "{label}: elapsed ages");
        assert_eq!(skipped.census, dense.census, "{label}: census");
        assert_eq!(skipped.counts, dense.counts, "{label}: transition counts");
        assert_eq!(skipped.checksum, dense.checksum, "{label}: state checksum");
        assert_eq!(
            skipped.auxiliary, dense.auxiliary,
            "{label}: auxiliary checksum"
        );
    }

    struct Pair {
        skipped: WorldStochastic,
        dense: WorldStochastic,
    }

    fn paired(columns: u32, rows: u32, seed: u64, rule: &[u8], cells: &[u8], ages: &[u16]) -> Pair {
        let mut skipped = WorldStochastic::new(columns, rows, seed).unwrap();
        let mut dense = WorldStochastic::new(columns, rows, seed).unwrap();
        for world in [&mut skipped, &mut dense] {
            world.set_neighborhood_rule(rule).unwrap();
            world.set_initial_state(cells, ages).unwrap();
        }
        dense.set_skipping_enabled(false);
        Pair { skipped, dense }
    }

    impl Pair {
        fn step_and_compare(&mut self, ticks: usize, label: &str) {
            for tick in 0..ticks {
                self.skipped.run_tick().unwrap();
                self.dense.run_tick().unwrap();
                assert_same(
                    &observe(&mut self.skipped),
                    &observe(&mut self.dense),
                    &format!("{label} tick {tick}"),
                );
            }
        }
    }

    fn wildfire_start(columns: usize, rows: usize, density: u32) -> (Vec<u8>, Vec<u16>) {
        let mut cells = vec![0u8; columns * rows];
        for row_index in 1..rows - 1 {
            for column in 1..columns - 1 {
                let index = row_index * columns + column;
                if scatter(0x3F17, index) % 100 < density {
                    cells[index] = 1;
                }
            }
        }
        for row_index in 2..rows - 2 {
            if row_index % 3 != 0 {
                cells[row_index * columns + 3] = 2;
            }
        }
        (cells, vec![0u16; columns * rows])
    }

    #[test]
    fn skipping_matches_dense_on_a_moving_wildfire_front() {
        let (columns, rows) = (70usize, 60usize);
        let (cells, ages) = wildfire_start(columns, rows, 78);
        let mut pair = paired(
            columns as u32,
            rows as u32,
            0xF1AE_2026,
            &wildfire_rule(0.18, 2, 20, 0.05),
            &cells,
            &ages,
        );
        pair.step_and_compare(120, "wildfire");
        assert!(pair.skipped.generation() == 120);
    }

    #[test]
    fn skipping_matches_dense_across_external_writes_and_interventions() {
        let (columns, rows) = (64usize, 54usize);
        let mut cells = vec![0u8; columns * rows];
        let mut ages = vec![0u16; columns * rows];
        for (index, cell) in cells.iter_mut().enumerate() {
            if scatter(0x2211, index) % 100 < 18 {
                *cell = 3;
            }
        }
        for (row_ratio, column_ratio) in [(0.32, 0.35), (0.57, 0.62), (0.72, 0.24)] {
            let center = ((rows as f64 * row_ratio) as usize) * columns
                + (columns as f64 * column_ratio) as usize;
            cells[center] = 1;
        }
        let rule = outbreak_rule(0.12, 6, 36, 0.85);
        let mut pair = paired(columns as u32, rows as u32, 0x0B7B_EA4, &rule, &cells, &ages);

        pair.step_and_compare(20, "outbreak before intervention");

        // Single-cell write: only its own chunk and the halo may wake.
        for world in [&mut pair.skipped, &mut pair.dense] {
            world.set_cell(31 * columns + 31, 1).unwrap();
        }
        pair.step_and_compare(15, "outbreak after set_cell");

        // Bulk intervention write at the current generation, ages included.
        let mut ring = pair.dense.visible_state.clone();
        pair.dense.compute_elapsed_ages();
        ages.copy_from_slice(&pair.dense.elapsed_age_scratch);
        for (index, cell) in ring.iter_mut().enumerate() {
            if *cell == 0 && scatter(0x77AA, index) % 100 < 30 {
                *cell = 3;
            }
        }
        for world in [&mut pair.skipped, &mut pair.dense] {
            world.set_cells(&ring, &ages).unwrap();
        }
        pair.step_and_compare(45, "outbreak after set_cells");

        // Toggling the reference path mid-run must not desynchronize either world.
        pair.skipped.set_skipping_enabled(false);
        pair.step_and_compare(5, "outbreak with skipping off");
        pair.skipped.set_skipping_enabled(true);
        pair.step_and_compare(20, "outbreak with skipping back on");
    }

    #[test]
    fn probability_endpoints_and_no_hazard_worlds_go_completely_quiet() {
        let (columns, rows) = (70usize, 60usize);
        let (cells, ages) = wildfire_start(columns, rows, 78);
        // regrowth = 0 â‡’ ash is an absorbing state with no hazard, so the whole grid must settle.
        let mut pair = paired(
            columns as u32,
            rows as u32,
            7,
            &wildfire_rule(1.0, 2, 20, 0.0),
            &cells,
            &ages,
        );
        pair.step_and_compare(200, "deterministic burn-out");
        assert_eq!(
            pair.skipped.active_chunk_count(),
            0,
            "a hazard-free settled world must skip every chunk"
        );
        assert!(pair.skipped.chunk_count() > 1);

        // p = 0 never transitions even though the row is age-applicable forever.
        let mut never = WorldStochastic::new(8, 6, 1).unwrap();
        never
            .set_neighborhood_rule(&build_rule(
                2,
                RNG_PHILOX_V1,
                &[uniform(row(0, 1), 0.0, 5)],
            ))
            .unwrap();
        never.set_initial_state(&[0; 48], &[0; 48]).unwrap();
        for _ in 0..10 {
            assert_eq!(never.run_tick().unwrap(), 0);
        }
        assert_eq!(never.active_chunk_count(), 0);
    }

    #[test]
    fn a_deadline_wakes_exactly_on_its_tick_and_not_before() {
        let mut world = WorldStochastic::new(8, 6, 1).unwrap();
        // State 0 waits nine ticks, then flips deterministically; state 1 is absorbing.
        world
            .set_neighborhood_rule(&build_rule(
                2,
                RNG_PHILOX_V1,
                &[uniform(aged(row(0, 1), 9, u16::MAX), 1.0, 11)],
            ))
            .unwrap();
        world.set_initial_state(&[0; 48], &[0; 48]).unwrap();

        // Tick 1 evaluates the grid, then every tick until the deadline sleeps.
        assert_eq!(world.run_tick().unwrap(), 0);
        assert_eq!(world.active_chunk_count(), world.chunk_count() as u32);
        for tick in 2..9 {
            assert_eq!(world.run_tick().unwrap(), 0, "tick {tick}");
            assert_eq!(world.active_chunk_count(), 0, "tick {tick} must sleep");
        }
        assert_eq!(world.run_tick().unwrap(), 48, "the deadline tick fires");
        assert_eq!(world.generation(), 9);
        for _ in 0..5 {
            assert_eq!(world.run_tick().unwrap(), 0);
        }
        assert_eq!(world.active_chunk_count(), 0);
    }

    #[test]
    fn dense_hazard_worlds_never_sleep_and_still_match_the_reference() {
        let (columns, rows) = (34usize, 34usize);
        let cells = vec![0u8; columns * rows];
        let ages = vec![0u16; columns * rows];
        // A self-loop that fires every tick changes no visible state but is never dormant.
        let rule = build_rule(
            2,
            RNG_PHILOX_V1,
            &[
                uniform(row(0, 0), 1.0, 21),
                uniform(row(1, 0), 0.5, 22),
            ],
        );
        let mut pair = paired(columns as u32, rows as u32, 3, &rule, &cells, &ages);
        pair.step_and_compare(25, "self-loop hazard");
        assert_eq!(
            pair.skipped.active_chunk_count(),
            pair.skipped.chunk_count() as u32,
        );
    }

    #[test]
    fn saturating_ages_survive_the_generation_wrap_and_rebase_exactly() {
        assert_eq!(saturating_age(10, 4), 6);
        assert_eq!(saturating_age(3, u32::MAX - 2), 6);
        assert_eq!(saturating_age(0, 1), u16::MAX, "delta 2^32-1 saturates");
        assert_eq!(saturating_age_after(10, 4), 7);
        assert_eq!(saturating_age_after(0x1_0000, 0), u16::MAX);
        assert_eq!(saturating_age_after(0xFFFF, 0), u16::MAX);
        assert_eq!(saturating_age_after(0xFFFE, 0), u16::MAX);

        let mut world = WorldStochastic::new(8, 6, 1).unwrap();
        world
            .set_neighborhood_rule(&build_rule(
                2,
                RNG_PHILOX_V1,
                &[uniform(aged(row(0, 1), 4, u16::MAX), 1.0, 31)],
            ))
            .unwrap();
        world.set_initial_state(&[0; 48], &[0; 48]).unwrap();

        // Park the world two ticks below the u32 generation wrap with epochs on the other side.
        world.generation = u64::from(u32::MAX) - 1;
        let entered = (u32::MAX - 3).wrapping_sub(0);
        world.entered_generation.fill(entered);
        world.next_entered_generation.fill(entered);
        world.mark_all_active();
        // age_after_tick = (0xFFFFFFFE - 0xFFFFFFFC) + 1 = 3 â‡’ one tick short of the deadline.
        assert_eq!(world.run_tick().unwrap(), 0);
        assert_eq!(world.run_tick().unwrap(), 48, "fires across the u32 wrap");

        // Rebasing clamps unreachable distances without moving any observable age.
        let mut aged_world = WorldStochastic::new(8, 6, 1).unwrap();
        aged_world
            .set_neighborhood_rule(&build_rule(
                2,
                RNG_PHILOX_V1,
                &[uniform(aged(row(0, 1), 40_000, u16::MAX), 1.0, 41)],
            ))
            .unwrap();
        aged_world.set_initial_state(&[0; 48], &[0; 48]).unwrap();
        aged_world.generation = 5_000_000;
        aged_world.entered_generation.fill(0);
        aged_world.next_entered_generation.fill(0);
        aged_world.compute_elapsed_ages();
        assert_eq!(aged_world.elapsed_age_scratch[0], u16::MAX);
        aged_world.rebase_epochs();
        aged_world.compute_elapsed_ages();
        assert_eq!(aged_world.elapsed_age_scratch[0], u16::MAX);
        assert_eq!(aged_world.entered_generation[0], 5_000_000 - 65_535);
    }

    // ---- Lattice gas ---------------------------------------------------------------------------

    /// The canonical two-species operator, mirroring `hexGasCollide` in the package.
    fn hex_gas_collide(channels: [u8; 6]) -> (u16, u16, u32) {
        let occupied: Vec<usize> = (0..6).filter(|&d| channels[d] != 0).collect();
        let pack = |slots: [u8; 6]| {
            slots
                .iter()
                .enumerate()
                .fold(0u16, |config, (direction, &species)| {
                    config | (u16::from(species) << (2 * direction))
                })
        };
        if occupied.len() == 2 && occupied[1] - occupied[0] == 3 {
            let mut primary = [0u8; 6];
            let mut alternate = [0u8; 6];
            for &direction in &occupied {
                primary[(direction + 1) % 6] = channels[direction];
                alternate[(direction + 5) % 6] = channels[direction];
            }
            return (pack(primary), pack(alternate), u32::MAX / 2);
        }
        if occupied.len() == 3 && occupied[1] - occupied[0] == 2 && occupied[2] - occupied[1] == 2 {
            let mut rotated = [0u8; 6];
            for &direction in &occupied {
                rotated[(direction + 1) % 6] = channels[direction];
            }
            let packed = pack(rotated);
            return (packed, packed, 0);
        }
        let packed = pack(channels);
        (packed, packed, 0)
    }

    fn gas_rule(scatter: u32) -> Vec<u8> {
        let mut bytes = vec![0u8; GAS_RULE_BYTES];
        bytes[..4].copy_from_slice(GAS_MAGIC);
        bytes[4] = 2;
        bytes[5] = RNG_PHILOX_V1;
        bytes[8..12].copy_from_slice(&(scatter & !1).to_le_bytes());
        let threshold_base = GAS_HEADER_BYTES + GAS_CONFIGURATIONS * 4;
        for config in 0..GAS_CONFIGURATIONS {
            let source = config as u16;
            let (primary, alternate, probability) = if gas_config_is_legal(source) {
                let channels = std::array::from_fn(|direction| {
                    ((source >> (2 * direction)) & 3) as u8
                });
                hex_gas_collide(channels)
            } else {
                (source, source, 0)
            };
            let packed = u32::from(primary) | (u32::from(alternate) << 16);
            let offset = GAS_HEADER_BYTES + config * 4;
            bytes[offset..offset + 4].copy_from_slice(&packed.to_le_bytes());
            if primary != alternate {
                let offset = threshold_base + config * 4;
                bytes[offset..offset + 4].copy_from_slice(&probability.to_le_bytes());
            }
        }
        bytes
    }

    /// The finite two-reservoir chamber, mirroring `mixingChamber` in the demo rules module.
    fn chamber(columns: usize, rows: usize, occupancy: u32) -> (Vec<u8>, Vec<u8>) {
        let mut channels = vec![0u8; columns * rows * 6];
        let mut walls = vec![0u8; columns * rows];
        let middle = columns / 2;
        for row in 0..rows {
            for column in 0..columns {
                let index = row * columns + column;
                if row == 0 || row + 1 == rows || column == 0 || column + 1 == columns || column == middle {
                    walls[index] = 1;
                    continue;
                }
                let species = if column < middle { 1 } else { 2 };
                for channel in 0..6 {
                    let salt = 0x6A5C_0111u32 ^ (channel as u32).wrapping_mul(0x9E37_79B1);
                    if scatter(salt, index) % 100 < occupancy {
                        channels[index * 6 + channel] = species;
                    }
                }
            }
        }
        (channels, walls)
    }

    fn species_totals(world: &WorldStochastic) -> (u32, u32) {
        (world.species_count(1), world.species_count(2))
    }

    /// The gather in `run_tick_gas` is only exact if `(d + 3) % 6` is the true inverse of every
    /// canonical direction. Proved against the generated table itself, on the real odd-q torus
    /// mapping â€” never against a hand translation of it.
    #[test]
    fn opposite_direction_is_the_exact_inverse_on_the_torus() {
        for (columns, rows) in [(8i32, 6i32), (12, 12), (34, 20)] {
            let count = (columns * rows) as usize;
            let table = compute_neighbor_indices(columns, rows, count);
            for index in 0..count {
                for direction in 0..6 {
                    let neighbor = table[index * 6 + direction] as usize;
                    let back = table[neighbor * 6 + (direction + 3) % 6] as usize;
                    assert_eq!(
                        back, index,
                        "{columns}x{rows}: direction {direction} from {index} does not invert"
                    );
                }
            }
        }
    }

    #[test]
    fn gas_rule_load_rejects_every_non_conserving_table() {
        assert!(is_conservative_gas_rule(&gas_rule(0)));
        assert!(!is_conservative_gas_rule(&[0u8; 16]));

        let mut leaky = gas_rule(0);
        // Empty one occupied configuration: legal bytes, illegal physics.
        let offset = GAS_HEADER_BYTES + 1 * 4;
        leaky[offset..offset + 4].copy_from_slice(&0u32.to_le_bytes());
        assert!(!is_conservative_gas_rule(&leaky));

        let mut unreachable = gas_rule(0);
        let offset = GAS_HEADER_BYTES + 3 * 4;
        unreachable[offset..offset + 4].copy_from_slice(&0u32.to_le_bytes());
        assert!(
            !is_conservative_gas_rule(&unreachable),
            "unreachable entries must stay pinned to the identity"
        );
    }

    #[test]
    fn gas_conserves_both_species_over_100k_ticks_without_allocating() {
        let (columns, rows) = (40usize, 40usize);
        let (channels, walls) = chamber(columns, rows, 60);
        let mut world =
            WorldStochastic::new_lattice_gas(columns as u32, rows as u32, 0x6A5C_0111).unwrap();
        world.set_gas_rule(&gas_rule(u32::MAX / 8)).unwrap();
        world.set_gas_initial_state(&channels, &walls).unwrap();
        let expected = species_totals(&world);
        assert!(expected.0 > 500 && expected.1 > 500);

        let signature = |world: &WorldStochastic| {
            [
                (world.channels.as_ptr() as usize, world.channels.capacity()),
                (
                    world.next_channels.as_ptr() as usize,
                    world.next_channels.capacity(),
                ),
                (world.walls.as_ptr() as usize, world.walls.capacity()),
                (
                    world.visible_state.as_ptr() as usize,
                    world.visible_state.capacity(),
                ),
                (
                    world.gas_outcomes.as_ptr() as usize,
                    world.gas_outcomes.capacity(),
                ),
                (
                    world.gas_profile.as_ptr() as usize,
                    world.gas_profile.capacity(),
                ),
            ]
        };
        let before = signature(&world);
        for tick in 0..100_000 {
            std::hint::black_box(world.run_tick().unwrap());
            if tick % 10_000 == 0 {
                assert_eq!(species_totals(&world), expected, "tick {tick}");
            }
        }
        assert_eq!(species_totals(&world), expected);
        assert_eq!(signature(&world), before);
        assert_eq!(
            world.census[..GAS_VISIBLE_STATES as usize].iter().sum::<u32>(),
            (columns * rows) as u32
        );
    }

    #[test]
    fn a_closed_chamber_never_leaks_across_the_torus_seam_or_the_membrane() {
        let (columns, rows) = (48usize, 40usize);
        let (channels, walls) = chamber(columns, rows, 24);
        let mut world =
            WorldStochastic::new_lattice_gas(columns as u32, rows as u32, 7).unwrap();
        world.set_gas_rule(&gas_rule(u32::MAX / 10)).unwrap();
        world.set_gas_initial_state(&channels, &walls).unwrap();
        let middle = columns / 2;

        for _ in 0..500 {
            world.run_tick().unwrap();
            for row in 0..rows {
                for column in 0..columns {
                    let index = row * columns + column;
                    if world.walls[index] != 0 {
                        assert_eq!(
                            world.channels[index] & GAS_CONFIG_MASK,
                            0,
                            "a wall site holds no particles"
                        );
                        continue;
                    }
                    let expected = if column < middle { 1u16 } else { 2u16 };
                    for direction in 0..6 {
                        let species = (world.channels[index] >> (2 * direction)) & 3;
                        assert!(
                            species == 0 || species == expected,
                            "species {species} reached column {column} through a closed membrane"
                        );
                    }
                }
            }
        }

        // Opening the gate produces cross-reservoir traffic without changing either total.
        let before = species_totals(&world);
        for row in (rows * 34 / 100)..(rows * 66 / 100) {
            world.set_wall(row * columns + middle, false).unwrap();
        }
        for _ in 0..600 {
            world.run_tick().unwrap();
        }
        assert_eq!(species_totals(&world), before);
        let crossed = (0..world.num_cells).any(|index| {
            let column = index % columns;
            if column == middle {
                return false;
            }
            let expected = if column < middle { 1u16 } else { 2u16 };
            (0..6).any(|direction| {
                let species = (world.channels[index] >> (2 * direction)) & 3;
                species != 0 && species != expected
            })
        });
        assert!(crossed, "an open membrane must let the reservoirs mix");
        assert!(world.census[GAS_MIXED as usize] > 0);
    }

    /// Release-native stochastic half of the Â§10 benchmark matrix.
    ///
    /// Ignored so ordinary test runs do not benchmark a busy host. Every workload is measured twice
    /// â€” skipping on and skipping off â€” because Â§10.3 gates both directions: sparse workloads must
    /// improve, and the dense reference path may not regress by more than 5%.
    #[test]
    #[ignore = "manual release benchmark; run with --release --ignored --nocapture"]
    fn stochastic_native_benchmark() {
        use std::time::Instant;

        const TIERS: [(&str, u32, u32, usize); 3] = [
            ("demo", 84, 72, 36),
            ("medium", 346, 300, 9),
            ("large", 666, 576, 3),
        ];
        const RUNS: usize = 7;
        const SETTLED_MULTIPLIER: usize = 100;

        fn measure(mut tick: impl FnMut(), ticks: usize) -> Vec<u128> {
            for _ in 0..3 {
                tick();
            }
            (0..RUNS)
                .map(|_| {
                    let start = Instant::now();
                    for _ in 0..ticks {
                        tick();
                    }
                    start.elapsed().as_nanos() / ticks as u128
                })
                .collect()
        }

        fn emit_engine(
            tier: &str,
            engine: &str,
            workload: &str,
            mode: &str,
            cells: usize,
            samples: &[u128],
        ) {
            let joined = samples
                .iter()
                .map(u128::to_string)
                .collect::<Vec<_>>()
                .join(",");
            println!("PHASEA_NATIVE|{tier}|{engine}|{workload}|{mode}|{cells}|{joined}");
        }

        fn emit(tier: &str, workload: &str, mode: &str, cells: usize, samples: &[u128]) {
            emit_engine(
                tier,
                "WorldStochastic/neighborhood",
                workload,
                mode,
                cells,
                samples,
            );
        }

        // (workload, rule, initial cells, tick multiplier)
        type Case = (&'static str, Vec<u8>, Box<dyn Fn(usize, usize) -> Vec<u8>>, usize);

        for (tier, columns, rows, ticks) in TIERS {
            let count = (columns * rows) as usize;
            let cases: Vec<Case> = vec![
                (
                    "no-hazard",
                    wildfire_rule(0.18, 2, 20, 0.0),
                    Box::new(|columns, rows| vec![1u8; columns * rows]),
                    SETTLED_MULTIPLIER,
                ),
                (
                    "sparse-fire-front",
                    wildfire_rule(0.25, 3, u16::MAX, 0.0),
                    Box::new(|columns, rows| {
                        let mut cells = vec![1u8; columns * rows];
                        cells[(rows / 2) * columns + columns / 2] = 2;
                        cells
                    }),
                    1,
                ),
                (
                    "dense-fire-hazard",
                    wildfire_rule(0.18, 2, 4, 0.05),
                    Box::new(|columns, rows| {
                        (0..columns * rows)
                            .map(|index| (scatter(0x5A17, index) % 3) as u8 + 1)
                            .collect()
                    }),
                    1,
                ),
                (
                    "outbreak-growth",
                    outbreak_rule(0.12, 6, 36, 0.85),
                    Box::new(|columns, rows| {
                        let mut cells = vec![0u8; columns * rows];
                        for ratio in [0.32, 0.57, 0.72] {
                            cells[((rows as f64 * ratio) as usize) * columns + columns / 2] = 1;
                        }
                        cells
                    }),
                    1,
                ),
            ];

            for (workload, rule, seed_cells, multiplier) in cases {
                let cells = seed_cells(columns as usize, rows as usize);
                let ages = vec![0u16; count];
                for skipping in [true, false] {
                    let mut world = WorldStochastic::new(columns, rows, 0xF1AE_2026).unwrap();
                    world.set_neighborhood_rule(&rule).unwrap();
                    world.set_initial_state(&cells, &ages).unwrap();
                    world.set_skipping_enabled(skipping);
                    let samples = measure(
                        || {
                            std::hint::black_box(world.run_tick().unwrap());
                        },
                        ticks * multiplier,
                    );
                    emit(
                        tier,
                        workload,
                        if skipping { "skipping" } else { "dense" },
                        count,
                        &samples,
                    );
                }
            }

            // Paired outbreak: both arms advance together, exactly as the demo drives them.
            let rule = outbreak_rule(0.12, 6, 36, 0.85);
            let ages = vec![0u16; count];
            let mut baseline_cells = vec![0u8; count];
            let mut policy_cells = vec![0u8; count];
            for index in 0..count {
                if scatter(0x2211, index) % 100 < 20 {
                    policy_cells[index] = 3;
                }
            }
            for ratio in [0.32, 0.57, 0.72] {
                let index = ((rows as f64 * ratio) as usize) * columns as usize + count / (2 * rows as usize);
                baseline_cells[index] = 1;
                policy_cells[index] = 1;
            }
            for skipping in [true, false] {
                let mut baseline = WorldStochastic::new(columns, rows, 0x0B7B_EA4).unwrap();
                let mut policy = WorldStochastic::new(columns, rows, 0x0B7B_EA4).unwrap();
                baseline.set_neighborhood_rule(&rule).unwrap();
                policy.set_neighborhood_rule(&rule).unwrap();
                baseline.set_initial_state(&baseline_cells, &ages).unwrap();
                policy.set_initial_state(&policy_cells, &ages).unwrap();
                baseline.set_skipping_enabled(skipping);
                policy.set_skipping_enabled(skipping);
                let samples = measure(
                    || {
                        std::hint::black_box(baseline.run_tick().unwrap());
                        std::hint::black_box(policy.run_tick().unwrap());
                    },
                    ticks,
                );
                emit(
                    tier,
                    "paired-outbreak",
                    if skipping { "skipping" } else { "dense" },
                    count,
                    &samples,
                );
            }

            // Lattice gas: the Â§10.2 occupancy sweep plus the two boundary/collision extremes.
            // Occupancy and scattering mirror the frozen Phase-0 JavaScript workloads exactly, so
            // the comparison is against the same nominal parameters rather than re-tuned ones.
            let scatter_7 = (0.07f64 * 4_294_967_296.0) as u32;
            let scatter_30 = (0.30f64 * 4_294_967_296.0) as u32;
            let gas_cases: [(&str, u32, u32, bool); 5] = [
                ("occupancy-8pct", 8, scatter_7, false),
                ("occupancy-24pct", 24, scatter_7, false),
                ("occupancy-60pct", 60, scatter_7, false),
                ("open-membrane", 24, scatter_7, true),
                ("collision-heavy", 60, scatter_30, false),
            ];
            for (workload, occupancy, scatter, open) in gas_cases {
                let (channels, walls) = chamber(columns as usize, rows as usize, occupancy);
                let mut world = WorldStochastic::new_lattice_gas(columns, rows, 0x6A5C_0111).unwrap();
                world.set_gas_rule(&gas_rule(scatter)).unwrap();
                world.set_gas_initial_state(&channels, &walls).unwrap();
                if open {
                    let middle = columns as usize / 2;
                    for row in (rows as usize * 34 / 100)..(rows as usize * 66 / 100) {
                        world.set_wall(row * columns as usize + middle, false).unwrap();
                    }
                }
                let samples = measure(
                    || {
                        std::hint::black_box(world.run_tick().unwrap());
                    },
                    ticks,
                );
                emit_engine(
                    tier,
                    "WorldStochastic/lattice-gas",
                    workload,
                    "dense",
                    count,
                    &samples,
                );
            }
        }
    }

    #[test]
    fn skipping_reduces_work_on_a_sparse_front_without_changing_it() {
        // Big enough that one front does not simply fill the halo of every chunk on the grid.
        let (columns, rows) = (256usize, 256usize);
        let mut cells = vec![1u8; columns * rows];
        cells[128 * columns + 128] = 2;
        let ages = vec![0u16; columns * rows];
        // Slow spread, no regrowth: the hazard band hugs the fire front.
        let mut pair = paired(
            columns as u32,
            rows as u32,
            0xBEEF,
            &wildfire_rule(0.25, 3, u16::MAX, 0.0),
            &cells,
            &ages,
        );
        pair.step_and_compare(30, "sparse front");
        let active = pair.skipped.active_chunk_count();
        let total = pair.skipped.chunk_count() as u32;
        assert!(
            active * 2 < total,
            "a sparse front should leave most of {total} chunks asleep, saw {active}"
        );
    }
}




