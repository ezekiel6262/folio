import 'server-only'
import { stablecoin, stock, toShares } from './assets'
import type { Market } from './market'

/**
 * The purchase planner.
 *
 * Three quantities are kept deliberately separate, because conflating them is how users
 * get surprised:
 *   - what the user typed, in their display currency
 *   - what actually moves, in whichever stablecoin they pay with
 *   - what each company costs, quoted leg by leg from Jupiter
 * Every leg carries the Jupiter quote it came from, so the transaction builder executes
 * exactly what the user was shown.
 */

const JUPITER = ['https://lite-api.jup.ag/swap/v1', 'https://api.jup.ag/swap/v1']

export const DEFAULT_SLIPPAGE_BPS = 100 // 1%
/** Below about a dollar the fee we sponsor costs more than the shares. */
export const MIN_ORDER_USD = 1

export type JupiterQuote = Record<string, unknown> & {
  inAmount: string
  outAmount: string
  /** Minimum out after slippage — what the user is guaranteed. */
  otherAmountThreshold: string
  priceImpactPct: string
  routePlan: { swapInfo: { label: string } }[]
}

export type Leg = {
  symbol: string
  display: string
  weightBps: number
  amountInRaw: string
  /** Stablecoin spent on this leg, valued in USD. */
  spendUsd: number
  tokensOut: number
  minTokensOut: number
  shares: number
  minShares: number
  /** What this fill works out to per share, against the market price. */
  fillShareUsd: number
  marketShareUsd: number
  gapPct: number
  priceImpactPct: number
  venues: string[]
  quote: JupiterQuote
}

export type PurchasePlan = {
  displayCode: string
  amountLocal: number
  payWith: string
  amountPayRaw: string
  amountPayUnits: number
  spendUsd: number
  legs: Leg[]
  totalCostPct: number
  slippageBps: number
  warnings: string[]
}

export async function jupiterQuote(inputMint: string, outputMint: string, amount: bigint, slippageBps: number) {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: String(slippageBps),
    // Keep routes compact so a three-company basket still fits one transaction.
    maxAccounts: '32',
  })
  let lastError = 'no route'
  for (const base of JUPITER) {
    try {
      const res = await fetch(`${base}/quote?${params}`, { cache: 'no-store' })
      const json = await res.json()
      if (res.ok && json?.outAmount) return json as JupiterQuote
      lastError = json?.error ?? `HTTP ${res.status}`
    } catch (e) {
      lastError = (e as Error).message
    }
  }
  throw new Error(lastError)
}

/** Split an amount across weights without losing units to rounding. */
function split(total: bigint, weights: { symbol: string; weightBps: number }[]) {
  let assigned = 0n
  return weights.map((w, i) => {
    const amount = i === weights.length - 1 ? total - assigned : (total * BigInt(w.weightBps)) / 10_000n
    assigned += amount
    return { ...w, amount }
  })
}

export async function planPurchase(args: {
  displayCode: string
  amountLocal: number
  payWith: string
  weights: { symbol: string; weightBps: number }[]
  market: Market
  slippageBps?: number
}): Promise<PurchasePlan> {
  const { displayCode, amountLocal, weights, market } = args
  const slippageBps = args.slippageBps ?? DEFAULT_SLIPPAGE_BPS
  const pay = stablecoin(args.payWith)
  const warnings: string[] = []

  const fx = market.fx[displayCode]
  if (!fx) throw new Error(`No exchange rate for ${displayCode} right now`)
  const spendUsd = amountLocal / fx
  if (spendUsd < MIN_ORDER_USD) {
    const minLocal = MIN_ORDER_USD * fx
    throw new Error(`The smallest order is about ${Math.ceil(minLocal).toLocaleString()} ${displayCode}.`)
  }

  const payUsd = market.stablecoinUsd[pay.symbol]
  if (!payUsd) throw new Error(`No price for ${pay.symbol} right now`)
  const units = spendUsd / payUsd
  const amountPayRaw = BigInt(Math.floor(units * 10 ** pay.decimals))
  if (amountPayRaw <= 0n) throw new Error('Amount is too small to trade')

  const legs = await Promise.all(
    split(amountPayRaw, weights).map(async (part): Promise<Leg> => {
      const s = stock(part.symbol)
      const m = market.stocks[s.symbol]
      if (!m) throw new Error(`No market price for ${s.display} right now`)
      const quote = await jupiterQuote(pay.mint, s.mint, part.amount, slippageBps)

      const tokensOut = Number(quote.outAmount) / 10 ** s.decimals
      const minTokensOut = Number(quote.otherAmountThreshold) / 10 ** s.decimals
      const legSpendUsd = (Number(part.amount) / 10 ** pay.decimals) * payUsd
      const shares = toShares(quote.outAmount, s.decimals, m.multiplier)
      const fillShareUsd = shares > 0 ? legSpendUsd / shares : 0

      return {
        symbol: s.symbol,
        display: s.display,
        weightBps: part.weightBps,
        amountInRaw: part.amount.toString(),
        spendUsd: legSpendUsd,
        tokensOut,
        minTokensOut,
        shares,
        minShares: toShares(quote.otherAmountThreshold, s.decimals, m.multiplier),
        fillShareUsd,
        marketShareUsd: m.shareUsd,
        gapPct: m.shareUsd > 0 ? ((fillShareUsd - m.shareUsd) / m.shareUsd) * 100 : 0,
        priceImpactPct: Number(quote.priceImpactPct) * 100,
        venues: [...new Set(quote.routePlan.map((h) => h.swapInfo.label))],
        quote,
      }
    }),
  )

  for (const leg of legs) {
    if (Math.abs(leg.gapPct) > 2.5) {
      warnings.push(
        `${leg.display} is filling ${Math.abs(leg.gapPct).toFixed(1)}% ${leg.gapPct > 0 ? 'above' : 'below'} the market price — that pool is thin at this size.`,
      )
    }
  }
  if (pay.note) warnings.push(pay.note)

  const received = legs.reduce((a, l) => a + l.shares * l.marketShareUsd, 0)
  const spent = legs.reduce((a, l) => a + l.spendUsd, 0)

  return {
    displayCode,
    amountLocal,
    payWith: pay.symbol,
    amountPayRaw: amountPayRaw.toString(),
    amountPayUnits: Number(amountPayRaw) / 10 ** pay.decimals,
    spendUsd: spent,
    legs,
    totalCostPct: spent > 0 ? ((spent - received) / spent) * 100 : 0,
    slippageBps,
    warnings,
  }
}
