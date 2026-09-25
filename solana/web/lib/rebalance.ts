import 'server-only'
import { PublicKey } from '@solana/web3.js'
import { STOCK_BY_SYMBOL } from './assets'
import { walletBalances } from './balances'
import { readFolio } from './folio-reader'
import { MIN_ORDER_USD } from './quote'
import { buildSell } from './sell'
import { buildStep } from './steps'

/**
 * Putting a folio back to the split it was built from.
 *
 * Nothing drifts because anyone did anything wrong: one company rises, another falls, and
 * a basket that started 45/35/20 quietly becomes something else. Folio never does this on
 * its own — drift is shown, and the owner decides. It happens in two halves, each one its
 * own confirmation: sell what is over, then buy what is under with exactly what came back.
 *
 * The target split is supplied by the caller and proved against the folio's own policy
 * hash before anything is built, so a browser cannot talk this route into a different
 * basket than the one the chain recorded.
 */

/** Below this, moving money costs more than the drift is worth. */
const MIN_MOVE_USD = Math.max(MIN_ORDER_USD, 2)

export type Drift = {
  symbol: string
  display: string
  nowPct: number
  targetPct: number
  nowUsd: number
  targetUsd: number
  /** Positive: this holding is over its share. Negative: under it. */
  gapUsd: number
}

export type RebalancePlan = {
  folio: string
  totalUsd: number
  /** The largest single gap, in percentage points of the whole folio. */
  driftPct: number
  drifts: Drift[]
  sells: { symbol: string; fraction: number; usd: number }[]
  buys: { symbol: string; usd: number }[]
  /** Nothing worth doing: every gap is smaller than the cost of closing it. */
  settled: boolean
}

export type Targets = { symbol: string; weightBps: number }[]

function normalise(targets: Targets): Targets {
  const total = targets.reduce((a, t) => a + t.weightBps, 0)
  if (!targets.length || total <= 0) throw new Error('That folio has no target split')
  if (targets.some((t) => !STOCK_BY_SYMBOL.has(t.symbol))) throw new Error('That split names something Folio does not hold')
  // Rounding in a stored policy should not tip a folio into a phantom trade.
  return targets.map((t) => ({ symbol: t.symbol, weightBps: Math.round((t.weightBps / total) * 10_000) }))
}

/**
 * The arithmetic on its own, so it can be checked without a cluster: what each company is
 * worth now against what the split asks for, and the smallest set of moves that closes the
 * gap. Nothing here touches the chain.
 */
export function movesFor(a: {
  totalUsd: number
  holdings: { symbol: string; display: string; valueUsd: number }[]
  targets: Targets
}): Omit<RebalancePlan, 'folio'> {
  const targets = normalise(a.targets)
  const held = new Map(a.holdings.map((h) => [h.symbol, h]))
  const symbols = [...new Set([...targets.map((t) => t.symbol), ...a.holdings.map((h) => h.symbol)])]

  const drifts: Drift[] = symbols.map((symbol) => {
    const holding = held.get(symbol)
    const bps = targets.find((t) => t.symbol === symbol)?.weightBps ?? 0
    const nowUsd = holding?.valueUsd ?? 0
    const targetUsd = (a.totalUsd * bps) / 10_000
    return {
      symbol,
      display: holding?.display ?? STOCK_BY_SYMBOL.get(symbol)?.display ?? symbol,
      nowPct: a.totalUsd > 0 ? (nowUsd / a.totalUsd) * 100 : 0,
      targetPct: bps / 100,
      nowUsd,
      targetUsd,
      gapUsd: nowUsd - targetUsd,
    }
  })

  const sells = drifts
    .filter((d) => d.gapUsd >= MIN_MOVE_USD && d.nowUsd > 0)
    .map((d) => ({
      symbol: d.symbol,
      // Selling everything of something the split no longer wants closes its vault too.
      fraction: Math.min(1, d.gapUsd / d.nowUsd),
      usd: Math.min(d.gapUsd, d.nowUsd),
    }))

  const buys = drifts.filter((d) => -d.gapUsd >= MIN_MOVE_USD).map((d) => ({ symbol: d.symbol, usd: -d.gapUsd }))

  return {
    totalUsd: a.totalUsd,
    driftPct: drifts.reduce((a, d) => Math.max(a, Math.abs(d.nowPct - d.targetPct)), 0),
    drifts: drifts.sort((a, b) => b.nowUsd - a.nowUsd),
    sells,
    buys,
    settled: !sells.length && !buys.length,
  }
}

export async function planRebalance(a: { owner: string; folio: string; targets: Targets }): Promise<RebalancePlan> {
  const folio = await readFolio(a.folio)
  if (!folio) throw new Error('No folio at that address')
  if (folio.escrowed) throw new Error('This folio has not been claimed yet')
  if (folio.owner !== a.owner) throw new Error('Only the owner can rebalance this folio')
  if (folio.unlockAt * 1000 > Date.now()) throw new Error('This folio is held shut until its unlock date')
  if (folio.totalUsd <= 0) throw new Error('There is nothing in this folio to rebalance')

  return {
    folio: folio.address,
    ...movesFor({ totalUsd: folio.totalUsd, holdings: folio.holdings, targets: a.targets }),
  }
}

/**
 * The selling half: every holding that is over its share, trimmed back to it. Proceeds land
 * as USDC in the owner's own wallet, exactly as an ordinary sale does.
 */
export async function buildRebalanceSells(a: { owner: string; folio: string; targets: Targets }) {
  const plan = await planRebalance(a)
  const transactions: string[] = []
  for (const sell of plan.sells) {
    const built = await buildSell({ owner: a.owner, folio: a.folio, symbol: sell.symbol, fraction: sell.fraction })
    transactions.push(built.transaction)
  }
  return { plan, transactions }
}

/**
 * The buying half, priced from what is actually in the wallet now rather than from what the
 * sales were expected to fetch. If the market moved in between, the folio buys what it can
 * and stays a little short of target rather than spending money that is not there.
 */
export async function buildRebalanceBuys(a: { owner: string; folio: string; targets: Targets }) {
  const plan = await planRebalance(a)
  if (!plan.buys.length) return { plan, transactions: [] as string[], spentUsd: 0 }

  const balances = await walletBalances(a.owner)
  const usdc = balances.stablecoins.find((s) => s.symbol === 'USDC')?.usd ?? 0
  const wanted = plan.buys.reduce((a, b) => a + b.usd, 0)
  // Leave nothing stranded: scale every leg by what the wallet can actually cover.
  const scale = wanted > 0 ? Math.min(1, usdc / wanted) : 0
  if (usdc < MIN_MOVE_USD) throw new Error('There is no cash back from the sales yet — wait for them to settle, then try again')

  const owner = new PublicKey(a.owner)
  const transactions: string[] = []
  let spentUsd = 0
  for (const buy of plan.buys) {
    const usd = buy.usd * scale
    if (usd < MIN_ORDER_USD) continue
    const step = await buildStep({ owner, symbol: buy.symbol, usd, folio: { kind: 'existing', address: a.folio } })
    transactions.push(step.transaction)
    spentUsd += usd
  }
  return { plan, transactions, spentUsd }
}
