import { NextResponse } from 'next/server'
import { buildBorrow, buildRepay } from '@/lib/borrow'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const b = await req.json()
    if (b?.action === 'repay') {
      return NextResponse.json(
        await buildRepay({
          owner: String(b?.owner),
          symbol: String(b?.symbol),
          repayUsdc: Number(b?.repayUsdc),
          withdrawAll: Boolean(b?.withdrawAll),
        }),
      )
    }
    return NextResponse.json(
      await buildBorrow({
        owner: String(b?.owner),
        folio: String(b?.folio),
        symbol: String(b?.symbol),
        fraction: Number(b?.fraction),
        borrowUsdc: Number(b?.borrowUsdc),
      }),
    )
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
