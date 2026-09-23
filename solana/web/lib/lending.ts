import 'server-only'
import { STOCK_BY_MINT, STABLE_BY_MINT } from './assets'

/**
 * What the lending market will do with these assets, read live from Kamino's xStocks
 * market. Two numbers matter to a person: how much cash a holding can back, and what
 * borrowing it costs. Everything else stays out of the interface.
 */

const MARKET = '5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua'
const TTL_MS = 5 * 60_000

export type LendingTerms = {
  symbol: string
  mint: string
  /** Fraction of the holding's value that can be borrowed against it. */
  maxLtv: number
  borrowApy: number
  supplyApy: number
  /** How much of this asset the market already holds, in tokens. */
  totalSupply: number
}

let cache: { at: number; value: Record<string, LendingTerms> } | null = null

export async function lendingTerms(): Promise<Record<string, LendingTerms>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  try {
    const res = await fetch(`https://api.kamino.finance/kamino-market/${MARKET}/reserves/metrics`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) throw new Error('unavailable')
    const rows = (await res.json()) as {
      liquidityTokenMint: string
      maxLtv: string
      borrowApy: string
      supplyApy: string
      totalSupply: string
    }[]
    const value: Record<string, LendingTerms> = {}
    for (const r of rows) {
      const asset = STOCK_BY_MINT.get(r.liquidityTokenMint) ?? STABLE_BY_MINT.get(r.liquidityTokenMint)
      const maxLtv = Number(r.maxLtv)
      if (!asset || !(maxLtv > 0)) continue
      value[asset.symbol] = {
        symbol: asset.symbol,
        mint: r.liquidityTokenMint,
        maxLtv,
        borrowApy: Number(r.borrowApy) * 100,
        supplyApy: Number(r.supplyApy) * 100,
        totalSupply: Number(r.totalSupply),
      }
    }
    cache = { at: Date.now(), value }
    return value
  } catch {
    return cache?.value ?? {}
  }
}
