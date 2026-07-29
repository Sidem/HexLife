// @ts-check

/**
 * Refuse artifacts that do not exactly match Explorer's frozen native-inference contract.
 * @param {Record<string, any>} manifest
 * @returns {Record<string, any>}
 */
export function validateNativeTrajectoryModelManifest(manifest) {
    if (manifest?.schema !== 'hexlife-interest-model-v1' ||
        manifest.trajectorySchema !== 'HXLT1' ||
        manifest.topology !== 'odd-q-torus-v1' ||
        manifest.preprocessing !== 'state-change-parity-v1') {
        throw new Error('incompatible native-model manifest');
    }
    if (manifest.acceptance?.status !== 'accepted') {
        throw new Error('native-model manifest has not passed acceptance');
    }
    if (!manifest.artifact || !manifest.artifactSha256) {
        throw new Error('native-model manifest is incomplete');
    }
    if (Number(manifest.outputs?.descriptor?.shape?.at(-1)) !== 32) {
        throw new Error('native-model descriptor contract must be 32-D');
    }
    return manifest;
}
