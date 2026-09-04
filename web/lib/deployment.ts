import type { Address } from 'viem'
import file from './deployment.json'

/**
 * Deployment coordinates. `scripts/sync-assets.mjs` copies the real values in after
 * `contracts/scripts/deploy.js` runs; the env override lets a preview deployment point
 * at a different vault without a rebuild. The JSON always exists so the app builds
 * before the contract is live.
 */
export const VAULT_ADDRESS = (process.env.NEXT_PUBLIC_VAULT_ADDRESS || file.folioVault || '') as Address

export const VAULT_DEPLOY_BLOCK = BigInt(
  process.env.NEXT_PUBLIC_VAULT_DEPLOY_BLOCK || file.deployedBlock || '0',
)

export const IS_DEPLOYED = Boolean(VAULT_ADDRESS)
