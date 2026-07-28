/**
 * Build the independent flat-camera state for every world.
 *
 * A zoom of 1 is the fitted whole-grid view. A share link may override only the selected world's
 * camera; the other worlds still start fitted so selecting one never reveals an inherited zoom.
 *
 * @param {number} numWorlds
 * @param {{x: number, y: number}} gridCenter
 * @param {number} selectedWorldIndex
 * @param {{x: number, y: number, zoom: number}|undefined} sharedCamera
 * @returns {{x: number, y: number, zoom: number}[]}
 */
export function createInitialCameraStates(numWorlds, gridCenter, selectedWorldIndex, sharedCamera) {
    return Array.from({ length: numWorlds }, (_, index) => {
        if (sharedCamera && index === selectedWorldIndex) return sharedCamera;
        return {
            x: gridCenter.x,
            y: gridCenter.y,
            zoom: 1.0,
        };
    });
}
