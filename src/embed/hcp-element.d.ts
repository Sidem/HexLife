import {
  BLOCK_PHASES,
  HexHcp,
  MAX_BLOCK_STATES,
  blockRuleFromTet,
  decodeHcpCode,
  encodeHcpCode,
  hcpEngineVersion,
  initHcpEngine,
  isConservative,
  isHcpCode,
  isIsotropic,
} from './hcp.js'

export const HCP_TAG_NAME: 'hexlife-hcp'

export declare class HexHcpElement extends HTMLElement {
  world: HexHcp | null
  play(): void
  pause(): void
  tick(count?: number): number
  reset(): void
  setRule(rule: ArrayLike<number>): boolean
  setCells(cells: ArrayLike<number>): boolean
  readonly generation: number
  readonly isSettled: boolean
  readonly playing: boolean
  readonly userPaused: boolean
}

export {
  BLOCK_PHASES,
  HexHcp,
  MAX_BLOCK_STATES,
  blockRuleFromTet,
  decodeHcpCode,
  encodeHcpCode,
  hcpEngineVersion,
  initHcpEngine,
  isConservative,
  isHcpCode,
  isIsotropic,
}
