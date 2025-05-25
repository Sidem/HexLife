# Hexagonal Block Entropy Implementation

## Overview

This document describes the implementation of hexagonal block entropy in the HexLife cellular automaton system. The hexagonal block entropy provides a more sophisticated measure of spatial complexity compared to simple binary entropy by analyzing 7-cell hexagonal patterns (a center cell and its 6 immediate neighbors).

## What is Hexagonal Block Entropy?

### Concept
- **Block Definition**: A 7-cell hexagonal block consists of a center cell and its 6 immediate neighbors
- **Pattern Representation**: Each block is represented as a 7-bit number (0-127)
  - Bit 6: Center cell state (0 or 1)
  - Bits 0-5: Neighbor states in order (SW, NW, N, NE, SE, S)
- **Entropy Calculation**: Shannon entropy based on the probability distribution of all unique 7-bit patterns

### Mathematical Formula
```
H = -Σ(p_i * log2(p_i))
```
Where:
- `p_i` is the probability of pattern `i` occurring
- The sum is over all unique patterns found in the grid
- Maximum entropy is log2(128) = 7.0 bits

## Implementation Details

### Core Function: `calculateHexBlockEntropy`

**Location**: `src/core/WorldWorker.js` (lines 41-85)

**Parameters**:
- `currentStateArray`: Uint8Array of cell states
- `config`: Grid configuration (GRID_ROWS, GRID_COLS, NUM_CELLS)
- `N_DIRS_ODD`: Neighbor directions for odd columns
- `N_DIRS_EVEN`: Neighbor directions for even columns

**Algorithm**:
1. Iterate through each cell as a potential center
2. For each center cell:
   - Get its state (0 or 1)
   - Check all 6 neighbors using hexagonal grid directions
   - Create a 7-bit pattern: `(centerState << 6) | neighborMask`
   - Count occurrences of each unique pattern
3. Calculate Shannon entropy from pattern probabilities

### Integration Points

#### 1. WorldWorker.js Changes
- Added `hexBlockEntropyHistory` array for storing history
- Modified `runTick()` to calculate block entropy when sampling is enabled
- Updated `sendStateUpdate()` to include both `binaryEntropy` and `blockEntropy`
- Updated all command handlers to support the new entropy type

#### 2. WorldProxy.js Changes
- Added `hexBlockEntropyHistory` to `latestStats`
- Updated `STATS_UPDATE` message handling to process both entropy types
- Modified history management to track both entropy histories

#### 3. UI Updates (EntropyPlotPlugin.js)
- Added entropy type selector (Binary vs Block)
- Separate display fields for both entropy types
- Dynamic plot switching between entropy types
- Different color coding: Orange for binary, Cyan for block entropy
- Proper axis labeling: Binary (0.0-1.0), Block (0.0-7.0)

#### 4. Interface Extensions
- Added `getSelectedWorldBlockEntropyHistory()` method to simulation interface
- Updated both `main.js` and `AnalysisPanel.js` to support the new method

## Performance Considerations

### Computational Complexity
- **Time Complexity**: O(n) where n is the number of cells
- **Space Complexity**: O(k) where k is the number of unique patterns (max 128)
- **Performance Impact**: Roughly doubles entropy calculation time when both types are enabled

### Optimization Features
- **Sampling Control**: Block entropy is only calculated when entropy sampling is enabled
- **Rate Limiting**: Controlled by `workerEntropySampleRate` (default: every 10 ticks)
- **Conditional Calculation**: Only computed when needed, not on every tick

## Usage Examples

### Basic Usage
1. Enable entropy sampling in the analysis panel
2. Select "Block Entropy" from the entropy type dropdown
3. Observe the plot showing block entropy over time
4. Compare with binary entropy by switching the selector

### Interpreting Results
- **Low Block Entropy (0.0-2.0)**: Highly ordered patterns, few unique 7-cell configurations
- **Medium Block Entropy (2.0-4.0)**: Moderate complexity, some pattern diversity
- **High Block Entropy (4.0-7.0)**: High complexity, many different local patterns

### Comparison with Binary Entropy
- **Binary Entropy**: Measures overall density distribution (0-1 bits)
- **Block Entropy**: Measures local spatial pattern diversity (0-7 bits)
- **Complementary Information**: Binary entropy shows global order, block entropy shows local complexity

## Testing

### Test File: `test_hex_block_entropy.js`
Includes test cases for:
- All zeros (entropy = 0)
- All ones (entropy = 0)
- Checkerboard patterns (higher entropy)
- Single active cells (low entropy)
- Random patterns (variable entropy)

### Expected Behaviors
1. **Uniform States**: All 0s or all 1s should yield entropy = 0
2. **Ordered Patterns**: Regular patterns should have low entropy
3. **Random Patterns**: Should have higher entropy values
4. **Maximum Entropy**: Theoretical maximum is 7.0 bits

## Configuration

### Entropy Sampling Settings
- **Enable/Disable**: Checkbox in analysis panel
- **Sample Rate**: Slider control (1-100 ticks)
- **Persistence**: Settings saved in browser storage

### Display Options
- **Entropy Type Selector**: Switch between binary and block entropy
- **Real-time Values**: Both entropy types displayed simultaneously
- **History Plots**: Separate plotting with appropriate scaling

## Future Enhancements

### Potential Improvements
1. **Multi-scale Analysis**: Different neighborhood sizes (7-cell, 19-cell, etc.)
2. **Pattern Analysis**: Identify and track specific pattern types
3. **Comparative Metrics**: Correlation analysis between binary and block entropy
4. **Performance Optimization**: WASM implementation for large grids

### Additional Metrics
- **Local Entropy Maps**: Spatial distribution of entropy
- **Temporal Entropy**: Rate of pattern change over time
- **Pattern Stability**: Persistence of specific configurations

## Technical Notes

### Hexagonal Grid Considerations
- **Neighbor Directions**: Different for odd/even columns due to hexagonal geometry
- **Boundary Conditions**: Toroidal wrapping for consistent neighborhood sizes
- **Pattern Encoding**: Consistent bit ordering for reproducible results

### Data Flow
1. **Worker Calculation**: Block entropy computed in WorldWorker
2. **Proxy Forwarding**: WorldProxy manages history and state
3. **UI Display**: EntropyPlotPlugin renders and controls
4. **Persistence**: Settings and preferences saved automatically

This implementation provides a powerful tool for analyzing the spatial complexity of hexagonal cellular automata, offering insights beyond simple density measurements. 