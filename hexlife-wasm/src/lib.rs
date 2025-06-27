use wasm_bindgen::prelude::*;

// This line allows Rust to print panic messages to the browser's developer console.
// extern crate console_error_panic_hook;
// use std::panic;

// Define the neighbor directions just like in the JavaScript version.
// Using 'static' makes them globally available within the module.
const NEIGHBOR_DIRS_ODD_R: [[i32; 2]; 6] = [[-1, 1], [-1, 0], [0, -1], [1, 0], [1, 1], [0, 1]];
const NEIGHBOR_DIRS_EVEN_R: [[i32; 2]; 6] = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [0, 1]];

// The `#[wasm_bindgen]` attribute exposes the following struct or function to JavaScript.
#[wasm_bindgen]
pub struct World {
    grid_cols: i32,
    grid_rows: i32,
}

#[wasm_bindgen]
impl World {
    /// Public constructor that can be called from JavaScript.
    #[wasm_bindgen(constructor)]
    pub fn new(grid_cols: i32, grid_rows: i32) -> World {
        // Optional: Sets up a panic hook to log errors to the console.
        // panic::set_hook(Box::new(console_error_panic_hook::hook));
        World { grid_cols, grid_rows }
    }

    /// This is the core function that will replace the JavaScript simulation loop.
    /// It takes slices as arguments. A slice (`&[u8]`) is a "view" into a block of memory.
    /// A mutable slice (`&mut [u8]`) means Rust can write to that memory.
    /// This is how we will modify the JavaScript Uint8Arrays directly.
    pub fn run_tick(
        &self,
        ruleset: &[u8],
        state: &[u8],
        next_state: &mut [u8],
        rule_indices: &mut [u8],
        rule_usage_counters: &mut [u32],
    ) {
        let num_cells = (self.grid_cols * self.grid_rows) as usize;

        // The main simulation loop, now in Rust.
        for i in 0..num_cells {
            let c_col = i as i32 % self.grid_cols;
            let c_row = i as i32 / self.grid_cols;
            let c_state = state[i];

            let mut neighbor_mask: u8 = 0;
            
            // Determine which set of neighbor directions to use.
            let dirs = if c_col % 2 != 0 {
                &NEIGHBOR_DIRS_ODD_R
            } else {
                &NEIGHBOR_DIRS_EVEN_R
            };

            // Calculate the neighbor mask.
            for n_order in 0..6 {
                // The modulo arithmetic handles the toroidal grid wrapping.
                let n_col = (c_col + dirs[n_order][0] + self.grid_cols) % self.grid_cols;
                let n_row = (c_row + dirs[n_order][1] + self.grid_rows) % self.grid_rows;
                let neighbor_index = (n_row * self.grid_cols + n_col) as usize;

                if state[neighbor_index] == 1 {
                    neighbor_mask |= 1 << n_order;
                }
            }

            // Determine the rule index and get the result from the ruleset.
            let rule_idx = ((c_state << 6) | neighbor_mask) as usize;
            let next_state_value = ruleset[rule_idx];
            
            // Update the output arrays directly.
            next_state[i] = next_state_value;
            rule_indices[i] = rule_idx as u8;
            rule_usage_counters[rule_idx] += 1;
        }
    }

    /// A direct port of the checksum function.
    pub fn calculate_checksum(&self, arr: &[u8]) -> i32 {
        let mut checksum: i32 = 0;
        for &val in arr {
            // The `wrapping_*` methods prevent panics on integer overflow,
            // which is the intended behavior for this kind of checksum.
            checksum = checksum.wrapping_mul(31).wrapping_add(val as i32);
        }
        checksum
    }
}