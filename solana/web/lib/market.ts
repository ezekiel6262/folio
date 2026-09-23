import 'server-only'
import { Connection, PublicKey } from '@solana/web3.js'
import { STABLECOINS, STOCKS } from './assets'
import { DISPLAY_CODES } from './currencies'
import { lendingTerms, type LendingTerms } from './lending'

/**
 * Market data, with its limits stated.
 *
 * Prices come from Jupiter's aggregated market price. That is a price from trading venues,
 * not an independent oracle: on Solana, Chainlink publishes no equity feeds, Pyth's free
 * on-chain equity feeds were ~30 days stale on 14 Sep 2026, and its live service needs a
 * paid key. The UI labels it accordingly.
 *
 * Multipliers are read from each stock's own mint: the issuer's scaled-UI-amount
 * extension, including a scheduled change once its effective time passes.
 */

export const RPC_URL = process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

export const connection = new Connection(RPC_URL, 'confirmed')

const JUPITER = ['https://lite-api.jup.ag', 'https://api.jup.ag']

export type StockMarket = {
  symbol: string
  /** Market price of one token as wallets display it (UI amount), USD. */
  tokenUsd: number
  /**
   * Price of one share-equivalent. Jupiter already quotes scaled-UI tokens per UI unit
   * (verified: usdPrice = usdPricePrescaled / multiplier), and one UI unit is one share, so
   * this equals tokenUsd. Kept separate so call sites say what they mean.
   */
  shareUsd: number
  /**
   * What the token tracks, as its issuer reports it through Jupiter: the listed share price
   * for xStocks, the last-round mark for PreStocks. Absent when the issuer publishes none.
   */
  referenceUsd?: number
  referenceSource?: string
  /** Market price against the reference: +13 means buyers pay 13% above it. */
  premiumPct?: number
  multiplier: number
  /** A multiplier change the issuer has scheduled but not yet reached. */
  scheduled?: { multiplier: number; effectiveAt: number }
}

/** PreStocks' own view of each private company, from their public API. */
export type PrivateValuation = { markValuation: number; impliedValuation: number; markPrice: number }

export type Market = {
  stocks: Record<string, StockMarket>
  valuations: Record<string, PrivateValuation>
  /** Borrowing terms where a lending market accepts the asset. */
  lending: Record<string, LendingTerms>
  /** USD value of one unit of each stablecoin (EURC is not 1.00). */
  stablecoinUsd: Record<string, number>
  /** USD -> each display currency. */
  fx: Record<string, number>
  asOf: number
  source: 'jupiter'
}

type Cached<T> = { at: number; value: T }
let marketCache: Cached<Market> | null = null
let fxCache: Cached<Record<string, number>> | null = null
const MARKET_TTL = 20_000
const FX_TTL = 10 * 60_000

type JupPrice = { usd: number; reference?: { usd: number; source: string } }

async function jupiterPrices(mints: string[]): Promise<Record<string, JupPrice>> {
  for (const base of JUPITER) {
    try {
      const res = await fetch(`${base}/price/v3?ids=${mints.join(',')}`, { cache: 'no-store' })
      if (!res.ok) continue
      const json = (await res.json()) as Record<string, { usdPrice?: number; stockData?: { id?: string; price?: number } }>
      return Object.fromEntries(
        Object.entries(json)
          .filter(([, v]) => typeof v?.usdPrice === 'number')
          .map(([mint, v]) => [
            mint,
            {
              usd: Number(v.usdPrice),
              reference:
                typeof v.stockData?.price === 'number' && v.stockData.price > 0
                  ? { usd: v.stockData.price, source: v.stockData.id ?? 'issuer' }
                  : undefined,
            },
          ]),
      )
    } catch {
      // try the next base
    }
  }
  throw new Error('Jupiter price API unavailable')
}

type ScaledState = { multiplier?: string; newMultiplier?: string; newMultiplierEffectiveTimestamp?: number | string }

async function multipliers(): Promise<Record<string, Pick<StockMarket, 'multiplier' | 'scheduled'>>> {
  const infos = await connection.getMultipleParsedAccounts(STOCKS.map((s) => new PublicKey(s.mint)))
  const now = Math.floor(Date.now() / 1000)
  const out: Record<string, Pick<StockMarket, 'multiplier' | 'scheduled'>> = {}

  STOCKS.forEach((s, i) => {
    const data = infos.value[i]?.data
    const exts: { extension: string; state: ScaledState }[] =
      data && 'parsed' in data ? (data.parsed?.info?.extensions ?? []) : []
    const scaled = exts.find((e) => e.extension === 'scaledUiAmountConfig')?.state
    const current = Number(scaled?.multiplier ?? 1)
    const next = Number(scaled?.newMultiplier ?? current)
    const at = Number(scaled?.newMultiplierEffectiveTimestamp ?? 0)

    // Once the scheduled time passes, the new multiplier is the live one.
    if (at && now >= at) out[s.symbol] = { multiplier: next }
    else out[s.symbol] = { multiplier: current, scheduled: at && next !== current ? { multiplier: next, effectiveAt: at } : undefined }
  })
  return out
}

export async function getFx(): Promise<Record<string, number>> {
  if (fxCache && Date.now() - fxCache.at < FX_TTL) return fxCache.value
  for (const url of ['https://open.er-api.com/v6/latest/USD', 'https://api.frankfurter.app/latest?from=USD']) {
    try {
      const res = await fetch(url, { next: { revalidate: 600 } })
      if (!res.ok) continue
      const rates = (await res.json())?.rates as Record<string, number> | undefined
      if (!rates) continue
      const picked: Record<string, number> = { USD: 1 }
      for (const code of DISPLAY_CODES) if (typeof rates[code] === 'number') picked[code] = rates[code]
      if (picked.EUR) {
        fxCache = { at: Date.now(), value: picked }
        return picked
      }
    } catch {
      // try the next source
    }
  }
  if (fxCache) return fxCache.value
  throw new Error('No FX source available')
}

let valuationCache: Cached<Record<string, PrivateValuation>> | null = null

async function preStocksValuations(): Promise<Record<string, PrivateValuation>> {
  if (valuationCache && Date.now() - valuationCache.at < 5 * 60_000) return valuationCache.value
  try {
    const res = await fetch('https://prestocks.com/api/prestocks', { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
    const list = (await res.json()) as { contract_address: string; markPrice: number; markValuation: number; impliedValuation: number }[]
    const bySymbol: Record<string, PrivateValuation> = {}
    for (const s of STOCKS) {
      const row = list.find((r) => r.contract_address === s.mint)
      if (row) bySymbol[s.symbol] = { markValuation: row.markValuation, impliedValuation: row.impliedValuation, markPrice: row.markPrice }
    }
    valuationCache = { at: Date.now(), value: bySymbol }
    return bySymbol
  } catch {
    return valuationCache?.value ?? {}
  }
}

export async function getMarket(): Promise<Market> {
  if (marketCache && Date.now() - marketCache.at < MARKET_TTL) return marketCache.value

  const [prices, mults, fx, valuations, lending] = await Promise.all([
    jupiterPrices([...STOCKS.map((s) => s.mint), ...STABLECOINS.map((s) => s.mint)]),
    multipliers(),
    getFx(),
    preStocksValuations(),
    lendingTerms(),
  ])

  const stocks: Record<string, StockMarket> = {}
  for (const s of STOCKS) {
    const price = prices[s.mint]
    if (!price) continue
    const { multiplier, scheduled } = mults[s.symbol] ?? { multiplier: 1 }
    const ref = price.reference
    stocks[s.symbol] = {
      symbol: s.symbol,
      tokenUsd: price.usd,
      shareUsd: price.usd,
      referenceUsd: ref?.usd,
      referenceSource: ref?.source,
      premiumPct: ref ? (price.usd / ref.usd - 1) * 100 : undefined,
      multiplier,
      scheduled,
    }
  }

  const stablecoinUsd: Record<string, number> = {}
  for (const c of STABLECOINS) {
    // Fall back to the peg through FX if Jupiter has no price for a thin stablecoin.
    stablecoinUsd[c.symbol] = prices[c.mint]?.usd ?? (c.pegged === 'USD' ? 1 : 1 / (fx[c.pegged] ?? NaN))
  }

  const value: Market = { stocks, valuations, lending, stablecoinUsd, fx, asOf: Math.floor(Date.now() / 1000), source: 'jupiter' }
  marketCache = { at: Date.now(), value }
  return value
}
