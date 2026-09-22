import { NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { foliosOwnedBy, giftsWaitingFrom } from '@/lib/folio-reader'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const owner = new URL(req.url).searchParams.get('owner')
  try {
    if (!owner) throw new Error('owner is required')
    new PublicKey(owner)
  } catch {
    return NextResponse.json({ error: 'owner must be a Solana address' }, { status: 400 })
  }
  try {
    const [owned, giftsWaiting] = await Promise.all([foliosOwnedBy(owner), giftsWaitingFrom(owner)])
    return NextResponse.json({ owned, giftsWaiting })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
