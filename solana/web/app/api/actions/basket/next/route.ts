import { ACTIONS_HEADERS, basketFrom } from '@/lib/actions'
import { STOCK_BY_SYMBOL } from '@/lib/assets'

export const dynamic = 'force-dynamic'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: ACTIONS_HEADERS })

export async function OPTIONS() {
  return new Response(null, { headers: ACTIONS_HEADERS })
}

/**
 * Called by the Blink client after each signed step. Returns the next step's button, or
 * the finished state with a link to the folio.
 */
export async function POST(req: Request) {
  const url = new URL(req.url)
  try {
    const basket = await basketFrom(url.searchParams)
    const step = Math.floor(Number(url.searchParams.get('step') ?? 0))
    const target = url.searchParams.get('target') ?? ''
    const amount = url.searchParams.get('amount') ?? ''
    const icon = `${url.origin}/blink.png`

    if (step >= basket.weights.length) {
      return json({
        type: 'completed',
        icon,
        title: `You own ${basket.name}`,
        description: `Held in a Folio vault in your name. See it, sell it, or give it away at ${url.origin}/folio/${target}`,
        label: 'Done',
      })
    }

    const qs = new URLSearchParams(url.searchParams)
    qs.set('step', String(step))
    qs.set('target', target)
    qs.set('amount', amount)
    const leg = basket.weights[step]
    const name = STOCK_BY_SYMBOL.get(leg.symbol)?.display ?? leg.symbol
    return json({
      type: 'action',
      icon,
      title: `Step ${step + 1} of ${basket.weights.length}: ${name}`,
      description: `Your folio "${basket.name}" is started. Add ${name} to finish the basket.`,
      label: `Buy ${name}`,
      links: { actions: [{ type: 'transaction', label: `Buy ${name}`, href: `${url.origin}/api/actions/basket?${qs.toString()}` }] },
    })
  } catch (e) {
    return json({ message: (e as Error).message }, 400)
  }
}
