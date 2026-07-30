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
    // A beta is permitted for clearly-labelled ranking without claiming strict Corpus-v1 acceptance.
    if (!['accepted', 'beta', 'testing'].includes(manifest.acceptance?.status)) {
        throw new Error('native-model manifest has not passed acceptance');
    }
    if (!manifest.artifact || !manifest.artifactSha256) {
        throw new Error('native-model manifest is incomplete');
    }
    if (Number(manifest.outputs?.descriptor?.shape?.at(-1)) !== 32) {
        throw new Error('native-model descriptor contract must be 32-D');
    }
    if (manifest.acceptance?.status === 'beta') validateRewardCalibration(manifest.rewardCalibration);
    return manifest;
}

/** @param {Record<string, any>} calibration */
export function validateRewardCalibration(calibration) {
    if (calibration?.status !== 'calibrated' || calibration.method !== 'reference-quantile-v1') {
        throw new Error('native beta reward is not calibrated');
    }
    const utilities = calibration.utilities;
    const percentiles = calibration.percentiles;
    if (!Array.isArray(utilities) || utilities.length < 2 || utilities.length !== percentiles?.length) {
        throw new Error('native beta reward calibration is invalid');
    }
    for (let i = 0; i < utilities.length; i++) {
        if (!Number.isFinite(utilities[i]) || !Number.isFinite(percentiles[i])) {
            throw new Error('native beta reward calibration is invalid');
        }
        if (i > 0 && (utilities[i] <= utilities[i - 1] || percentiles[i] < percentiles[i - 1])) {
            throw new Error('native beta reward calibration is not monotonic');
        }
    }
    return calibration;
}

/**
 * Map arbitrary Bradley-Terry utility onto the frozen reference-corpus percentile stored in the
 * manifest. Accepted legacy artifacts without calibration retain their raw reward.
 * @param {number} utility
 * @param {Record<string, any>|null|undefined} calibration
 */
export function calibrateNativeReward(utility, calibration) {
    if (!calibration || calibration.status !== 'calibrated') return utility;
    validateRewardCalibration(calibration);
    const xs = calibration.utilities;
    const ys = calibration.percentiles;
    if (utility <= xs[0]) return 0;
    const last = xs.length - 1;
    if (utility >= xs[last]) return 1;
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (utility < xs[mid]) hi = mid;
        else lo = mid;
    }
    const span = xs[hi] - xs[lo];
    return ys[lo] + ((utility - xs[lo]) / span) * (ys[hi] - ys[lo]);
}
