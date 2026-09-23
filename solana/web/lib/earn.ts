import 'server-only'
import { PublicKey, TransactionInstruction, VersionedTransaction } from '@solana/web3.js'
import { FEE_PAYER, PROGRAMS, STABLECOINS, STABLE_BY_MINT, stablecoin } from './assets'
import { budget, compile, lookupTables } from './buy'
import { connection } from './market'

/**
 * Earning on idle cash, without leaving Folio.
 *
 * Money that is waiting to be invested sits still. Jupiter Lend pays on it, and Folio
 * simply borrows the plumbing: their API builds the deposit or withdrawal, we take the
 * instructions out, put our fee payer in front so the user needs no SOL, and hand it to
 * the user to sign. The deposit receipt (a jl-token) stays in the user's own wallet, so
 * the position is theirs even if Folio disappears.
 */

const LEND = 'https://lite-api.jup.ag/lend/v1'
const TTL_MS = 60_000

export type EarnToken = {
  symbol: string
  /** The stablecoin being lent. */
  mint: string
  decimals: number
  /** Annual rate, percent. */
  apy: number
  /** Deposit-receipt token held in the user's wallet. */
  receiptMint: string
  receiptSymbol: string
  liquidityUsd: number
}

export type EarnPosition = { symbol: string; receiptMint: string; units: number; usd: number; apy: number }

let cache: { at: number; value: EarnToken[] } | null = null

/** Only the stablecoins Folio already accepts, so nothing new appears out of nowhere. */
export async function earnTokens(): Promise<EarnToken[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  const res = await fetch(`${LEND}/earn/tokens`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
  if (!res.ok) throw new Error('Jupiter Lend is unavailable right now')
  const list = (await res.json()) as {
    address: string
    symbol: string
    decimals: number
    totalRate?: number
    totalAssets?: string
    asset: { address: string; symbol: string; decimals: number }
  }[]
  const ours = new Set(STABLECOINS.map((s) => s.mint))
  const value = list
    .filter((t) => ours.has(t.asset.address))
    .map((t) => ({
      symbol: STABLE_BY_MINT.get(t.asset.address)?.symbol ?? t.asset.symbol,
      mint: t.asset.address,
      decimals: t.asset.decimals,
      // Jupiter quotes the rate in basis points.
      apy: Number(t.totalRate ?? 0) / 100,
      receiptMint: t.address,
      receiptSymbol: t.symbol,
      liquidityUsd: Number(t.totalAssets ?? 0) / 10 ** t.asset.decimals,
    }))
    .sort((a, b) => b.apy - a.apy)
  cache = { at: Date.now(), value }
  return value
}

export async function earnPositions(owner: string): Promise<EarnPosition[]> {
  const [res, tokens] = await Promise.all([
    fetch(`${LEND}/earn/positions?users=${owner}`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) }),
    earnTokens(),
  ])
  if (!res.ok) return []
  const rows = (await res.json()) as { token: { address: string; assetAddress: string; decimals: number }; underlyingAssets?: string; shares?: string }[]
  return rows
    .map((r) => {
      const t = tokens.find((x) => x.receiptMint === r.token.address)
      if (!t) return null
      const units = Number(r.underlyingAssets ?? 0) / 10 ** t.decimals
      return units > 0.000001 ? { symbol: t.symbol, receiptMint: t.receiptMint, units, usd: units, apy: t.apy } : null
    })
    .filter((x): x is EarnPosition => Boolean(x))
}

/**
 * Jupiter builds the transaction with the user paying. We keep the instructions and
 * rebuild it with Folio's fee payer in front — including any account it opens, which
 * Folio funds rather than a user who holds no SOL.
 */
async function rebuild(endpoint: 'deposit' | 'withdraw', body: Record<string, unknown>, owner: PublicKey) {
  const res = await fetch(`${LEND}/earn/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const json = (await res.json()) as { transaction?: string; error?: string; message?: string }
  if (!json.transaction) throw new Error(json.error ?? json.message ?? 'Jupiter Lend could not build that')

  const source = VersionedTransaction.deserialize(Buffer.from(json.transaction, 'base64'))
  const tables = await lookupTables(source.message.addressTableLookups.map((l) => l.accountKey.toBase58()))
  const keys = source.message.getAccountKeys({ addressLookupTableAccounts: tables })
  const feePayer = new PublicKey(FEE_PAYER)

  const instructions: TransactionInstruction[] = []
  let units = 0
  for (const ix of source.message.compiledInstructions) {
    const programId = keys.get(ix.programIdIndex)!
    const program = programId.toBase58()
    // Jupiter's own compute budget is replaced by ours, which the co-signer checks.
    if (program === PROGRAMS.computeBudget) {
      if (ix.data[0] === 2) units = Buffer.from(ix.data).readUInt32LE(1)
      continue
    }
    instructions.push(
      new TransactionInstruction({
        programId,
        keys: ix.accountKeyIndexes.map((i, position) => {
          const pubkey = keys.get(i)!
          // An account opened at the user's expense would fail: they hold no SOL.
          const funder = program === PROGRAMS.associatedToken && position === 0 && pubkey.equals(owner)
          return {
            pubkey: funder ? feePayer : pubkey,
            isSigner: source.message.isAccountSigner(i) || funder,
            isWritable: source.message.isAccountWritable(i),
          }
        }),
        data: Buffer.from(ix.data),
      }),
    )
  }

  const latest = await connection.getLatestBlockhash('confirmed')
  const built = compile([...budget(units || 400_000), ...instructions], latest.blockhash, tables)
  return { transaction: built.base64, lastValidBlockHeight: latest.lastValidBlockHeight }
}

const toRaw = (amount: number, decimals: number) => {
  const [whole, frac = ''] = amount.toFixed(decimals).split('.')
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals)).toString()
}

export async function buildEarnDeposit(a: { owner: string; symbol: string; amount: number }) {
  const coin = stablecoin(a.symbol)
  const tokens = await earnTokens()
  const t = tokens.find((x) => x.mint === coin.mint)
  if (!t) throw new Error(`${coin.symbol} cannot earn yet`)
  if (!(a.amount > 0)) throw new Error('Enter an amount')
  const owner = new PublicKey(a.owner)
  const out = await rebuild('deposit', { asset: coin.mint, signer: a.owner, amount: toRaw(a.amount, coin.decimals) }, owner)
  return { ...out, preview: { symbol: coin.symbol, amount: a.amount, apy: t.apy } }
}

export async function buildEarnWithdraw(a: { owner: string; symbol: string; amount: number }) {
  const coin = stablecoin(a.symbol)
  const tokens = await earnTokens()
  const t = tokens.find((x) => x.mint === coin.mint)
  if (!t) throw new Error(`${coin.symbol} is not earning`)
  if (!(a.amount > 0)) throw new Error('Enter an amount')
  const owner = new PublicKey(a.owner)
  const out = await rebuild('withdraw', { asset: coin.mint, signer: a.owner, amount: toRaw(a.amount, coin.decimals) }, owner)
  return { ...out, preview: { symbol: coin.symbol, amount: a.amount, apy: t.apy } }
}
