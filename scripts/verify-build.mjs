// Does the aggregator actually hand back executable calldata? If not, the whole
// one-tap purchase flow is fiction.
const BASE = 'https://aggregator-api.kyberswap.com/base/api/v1'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const AAPL = '0xb200000000000000000000C2e324d24d7eEcd1fb'
const NVDA = '0xb20000000000000000000078ee7ce2fE4908108C'
// A Smart Wallet-shaped address that holds nothing, to check build does not require balance.
const SENDER = '0x1111111111111111111111111111111111111111'

async function leg(tokenOut, label, amountUsdc) {
  const amountIn = String(BigInt(amountUsdc) * 10n ** 6n)
  const q = new URLSearchParams({ tokenIn: USDC, tokenOut, amountIn, gasInclude: 'true' })
  const r1 = await fetch(`${BASE}/routes?${q}`, { headers: { 'x-client-id': 'folio' } })
  const j1 = await r1.json()
  if (j1.code !== 0) return console.log(`${label}: ROUTE FAILED ${j1.message}`)
  const rs = j1.data.routeSummary

  const r2 = await fetch(`${BASE}/route/build`, {
    method: 'POST',
    headers: { 'x-client-id': 'folio', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      routeSummary: rs,
      sender: SENDER,
      recipient: SENDER,
      slippageTolerance: 100,
      deadline: Math.floor(Date.now() / 1000) + 1200,
      source: 'folio',
      enableGasEstimation: false,
    }),
  })
  const j2 = await r2.json()
  if (j2.code !== 0) return console.log(`${label}: BUILD FAILED (${r2.status}) ${j2.message}`)

  const d = j2.data
  console.log(`${label}:`)
  console.log(`  router      ${d.routerAddress}`)
  console.log(`  amountIn    ${Number(d.amountIn) / 1e6} USDC`)
  console.log(`  amountOut   ${Number(d.amountOut) / 1e8} shares`)
  console.log(`  calldata    ${d.data.slice(0, 26)}... (${(d.data.length - 2) / 2} bytes)`)
  console.log(`  selector    ${d.data.slice(0, 10)}`)
  return d.routerAddress
}

console.log('=== Kyber route -> build (executable calldata) ===\n')
const r1 = await leg(AAPL, '30 USDC -> AAPLc', 30)
const r2 = await leg(NVDA, '20 USDC -> NVDAc', 20)
console.log(`\nSame router for every leg? ${r1 && r1 === r2 ? 'YES - one approval covers the batch' : 'NO - approve per leg'}`)
