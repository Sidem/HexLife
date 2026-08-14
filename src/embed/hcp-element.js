/**
 * `@hexlife/embed/hcp-element` — importing this module registers `<hexlife-hcp>`.
 *
 * Separate from `/hcp` because that entry is DOM-free and outside `sideEffects`. Separate from
 * every other element entry so a page that never asks for HCP fetches zero HCP bytes.
 */

import {HexHcpElement} from './HexHcpElement.js';

export const HCP_TAG_NAME = 'hexlife-hcp';

if (typeof customElements !== 'undefined' && !customElements.get(HCP_TAG_NAME)) {
    customElements.define(HCP_TAG_NAME, HexHcpElement);
}

export {HexHcpElement};
export {
    BLOCK_PHASES,
    HexHcp,
    blockRuleFromTet,
    decodeHcpCode,
    encodeHcpCode,
    hcpEngineVersion,
    initHcpEngine,
    isConservative,
    isHcpCode,
    isIsotropic,
    MAX_BLOCK_STATES,
} from './hcp.js';
