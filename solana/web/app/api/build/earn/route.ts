import { NextResponse } from 'next/server'
import { buildEarnDeposit, buildEarnWithdraw } from '@/lib/earn'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const b = await req.json()
    const args = { owner: String(b?.owner), symbol: String(b?.symbol), amount: Number(b?.amount) }
    const result = b?.action === 'withdraw' ? await buildEarnWithdraw(args) : await buildEarnDeposit(args)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
