import { NextResponse } from 'next/server'
import { buildCloseFolio, buildExtendLock, buildHandOn, buildPublish, buildUnpublish } from '@/lib/owner-actions'
import { buildTakeOut } from '@/lib/take-out'

export const dynamic = 'force-dynamic'

/** What an owner can do with a folio they hold. */
export async function POST(req: Request) {
  try {
    const b = await req.json()
    const owner = String(b?.owner)
    const folio = String(b?.folio)
    switch (String(b?.action)) {
      case 'take-out':
        return NextResponse.json(await buildTakeOut({ owner, folio, symbol: String(b?.symbol), fraction: Number(b?.fraction) }))
      case 'hand-on':
        return NextResponse.json(await buildHandOn({ owner, folio, newOwner: String(b?.newOwner) }))
      case 'extend-lock':
        return NextResponse.json(await buildExtendLock({ owner, folio, newUnlockAt: Number(b?.newUnlockAt) }))
      case 'publish':
        return NextResponse.json(await buildPublish({ owner, folio, note: String(b?.note ?? '') }))
      case 'unpublish':
        return NextResponse.json(await buildUnpublish({ owner, folio }))
      case 'close':
        return NextResponse.json(await buildCloseFolio({ owner, folio }))
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
