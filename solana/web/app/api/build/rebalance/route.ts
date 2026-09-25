import { NextResponse } from 'next/server'
import { hashPolicy, type Policy } from '@/lib/allocator'
import { readFolio } from '@/lib/folio-reader'
import { buildRebalanceBuys, buildRebalanceSells, planRebalance } from '@/lib/rebalance'

export const dynamic = 'force-dynamic'

/**
 * Put a folio back to the split it was built from.
 *
 * The caller sends the policy it believes made this folio; the route hashes it and refuses
 * unless those 32 bytes are the ones the chain recorded. That is what keeps a rebalance
 * honest without Folio keeping a database of anybody's intentions.
 *
 * `phase` is omitted to preview, then 'sell' and finally 'buy' — two confirmations, with
 * the second priced from what the first actually fetched.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const owner = String(body?.owner ?? '')
    const address = String(body?.folio ?? '')
    const policy = body?.policy as Policy | undefined
    const phase = body?.phase as 'sell' | 'buy' | undefined

    if (!owner || !address) return NextResponse.json({ error: 'Missing owner or folio' }, { status: 400 })
    if (!policy?.weights) return NextResponse.json({ error: 'No target split supplied' }, { status: 400 })

    const folio = await readFolio(address)
    if (!folio) return NextResponse.json({ error: 'No folio at that address' }, { status: 404 })
    if (hashPolicy(policy) !== folio.policyHash) {
      return NextResponse.json({ error: 'That split is not the one this folio recorded' }, { status: 400 })
    }

    const targets = Object.entries(policy.weights).map(([symbol, weightBps]) => ({ symbol, weightBps: Number(weightBps) }))

    if (phase === 'sell') return NextResponse.json(await buildRebalanceSells({ owner, folio: address, targets }))
    if (phase === 'buy') return NextResponse.json(await buildRebalanceBuys({ owner, folio: address, targets }))
    return NextResponse.json({ plan: await planRebalance({ owner, folio: address, targets }) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
