// Creates one real folio on Base from the deployer EOA, so the screens that have never
// been rendered with real data can be verified against something true.
//
// It deliberately goes through the app's own /api/plan and /api/build, so this exercises
// the real allocator, quoting and calldata paths rather than a parallel implementation.
// An EOA cannot batch, so the calls are sent one at a time — the same sequence the app's
// sequential fallback walks.
//
//   node scripts/demo-buy.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  decodeEventLog,
  keccak256,
  formatUnits,
  formatEther,
  erc20Abi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'

const APP = process.env.APP || 'http://localhost:3010'
const AMOUNT_BRL = Number(process.env.AMOUNT_BRL || 8)
const PROMPT = process.env.PROMPT || 'Only Apple and Nvidia'
const FOLIO_NAME = process.env.FOLIO_NAME || 'Ada 2028'
const UNLOCK_ISO = process.env.UNLOCK || '2028-03-12'

const deployment = JSON.parse(readFileSync('shared/deployment.base.json', 'utf8'))
const vaultAbi = JSON.parse(
  readFileSync('contracts/artifacts/contracts/FolioVault.sol/FolioVault.json', 'utf8'),
).abi
const assets = JSON.parse(readFileSync('shared/base-assets.json', 'utf8'))
const BRZ = assets.currencies.find((c) => c.code === 'BRL')

function loadKey() {
  const m = readFileSync('contracts/.env', 'utf8').match(/^DEPLOYER_PRIVATE_KEY=(.*)$/m)
  let k = (m?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
  if (!k || k === '0x...') throw new Error('No deploy key in contracts/.env')
  if (!k.startsWith('0x')) k = '0x' + k
  return k
}

const account = privateKeyToAccount(loadKey())
const rpc = process.env.BASE_RPC_URL || 'https://mainnet.base.org'
const pub = createPublicClient({ chain: base, transport: http(rpc, { retryCount: 6, retryDelay: 500 }) })
const wallet = createWalletClient({ account, chain: base, transport: http(rpc, { retryCount: 6 }) })

async function post(path, body) {
  const r = await fetch(APP + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`${path}: ${j.error}`)
  return j
}

/** Sequential send with a hard status check — a reverted receipt still resolves. */
async function send(label, to, data) {
  process.stdout.write(`  ${label.padEnd(42)}`)
  const hash = await wallet.sendTransaction({ to, data })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${label} REVERTED — ${hash}`)
  console.log(`ok  gas ${receipt.gasUsed}`)
  return receipt
}

const main = async () => {
  console.log('=== demo folio, Base mainnet ===\n')
  console.log('buyer  ', account.address)
  console.log('vault  ', deployment.folioVault)

  const [eth, brz] = await Promise.all([
    pub.getBalance({ address: account.address }),
    pub.readContract({ address: BRZ.address, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
  ])
  const brzHuman = Number(formatUnits(brz, BRZ.decimals))
  console.log('ETH    ', formatEther(eth))
  console.log('BRZ    ', brzHuman.toFixed(4))
  if (brzHuman < AMOUNT_BRL) throw new Error(`Need ${AMOUNT_BRL} BRZ, have ${brzHuman}`)
  if (eth === 0n) throw new Error('No ETH for gas')

  // 1. Allocate and price through the running app.
  const alloc = await post('/api/allocate', { prompt: PROMPT })
  console.log(`\nallocator: ${alloc.interpretation}`)
  const weights = alloc.lines.map((l) => ({ symbol: l.symbol, weightBps: l.weightBps }))

  const { plan } = await post('/api/plan', { currency: 'BRL', amountLocal: AMOUNT_BRL, weights })
  console.log(`plan:      R$${AMOUNT_BRL} -> ${plan.legs.length} legs, cost ${plan.totalCostPct.toFixed(2)}%`)
  for (const leg of plan.legs) {
    console.log(`           ${leg.display.padEnd(9)} ${leg.shares.toFixed(6)} sh (worst ${leg.minShares.toFixed(6)})`)
  }

  const { swaps } = await post('/api/build', {
    sender: account.address,
    legs: plan.legs,
    slippageBps: plan.slippageBps,
  })
  const router = swaps[0].routerAddress

  // 2. A claim-link gift: escrowed against keccak(secret), unlocking in 2028.
  const secretBytes = new Uint8Array(32)
  ;(globalThis.crypto ?? (await import('node:crypto')).webcrypto).getRandomValues(secretBytes)
  const secret = '0x' + Buffer.from(secretBytes).toString('hex')
  const claimHash = keccak256(secret)
  const unlockAt = BigInt(Math.floor(new Date(UNLOCK_ISO).getTime() / 1000))

  const contributions = plan.legs.map((leg) => ({
    token: leg.tokenOut,
    amount: BigInt(leg.minAmountOutRaw),
  }))
  const totalIn = plan.legs.reduce((s, l) => s + BigInt(l.amountInRaw), 0n)

  const approve = (token, spender, amount) =>
    encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] })

  console.log('\nsending (EOA, so one at a time):')
  await send('allow BRZ to be swapped', BRZ.address, approve(BRZ.address, router, totalIn))
  for (const [i, s] of swaps.entries()) {
    await send(`buy ${plan.legs[i].display}`, s.routerAddress, s.data)
  }
  for (const [i, c] of contributions.entries()) {
    await send(`allow ${plan.legs[i].display} into the vault`, c.token, approve(c.token, deployment.folioVault, c.amount))
  }

  const createData = encodeFunctionData({
    abi: vaultAbi,
    functionName: 'createFolio',
    args: [
      '0x0000000000000000000000000000000000000000', // escrowed for a claim link
      FOLIO_NAME,
      unlockAt,
      0n, // never reclaimable — it stays claimable
      claimHash,
      alloc.policyHash,
      contributions,
    ],
  })
  const receipt = await send(`create "${FOLIO_NAME}"`, deployment.folioVault, createData)

  let folioId = null
  for (const log of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics })
      if (d.eventName === 'FolioCreated') folioId = d.args.folioId.toString()
    } catch {
      /* not ours */
    }
  }
  if (!folioId) throw new Error('FolioCreated not found in the receipt')

  const out = {
    folioId,
    name: FOLIO_NAME,
    secret,
    claimHash,
    unlockAt: UNLOCK_ISO,
    creator: account.address,
    vault: deployment.folioVault,
    txHash: receipt.transactionHash,
  }
  writeFileSync('.demo-folio.json', JSON.stringify(out, null, 2))

  console.log(`\n=== folio #${folioId} created ===`)
  console.log(`detail   ${APP}/folio/${folioId}`)
  console.log(`claim    ${APP}/claim/${folioId}#${secret}`)
  console.log(`basescan https://basescan.org/tx/${receipt.transactionHash}`)
  console.log('\nSecret written to .demo-folio.json (gitignored). It is the only key.')
}

main().catch((e) => {
  console.error('\nFAILED:', e.message)
  process.exitCode = 1
})
