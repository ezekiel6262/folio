import { NextResponse } from 'next/server'
import { borrowOptions, getLoan } from '@/lib/borrow'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** What a folio can back a loan with, and the loan the wallet already has. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const folio = searchParams.get('folio')
  const owner = searchParams.get('owner')
  try {
    const [options, loan] = await Promise.all([
      folio ? borrowOptions(folio) : Promise.resolve([]),
      owner ? getLoan(owner) : Promise.resolve(null),
    ])
    return NextResponse.json({ options, loan })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, options: [], loan: null }, { status: 503 })
  }
}
