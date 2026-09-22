import { NextResponse } from 'next/server'
import { enforceAllowlist } from '@/lib/allocator'
import { getMarket } from '@/lib/market'
import { planPurchase } from '@/lib/quote'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const b = await req.json()
    const weights = b?.weights as { symbol: string; weightBps: number }[]
    if (!Array.isArray(weights) || !weights.length) {
      return NextResponse.json({ error: 'No allocation supplied' }, { status: 400 })
    }
    enforceAllowlist(Object.fromEntries(weights.map((w) => [w.symbol, w.weightBps])))

    const amountLocal = Number(b?.amountLocal)
    if (!Number.isFinite(amountLocal) || amountLocal <= 0) {
      return NextResponse.json({ error: 'Enter an amount' }, { status: 400 })
    }

    const market = await getMarket()
    const plan = await planPurchase({
      displayCode: String(b?.displayCode ?? 'USD'),
      amountLocal,
      payWith: String(b?.payWith ?? 'USDC'),
      weights,
      market,
    })
    return NextResponse.json({ plan, market: { fx: market.fx, asOf: market.asOf, source: market.source } })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
