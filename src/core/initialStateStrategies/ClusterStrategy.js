import { BaseStateStrategy } from './BaseStateStrategy.js';

function isOverlapping(x, y, diameter, otherClusters, config) {
    const numCols = config.GRID_COLS;
    const numRows = config.GRID_ROWS;
    for (const other of otherClusters) {
        const dx = Math.abs(x - other.x);
        const dy = Math.abs(y - other.y);
        
        // Toroidal distance check
        const toroidalDx = Math.min(dx, numCols - dx);
        const toroidalDy = Math.min(dy, numRows - dy);

        const distSq = toroidalDx * toroidalDx + toroidalDy * toroidalDy;
        const requiredDist = (diameter / 2) + (other.diameter / 2);
        if (distSq < requiredDist * requiredDist) {
            return true;
        }
    }
    return false;
}

export class ClusterStrategy extends BaseStateStrategy {
    generate(stateArray, params, rng, config) {
        stateArray.fill(0);
        const { count, density, densityVariation, diameter, diameterVariation, eccentricity, orientation, orientationVariation, gaussianStdDev } = params;
        const numCols = config.GRID_COLS;
        const numRows = config.GRID_ROWS;
        
        const placedClusters = [];

        for (let i = 0; i < count; i++) {
            let attempts = 0;
            let clusterX, clusterY, effectiveDiameter;
            
            do {
                clusterX = rng() * numCols;
                clusterY = rng() * numRows;
                effectiveDiameter = diameter + (rng() * 2 - 1) * diameterVariation;
                attempts++;
                if (attempts > 50) break;
            } while (isOverlapping(clusterX, clusterY, effectiveDiameter, placedClusters, config));
            
            placedClusters.push({ x: clusterX, y: clusterY, diameter: effectiveDiameter });

            const angle = (orientation + (rng() * 2 - 1) * orientationVariation * 180) * Math.PI / 180;
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);

            const majorAxis = effectiveDiameter / 2;
            const minorAxis = majorAxis * (1 - eccentricity);

            // For gaussian distribution, expand search radius to capture tail
            const searchRadius = Math.ceil(majorAxis * 2);
                
            for (let rOffset = -searchRadius; rOffset <= searchRadius; rOffset++) {
                for (let cOffset = -searchRadius; cOffset <= searchRadius; cOffset++) {
                    const c = Math.round(clusterX + cOffset);
                    const r = Math.round(clusterY + rOffset);

                    // Toroidal wrapping for distance calculation
                    const dx = (c - clusterX + numCols / 2 + numCols) % numCols - numCols / 2;
                    const dy = (r - clusterY + numRows / 2 + numRows) % numRows - numRows / 2;

                    const rotX = dx * cosA + dy * sinA;
                    const rotY = dy * cosA - dx * sinA;
                    
                    const normalizedDist = Math.sqrt(Math.pow(rotX / majorAxis, 2) + Math.pow(rotY / minorAxis, 2));

                    const effectiveDensity = density + (rng() * 2 - 1) * densityVariation;
                    let probability = Math.max(0, Math.min(1, effectiveDensity));


                    const stdDev = effectiveDiameter / (gaussianStdDev * 2);
                    const distance = normalizedDist * majorAxis; // Actual distance from center
                    probability *= Math.exp(-0.5 * Math.pow(distance / stdDev, 2));

                    
                    if (probability > 0 && rng() < probability) {
                        const wrappedC = (c + numCols) % numCols;
                        const wrappedR = (r + numRows) % numRows;
                        const idx = wrappedR * numCols + wrappedC;
                        stateArray[idx] = 1;
                    }
                }
            }
        }
    }
} 