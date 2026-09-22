import { NextResponse } from 'next/server'
import { buildClaim } from '@/lib/claim'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const b = await req.json()
    return NextResponse.json(
      await buildClaim({ folio: String(b?.folio), claimKey: String(b?.claimKey), claimant: String(b?.claimant) }),
    )
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
