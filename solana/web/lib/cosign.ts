import 'server-only'
import { createHash } from 'node:crypto'
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type MessageCompiledInstruction,
} from '@solana/web3.js'
import assets from './solana-assets.json'

/**
 * The co-signer.
 *
 * Folio pays every network fee and account deposit so a user with zero SOL can still
 * buy, sell and give. That means our fee-payer key signs transactions that users build.
 * Anything it signs, it pays for — so this is the one place where a bug costs money
 * directly, and it is written to fail closed.
 *
 * The rules, in the order they run:
 *   1. The fee payer must be ours, and every other required signer must already have
 *      signed. We never sign something the user has not.
 *   2. Every top-level instruction must belong to an allowlisted program. The System
 *      program is deliberately absent: a top-level transfer is the one instruction that
 *      could move our SOL directly.
 *   3. No authority may be reassigned, and a token account may be closed only when its
 *      deposit comes back to us. Closing refunds a deposit to whoever the caller names —
 *      the "open at our expense, close for profit" drain Privy's docs warn about.
 *   4. Our fee payer may appear only as the fee payer, as the funder of an associated
 *      token account, as the `payer` of our own program's account-creating instructions,
 *      or as the recipient of a refund.
 *   5. Priority fees are capped. Account creations per transaction are capped.
 *   6. Finally, simulate. Whatever the instructions are, refuse unless the fee payer's
 *      balance drops by no more than a fixed ceiling. This is the invariant that still
 *      holds if every rule above has a hole in it.
 */

const P = assets.programs
const FEE_PAYER = new PublicKey(assets.keys.feePayer)

const ALLOWED_PROGRAMS = new Set([
  P.computeBudget,
  P.jupiterV6,
  P.folioVault,
  P.token,
  P.token2022,
  P.associatedToken,
  // Jupiter Lend: earning on idle stablecoins, sponsored like everything else.
  P.jupiterLend,
  // Kamino: posting a folio's shares as collateral and borrowing against them.
  P.kaminoLend,
])

/** Most a single sponsored transaction may cost us: fee + a folio + three vaults + a few user token accounts. */
export const MAX_SPONSOR_SPEND_LAMPORTS = 25_000_000 // 0.025 SOL
const MAX_PRIORITY_FEE_LAMPORTS = 200_000 // 0.0002 SOL
const MAX_ACCOUNT_CREATIONS = 6
const DEFAULT_CU_LIMIT = 1_400_000

// SPL Token / Token-2022 instruction tags that must never be sponsored.
const TOKEN_SET_AUTHORITY = 6
const TOKEN_CLOSE_ACCOUNT = 9

// Compute Budget instruction tags.
const CB_SET_LIMIT = 2
const CB_SET_PRICE = 3

const anchorDisc = (name: string) =>
  createHash('sha256').update(`global:${name}`).digest().subarray(0, 8).toString('hex')

/** Our instructions whose accounts list has a `payer` that may be the fee payer, and where. */
const PAYER_POSITION: Record<string, number> = {
  [anchorDisc('create_folio')]: 3, // config, folio, creator, payer
  [anchorDisc('deposit')]: 7, // config, folio, asset, mint, depositor_token, vault, depositor, payer
}

/**
 * Our instructions that refund an account deposit, and where the refund lands. The
 * program only pays it to the folio's recorded `rent_payer`, so the fee payer here is
 * receiving, never spending.
 */
const REFUND_POSITION: Record<string, number> = {
  [anchorDisc('close_vault')]: 3, // folio, mint, vault, rent_payer
  [anchorDisc('close_folio')]: 1, // folio, rent_payer
}

/** Admin instructions are never sponsored, whoever signs them. */
const ADMIN_DISCS = new Set(['initialize', 'set_asset', 'set_paused'].map(anchorDisc))

export type CosignVerdict =
  | { ok: true; signature: string; sponsorSpendLamports: number }
  | { ok: false; reason: string; logs?: string[] }

type Deps = {
  connection: Connection
  feePayer: Keypair
  /** The signed-in user's Solana wallets. At least one must sign, so fees are only paid for Folio users. */
  userWallets?: string[]
}

export function loadFeePayer(secret: string | undefined): Keypair {
  if (!secret) throw new Error('FOLIO_FEE_PAYER_SECRET is not set')
  const bytes = Uint8Array.from(JSON.parse(secret))
  const kp = Keypair.fromSecretKey(bytes)
  if (!kp.publicKey.equals(FEE_PAYER)) throw new Error('Fee payer secret does not match the address book')
  return kp
}

function reject(reason: string, logs?: string[]): CosignVerdict {
  return { ok: false, reason, logs }
}

async function lookupTables(connection: Connection, tx: VersionedTransaction): Promise<AddressLookupTableAccount[]> {
  const tables: AddressLookupTableAccount[] = []
  for (const lookup of tx.message.addressTableLookups) {
    const res = await connection.getAddressLookupTable(lookup.accountKey)
    if (!res.value) throw new Error(`Unknown lookup table ${lookup.accountKey.toBase58()}`)
    tables.push(res.value)
  }
  return tables
}

/** Inspect without signing. Exported separately so the rules can be tested offline. */
export function inspect(
  tx: VersionedTransaction,
  tables: AddressLookupTableAccount[],
  userWallets?: string[],
): { ok: true } | { ok: false; reason: string } {
  const message = tx.message
  const keys = message.getAccountKeys({ addressLookupTableAccounts: tables })

  // 1. Fee payer and signatures.
  if (!keys.get(0)?.equals(FEE_PAYER)) return { ok: false, reason: 'fee payer is not Folio' }
  const required = message.header.numRequiredSignatures
  for (let i = 1; i < required; i++) {
    if (tx.signatures[i].every((b) => b === 0)) {
      return { ok: false, reason: `signer ${keys.get(i)?.toBase58()} has not signed` }
    }
  }
  if (userWallets) {
    const signers = Array.from({ length: required - 1 }, (_, i) => keys.get(i + 1)?.toBase58())
    if (!signers.some((k) => k && userWallets.includes(k))) {
      return { ok: false, reason: 'not signed by the signed-in account' }
    }
  }

  let accountCreations = 0
  let cuLimit = DEFAULT_CU_LIMIT
  let cuPrice = 0

  message.compiledInstructions.forEach((ix: MessageCompiledInstruction) => {
    // Throwing from inside forEach is caught below and turned into a rejection.
    const program = keys.get(ix.programIdIndex)?.toBase58() ?? ''
    const data = Buffer.from(ix.data)
    const accounts = ix.accountKeyIndexes.map((i) => keys.get(i)!)

    // 2. Program allowlist.
    if (!ALLOWED_PROGRAMS.has(program)) throw new Error(`program ${program} is not allowed`)

    // 3. Token programs: no authority changes, and a close only when its deposit comes
    //    back to us (accounts: account, destination, owner).
    const isToken = program === P.token || program === P.token2022
    const refundsUs = isToken && data[0] === TOKEN_CLOSE_ACCOUNT && Boolean(accounts[1]?.equals(FEE_PAYER))
    if (isToken) {
      if (data[0] === TOKEN_CLOSE_ACCOUNT && !refundsUs) throw new Error('closing a token account is sponsored only when it refunds Folio')
      if (data[0] === TOKEN_SET_AUTHORITY) throw new Error('changing a token authority is never sponsored')
    }

    // 5a. Compute budget.
    if (program === P.computeBudget) {
      if (data[0] === CB_SET_LIMIT) cuLimit = data.readUInt32LE(1)
      if (data[0] === CB_SET_PRICE) cuPrice = Number(data.readBigUInt64LE(1))
    }

    if (program === P.associatedToken) accountCreations++

    // Admin instructions are never ours to pay for.
    if (program === P.folioVault && ADMIN_DISCS.has(data.subarray(0, 8).toString('hex'))) {
      throw new Error('admin instructions are never sponsored')
    }

    // 4. Where may our fee payer appear?
    accounts.forEach((account, position) => {
      if (!account.equals(FEE_PAYER)) return
      const asAtaFunder = program === P.associatedToken && position === 0
      const d = data.subarray(0, 8).toString('hex')
      const asFolioPayer = program === P.folioVault && PAYER_POSITION[d] === position
      const asRefunded = (program === P.folioVault && REFUND_POSITION[d] === position) || (refundsUs && position === 1)
      if (!asAtaFunder && !asFolioPayer && !asRefunded) {
        throw new Error(`fee payer used as account ${position} of ${program}`)
      }
      if (asFolioPayer) accountCreations++
    })
  })

  // 5b. Caps.
  const priorityLamports = Math.ceil((cuPrice * cuLimit) / 1_000_000)
  if (priorityLamports > MAX_PRIORITY_FEE_LAMPORTS) {
    return { ok: false, reason: `priority fee ${priorityLamports} lamports is over the cap` }
  }
  if (accountCreations > MAX_ACCOUNT_CREATIONS) {
    return { ok: false, reason: `${accountCreations} account creations is over the cap` }
  }
  return { ok: true }
}

/** Check, simulate, sign and send. Returns the signature only if every rule held. */
export async function cosignAndSend(serializedBase64: string, { connection, feePayer, userWallets }: Deps): Promise<CosignVerdict> {
  let tx: VersionedTransaction
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(serializedBase64, 'base64'))
  } catch {
    return reject('not a versioned transaction')
  }

  let tables: AddressLookupTableAccount[]
  try {
    tables = await lookupTables(connection, tx)
    const verdict = inspect(tx, tables, userWallets)
    if (!verdict.ok) return reject(verdict.reason)
  } catch (e) {
    return reject((e as Error).message)
  }

  // 6. The invariant: simulate and measure what it would cost us.
  const before = await connection.getBalance(FEE_PAYER, 'confirmed')
  const sim = await connection.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: false,
    commitment: 'confirmed',
    accounts: { addresses: [FEE_PAYER.toBase58()], encoding: 'base64' },
  })
  if (sim.value.err) return reject(`simulation failed: ${JSON.stringify(sim.value.err)}`, sim.value.logs ?? undefined)
  const after = sim.value.accounts?.[0]?.lamports
  if (typeof after !== 'number') return reject('simulation did not report the fee payer balance')
  const spend = before - after
  if (spend > MAX_SPONSOR_SPEND_LAMPORTS) {
    return reject(`this would cost the sponsor ${spend} lamports, over the ${MAX_SPONSOR_SPEND_LAMPORTS} ceiling`)
  }

  tx.sign([feePayer])
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 })
  return { ok: true, signature, sponsorSpendLamports: Math.max(0, spend) }
}

// Per-instance rate limit. Serverless means several instances and a softer ceiling than
// it looks; the spend ceiling above is what actually bounds the damage.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 12
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
