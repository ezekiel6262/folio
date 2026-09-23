import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { buildDemoFolio, demoAssets, demoHoldings, isDemo } from '@/lib/demo'

export const dynamic = 'force-dynamic'

/** What the signed-in wallet holds of the demo tokens. */
export async function GET(req: Request) {
  if (!isDemo()) return NextResponse.json({ enabled: false, holdings: [] })
  const owner = new URL(req.url).searchParams.get('owner')
  const demo = demoAssets()!
  try {
    return NextResponse.json({
      enabled: true,
      cluster: demo.cluster,
      holdings: owner ? await demoHoldings(owner) : [],
    })
  } catch (e) {
    return NextResponse.json({ enabled: true, holdings: [], error: (e as Error).message }, { status: 503 })
  }
}

export async function POST(req: Request) {
  if (!isDemo()) return NextResponse.json({ error: 'The demo is not enabled on this cluster' }, { status: 400 })
  try {
    const b = await req.json()
    const picks = (b?.picks ?? []) as { symbol: string; rawAmount: string }[]
    const name = String(b?.name ?? 'Demo folio').slice(0, 40)
    // The policy hash records what the folio was made from, as a purchase would.
    const policyHashHex = createHash('sha256')
      .update(JSON.stringify({ engine: 'demo-v1', name, picks }))
      .digest('hex')
    return NextResponse.json(
      await buildDemoFolio({
        user: String(b?.user),
        name,
        unlockAt: Number(b?.unlockAt ?? 0),
        claimKey: b?.claimKey ? String(b.claimKey) : null,
        recipient: b?.recipient ? String(b.recipient) : null,
        policyHashHex,
        picks,
      }),
    )
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
