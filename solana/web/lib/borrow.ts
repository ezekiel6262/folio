import 'server-only'
import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { createSolanaRpc, none } from '@solana/kit'
import { KaminoAction, KaminoMarket, PROGRAM_ID as KLEND_PROGRAM, VanillaObligation } from '@kamino-finance/klend-sdk'
import { FEE_PAYER, STABLE_BY_MINT, STOCK_BY_MINT, stablecoin, stock, toShares } from './assets'
import { budget, compile, MAX_TX_BYTES } from './buy'
import { ata, createAtaIdempotentIx, TOKEN_2022, withdrawIx } from './folio-program'
import { readFolio } from './folio-reader'
import { connection, getMarket, RPC_URL } from './market'
import { lendingTerms } from './lending'
import { transferFee } from './transfer-fee'

/**
 * Cash without selling.
 *
 * A folio's shares can back a loan on Kamino's xStocks market: the shares leave the vault
 * into the owner's own account, are posted as collateral, and USDC comes back. The owner
 * keeps the upside and the position is theirs on-chain — Folio is not the lender and
 * cannot touch it. Everything a borrower needs to understand is one number: the price at
 * which the shares start being sold to repay.
 */

export const KAMINO_MARKET = '5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua'
export const KAMINO_PROGRAM = String(KLEND_PROGRAM)

const SLOT_MS = 450
const TTL_MS = 60_000
let cached: { at: number; market: KaminoMarket } | null = null

async function market(): Promise<KaminoMarket> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.market
  const rpc = createSolanaRpc(RPC_URL)
  const m = await KaminoMarket.load(rpc as never, KAMINO_MARKET as never, SLOT_MS)
  if (!m) throw new Error('The lending market is unavailable right now')
  cached = { at: Date.now(), market: m }
  return m
}

/** Kit instructions carry roles; web3.js wants two booleans. */
const ROLE_WRITABLE = new Set([1, 3])
const ROLE_SIGNER = new Set([2, 3])
type KitIx = { programAddress: string; accounts?: { address: string; role: number }[]; data?: Uint8Array }

function toWeb3(ix: KitIx, owner: PublicKey, feePayer: PublicKey, ataProgram: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: (ix.accounts ?? []).map((a, position) => {
      const pubkey = new PublicKey(a.address)
      // The user holds no SOL, so Folio funds any account this opens.
      const funder = ix.programAddress === ataProgram && position === 0 && pubkey.equals(owner)
      return {
        pubkey: funder ? feePayer : pubkey,
        isSigner: ROLE_SIGNER.has(a.role) || funder,
        isWritable: ROLE_WRITABLE.has(a.role),
      }
    }),
    data: Buffer.from(ix.data ?? new Uint8Array()),
  })
}

export type BorrowOption = {
  symbol: string
  display: string
  shares: number
  valueUsd: number
  /** Share of that value that can be borrowed. */
  maxLtv: number
  maxBorrowUsd: number
  borrowApy: number
}

/** What a folio could back a loan with, and on what terms. */
export async function borrowOptions(folioAddress: string): Promise<BorrowOption[]> {
  const [folio, m, marketData] = await Promise.all([readFolio(folioAddress), market(), getMarket()])
  if (!folio) throw new Error('No folio at that address')
  const terms = await lendingTerms()
  const out: BorrowOption[] = []
  for (const h of folio.holdings) {
    const t = terms[h.symbol]
    const s = stock(h.symbol)
    if (!t || !m.getReservesByMint(s.mint as never)[0]) continue
    out.push({
      symbol: h.symbol,
      display: h.display,
      shares: h.shares,
      valueUsd: h.valueUsd,
      maxLtv: t.maxLtv,
      maxBorrowUsd: h.valueUsd * t.maxLtv,
      borrowApy: terms.USDC?.borrowApy ?? t.borrowApy,
    })
  }
  void marketData
  return out
}

export type Loan = {
  collateralUsd: number
  debtUsd: number
  ltv: number
  maxLtv: number
  liquidationLtv: number
  /** How far prices may fall before part of the collateral is sold. */
  headroomPct: number
  deposits: { symbol: string; usd: number }[]
  borrows: { symbol: string; usd: number }[]
}

export async function getLoan(owner: string): Promise<Loan | null> {
  const m = await market()
  const obligation = await m.getUserVanillaObligation(owner as never).catch(() => null)
  if (!obligation) return null
  const collateralUsd = Number(obligation.getDepositedValue())
  const debtUsd = Number(obligation.getBorrowedMarketValue())
  if (collateralUsd === 0 && debtUsd === 0) return null
  const ltv = Number(obligation.loanToValue())
  const stats = obligation.refreshedStats
  const liquidationLtv = Number(stats?.liquidationLtv ?? 0)
  return {
    collateralUsd,
    debtUsd,
    ltv,
    maxLtv: Number(stats?.borrowLimit ?? 0) > 0 ? Number(stats.borrowLimit) / collateralUsd : 0,
    liquidationLtv,
    headroomPct: liquidationLtv > 0 && ltv > 0 ? (1 - ltv / liquidationLtv) * 100 : 100,
    deposits: [...obligation.deposits.values()].map((d: { mintAddress: string; marketValueRefreshed: unknown }) => ({
      symbol: labelFor(String(d.mintAddress)),
      usd: Number(d.marketValueRefreshed),
    })),
    borrows: [...obligation.borrows.values()].map((b: { mintAddress: string; marketValueRefreshed: unknown }) => ({
      symbol: labelFor(String(b.mintAddress)),
      usd: Number(b.marketValueRefreshed),
    })),
  }
}

function labelFor(mint: string) {
  return STOCK_BY_MINT.get(mint)?.display ?? STABLE_BY_MINT.get(mint)?.symbol ?? `${mint.slice(0, 4)}…`
}

/**
 * Two transactions: take the shares out of the vault, then post them as collateral and
 * borrow. They are separate because together they exceed one Solana transaction; if the
 * second fails the shares are simply in the owner's own account.
 */
export async function buildBorrow(a: {
  owner: string
  folio: string
  symbol: string
  /** Portion of that holding to post as collateral, 0–1. */
  fraction: number
  borrowUsdc: number
}): Promise<{ transactions: string[]; preview: { collateralShares: number; borrowUsdc: number; liquidationDropPct: number; borrowApy: number } }> {
  if (!(a.fraction > 0 && a.fraction <= 1)) throw new Error('Choose how much to put up')
  if (!(a.borrowUsdc > 0)) throw new Error('Choose how much to borrow')

  const folio = await readFolio(a.folio)
  if (!folio) throw new Error('No folio at that address')
  if (folio.owner !== a.owner) throw new Error('Only the owner can borrow against this folio')
  if (folio.escrowed) throw new Error('This folio has not been claimed yet')
  if (folio.unlockAt * 1000 > Date.now()) throw new Error('This folio is locked until its date')

  const holding = folio.holdings.find((h) => h.symbol === a.symbol)
  if (!holding) throw new Error('That company is not in this folio')

  const s = stock(a.symbol)
  const usdc = stablecoin('USDC')
  const raw = BigInt(holding.rawAmount)
  const amount = a.fraction >= 1 ? raw : (raw * BigInt(Math.floor(a.fraction * 10_000))) / 10_000n
  const landing = amount - (await transferFee(s.mint, amount))
  if (landing <= 0n) throw new Error('That is too small to use as collateral')

  const [m, marketData] = await Promise.all([market(), getMarket()])
  const reserve = m.getReservesByMint(s.mint as never)[0]
  const usdcReserve = m.getReservesByMint(usdc.mint as never)[0]
  if (!reserve || !usdcReserve) throw new Error(`${s.display} cannot back a loan yet`)

  const multiplier = marketData.stocks[a.symbol]?.multiplier ?? 1
  const shares = toShares(landing, s.decimals, multiplier)
  const valueUsd = shares * (marketData.stocks[a.symbol]?.shareUsd ?? 0)
  const terms = await lendingTerms()
  const maxLtv = terms[a.symbol]?.maxLtv ?? 0
  if (!(maxLtv > 0)) throw new Error(`${s.display} cannot back a loan yet`)
  // Kamino liquidates above the borrow limit; the buffer between them is what gives the
  // borrower room, and Folio states it as a price fall rather than a ratio.
  const liquidationLtv = Math.min(0.95, maxLtv + 0.05)
  if (a.borrowUsdc > valueUsd * maxLtv) {
    throw new Error(`You can borrow at most $${(valueUsd * maxLtv).toFixed(2)} against that`)
  }

  const owner = new PublicKey(a.owner)
  const feePayer = new PublicKey(FEE_PAYER)
  const mint = new PublicKey(s.mint)
  const ownerStock = ata(owner, mint, TOKEN_2022)

  const action = await KaminoAction.buildDepositAndBorrowTxns({
    kaminoMarket: m,
    depositAmount: landing.toString(),
    depositReserveAddress: reserve.address,
    borrowAmount: BigInt(Math.floor(a.borrowUsdc * 10 ** usdc.decimals)).toString(),
    borrowReserveAddress: usdcReserve.address,
    owner: { address: a.owner, signTransactions: async (t: unknown[]) => t } as never,
    obligation: new VanillaObligation(KLEND_PROGRAM),
    useV2Ixs: true,
    scopeRefreshConfig: undefined,
    includeAtaIxs: true,
    requestElevationGroup: false,
    initUserMetadata: { skipInitialization: false, skipLutCreation: true },
    referrer: none(),
  } as never)

  const ataProgram = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
  const kaminoIxs = [...action.setupIxs, ...action.lendingIxs, ...action.cleanupIxs].map((ix) =>
    toWeb3(ix as unknown as KitIx, owner, feePayer, ataProgram),
  )

  const latest = await connection.getLatestBlockhash('confirmed')
  const opened = !(await connection.getAccountInfo(ownerStock, 'confirmed'))
  const move = compile(
    [
      ...budget(120_000),
      ...(opened ? [createAtaIdempotentIx({ payer: feePayer, owner, mint, tokenProgram: TOKEN_2022 })] : []),
      withdrawIx({ folio: new PublicKey(folio.address), mint, owner, destination: ownerStock, amount }),
    ],
    latest.blockhash,
    [],
  )
  const lend = compile([...budget(600_000), ...kaminoIxs], latest.blockhash, [])
  if (move.size > MAX_TX_BYTES || lend.size > MAX_TX_BYTES) {
    throw new Error('This loan does not fit in one transaction right now. Try a smaller part of the holding.')
  }

  return {
    transactions: [move.base64, lend.base64],
    preview: {
      collateralShares: shares,
      borrowUsdc: a.borrowUsdc,
      // The fall in price that would take this position to its liquidation point.
      liquidationDropPct: valueUsd > 0 ? Math.max(0, (1 - a.borrowUsdc / (valueUsd * liquidationLtv)) * 100) : 0,
      borrowApy: terms.USDC?.borrowApy ?? 0,
    },
  }
}

/** Pay the loan back and take the shares out of the lending market. */
export async function buildRepay(a: { owner: string; symbol: string; repayUsdc: number; withdrawAll?: boolean }) {
  const s = stock(a.symbol)
  const usdc = stablecoin('USDC')
  const m = await market()
  const reserve = m.getReservesByMint(s.mint as never)[0]
  const usdcReserve = m.getReservesByMint(usdc.mint as never)[0]
  if (!reserve || !usdcReserve) throw new Error('That loan is not on this market')
  const owner = new PublicKey(a.owner)
  const feePayer = new PublicKey(FEE_PAYER)

  const action = await KaminoAction.buildRepayAndWithdrawTxns({
    kaminoMarket: m,
    repayAmount: BigInt(Math.floor(a.repayUsdc * 10 ** usdc.decimals)).toString(),
    repayReserveAddress: usdcReserve.address,
    withdrawAmount: a.withdrawAll ? 'ALL' : '0',
    withdrawReserveAddress: reserve.address,
    owner: { address: a.owner, signTransactions: async (t: unknown[]) => t } as never,
    obligation: new VanillaObligation(KLEND_PROGRAM),
    useV2Ixs: true,
    scopeRefreshConfig: undefined,
    includeAtaIxs: true,
    referrer: none(),
  } as never)

  const ataProgram = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
  const ixs = [...action.setupIxs, ...action.lendingIxs, ...action.cleanupIxs].map((ix) =>
    toWeb3(ix as unknown as KitIx, owner, feePayer, ataProgram),
  )
  const latest = await connection.getLatestBlockhash('confirmed')
  const built = compile([...budget(600_000), ...ixs], latest.blockhash, [])
  if (built.size > MAX_TX_BYTES) throw new Error('That repayment does not fit in one transaction right now')
  return { transactions: [built.base64] }
}
