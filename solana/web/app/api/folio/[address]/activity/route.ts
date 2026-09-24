import { NextResponse } from 'next/server'
import { folioActivity } from '@/lib/activity'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params
    return NextResponse.json({ activity: await folioActivity(address) })
  } catch (e) {
    return NextResponse.json({ activity: [], error: (e as Error).message }, { status: 400 })
  }
}
