import { NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { walletBalances } from '@/lib/balances'

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
    return NextResponse.json(await walletBalances(owner))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
