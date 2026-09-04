import { parseUnits, formatUnits, type Address } from 'viem'
import { STOCKS, settlementCurrency, stock, type Currency } from './assets'

/**
 * The Executor.
 *
 * intent -> quote -> slippage bound -> calldata. Routing goes through the KyberSwap
 * aggregator, which is one of the venues Base lists for these assets and needs no API
 * key. Every leg is quoted separately so the preview can show the user what each line
 * actually costs, rather than a single blended number.
 */

const KYBER_BASE = 'https://aggregator-api.kyberswap.com/base/api/v1'
const CLIENT_ID = 'folio'

export const DEFAULT_SLIPPAGE_BPS = 100 // 1%
/** Gas on Base is around a cent; anything under this is worse than not trading. */
export const MIN_ORDER_USD = 1

export type RouteSummary = Record<string, unknown> & {
  amountIn: string
  amountOut: string
  amountInUsd: string
  amountOutUsd: string
  gasUsd: string
  route: { exchange: string }[][]
}

export type LegQuote = {
  symbol: string
  display: string
  tokenOut: Address
  decimalsOut: number
  weightBps: number
  amountInRaw: string
  amountOutRaw: string
  /** Worst case out, after slippage tolerance. This is what gets deposited. */
  minAmountOutRaw: string
  shares: number
  minShares: number
  amountInUsd: number
  amountOutUsd: number
  /** Negative means the fill is worse than the input value. */
  priceImpactPct: number
  venues: string[]
  routeSummary: RouteSummary
}

export type PurchasePlan = {
  currencyCode: string
  settlementToken: Address
  settlementSymbol: string
  settlementDecimals: number
  amountLocal: number
  amountSettlementRaw: string
  amountSettlementHuman: number
  fxRate: number
  legs: LegQuote[]
  totalInUsd: number
  totalOutUsd: number
  totalGasUsd: number
  /** Blended cost of getting in, in percent. Shown to the user before they commit. */
  totalCostPct: number
  slippageBps: number
  /** True when the display currency is not the currency that actually moves. */
  settlesInDifferentCurrency: boolean
  warnings: string[]
}

async function kyber<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${KYBER_BASE}${path}`, {
    ...init,
    headers: { 'x-client-id': CLIENT_ID, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json?.code !== 0) {
    throw new Error(json?.message || `Aggregator error ${res.status}`)
  }
  return json.data as T
}

export async function getRoute(tokenIn: Address, tokenOut: Address, amountInRaw: bigint) {
  const params = new URLSearchParams({
    tokenIn,
    tokenOut,
    amountIn: amountInRaw.toString(),
    gasInclude: 'true',
  })
  const data = await kyber<{ routeSummary: RouteSummary; routerAddress: Address }>(`/routes?${params}`)
  return data
}

export type BuiltSwap = {
  data: `0x${string}`
  routerAddress: Address
  amountIn: string
  amountOut: string
  gas: string
}

export async function buildSwap(args: {
  routeSummary: RouteSummary
  sender: Address
  recipient: Address
  slippageBps: number
}): Promise<BuiltSwap> {
  return kyber<BuiltSwap>('/route/build', {
    method: 'POST',
    body: JSON.stringify({
      routeSummary: args.routeSummary,
      sender: args.sender,
      recipient: args.recipient,
      slippageTolerance: args.slippageBps,
      deadline: Math.floor(Date.now() / 1000) + 20 * 60,
      source: CLIENT_ID,
      enableGasEstimation: false,
    }),
  })
}

/** Split a settlement amount across weights without losing units to rounding. */
export function splitByWeights(totalRaw: bigint, weights: { symbol: string; weightBps: number }[]) {
  let assigned = 0n
  const parts = weights.map((w, i) => {
    const isLast = i === weights.length - 1
    const amount = isLast ? totalRaw - assigned : (totalRaw * BigInt(w.weightBps)) / 10_000n
    assigned += amount
    return { symbol: w.symbol, weightBps: w.weightBps, amountInRaw: amount }
  })
  return parts
}

export async function planPurchase(args: {
  currency: Currency
  amountLocal: number
  weights: { symbol: string; weightBps: number }[]
  fxRates: Record<string, number>
  slippageBps?: number
  referenceUsd?: Record<string, number>
}): Promise<PurchasePlan> {
  const { currency, amountLocal, weights, fxRates } = args
  const slippageBps = args.slippageBps ?? DEFAULT_SLIPPAGE_BPS
  const settle = settlementCurrency(currency.code)
  const warnings: string[] = []

  // How much of the settlement token does the user's local amount represent?
  // A tradeable local stablecoin is 1:1 with its own currency. A display-only currency
  // (naira today) is converted through FX into the settlement currency instead.
  let amountSettlementHuman: number
  const fxRate = fxRates[currency.code] ?? 1
  if (currency.tradeable) {
    amountSettlementHuman = amountLocal
  } else {
    const settleRate = fxRates[settle.code] ?? 1
    amountSettlementHuman = (amountLocal / fxRate) * settleRate
    warnings.push(
      `${currency.code} has no onchain market on Base yet, so this order settles in ${settle.code} at ${fxRate.toLocaleString()} ${currency.code}/USD.`,
    )
  }

  const amountSettlementRaw = parseUnits(amountSettlementHuman.toFixed(settle.decimals), settle.decimals)
  if (amountSettlementRaw <= 0n) throw new Error('Amount is too small to trade')

  // Below about a dollar the network fee eats more than the order buys. Refuse in the
  // user's own currency rather than letting them pay to lose money.
  const settleRateForUsd = fxRates[settle.code] ?? 1
  const orderUsd = amountSettlementHuman / settleRateForUsd
  if (orderUsd < MIN_ORDER_USD) {
    const minLocal = MIN_ORDER_USD * (fxRates[currency.code] ?? 1)
    throw new Error(
      `The smallest order is about ${minLocal.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency.code}. Below that the network fee costs more than the shares.`,
    )
  }

  const parts = splitByWeights(amountSettlementRaw, weights)

  const legs = await Promise.all(
    parts.map(async (part) => {
      const s = stock(part.symbol)
      if (part.amountInRaw <= 0n) return null
      const { routeSummary } = await getRoute(settle.address, s.address, part.amountInRaw)

      const amountOutRaw = BigInt(routeSummary.amountOut)
      const minAmountOutRaw = (amountOutRaw * BigInt(10_000 - slippageBps)) / 10_000n
      const amountInUsd = Number(routeSummary.amountInUsd)
      const amountOutUsd = Number(routeSummary.amountOutUsd)

      const leg: LegQuote = {
        symbol: s.symbol,
        display: s.display,
        tokenOut: s.address,
        decimalsOut: s.decimals,
        weightBps: part.weightBps,
        amountInRaw: part.amountInRaw.toString(),
        amountOutRaw: amountOutRaw.toString(),
        minAmountOutRaw: minAmountOutRaw.toString(),
        shares: Number(formatUnits(amountOutRaw, s.decimals)),
        minShares: Number(formatUnits(minAmountOutRaw, s.decimals)),
        amountInUsd,
        amountOutUsd,
        priceImpactPct: amountInUsd > 0 ? ((amountOutUsd - amountInUsd) / amountInUsd) * 100 : 0,
        venues: [...new Set((routeSummary.route?.[0] ?? []).map((h) => h.exchange))],
        routeSummary,
      }
      return leg
    }),
  )

  const ok = legs.filter((l): l is LegQuote => l !== null)
  if (!ok.length) throw new Error('No route available for this basket right now')

  // The vault rejects zero-amount contributions, so a leg that rounds away at this size
  // would revert the whole batch. Fail here, with an amount the user can act on.
  const dust = ok.filter((l) => BigInt(l.minAmountOutRaw) === 0n)
  if (dust.length) {
    throw new Error(
      `That amount is too small to split across ${ok.length} companies — ${dust
        .map((d) => d.display)
        .join(', ')} would round to zero. Try a larger amount or fewer names.`,
    )
  }

  const totalInUsd = ok.reduce((a, b) => a + b.amountInUsd, 0)
  const totalOutUsd = ok.reduce((a, b) => a + b.amountOutUsd, 0)
  const totalGasUsd = ok.reduce((a, b) => a + Number(b.routeSummary.gasUsd || 0), 0)
  const totalCostPct = totalInUsd > 0 ? ((totalInUsd - totalOutUsd) / totalInUsd) * 100 : 0

  // A large gap in either direction means the pool is thin and the marks are unreliable,
  // not that the user found free money. Say so both ways.
  for (const leg of ok) {
    if (Math.abs(leg.priceImpactPct) > 2.5) {
      const dir = leg.priceImpactPct < 0 ? 'below' : 'above'
      warnings.push(
        `${leg.display} is pricing ${Math.abs(leg.priceImpactPct).toFixed(1)}% ${dir} its reference - that pool is thin, so the fill you get may move.`,
      )
    }
  }

  return {
    currencyCode: currency.code,
    settlementToken: settle.address,
    settlementSymbol: settle.token,
    settlementDecimals: settle.decimals,
    amountLocal,
    amountSettlementRaw: amountSettlementRaw.toString(),
    amountSettlementHuman,
    fxRate,
    legs: ok,
    totalInUsd,
    totalOutUsd,
    totalGasUsd,
    totalCostPct,
    slippageBps,
    settlesInDifferentCurrency: !currency.tradeable,
    warnings,
  }
}

/** Reference value of a plan from Chainlink, so the UI can show fill vs. reference. */
export function referenceValueUsd(legs: LegQuote[], referenceUsd: Record<string, number>) {
  return legs.reduce((sum, leg) => sum + leg.shares * (referenceUsd[leg.symbol] ?? 0), 0)
}

export const ALL_SYMBOLS = STOCKS.map((s) => s.symbol)
