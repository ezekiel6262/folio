import 'server-only'
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
} from '@solana/web3.js'
import { FEE_PAYER, stock } from './assets'
import { connection } from './market'
import {
  ata,
  createAtaIdempotentIx,
  createFolioIx,
  folioPda,
  newNonce,
  syncVaultIx,
  TOKEN_2022,
} from './folio-program'
import type { Leg } from './quote'

/**
 * Builds the purchase. Per company, in order:
 *   1. open the folio's vault for that stock (our fee payer funds it, only if missing)
 *   2. Jupiter swaps the user's stablecoin and pays the output straight into that vault
 *   3. sync_vault records what arrived and enforces the cap — or the whole thing reverts
 *
 * Folio creation goes in the same transaction when it fits, making the entire purchase
 * all-or-nothing. When three companies leave no room, creation is split into its own
 * transaction first. That split moves no money: if the purchase then fails, the user has
 * an empty folio they can close, never half-spent funds.
 *
 * Transactions come back unsigned. The browser signs only the user's slot; the co-signer
 * checks, adds the fee payer's signature and broadcasts.
 */

const JUPITER = ['https://lite-api.jup.ag/swap/v1', 'https://api.jup.ag/swap/v1']
export const MAX_TX_BYTES = 1232
/** Well under the co-signer's priority-fee cap. */
const CU_PRICE_MICROLAMPORTS = 20_000
const CU_PER_SYNC = 40_000
const CU_PER_VAULT = 30_000
const CU_CREATE_FOLIO = 35_000

const feePayer = new PublicKey(FEE_PAYER)

export type JupIx = { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }
export type SwapInstructions = {
  setupInstructions?: JupIx[]
  swapInstruction: JupIx
  cleanupInstruction?: JupIx | null
  addressLookupTableAddresses?: string[]
  computeUnitLimit?: number
}

export const toIx = (i: JupIx) =>
  new TransactionInstruction({
    programId: new PublicKey(i.programId),
    keys: i.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(i.data, 'base64'),
  })

/** Without a destination, the output goes to the user's own account for that token. */
export async function swapInstructions(
  quote: Leg['quote'],
  user: PublicKey,
  destination?: PublicKey,
  payer: string = FEE_PAYER,
): Promise<SwapInstructions> {
  const body = JSON.stringify({
    quoteResponse: quote,
    userPublicKey: user.toBase58(),
    // Our fee payer funds any account Jupiter opens (verified: it appears only as the
    // funder of an associated-token-account creation, never inside the swap itself).
    payer,
    ...(destination ? { destinationTokenAccount: destination.toBase58() } : {}),
    wrapAndUnwrapSol: false,
    dynamicComputeUnitLimit: true,
  })
  let last = 'swap-instructions failed'
  for (const base of JUPITER) {
    try {
      const res = await fetch(`${base}/swap-instructions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, cache: 'no-store' })
      const json = await res.json()
      if (res.ok && json?.swapInstruction) return json as SwapInstructions
      last = json?.error ?? `HTTP ${res.status}`
    } catch (e) {
      last = (e as Error).message
    }
  }
  throw new Error(last)
}

/**
 * With the output going to the vault, Jupiter still offers to open the buyer's own
 * account for the stock. It would never be used, and we would pay its deposit, so drop it.
 */
function isBuyersOutputAccount(i: JupIx, user: PublicKey, mint: string) {
  if (i.programId !== 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') return false
  const owner = i.accounts[2]?.pubkey
  const tokenMint = i.accounts[3]?.pubkey
  return owner === user.toBase58() && tokenMint === mint
}

export async function lookupTables(addresses: string[]): Promise<AddressLookupTableAccount[]> {
  const tables = await Promise.all(
    [...new Set(addresses)].map(async (a) => (await connection.getAddressLookupTable(new PublicKey(a))).value),
  )
  return tables.filter((t): t is AddressLookupTableAccount => Boolean(t))
}

export function compile(
  instructions: TransactionInstruction[],
  blockhash: string,
  tables: AddressLookupTableAccount[],
  payerKey: PublicKey = feePayer,
) {
  const message = new TransactionMessage({ payerKey, recentBlockhash: blockhash, instructions }).compileToV0Message(tables)
  const tx = new VersionedTransaction(message)
  let bytes: Uint8Array
  try {
    bytes = tx.serialize()
  } catch {
    // web3.js refuses to serialize past the packet limit; report it as too big instead.
    return { tx, size: Number.POSITIVE_INFINITY, base64: '' }
  }
  return { tx, size: bytes.length, base64: Buffer.from(bytes).toString('base64') }
}

export const budget = (units: number) => [
  ComputeBudgetProgram.setComputeUnitLimit({ units: Math.min(1_400_000, Math.ceil(units)) }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE_MICROLAMPORTS }),
]

export type NewFolio = {
  kind: 'new'
  name: string
  unlockAt: number
  reclaimAfter: number
  /** Public half of a claim link's key, generated in the browser. The secret never reaches us. */
  claimKey: string | null
  /** Give directly to this address; null with a claim key escrows it. Omit both to keep it. */
  recipient: string | null
  policyHashHex: string
}

export type BuiltPurchase = {
  /** Unsigned, base64, to be signed and co-signed in this order. */
  transactions: string[]
  sizes: number[]
  folio: string
  nonce: string | null
  atomic: boolean
  lastValidBlockHeight: number
}

export async function buildPurchase(args: {
  user: string
  legs: Leg[]
  folio: NewFolio | { kind: 'existing'; address: string }
  /**
   * The user's own wallet pays fees and deposits (Blinks: any wallet, no co-signer). Deposits
   * then refund to the user, since the folio records them as its rent payer.
   */
  selfPaid?: boolean
  /** Fix a new folio's nonce (and so its address) in advance. */
  nonce?: bigint
}): Promise<BuiltPurchase> {
  const user = new PublicKey(args.user)
  const payer = args.selfPaid ? user : feePayer

  let folio: PublicKey
  let nonce: bigint | null = null
  let createIx: TransactionInstruction | null = null
  if (args.folio.kind === 'new') {
    nonce = args.nonce ?? newNonce()
    folio = folioPda(user, nonce)
    const recipient =
      args.folio.recipient != null
        ? new PublicKey(args.folio.recipient)
        : args.folio.claimKey
          ? null
          : user // keeping it
    createIx = createFolioIx({
      creator: user,
      payer,
      nonce,
      name: args.folio.name,
      unlockAt: args.folio.unlockAt,
      reclaimAfter: args.folio.reclaimAfter,
      claimKey: args.folio.claimKey ? new PublicKey(args.folio.claimKey) : null,
      policyHash: Buffer.from(args.folio.policyHashHex, 'hex'),
      recipient,
    })
  } else {
    folio = new PublicKey(args.folio.address)
  }

  const purchase: TransactionInstruction[] = []
  const tableAddresses: string[] = []
  let units = 0

  for (const leg of args.legs) {
    const s = stock(leg.symbol)
    const mint = new PublicKey(s.mint)
    const vault = ata(folio, mint, TOKEN_2022)
    const jup = await swapInstructions(leg.quote, user, vault, payer.toBase58())

    purchase.push(createAtaIdempotentIx({ payer, owner: folio, mint, tokenProgram: TOKEN_2022 }))
    for (const setup of jup.setupInstructions ?? []) {
      if (!isBuyersOutputAccount(setup, user, s.mint)) purchase.push(toIx(setup))
    }
    purchase.push(toIx(jup.swapInstruction))
    if (jup.cleanupInstruction) purchase.push(toIx(jup.cleanupInstruction))
    purchase.push(syncVaultIx({ folio, mint }))

    tableAddresses.push(...(jup.addressLookupTableAddresses ?? []))
    units += (jup.computeUnitLimit ?? 300_000) + CU_PER_SYNC + CU_PER_VAULT
  }

  const [tables, latest] = await Promise.all([lookupTables(tableAddresses), connection.getLatestBlockhash('confirmed')])

  // Prefer one transaction: creation and purchase together, all or nothing.
  if (createIx) {
    const single = compile([...budget(units + CU_CREATE_FOLIO + 20_000), createIx, ...purchase], latest.blockhash, tables, payer)
    if (single.size <= MAX_TX_BYTES) {
      return {
        transactions: [single.base64],
        sizes: [single.size],
        folio: folio.toBase58(),
        nonce: nonce?.toString() ?? null,
        atomic: true,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      }
    }
  }

  const buy = compile([...budget(units + 20_000), ...purchase], latest.blockhash, tables, payer)
  if (buy.size > MAX_TX_BYTES) {
    throw new Error(
      Number.isFinite(buy.size)
        ? `This basket needs ${buy.size} bytes and one transaction holds ${MAX_TX_BYTES}. Try fewer companies.`
        : 'These trading routes are too large for one transaction right now. Try fewer companies.',
    )
  }
  const transactions = [buy.base64]
  const sizes = [buy.size]
  if (createIx) {
    const create = compile([...budget(CU_CREATE_FOLIO + 10_000), createIx], latest.blockhash, [], payer)
    transactions.unshift(create.base64)
    sizes.unshift(create.size)
  }

  return {
    transactions,
    sizes,
    folio: folio.toBase58(),
    nonce: nonce?.toString() ?? null,
    // The money-moving transaction is still all-or-nothing; only the empty folio is separate.
    atomic: transactions.length === 1,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  }
}
