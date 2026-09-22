import { NextResponse } from 'next/server'
import { getMarket } from '@/lib/market'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await getMarket())
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
