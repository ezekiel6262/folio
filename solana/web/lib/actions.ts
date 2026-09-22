import 'server-only'
import { enforceAllowlist, hashPolicy, type Policy } from './allocator'
import { STOCK_BY_SYMBOL, type Stock } from './assets'
import { readFolio } from './folio-reader'

/**
 * Solana Actions ("Blinks"): a link anyone can post that becomes a working "own this
 * basket" button on X, Discord and in any Solana wallet. Only the purchase goes through
 * the visitor's own wallet; the basket is still bought straight into a Folio vault in
 * their name, with the same caps and allowlist as the app.
 */

export const ACTIONS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Action-Version, X-Blockchain-Ids',
  'Access-Control-Expose-Headers': 'X-Action-Version, X-Blockchain-Ids',
  'X-Action-Version': '2.4',
  'X-Blockchain-Ids': 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  'Content-Type': 'application/json',
}

export type Basket = { weights: { symbol: string; weightBps: number }[]; name: string; source: string }

const MAX_NAME = 40

/**
 * A basket comes from `s=AAPLx,NVDAx,SPYx` (equal weights), `b=AAPLx.5000-SPYx.5000`
 * (explicit basis points) or `folio=<address>` (copy what an existing folio holds, by value).
 */
export async function basketFrom(params: URLSearchParams): Promise<Basket> {
  let weights: { symbol: string; weightBps: number }[] = []
  let source = ''
  let defaultName = ''

  const folio = params.get('folio')
  if (folio) {
    const f = await readFolio(folio)
    if (!f || !f.holdings.length) throw new Error('That folio holds nothing to copy')
    const total = f.holdings.reduce((a, h) => a + h.valueUsd, 0)
    const top = [...f.holdings].sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 3)
    const topTotal = top.reduce((a, h) => a + h.valueUsd, 0) || total
    weights = top.map((h) => ({ symbol: h.symbol, weightBps: Math.floor((h.valueUsd / topTotal) * 10_000) }))
    source = `folio:${folio}`
    defaultName = f.name
  } else if (params.get('b')) {
    weights = params
      .get('b')!
      .split('-')
      .map((p) => {
        const [symbol, bps] = p.split('.')
        return { symbol, weightBps: Number(bps) }
      })
    source = `b:${params.get('b')}`
  } else if (params.get('s')) {
    const symbols = [...new Set(params.get('s')!.split(',').map((x) => x.trim()).filter(Boolean))]
    const each = Math.floor(10_000 / symbols.length)
    weights = symbols.map((symbol) => ({ symbol, weightBps: each }))
    source = `s:${symbols.join(',')}`
  } else {
    throw new Error('Say which companies: ?s=AAPLx,NVDAx,SPYx')
  }

  // Rounding remainder to the largest weight, so the basket sums to exactly 100%.
  const sum = weights.reduce((a, w) => a + w.weightBps, 0)
  if (weights.length) weights.sort((a, b) => b.weightBps - a.weightBps)[0].weightBps += 10_000 - sum

  enforceAllowlist(Object.fromEntries(weights.map((w) => [w.symbol, w.weightBps])))
  const stocks = weights.map((w) => STOCK_BY_SYMBOL.get(w.symbol) as Stock)
  const name = (params.get('name') || defaultName || describeNames(stocks)).slice(0, MAX_NAME)
  return { weights, name, source }
}

export function describeNames(stocks: Stock[]) {
  const n = stocks.map((s) => s.display)
  return n.length <= 1 ? (n[0] ?? 'A folio') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}

export function basketPolicy(basket: Basket): { policy: Policy; hash: string } {
  const policy: Policy = {
    version: 1,
    engine: 'blink-v1',
    prompt: basket.source,
    tilt: 'balanced',
    maxWeight: 1,
    weights: Object.fromEntries(basket.weights.map((w) => [w.symbol, w.weightBps])),
    excluded: [],
  }
  return { policy, hash: hashPolicy(policy) }
}
