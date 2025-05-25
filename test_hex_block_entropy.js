// Test file for hexagonal block entropy calculation
// This file tests the calculateHexBlockEntropy function with a small grid

// Neighbor directions for hexagonal grid (from config.js)
const NEIGHBOR_DIRS_ODD_R = [ 
    [-1, +1],  // SW
    [-1, 0],   // NW
    [0, -1],   // N
    [+1, 0],   // NE
    [+1, +1],  // SE
    [0, +1]    // S
];

const NEIGHBOR_DIRS_EVEN_R = [ 
    [-1, 0],   // SW
    [-1, -1],  // NW
    [0, -1],   // N
    [+1, -1],  // NE
    [+1, 0],   // SE
    [0, +1]    // S
];

/**
 * Calculates the block entropy for 7-cell hexagonal patterns.
 * A block consists of a center cell and its 6 immediate neighbors.
 * The pattern is a 7-bit number (0-127).
 */
function calculateHexBlockEntropy(currentStateArray, config, N_DIRS_ODD, N_DIRS_EVEN) {
    if (!currentStateArray || !config || !config.NUM_CELLS || config.NUM_CELLS === 0) {
        return 0;
    }

    const blockCounts = new Map();
    let totalBlocks = 0;
    const numCols = config.GRID_COLS;
    const numRows = config.GRID_ROWS;

    for (let i = 0; i < config.NUM_CELLS; i++) {
        totalBlocks++;
        const cCol = i % numCols;
        const cRow = Math.floor(i / numCols);
        const cState = currentStateArray[i];

        let neighborMask = 0;
        const dirs = (cCol % 2 !== 0) ? N_DIRS_ODD : N_DIRS_EVEN;

        for (let nOrder = 0; nOrder < 6; nOrder++) {
            const nCol = (cCol + dirs[nOrder][0] + numCols) % numCols;
            const nRow = (cRow + dirs[nOrder][1] + numRows) % numRows;
            if (currentStateArray[nRow * numCols + nCol] === 1) {
                neighborMask |= (1 << nOrder);
            }
        }

        const blockPattern = (cState << 6) | neighborMask; // 7-bit pattern
        blockCounts.set(blockPattern, (blockCounts.get(blockPattern) || 0) + 1);
    }

    if (totalBlocks === 0) {
        return 0;
    }

    let entropy = 0;
    for (const count of blockCounts.values()) {
        const probability = count / totalBlocks;
        if (probability > 0) {
            entropy -= probability * Math.log2(probability);
        }
    }

    return entropy;
}

// Test cases
function runTests() {
    console.log("Testing Hexagonal Block Entropy Calculation");
    console.log("===========================================");

    // Test 1: All zeros (should have entropy = 0, only pattern 0 exists)
    console.log("\nTest 1: All zeros");
    const config1 = { GRID_ROWS: 3, GRID_COLS: 3, NUM_CELLS: 9 };
    const state1 = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const entropy1 = calculateHexBlockEntropy(state1, config1, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
    console.log(`State: [${Array.from(state1).join(', ')}]`);
    console.log(`Entropy: ${entropy1.toFixed(4)} (expected: 0.0000)`);

    // Test 2: All ones (should have entropy = 0, only pattern 127 exists)
    console.log("\nTest 2: All ones");
    const config2 = { GRID_ROWS: 3, GRID_COLS: 3, NUM_CELLS: 9 };
    const state2 = new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const entropy2 = calculateHexBlockEntropy(state2, config2, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
    console.log(`State: [${Array.from(state2).join(', ')}]`);
    console.log(`Entropy: ${entropy2.toFixed(4)} (expected: 0.0000)`);

    // Test 3: Checkerboard pattern (should have higher entropy)
    console.log("\nTest 3: Checkerboard pattern");
    const config3 = { GRID_ROWS: 3, GRID_COLS: 3, NUM_CELLS: 9 };
    const state3 = new Uint8Array([1, 0, 1, 0, 1, 0, 1, 0, 1]);
    const entropy3 = calculateHexBlockEntropy(state3, config3, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
    console.log(`State: [${Array.from(state3).join(', ')}]`);
    console.log(`Entropy: ${entropy3.toFixed(4)}`);

    // Test 4: Single active cell in center
    console.log("\nTest 4: Single active cell in center");
    const config4 = { GRID_ROWS: 3, GRID_COLS: 3, NUM_CELLS: 9 };
    const state4 = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const entropy4 = calculateHexBlockEntropy(state4, config4, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
    console.log(`State: [${Array.from(state4).join(', ')}]`);
    console.log(`Entropy: ${entropy4.toFixed(4)}`);

    // Test 5: Random pattern
    console.log("\nTest 5: Random pattern");
    const config5 = { GRID_ROWS: 4, GRID_COLS: 4, NUM_CELLS: 16 };
    const state5 = new Uint8Array([1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0]);
    const entropy5 = calculateHexBlockEntropy(state5, config5, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
    console.log(`State: [${Array.from(state5).join(', ')}]`);
    console.log(`Entropy: ${entropy5.toFixed(4)}`);

    console.log("\nTests completed!");
    console.log("Note: Maximum possible entropy is log2(128) = 7.0 bits");
    console.log("Higher entropy indicates more diverse 7-cell hexagonal patterns");
}

// Run the tests
if (typeof module !== 'undefined' && module.exports) {
    // Node.js environment
    module.exports = { calculateHexBlockEntropy, runTests };
} else {
    // Browser environment
    runTests();
} 