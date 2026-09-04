// Ground-truth check against Base mainnet, batched through Multicall3 to avoid
// public-RPC throttling. Every address is probed; nothing is assumed.
import { createPublicClient, http, parseAbi, formatUnits, getAddress } from 'viem'
import { base } from 'viem/chains'

const client = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org', { batch: true, retryCount: 5, retryDelay: 400 }),
  batch: { multicall: { wait: 32 } },
})

const STOCKS = {
  NVDAc: '0xb20000000000000000000078ee7ce2fE4908108C',
  METAc: '0xb2000000000000000000008bC8786B856E61707C',
  AAPLc: '0xb200000000000000000000C2e324d24d7eEcd1fb',
  GOOGLc: '0xb2000000000000000000002D0BA3164cc74f58B7',
  AMZNc: '0xb200000000000000000000d9192b6B456483C2E8',
  MSFTc: '0xB200000000000000000000Ab99cFa739E253872B',
  MSTRc: '0xb2000000000000000000004884b426556b92883d',
  SNDKc: '0xb200000000000000000000397293Cb8cda9a10c5',
  SPCXc: '0xb2000000000000000000007b9fcbd005511aCBd5',
  TSLAc: '0xb2000000000000000000001e800a7f5189430cD0',
}

const STABLES = {
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  EURC: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42',
  cNGN: '0xC930784d6e14e2FC2A1F49BE1068dc40f24762D3',
  BRZ: '0xE9185Ee218cae427aF7B9764A011bb89FeA761B4',
  IDRX: '0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22',
}

const META = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
])
const B20 = parseAbi([
  'function toScaledBalance(uint256) view returns (uint256)',
  'function WAD_PRECISION() view returns (uint256)',
])

const WAD = 10n ** 18n

async function report(label, raw, isStock) {
  const address = getAddress(raw)
  const calls = [
    { address, abi: META, functionName: 'name' },
    { address, abi: META, functionName: 'symbol' },
    { address, abi: META, functionName: 'decimals' },
    { address, abi: META, functionName: 'totalSupply' },
  ]
  if (isStock) {
    calls.push({ address, abi: B20, functionName: 'toScaledBalance', args: [WAD] })
    calls.push({ address, abi: B20, functionName: 'WAD_PRECISION' })
  }
  const r = await client.multicall({ contracts: calls, allowFailure: true })
  const val = (i) => (r[i].status === 'success' ? r[i].result : null)

  const name = val(0), sym = val(1), dec = val(2), sup = val(3)
  if (name === null && sym === null && dec === null) return `${label.padEnd(7)} ${address}  ALL READS FAILED`

  const d = dec ?? 18
  const supply = sup !== null ? Number(formatUnits(sup, d)) : null
  let line =
    `${label.padEnd(7)} ${address}\n` +
    `        symbol=${sym ?? '?'}  decimals=${d}  ` +
    `totalSupply=${supply !== null ? supply.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '?'}  name="${name ?? '?'}"`

  if (isStock) {
    const scaled = val(4), wadp = val(5)
    if (scaled !== null) {
      const mult = Number(scaled) / Number(WAD)
      line += `\n        multiplier=${mult} (1 token -> ${mult} share)  WAD_PRECISION=${wadp ?? 'n/a'}`
    } else {
      line += `\n        multiplier: toScaledBalance reverted`
    }
  }
  return line
}

console.log('=== BASE MAINNET GROUND TRUTH ===')
console.log('block:', await client.getBlockNumber(), '\n')

console.log('--- Coinbase tokenized stocks (B20) ---')
for (const [k, v] of Object.entries(STOCKS)) console.log(await report(k, v, true))

console.log('\n--- Stablecoin corridors ---')
for (const [k, v] of Object.entries(STABLES)) console.log(await report(k, v, false))
