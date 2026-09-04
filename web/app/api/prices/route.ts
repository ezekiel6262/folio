import { NextResponse } from 'next/server'
import { getStockPrices, getFxRates } from '@/lib/prices'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [prices, fx] = await Promise.all([getStockPrices(), getFxRates()])
    return NextResponse.json({
      prices,
      fx,
      asOf: Math.floor(Date.now() / 1000),
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
