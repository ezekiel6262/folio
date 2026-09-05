// The paymaster proxy guards a real spending authority. Prove it refuses everything
// that is not this app before trusting it with a gas budget.
import { encodeFunctionData } from 'viem'

const APP = process.env.APP || 'http://localhost:3010'
const assets = JSON.parse(await (await fetch(`${APP}/api/prices`)).ok ? '{}' : '{}')

const ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5'
const AAPL = '0xb200000000000000000000C2e324d24d7eEcd1fb'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const STRANGER = '0x000000000000000000000000000000000000dEaD'

const CALL = [
  { name: 'target', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'data', type: 'bytes' },
]
const ABI = [
  { type: 'function', name: 'execute', stateMutability: 'nonpayable', inputs: CALL, outputs: [] },
  {
    type: 'function', name: 'executeBatch', stateMutability: 'nonpayable',
    inputs: [{ name: 'calls', type: 'tuple[]', components: CALL }], outputs: [],
  },
]

const batch = (targets) =>
  encodeFunctionData({
    abi: ABI,
    functionName: 'executeBatch',
    args: [targets.map((t) => ({ target: t, value: 0n, data: '0x' }))],
  })

const single = (target) =>
  encodeFunctionData({ abi: ABI, functionName: 'execute', args: [target, 0n, '0x'] })

async function ask(label, body) {
  const res = await fetch(`${APP}/api/paymaster`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await res.json().catch(() => ({}))
  const declined = j?.error?.message?.startsWith('Not sponsored')
  const forwarded = !declined && !j?.error?.message?.includes('not proxied') && res.status !== 403
  const verdict = declined ? 'DECLINED' : forwarded ? 'FORWARDED' : 'BLOCKED'
  console.log(`${label.padEnd(46)} ${String(res.status).padEnd(4)} ${verdict}`)
  if (j?.error?.message) console.log(`${' '.repeat(48)}${j.error.message.slice(0, 90)}`)
  return verdict
}

console.log('=== paymaster proxy guard ===\n')
console.log('label'.padEnd(46) + 'HTTP verdict')

const results = {}
results.badMethod = await ask('eth_sendTransaction (not a paymaster method)', {
  id: 1, method: 'eth_sendTransaction', params: [{}],
})
results.noCallData = await ask('paymaster call with no callData', {
  id: 2, method: 'pm_getPaymasterData', params: [{}],
})
results.garbage = await ask('callData that is not execute/executeBatch', {
  id: 3, method: 'pm_getPaymasterData', params: [{ callData: '0xdeadbeef' }],
})
results.stranger = await ask('executeBatch touching an unknown contract', {
  id: 4, method: 'pm_getPaymasterData', params: [{ callData: batch([ROUTER, STRANGER]) }],
})
results.singleStranger = await ask('execute on an unknown contract', {
  id: 5, method: 'pm_getPaymasterStubData', params: [{ callData: single(STRANGER) }],
})
results.ours = await ask('executeBatch of only this app contracts', {
  id: 6, method: 'pm_getPaymasterData', params: [{ callData: batch([USDC, ROUTER, AAPL]) }],
})

console.log('\n=== expected ===')
const expect = {
  badMethod: 'BLOCKED', noCallData: 'DECLINED', garbage: 'DECLINED',
  stranger: 'DECLINED', singleStranger: 'DECLINED', ours: 'FORWARDED',
}
let pass = true
for (const [k, want] of Object.entries(expect)) {
  const got = results[k]
  const ok = got === want
  if (!ok) pass = false
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${k.padEnd(16)} want ${want}, got ${got}`)
}
console.log(pass ? '\nAll guard checks behaved correctly.' : '\nGUARD IS WRONG — do not ship.')
