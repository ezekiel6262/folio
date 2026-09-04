import { NextResponse } from 'next/server'
import { isAddress, type Address } from 'viem'
import { buildSwap, DEFAULT_SLIPPAGE_BPS, type LegQuote } from '@/lib/quote'

export const dynamic = 'force-dynamic'

/**
 * Turns the quoted legs into signed-ready calldata for one wallet batch.
 * The sender and the recipient are always the user's own wallet: tokens land with them
 * and are then deposited into their folio in the same batch, so nothing is ever held by
 * an intermediary.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const sender = body?.sender as Address
    const legs = body?.legs as LegQuote[]
    const slippageBps = Number.isFinite(body?.slippageBps)
      ? Math.min(500, Math.max(10, Number(body.slippageBps)))
      : DEFAULT_SLIPPAGE_BPS

    if (!sender || !isAddress(sender)) {
      return NextResponse.json({ error: 'A connected wallet is required' }, { status: 400 })
    }
    if (!Array.isArray(legs) || !legs.length) {
      return NextResponse.json({ error: 'Nothing to build' }, { status: 400 })
    }

    const swaps = await Promise.all(
      legs.map(async (leg) => {
        const built = await buildSwap({
          routeSummary: leg.routeSummary,
          sender,
          recipient: sender,
          slippageBps,
        })
        return {
          symbol: leg.symbol,
          routerAddress: built.routerAddress,
          data: built.data,
          amountIn: built.amountIn,
          amountOut: built.amountOut,
        }
      }),
    )

    return NextResponse.json({ swaps })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
