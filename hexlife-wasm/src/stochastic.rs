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

/// Counter-based Philox4x32-10 sample for one stochastic decision.
///
/// Counter words are `[cell_index, stream_id, generation_lo, generation_hi]`; key words are the
/// low/high halves of `seed`. No mutable cursor exists, so skipping a cell or reordering rule rows
/// cannot shift any other cell's stream.
#[wasm_bindgen]
pub fn random_u32(seed: u64, generation: u64, cell_index: u32, stream_id: u32) -> u32 {
    let mut counter = [
        cell_index,
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

    counter[0]
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
}

struct PhiloxV1;
impl CounterRng for PhiloxV1 {
    #[inline]
    fn sample(seed: u64, generation: u64, cell_index: u32, stream_id: u32) -> u32 {
        random_u32(seed, generation, cell_index, stream_id)
    }
}

struct LegacyDemo;
impl CounterRng for LegacyDemo {
    #[inline]
    fn sample(seed: u64, generation: u64, cell_index: u32, stream_id: u32) -> u32 {
        legacy_demo_random_u32(seed, generation, cell_index, stream_id)
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
    num_cells: usize,
    seed: u64,
    generation: u64,
    states: u8,
    rng_tag: u8,
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
}

#[wasm_bindgen]
impl WorldStochastic {
    #[wasm_bindgen(constructor)]
    pub fn new(columns: u32, rows: u32, seed: u64) -> Result<WorldStochastic, String> {
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

        Ok(WorldStochastic {
            rows,
            columns,
            num_cells,
            seed,
            generation: 0,
            states: 0,
            rng_tag: RNG_PHILOX_V1,
            visible_state: vec![0; num_cells],
            next_visible_state: vec![0; num_cells],
            entered_generation: vec![0; num_cells],
            next_entered_generation: vec![0; num_cells],
            initial_state: vec![0; num_cells],
            initial_entered_generation: vec![0; num_cells],
            elapsed_age_scratch: vec![0; num_cells],
            neighbor_indices: compute_neighbor_indices(columns_i32, rows_i32, num_cells),
            rule_bytes: Vec::new(),
            transitions: Vec::new(),
            row_offsets: [0; MAX_STATES + 1],
            age_tracked: [false; MAX_STATES],
            census: [0; MAX_STATES],
            transition_counts: [0; MAX_TRANSITIONS],
            last_changed_count: 0,
        })
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
        self.recompute_census();
        Ok(())
    }

    /// Replace the reset snapshot and reset the world to generation zero.
    pub fn set_initial_state(&mut self, cells: &[u8], elapsed_ages: &[u16]) -> Result<(), String> {
        self.validate_cells_and_ages(cells, elapsed_ages)?;
        self.generation = 0;
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
        Ok(())
    }

    pub fn set_cell(&mut self, index: usize, value: u8) -> Result<(), String> {
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
        Ok(())
    }

    pub fn reset(&mut self) -> Result<(), String> {
        self.ensure_rule()?;
        self.generation = 0;
        self.visible_state.copy_from_slice(&self.initial_state);
        self.next_visible_state.copy_from_slice(&self.initial_state);
        self.entered_generation
            .copy_from_slice(&self.initial_entered_generation);
        self.next_entered_generation
            .copy_from_slice(&self.initial_entered_generation);
        self.transition_counts.fill(0);
        self.last_changed_count = 0;
        self.recompute_census();
        Ok(())
    }

    /// Advance one dense generation. Phase 3 adds temporal activity skipping around this reference.
    pub fn run_tick(&mut self) -> Result<u32, String> {
        self.ensure_rule()?;
        let changed = match self.rng_tag {
            RNG_LEGACY_DEMO => self.run_tick_dense::<LegacyDemo>(),
            RNG_PHILOX_V1 => self.run_tick_dense::<PhiloxV1>(),
            _ => unreachable!("parse_rule rejects unknown RNG tags"),
        };
        Ok(changed)
    }

    pub fn compute_elapsed_ages(&mut self) {
        let generation = self.generation as u32;
        for index in 0..self.num_cells {
            let state = self.visible_state[index] as usize;
            self.elapsed_age_scratch[index] = if self.age_tracked[state] {
                generation.wrapping_sub(self.entered_generation[index]) as u16
            } else {
                0
            };
        }
    }

    pub fn checksum_state(&self) -> u32 {
        fnv1a(self.visible_state.iter().copied())
    }

    pub fn checksum_auxiliary(&self) -> u32 {
        let generation = self.generation as u32;
        let mut hash = 0x811C_9DC5u32;
        for index in 0..self.num_cells {
            let state = self.visible_state[index] as usize;
            let age = if self.age_tracked[state] {
                generation.wrapping_sub(self.entered_generation[index]) as u16
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
    fn ensure_rule(&self) -> Result<(), String> {
        if self.states == 0 {
            Err("WorldStochastic: install a neighborhood rule first".into())
        } else {
            Ok(())
        }
    }

    fn validate_cells_and_ages(&self, cells: &[u8], ages: &[u16]) -> Result<(), String> {
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

    fn run_tick_dense<R: CounterRng>(&mut self) -> u32 {
        self.census.fill(0);
        let generation_u32 = self.generation as u32;
        let next_generation = generation_u32.wrapping_add(1);
        let mut changed = 0u32;

        for index in 0..self.num_cells {
            let state = self.visible_state[index];
            let state_index = state as usize;
            let tracked = self.age_tracked[state_index];
            let age_after_tick = if tracked {
                generation_u32
                    .wrapping_sub(self.entered_generation[index])
                    .wrapping_add(1) as u16
            } else {
                0
            };
            let mut next_state = state;
            let mut next_entered = if tracked {
                self.entered_generation[index]
            } else {
                next_generation
            };
            let start = self.row_offsets[state_index] as usize;
            let end = self.row_offsets[state_index + 1] as usize;

            for row_index in start..end {
                let row = &self.transitions[row_index];
                if age_after_tick < row.min_age || age_after_tick > row.max_age {
                    continue;
                }
                let mask = if row.neighbor_state == NO_NEIGHBOR_STATE {
                    0
                } else {
                    let mut mask = 0usize;
                    let base = index * 6;
                    for direction in 0..6 {
                        let neighbor = self.neighbor_indices[base + direction] as usize;
                        if self.visible_state[neighbor] == row.neighbor_state {
                            mask |= 1 << direction;
                        }
                    }
                    mask
                };
                let threshold = row.thresholds[mask];
                if threshold == 0 {
                    continue;
                }
                let passes = threshold == u32::MAX
                    || R::sample(self.seed, self.generation, index as u32, row.stream_id)
                        < threshold;
                if !passes {
                    continue;
                }

                next_state = row.to;
                if row.reset_epoch || row.to != state {
                    next_entered = next_generation;
                }
                self.transition_counts[row_index] =
                    self.transition_counts[row_index].wrapping_add(1);
                break;
            }

            if !self.age_tracked[next_state as usize] {
                next_entered = next_generation;
            }
            self.next_visible_state[index] = next_state;
            self.next_entered_generation[index] = next_entered;
            self.census[next_state as usize] += 1;
            changed += u32::from(next_state != state);
        }

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
        }
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

    #[test]
    fn dense_tick_keeps_every_persistent_buffer_fixed() {
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
        let signature = |world: &WorldStochastic| {
            [
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
            ]
        };
        let before = signature(&world);
        for _ in 0..100_000 {
            std::hint::black_box(world.run_tick().unwrap());
        }
        assert_eq!(signature(&world), before);
    }
}
