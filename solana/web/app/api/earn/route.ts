import { NextResponse } from 'next/server'
import { earnPositions, earnTokens } from '@/lib/earn'

export const dynamic = 'force-dynamic'

/** What each stablecoin pays, and what this wallet already has earning. */
export async function GET(req: Request) {
  try {
    const owner = new URL(req.url).searchParams.get('owner')
    const [tokens, positions] = await Promise.all([earnTokens(), owner ? earnPositions(owner) : Promise.resolve([])])
    return NextResponse.json({ tokens, positions, earningUsd: positions.reduce((a, p) => a + p.usd, 0) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 })
  }
}
