import { NextResponse } from 'next/server'
import { buildSendOut } from '@/lib/send-out'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const b = await req.json()
    const result = await buildSendOut({
      owner: String(b?.owner),
      symbol: String(b?.symbol),
      amount: Number(b?.amount),
      destination: String(b?.destination),
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
