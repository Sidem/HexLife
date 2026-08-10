use wasm_bindgen::prelude::*;

use crate::compute_neighbor_indices;

/// Reproducibility version for the tuple-to-counter mapping and Philox round function below.
/// This value will be stored in `HXS1` once the codec lands; changing either is a breaking change
/// to stochastic trajectories and therefore requires a new version.
pub const STOCHASTIC_RNG_VERSION: u32 = 1;

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
/// cannot shift any other cell's stream. The returned sample is counter word 0 after ten rounds.
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

/// Phase-1 allocation and loader shell. It owns the final-size visible state and canonical neighbor
/// table, but deliberately has no transition backend: `tick` does not exist until Phase 2 installs
/// the compiled neighborhood kernel. This keeps Phase 1 focused on the artifact/RNG boundary.
#[wasm_bindgen]
pub struct WorldStochastic {
    rows: u32,
    columns: u32,
    num_cells: usize,
    seed: u64,
    generation: u64,
    visible_state: Vec<u8>,
    neighbor_indices: Vec<u32>,
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
        let rows_i32 = i32::try_from(rows)
            .map_err(|_| "WorldStochastic: rows exceed the supported range")?;

        Ok(WorldStochastic {
            rows,
            columns,
            num_cells,
            seed,
            generation: 0,
            visible_state: vec![0; num_cells],
            neighbor_indices: compute_neighbor_indices(columns_i32, rows_i32, num_cells),
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

    pub fn seed(&self) -> u64 {
        self.seed
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn state_ptr(&self) -> *const u8 {
        self.visible_state.as_ptr()
    }

    pub fn neighbor_indices_ptr(&self) -> *const u32 {
        self.neighbor_indices.as_ptr()
    }

    pub fn rng_sample(&self, cell_index: u32, stream_id: u32) -> Result<u32, String> {
        if usize::try_from(cell_index).map_or(true, |index| index >= self.num_cells) {
            return Err(format!(
                "WorldStochastic: cell index {cell_index} is outside 0..{}",
                self.num_cells
            ));
        }
        Ok(random_u32(self.seed, self.generation, cell_index, stream_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn world_shell_validates_geometry_and_owns_final_buffers() {
        assert!(WorldStochastic::new(7, 6, 1).is_err());
        assert!(WorldStochastic::new(8, 0, 1).is_err());

        let world = WorldStochastic::new(8, 6, 0xCAFE).unwrap();
        assert_eq!(world.num_cells, 48);
        assert_eq!(world.visible_state.len(), 48);
        assert_eq!(world.visible_state.capacity(), 48);
        assert_eq!(world.neighbor_indices.len(), 48 * 6);
        assert_eq!(world.neighbor_indices.capacity(), 48 * 6);
        assert_eq!(world.generation, 0);
    }
}
