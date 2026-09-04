import { encodeFunctionData, keccak256, toHex, type Address, type Hex } from 'viem'
import { folioVaultAbi } from './vault-abi'
import { settlementCurrency, stock } from './assets'
import type { LegQuote, PurchasePlan } from './quote'

export { folioVaultAbi }

/** Filled in by scripts/sync-assets.mjs once the vault is deployed. */
export const VAULT_ADDRESS = (process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? '') as Address

export const ZERO_BYTES32 = `0x${'0'.repeat(64)}` as Hex
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

const ERC20_APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const

/**
 * `label` exists because a batch is one confirmation on a smart wallet but N separate
 * confirmations on an ordinary wallet. When we have to fall back, the user deserves to
 * know which step they are signing.
 */
export type Call = { to: Address; data: Hex; value?: bigint; label: string }

/** A claim link carries the secret in its fragment; only its hash ever goes onchain. */
export function newClaimSecret(): { secret: Hex; claimHash: Hex } {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const secret = `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex
  return { secret, claimHash: keccak256(secret) }
}

export function approveCall(token: Address, spender: Address, amount: bigint, label: string): Call {
  return {
    to: token,
    data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [spender, amount] }),
    label,
  }
}

export type FolioIntent = {
  name: string
  /** Recipient of the Folio NFT, or null to escrow behind a claim link. */
  to: Address | null
  unlockAt: number
  reclaimAfter: number
  claimHash: Hex
  policyHash: Hex
}

/**
 * Build the single batch that turns local currency into an owned, named basket.
 *
 * Coinbase Smart Wallet executes these atomically through EIP-5792, so the user taps
 * once and either gets the whole folio or nothing. The deposit uses each leg's
 * worst-case output, which is guaranteed to have arrived; any positive slippage stays
 * in the user's wallet rather than being stranded.
 */
export function buildPurchaseBatch(args: {
  plan: PurchasePlan
  swaps: { leg: LegQuote; routerAddress: Address; data: Hex }[]
  intent: FolioIntent
  vault?: Address
}): Call[] {
  const vault = args.vault ?? VAULT_ADDRESS
  if (!vault) throw new Error('Vault address is not configured')
  if (!args.swaps.length) throw new Error('Nothing to buy')

  const router = args.swaps[0].routerAddress
  if (args.swaps.some((s) => s.routerAddress.toLowerCase() !== router.toLowerCase())) {
    throw new Error('Legs routed through different routers; batch would need one approval each')
  }

  const totalIn = args.swaps.reduce((sum, s) => sum + BigInt(s.leg.amountInRaw), 0n)
  const calls: Call[] = [
    approveCall(args.plan.settlementToken, router, totalIn, `Allow ${args.plan.settlementSymbol} to be swapped`),
  ]

  for (const s of args.swaps) {
    calls.push({ to: s.routerAddress, data: s.data, label: `Buy ${s.leg.display}` })
  }

  const contributions = args.swaps.map((s) => ({
    token: s.leg.tokenOut,
    amount: BigInt(s.leg.minAmountOutRaw),
  }))

  for (const [i, c] of contributions.entries()) {
    calls.push(approveCall(c.token, vault, c.amount, `Allow ${args.swaps[i].leg.display} into the vault`))
  }

  calls.push({
    label: `Create "${args.intent.name}"`,
    to: vault,
    data: encodeFunctionData({
      abi: folioVaultAbi,
      functionName: 'createFolio',
      args: [
        args.intent.to ?? ZERO_ADDRESS,
        args.intent.name,
        BigInt(args.intent.unlockAt),
        BigInt(args.intent.reclaimAfter),
        args.intent.claimHash,
        args.intent.policyHash,
        contributions,
      ],
    }),
  })

  return calls
}

export function claimCall(folioId: bigint, secret: Hex, vault: Address = VAULT_ADDRESS): Call {
  return {
    to: vault,
    data: encodeFunctionData({ abi: folioVaultAbi, functionName: 'claim', args: [folioId, secret] }),
    label: 'Claim this folio',
  }
}

export function withdrawAllCall(folioId: bigint, to: Address, vault: Address = VAULT_ADDRESS): Call {
  return {
    to: vault,
    data: encodeFunctionData({ abi: folioVaultAbi, functionName: 'withdrawAll', args: [folioId, to] }),
    label: 'Withdraw everything',
  }
}

export function policyHashOf(policy: unknown): Hex {
  return keccak256(toHex(JSON.stringify(policy)))
}

export function unlockLabel(unlockAt: number) {
  if (!unlockAt) return null
  const d = new Date(unlockAt * 1000)
  const now = Date.now()
  if (d.getTime() <= now) return 'Unlocked'
  return `Unlocks ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
}
