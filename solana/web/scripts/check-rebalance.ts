/**
 * The arithmetic behind "put it back in balance", checked without a cluster: a folio that
 * has drifted, one that has not, a company the split no longer wants, and a folio that has
 * grown without changing shape. Money is never invented and never left behind.
 *
 *   npx -y tsx --conditions=react-server scripts/check-rebalance.ts
 */
import { movesFor } from '../lib/rebalance'

const targets = [
  { symbol: 'AAPLx', weightBps: 5000 },
  { symbol: 'NVDAx', weightBps: 3000 },
  { symbol: 'SPYx', weightBps: 2000 },
]
const holding = (symbol: string, valueUsd: number) => ({ symbol, display: symbol, valueUsd })

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol

// NVIDIA has run away with it: 600/300/100 against a 500/300/200 split.
const drifted = movesFor({ totalUsd: 1000, holdings: [holding('AAPLx', 600), holding('NVDAx', 300), holding('SPYx', 100)], targets })
check('drift is measured in points of the whole folio', near(drifted.driftPct, 10))
check('only what is over is sold', drifted.sells.map((s) => s.symbol).join() === 'AAPLx')
check('only what is under is bought', drifted.buys.map((b) => b.symbol).join() === 'SPYx')
check('what is sold equals what is bought', near(drifted.sells[0].usd, drifted.buys[0].usd), `${drifted.sells[0].usd} vs ${drifted.buys[0].usd}`)
check('a sale is a fraction of that holding, not of the folio', near(drifted.sells[0].fraction, 100 / 600, 0.001))

// Exactly on target: nothing to do, and nothing claimed.
const settled = movesFor({ totalUsd: 1000, holdings: [holding('AAPLx', 500), holding('NVDAx', 300), holding('SPYx', 200)], targets })
check('a folio on its split is left alone', settled.settled && !settled.sells.length && !settled.buys.length)
check('a folio on its split reports no drift', near(settled.driftPct, 0))

// Grown 10x, same shape: still nothing to do.
const grown = movesFor({ totalUsd: 10_000, holdings: [holding('AAPLx', 5000), holding('NVDAx', 3000), holding('SPYx', 2000)], targets })
check('growth alone is not drift', grown.settled)

// A company the split no longer names is sold out completely.
const dropped = movesFor({
  totalUsd: 1000,
  holdings: [holding('AAPLx', 450), holding('NVDAx', 300), holding('SPYx', 150), holding('TSLAx', 100)],
  targets,
})
const tesla = dropped.sells.find((s) => s.symbol === 'TSLAx')
check('a company the split dropped is sold out entirely', Boolean(tesla) && near(tesla!.fraction, 1))

// Tiny drift is not worth a trade at either end.
const barely = movesFor({ totalUsd: 1000, holdings: [holding('AAPLx', 501), holding('NVDAx', 299.5), holding('SPYx', 199.5)], targets })
check('drift smaller than the cost of fixing it is left alone', barely.settled)

// A split that does not sum to 10,000 is read as proportions, not as a hole.
const sloppy = movesFor({
  totalUsd: 1000,
  holdings: [holding('AAPLx', 600), holding('NVDAx', 400)],
  targets: [
    { symbol: 'AAPLx', weightBps: 1 },
    { symbol: 'NVDAx', weightBps: 1 },
  ],
})
check('a split is read as proportions', near(sloppy.drifts.find((d) => d.symbol === 'AAPLx')!.targetPct, 50))

const total = 11
console.log(`\n${total - failed}/${total} passed`)
process.exit(failed ? 1 : 0)
