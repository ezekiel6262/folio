import { NextResponse } from 'next/server'
import { rulesAllocator, enforceAllowlist, type Tilt } from '@/lib/allocator'

export const dynamic = 'force-dynamic'

const TILTS: Tilt[] = ['growth', 'quality', 'balanced']

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const prompt = typeof body?.prompt === 'string' ? body.prompt.slice(0, 500) : ''
    const tilt = TILTS.includes(body?.tilt) ? (body.tilt as Tilt) : undefined

    const allocation = rulesAllocator.allocate({ prompt, tilt })

    // The allowlist is enforced on the way out, no matter which engine produced this.
    if (allocation.lines.length) enforceAllowlist(allocation.policy.weights)

    return NextResponse.json(allocation)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
