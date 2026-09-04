import 'server-only'
import { createPublicClient, http, parseAbi } from 'viem'
import { base } from 'viem/chains'
import { STOCKS } from './assets'

/**
 * Two different numbers, kept deliberately separate:
 *
 *   reference - the Chainlink feed. What the share is worth. Freezes on weekends and
 *               during corporate actions, so staleness is surfaced rather than hidden.
 *   fill      - what the DEX will actually give you right now (see quote.ts).
 *
 * Showing only one of these is how users get surprised. Folio shows both.
 */

export const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org', {
    batch: true,
    retryCount: 4,
    retryDelay: 350,
  }),
  batch: { multicall: { wait: 24 } },
})

const AGGREGATOR = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
])
const B20 = parseAbi(['function toScaledBalance(uint256) view returns (uint256)'])

const WAD = 10n ** 18n
/** Feeds hold last close over weekends; only flag genuinely unusual gaps. */
const STALE_AFTER_SECONDS = 4 * 24 * 60 * 60

export type StockPrice = {
  symbol: string
  usd: number
  updatedAt: number
  ageSeconds: number
  stale: boolean
  /** WAD-scaled B20 multiplier: tokens -> shares. */
  multiplierWad: string
}

type Cached<T> = { at: number; value: T }
let priceCache: Cached<StockPrice[]> | null = null
let fxCache: Cached<Record<string, number>> | null = null
const PRICE_TTL_MS = 30_000
const FX_TTL_MS = 10 * 60_000

export async function getStockPrices(): Promise<StockPrice[]> {
  if (priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.value

  const feedCalls = STOCKS.map((s) => ({
    address: s.feed,
    abi: AGGREGATOR,
    functionName: 'latestRoundData' as const,
  }))
  const multCalls = STOCKS.map((s) => ({
    address: s.address,
    abi: B20,
    functionName: 'toScaledBalance' as const,
    args: [WAD] as const,
  }))

  const results = await publicClient.multicall({
    contracts: [...feedCalls, ...multCalls],
    allowFailure: true,
  })

  const now = Math.floor(Date.now() / 1000)
  const out: StockPrice[] = []

  STOCKS.forEach((s, i) => {
    const feed = results[i]
    const mult = results[i + STOCKS.length]
    if (feed.status !== 'success') return

    const [, answer, , updatedAt] = feed.result as unknown as [bigint, bigint, bigint, bigint, bigint]
    const usd = Number(answer) / 1e8
    if (!Number.isFinite(usd) || usd <= 0) return

    const age = now - Number(updatedAt)
    out.push({
      symbol: s.symbol,
      usd,
      updatedAt: Number(updatedAt),
      ageSeconds: age,
      stale: age > STALE_AFTER_SECONDS,
      multiplierWad: (mult.status === 'success' ? (mult.result as bigint) : WAD).toString(),
    })
  })

  // Never cache a badly degraded read - better to retry than to pin bad prices for 30s.
  if (out.length >= Math.ceil(STOCKS.length / 2)) priceCache = { at: Date.now(), value: out }
  else if (priceCache) return priceCache.value

  return out
}

const FX_SOURCES = [
  { url: 'https://open.er-api.com/v6/latest/USD', pick: (j: any) => j?.rates },
  { url: 'https://api.frankfurter.app/latest?from=USD', pick: (j: any) => j?.rates },
]

/** USD -> local. Returns only the currencies we actually price in. */
export async function getFxRates(): Promise<Record<string, number>> {
  if (fxCache && Date.now() - fxCache.at < FX_TTL_MS) return fxCache.value

  const wanted = ['NGN', 'BRL', 'IDR', 'EUR', 'MXN']
  for (const src of FX_SOURCES) {
    try {
      const res = await fetch(src.url, { next: { revalidate: 600 } })
      if (!res.ok) continue
      const rates = src.pick(await res.json())
      if (!rates) continue
      const picked: Record<string, number> = { USD: 1 }
      for (const c of wanted) if (typeof rates[c] === 'number') picked[c] = rates[c]
      // Require the corridors we actually trade before trusting the source.
      if (picked.BRL && picked.EUR) {
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
