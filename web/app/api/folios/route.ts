import { NextResponse } from 'next/server'
import { isAddress, type Address } from 'viem'
import { listFolioIdsFor, readFolio } from '@/lib/folio-reader'
import { IS_DEPLOYED } from '@/lib/deployment'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const owner = new URL(req.url).searchParams.get('owner')
  if (!owner || !isAddress(owner)) {
    return NextResponse.json({ error: 'owner query parameter is required' }, { status: 400 })
  }
  if (!IS_DEPLOYED) return NextResponse.json({ folios: [], notDeployed: true })

  try {
    const ids = await listFolioIdsFor(owner as Address)
    const folios = (await Promise.all(ids.map((id) => readFolio(id)))).filter(Boolean)
    folios.sort((a, b) => Number(b!.createdAt) - Number(a!.createdAt))
    return NextResponse.json({ folios })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
