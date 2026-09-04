import { NextResponse } from 'next/server'
import { readFolio } from '@/lib/folio-reader'
import { IS_DEPLOYED } from '@/lib/deployment'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Bad folio id' }, { status: 400 })
  if (!IS_DEPLOYED) return NextResponse.json({ error: 'Vault is not deployed yet' }, { status: 503 })

  try {
    const folio = await readFolio(BigInt(id))
    if (!folio) return NextResponse.json({ error: 'No such folio' }, { status: 404 })
    return NextResponse.json({ folio })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
