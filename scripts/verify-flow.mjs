// End-to-end check of the two APIs the demo depends on, against the running app.
const BASE = process.env.APP || 'http://localhost:3010'

const PROMPTS = [
  'US tech that builds chips, no ads, for university',
  'Only Apple and Nvidia',
  'Safe large companies, nothing volatile',
  'AI and cloud, aggressive',
  'space and bitcoin',
  'everything except tesla',
  'asdfgh nonsense',
]

console.log('=== Allocator ===\n')
const allocations = {}
for (const prompt of PROMPTS) {
  const res = await fetch(`${BASE}/api/allocate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  const j = await res.json()
  if (!res.ok) { console.log(`"${prompt}"\n  ERROR ${j.error}\n`); continue }
  allocations[prompt] = j
  const mix = j.lines.map((l) => `${l.display} ${(l.weightBps / 100).toFixed(0)}%`).join(', ')
  const sum = j.lines.reduce((a, b) => a + b.weightBps, 0)
  console.log(`"${prompt}"`)
  console.log(`  -> ${mix}   [sum ${sum}bps ${sum === 10000 ? 'OK' : 'BAD'}]`)
  console.log(`  ${j.interpretation}`)
  if (j.excluded.length) console.log(`  excluded: ${j.excluded.map((e) => e.display).join(', ')}`)
  console.log()
}

console.log('=== Plan (naira, display-only corridor) ===\n')
const alloc = allocations['US tech that builds chips, no ads, for university']
for (const [ccy, amt] of [['NGN', 50000], ['BRL', 150], ['IDR', 500000], ['USD', 25]]) {
  const res = await fetch(`${BASE}/api/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currency: ccy,
      amountLocal: amt,
      weights: alloc.lines.map((l) => ({ symbol: l.symbol, weightBps: l.weightBps })),
    }),
  })
  const j = await res.json()
  if (!res.ok) { console.log(`${ccy} ${amt}: ERROR ${j.error}\n`); continue }
  const p = j.plan
  console.log(`${amt.toLocaleString()} ${ccy}  ->  ${p.amountSettlementHuman.toFixed(4)} ${p.settlementSymbol}`)
  for (const leg of p.legs) {
    console.log(`   ${leg.display.padEnd(10)} ${(leg.weightBps / 100).toFixed(0).padStart(3)}%  ${leg.shares.toFixed(6)} sh  (min ${leg.minShares.toFixed(6)})  impact ${leg.priceImpactPct.toFixed(2)}%  via ${leg.venues.join('+')}`)
  }
  console.log(`   cost-in ${p.totalCostPct.toFixed(2)}%   gas $${p.totalGasUsd.toFixed(3)}   vs Chainlink ${j.reference.premiumPct.toFixed(2)}%`)
  if (p.warnings.length) p.warnings.forEach((w) => console.log(`   ! ${w}`))
  console.log()
}
