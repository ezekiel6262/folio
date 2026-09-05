import 'server-only'
import { decodeFunctionData, getAddress, type Address, type Hex } from 'viem'
import raw from './base-assets.json'
import { STOCKS, CURRENCIES } from './assets'
import { VAULT_ADDRESS } from './deployment'

/**
 * Gas sponsorship.
 *
 * A person in São Paulo who holds BRZ and has never owned ETH cannot sign anything on
 * Base without first acquiring a second asset they have never heard of. That is the real
 * wallet-abstraction problem for this product, and a paymaster solves it: the app pays
 * the gas, the user pays nothing.
 *
 * The paymaster URL is a spending authority. If it leaks, anyone can drain the gas
 * budget sponsoring their own transactions, so it never reaches the browser. The client
 * talks to our own /api/paymaster, which forwards to the real service only after
 * checking that every contract the user operation touches is one of ours.
 */

/** Server-only. Set this to a CDP Paymaster URL to turn sponsorship on. */
export const PAYMASTER_URL = process.env.PAYMASTER_URL ?? ''
export const SPONSORSHIP_ENABLED = Boolean(PAYMASTER_URL)

/** The only RPC methods a paymaster proxy has any business forwarding. */
const ALLOWED_METHODS = new Set(['pm_getPaymasterStubData', 'pm_getPaymasterData'])

/**
 * Coinbase Smart Wallet wraps a batch in one of these two entrypoints, so decoding them
 * tells us exactly which contracts a user operation will call.
 */
const CALL_COMPONENTS = [
  { name: 'target', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'data', type: 'bytes' },
] as const

const SMART_WALLET_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'nonpayable',
    inputs: CALL_COMPONENTS,
    outputs: [],
  },
  {
    type: 'function',
    name: 'executeBatch',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'calls', type: 'tuple[]', components: CALL_COMPONENTS }],
    outputs: [],
  },
] as const

function buildAllowlist(): Set<string> {
  const entries: string[] = [
    ...STOCKS.map((s) => s.address),
    ...CURRENCIES.map((c) => c.address),
    ...Object.values(raw.routers ?? {}),
  ]
  if (VAULT_ADDRESS) entries.push(VAULT_ADDRESS)
  return new Set(entries.map((a) => a.toLowerCase()))
}

const ALLOWLIST = buildAllowlist()

export type PaymasterCheck = { ok: true; targets: Address[] } | { ok: false; reason: string }

/**
 * Decide whether we are willing to pay for this user operation.
 *
 * Undecodable calldata is rejected rather than waved through. Folio only ever produces
 * `execute` and `executeBatch`, so anything else is either not us or not something we
 * should be funding. Configure contract allowlisting in the CDP dashboard too - this is
 * the layer that fails closed, that one is the layer that survives a bug here.
 */
export function checkUserOperation(userOp: unknown): PaymasterCheck {
  const callData = (userOp as { callData?: Hex })?.callData
  if (!callData || typeof callData !== 'string' || !callData.startsWith('0x')) {
    return { ok: false, reason: 'user operation had no callData' }
  }

  let targets: Address[]
  try {
    const decoded = decodeFunctionData({ abi: SMART_WALLET_ABI, data: callData })
    // decodeFunctionData only matches the two entrypoints in SMART_WALLET_ABI; anything
    // else lands in the catch below.
    targets =
      decoded.functionName === 'execute'
        ? [decoded.args[0] as Address]
        : (decoded.args[0] as readonly { target: Address }[]).map((c) => c.target)
  } catch {
    return { ok: false, reason: 'callData is not an execute or executeBatch this app produced' }
  }

  if (!targets.length) return { ok: false, reason: 'user operation called nothing' }

  const strangers = targets.filter((t) => !ALLOWLIST.has(t.toLowerCase()))
  if (strangers.length) {
    return { ok: false, reason: `will not sponsor calls to ${strangers.map((s) => getAddress(s)).join(', ')}` }
  }

  return { ok: true, targets }
}

/**
 * Crude per-instance rate limit. Serverless means several instances and therefore a
 * softer ceiling than it looks, but it still blunts a script hammering one region, and
 * the allowlist above is what actually protects the budget.
 */
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 30
const hits = new Map<string, number[]>()

export function rateLimit(key: string): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent)
    return false
  }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 5_000) hits.clear()
  return true
}

export function isAllowedMethod(method: unknown): method is string {
  return typeof method === 'string' && ALLOWED_METHODS.has(method)
}
