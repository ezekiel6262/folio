import { NextResponse } from 'next/server'
import { buildReclaim } from '@/lib/claim'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const b = await req.json()
    return NextResponse.json(await buildReclaim({ folio: String(b?.folio), creator: String(b?.creator) }))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
