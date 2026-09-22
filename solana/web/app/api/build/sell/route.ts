import { NextResponse } from 'next/server'
import { buildSell, PriceMoved } from '@/lib/sell'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const b = await req.json()
    const result = await buildSell({
      owner: String(b?.owner),
      folio: String(b?.folio),
      symbol: String(b?.symbol),
      fraction: Number(b?.fraction),
      reviewedMinUsdc: typeof b?.reviewedMinUsdc === 'number' ? b.reviewedMinUsdc : undefined,
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof PriceMoved ? 409 : 400 })
  }
}
