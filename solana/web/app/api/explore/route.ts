import { NextResponse } from 'next/server'
import { exploreCards } from '@/lib/explore'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  try {
    return NextResponse.json({ cards: await exploreCards() })
  } catch (e) {
    return NextResponse.json({ cards: [], error: (e as Error).message }, { status: 503 })
  }
}
