import { NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { enforceAllowlist } from '@/lib/allocator'
import { buildPurchase, type NewFolio } from '@/lib/buy'
import { getMarket } from '@/lib/market'
import { planPurchase } from '@/lib/quote'

export const dynamic = 'force-dynamic'

const isKey = (v: unknown) => {
  try {
    return typeof v === 'string' && Boolean(new PublicKey(v))
  } catch {
    return false
  }
}

/**
 * Re-quotes on the server rather than trusting the legs the browser previewed. If the
 * fresh fill would give fewer shares than the worst case the user reviewed, it refuses:
 * the co-signer's ceiling already stops a tampered request costing us money, and this
 * stops a stale or tampered quote costing the user.
 */
export async function POST(req: Request) {
  try {
    const b = await req.json()
    if (!isKey(b?.user)) return NextResponse.json({ error: 'Sign in first' }, { status: 400 })

    const weights = b?.weights as { symbol: string; weightBps: number }[]
    enforceAllowlist(Object.fromEntries((weights ?? []).map((w) => [w.symbol, w.weightBps])))

    const folio = b?.folio
    if (folio?.kind === 'new') {
      const f = folio as NewFolio
      if (typeof f.name !== 'string' || Buffer.byteLength(f.name, 'utf8') > 40) {
        return NextResponse.json({ error: 'Names are at most 40 characters' }, { status: 400 })
      }
      if (!/^[0-9a-f]{64}$/i.test(String(f.policyHashHex))) {
        return NextResponse.json({ error: 'Bad policy hash' }, { status: 400 })
      }
      if (f.claimKey != null && !isKey(f.claimKey)) return NextResponse.json({ error: 'Bad claim key' }, { status: 400 })
      if (f.recipient != null && !isKey(f.recipient)) {
        return NextResponse.json({ error: 'That is not a valid Solana address' }, { status: 400 })
      }
    } else if (!(folio?.kind === 'existing' && isKey(folio.address))) {
      return NextResponse.json({ error: 'Say which folio this is for' }, { status: 400 })
    }

    const market = await getMarket()
    const plan = await planPurchase({
      displayCode: String(b?.displayCode ?? 'USD'),
      amountLocal: Number(b?.amountLocal),
      payWith: String(b?.payWith ?? 'USDC'),
      weights,
      market,
    })

    const reviewed = (b?.reviewedMinShares ?? {}) as Record<string, number>
    const moved = plan.legs.filter((l) => typeof reviewed[l.symbol] === 'number' && l.shares < reviewed[l.symbol])
    if (moved.length) {
      return NextResponse.json(
        { error: `The price of ${moved.map((l) => l.display).join(' and ')} moved since you reviewed it. Check it again.` },
        { status: 409 },
      )
    }

    const built = await buildPurchase({ user: b.user, legs: plan.legs, folio })
    return NextResponse.json({ built, plan })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
