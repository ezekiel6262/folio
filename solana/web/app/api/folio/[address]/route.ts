import { NextResponse } from 'next/server'
import { listingFor } from '@/lib/explore'
import { readFolio } from '@/lib/folio-reader'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  try {
    const folio = await readFolio(address)
    if (!folio) return NextResponse.json({ error: 'No folio at that address' }, { status: 404 })
    // Whether it is on the public shelf, so its own page can say so.
    const listing = await listingFor(address).catch(() => null)
    return NextResponse.json({ folio, listing })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
