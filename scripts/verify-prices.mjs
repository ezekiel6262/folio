// Chainlink equity feeds + FX source. Both must work for local-currency display.
import { createPublicClient, http, parseAbi } from 'viem'
import { base } from 'viem/chains'

const client = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org', { batch: true, retryCount: 5, retryDelay: 400 }),
  batch: { multicall: { wait: 32 } },
})

const FEEDS = {
  AAPLc: '0x787f13dEa48Db0897CbCDD985de77809D837F988',
  NVDAc: '0x04689a41629776563E6822F76f2e57D148d28513',
  TSLAc: '0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4',
  AMZNc: '0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295',
  GOOGLc: '0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2',
  METAc: '0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D',
  MSFTc: '0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c',
  MSTRc: '0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a',
  SNDKc: '0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA',
  SPCXc: '0x6A634B235903C4ad6376892180d6fF8612e3Fa68',
}

const AGG = parseAbi([
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
])

console.log('=== Chainlink equity feeds on Base ===\n')
const now = Math.floor(Date.now() / 1000)
for (const [sym, addr] of Object.entries(FEEDS)) {
  const r = await client.multicall({
    contracts: [
      { address: addr, abi: AGG, functionName: 'latestRoundData' },
      { address: addr, abi: AGG, functionName: 'decimals' },
      { address: addr, abi: AGG, functionName: 'description' },
    ],
    allowFailure: true,
  })
  if (r[0].status !== 'success') { console.log(`${sym.padEnd(7)} FEED READ FAILED`); continue }
  const [, answer, , updatedAt] = r[0].result
  const dec = r[1].status === 'success' ? r[1].result : 8
  const price = Number(answer) / 10 ** dec
  const age = now - Number(updatedAt)
  const ageStr = age < 3600 ? `${Math.floor(age / 60)}m` : `${(age / 3600).toFixed(1)}h`
  console.log(`${sym.padEnd(7)} $${price.toFixed(2).padStart(10)}  updated ${ageStr} ago  "${r[2].status === 'success' ? r[2].result : '?'}"`)
}

console.log('\n=== FX sources (keyless) ===')
for (const url of ['https://open.er-api.com/v6/latest/USD', 'https://api.frankfurter.app/latest?from=USD']) {
  try {
    const j = await (await fetch(url)).json()
    const rates = j.rates || {}
    const got = ['NGN', 'BRL', 'IDR', 'EUR', 'MXN'].map((c) => `${c}=${rates[c] ?? 'MISSING'}`).join(' ')
    console.log(`OK   ${url}\n     ${got}`)
  } catch (e) { console.log(`FAIL ${url} -> ${e.message}`) }
}
