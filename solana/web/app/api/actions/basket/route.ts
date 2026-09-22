import { PublicKey } from '@solana/web3.js'
import { ACTIONS_HEADERS, basketFrom, basketPolicy } from '@/lib/actions'
import { STOCK_BY_SYMBOL } from '@/lib/assets'
import { isBlocked } from '@/lib/eligibility'
import { buildStep } from '@/lib/steps'

export const dynamic = 'force-dynamic'

const MIN_USD = 1
const MAX_USD = 250

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: ACTIONS_HEADERS })
const fail = (message: string, status = 400) => json({ message }, status)
const display = (symbol: string) => STOCK_BY_SYMBOL.get(symbol)?.display ?? symbol

export async function OPTIONS() {
  return new Response(null, { headers: ACTIONS_HEADERS })
}

/** Query string for this basket without the per-request keys. */
function basketQuery(url: URL) {
  const qs = new URLSearchParams(url.searchParams)
  for (const k of ['amount', 'step', 'target']) qs.delete(k)
  return qs
}

/** The card: what is in the basket, and the buttons. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  try {
    const basket = await basketFrom(url.searchParams)
    const base = `${url.origin}/api/actions/basket?${basketQuery(url).toString()}`
    const list = basket.weights.map((w) => `${display(w.symbol)} ${(w.weightBps / 100).toFixed(0)}%`).join(' · ')
    const anyPrivate = basket.weights.some((w) => STOCK_BY_SYMBOL.get(w.symbol)?.kind === 'private')
    const steps = basket.weights.length

    return json({
      type: 'action',
      icon: `${url.origin}/blink.png`,
      title: `Own ${basket.name}`,
      description:
        `${list}. Real tokenized shares, bought into a Folio vault in your name. Pay in USDC; your wallet pays the network fee.` +
        (steps > 1 ? ` ${steps} quick steps, one company each.` : '') +
        (anyPrivate ? ' Includes pre-IPO companies (PreStocks, 1% transfer fee).' : '') +
        ' Not available to US persons.',
      label: 'Buy',
      links: {
        actions: [
          { type: 'transaction', label: '$10', href: `${base}&amount=10` },
          { type: 'transaction', label: '$25', href: `${base}&amount=25` },
          { type: 'transaction', label: '$50', href: `${base}&amount=50` },
          {
            type: 'transaction',
            label: 'Buy',
            href: `${base}&amount={amount}`,
            parameters: [{ name: 'amount', label: `Amount in USDC ($${MIN_USD}–$${MAX_USD})`, type: 'number', required: true, min: MIN_USD, max: MAX_USD }],
          },
        ],
      },
    })
  } catch (e) {
    return fail((e as Error).message)
  }
}

/**
 * One step of the purchase: step 0 creates the folio and buys the first company; each
 * later step buys one more company into that same folio. A Blink is a single signature,
 * and one company per transaction is what reliably fits Solana's transaction size.
 */
export async function POST(req: Request) {
  if (isBlocked(req.headers)) return fail('Folio is not available in the United States.', 403)
  const url = new URL(req.url)
  try {
    const body = await req.json().catch(() => ({}))
    let account: PublicKey
    try {
      account = new PublicKey(String(body?.account))
    } catch {
      return fail('Connect a Solana wallet first')
    }

    const amount = Number(url.searchParams.get('amount'))
    if (!Number.isFinite(amount) || amount < MIN_USD || amount > MAX_USD) {
      return fail(`Choose an amount between $${MIN_USD} and $${MAX_USD}`)
    }
    const step = Math.max(0, Math.floor(Number(url.searchParams.get('step') ?? 0)))
    const target = url.searchParams.get('target')

    const basket = await basketFrom(url.searchParams)
    if (step >= basket.weights.length) return fail('That basket is already complete')
    if (step > 0 && !target) return fail('Missing the folio to continue')

    const leg = basket.weights[step]
    const legUsd = (amount * leg.weightBps) / 10_000
    if (legUsd < MIN_USD) return fail(`Each company needs at least $${MIN_USD}; raise the amount`)

    const { hash } = basketPolicy(basket)
    const built = await buildStep({
      owner: account,
      symbol: leg.symbol,
      usd: legUsd,
      folio:
        step === 0
          ? { kind: 'new', name: basket.name, unlockAt: 0, reclaimAfter: 0, claimKey: null, recipient: null, policyHashHex: hash }
          : { kind: 'existing', address: target! },
    })
    const folio = built.folio
    const last = step === basket.weights.length - 1
    const shares = built.shares

    return json({
      type: 'transaction',
      transaction: built.transaction,
      message: `Buying ${shares.toFixed(4)} ${display(leg.symbol)} into "${basket.name}"${last ? '' : ` — step ${step + 1} of ${basket.weights.length}`}.`,
      links: {
        next: {
          type: 'post',
          href: `${url.origin}/api/actions/basket/next?${basketQuery(url).toString()}&amount=${amount}&step=${step + 1}&target=${folio}`,
        },
      },
    })
  } catch (e) {
    return fail((e as Error).message)
  }
}
