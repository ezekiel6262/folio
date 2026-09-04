// Can we actually execute the product's core action today?
// Tests real aggregator routes: local stable -> tokenized stock, on Base mainnet.
const KYBER = 'https://aggregator-api.kyberswap.com/base/api/v1/routes'

const T = {
  USDC: { a: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', d: 6 },
  cNGN: { a: '0xC930784d6e14e2FC2A1F49BE1068dc40f24762D3', d: 6 },
  BRZ: { a: '0xE9185Ee218cae427aF7B9764A011bb89FeA761B4', d: 18 },
  EURC: { a: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', d: 6 },
  WETH: { a: '0x4200000000000000000000000000000000000006', d: 18 },
  AAPLc: { a: '0xb200000000000000000000C2e324d24d7eEcd1fb', d: 8 },
  NVDAc: { a: '0xb20000000000000000000078ee7ce2fE4908108C', d: 8 },
  TSLAc: { a: '0xb2000000000000000000001e800a7f5189430cD0', d: 8 },
}

const units = (amt, d) => BigInt(Math.round(amt * 10 ** Math.min(d, 6))) * 10n ** BigInt(Math.max(0, d - 6))

async function route(inSym, outSym, humanAmt) {
  const i = T[inSym], o = T[outSym]
  const amountIn = units(humanAmt, i.d)
  const url = `${KYBER}?tokenIn=${i.a}&tokenOut=${o.a}&amountIn=${amountIn}&gasInclude=true`
  const label = `${humanAmt.toLocaleString()} ${inSym} -> ${outSym}`
  try {
    const res = await fetch(url, { headers: { 'x-client-id': 'folio' } })
    const j = await res.json()
    if (!res.ok || j.code !== 0) {
      return `  ${label.padEnd(34)} NO ROUTE  (${j.message || res.status})`
    }
    const s = j.data.routeSummary
    const out = Number(s.amountOut) / 10 ** o.d
    const inUsd = Number(s.amountInUsd || 0)
    const outUsd = Number(s.amountOutUsd || 0)
    const slip = inUsd > 0 ? ((outUsd - inUsd) / inUsd) * 100 : NaN
    const hops = (s.route?.[0] || []).map((h) => h.exchange).join(' > ') || '?'
    return (
      `  ${label.padEnd(34)} OK  out=${out.toFixed(6)} ${outSym}\n` +
      `      inUsd=$${inUsd.toFixed(2)} outUsd=$${outUsd.toFixed(2)} priceImpact=${slip.toFixed(2)}% gas~$${Number(s.gasUsd || 0).toFixed(3)}\n` +
      `      via: ${hops}`
    )
  } catch (e) {
    return `  ${label.padEnd(34)} ERROR ${e.message}`
  }
}

console.log('=== KyberSwap aggregator routing on Base ===\n')

console.log('[A] USD corridor (baseline liquidity depth)')
for (const amt of [10, 100, 1000, 10000]) console.log(await route('USDC', 'AAPLc', amt))

console.log('\n[B] Naira corridor — the actual product flow')
for (const amt of [5000, 50000, 500000]) console.log(await route('cNGN', 'AAPLc', amt))

console.log('\n[C] Other corridors')
console.log(await route('BRZ', 'NVDAc', 250))
console.log(await route('EURC', 'NVDAc', 50))
console.log(await route('USDC', 'TSLAc', 100))

console.log('\n[D] Exit path (can a user get out?)')
console.log(await route('AAPLc', 'USDC', 0.1))
