// Which local-currency corridors are actually tradeable on Base today?
const KYBER = 'https://aggregator-api.kyberswap.com/base/api/v1/routes'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const WETH = '0x4200000000000000000000000000000000000006'

const LOCALS = {
  cNGN: { a: '0xC930784d6e14e2FC2A1F49BE1068dc40f24762D3', d: 6, amt: 50000, ccy: 'NGN' },
  BRZ: { a: '0xE9185Ee218cae427aF7B9764A011bb89FeA761B4', d: 18, amt: 250, ccy: 'BRL' },
  IDRX: { a: '0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22', d: 2, amt: 800000, ccy: 'IDR' },
  EURC: { a: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', d: 6, amt: 50, ccy: 'EUR' },
}

async function probe(label, tokenIn, dIn, amt, tokenOut) {
  const amountIn = (BigInt(Math.round(amt * 100)) * 10n ** BigInt(dIn)) / 100n
  const url = `${KYBER}?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn}&gasInclude=true`
  try {
    const res = await fetch(url, { headers: { 'x-client-id': 'folio' } })
    const j = await res.json()
    if (j.code !== 0) return `${label.padEnd(24)} NO ROUTE (${j.message})`
    const s = j.data.routeSummary
    const impact = ((Number(s.amountOutUsd) - Number(s.amountInUsd)) / Number(s.amountInUsd)) * 100
    const hops = (s.route?.[0] || []).map((h) => h.exchange).join(' > ')
    return `${label.padEnd(24)} OK  $${Number(s.amountInUsd).toFixed(2)} in, impact ${impact.toFixed(2)}%  via ${hops}`
  } catch (e) {
    return `${label.padEnd(24)} ERROR ${e.message}`
  }
}

console.log('=== Local stablecoin liquidity on Base ===\n')
for (const [sym, t] of Object.entries(LOCALS)) {
  console.log(await probe(`${sym}->USDC`, t.a, t.d, t.amt, USDC))
  console.log(await probe(`${sym}->WETH`, t.a, t.d, t.amt, WETH))
  console.log(await probe(`USDC->${sym}`, USDC, 6, 50, t.a))
  console.log('')
}
