import { NextResponse } from 'next/server'
import { currency } from '@/lib/assets'
import { enforceAllowlist } from '@/lib/allocator'
import { planPurchase, referenceValueUsd, DEFAULT_SLIPPAGE_BPS } from '@/lib/quote'
import { getFxRates, getStockPrices } from '@/lib/prices'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const code = String(body?.currency ?? 'USD')
    const amountLocal = Number(body?.amountLocal)
    const weights = body?.weights as { symbol: string; weightBps: number }[]
    const slippageBps = Number.isFinite(body?.slippageBps)
      ? Math.min(500, Math.max(10, Number(body.slippageBps)))
      : DEFAULT_SLIPPAGE_BPS

    if (!Array.isArray(weights) || !weights.length) {
      return NextResponse.json({ error: 'No allocation supplied' }, { status: 400 })
    }
    if (!Number.isFinite(amountLocal) || amountLocal <= 0) {
      return NextResponse.json({ error: 'Enter an amount' }, { status: 400 })
    }
    enforceAllowlist(Object.fromEntries(weights.map((w) => [w.symbol, w.weightBps])))

    const [fxRates, prices] = await Promise.all([getFxRates(), getStockPrices()])
    const plan = await planPurchase({
      currency: currency(code),
      amountLocal,
      weights,
      fxRates,
      slippageBps,
    })

    const referenceUsd = Object.fromEntries(prices.map((p) => [p.symbol, p.usd]))
    const reference = referenceValueUsd(plan.legs, referenceUsd)
    const staleFeeds = prices.filter((p) => p.stale && plan.legs.some((l) => l.symbol === p.symbol))

    return NextResponse.json({
      plan,
      reference: {
        usd: reference,
        // Positive means you are paying above the Chainlink reference for the shares.
        premiumPct: reference > 0 ? ((plan.totalInUsd - reference) / reference) * 100 : 0,
        prices: referenceUsd,
        stale: staleFeeds.map((p) => p.symbol),
      },
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
