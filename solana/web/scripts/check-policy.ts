/**
 * The policy hash is what a folio carries on-chain to say which idea built it, and what
 * Explore counts copies by. These check that it actually commits to everything in the
 * policy — including the split, which an earlier canonicalisation quietly dropped.
 *
 *   npx -y tsx --conditions=react-server scripts/check-policy.ts
 */
import { canonicalJson, hashPolicy, rulesAllocator, type Policy } from '../lib/allocator'

const base: Policy = {
  version: 1,
  engine: 'rules-v1-solana',
  prompt: 'Apple and Nvidia',
  tilt: 'balanced',
  maxWeight: 0.6,
  weights: { AAPLx: 5000, NVDAx: 5000 },
  excluded: [],
}

let failed = 0
const check = (name: string, ok: boolean) => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}

check('the split survives canonicalisation', canonicalJson(base).includes('"AAPLx":5000'))
check('key order does not change the hash', hashPolicy(base) === hashPolicy({ ...base, weights: { NVDAx: 5000, AAPLx: 5000 } }))
check('a different split is a different idea', hashPolicy(base) !== hashPolicy({ ...base, weights: { AAPLx: 9000, NVDAx: 1000 } }))
check('a different sentence is a different idea', hashPolicy(base) !== hashPolicy({ ...base, prompt: 'Apple and Tesla' }))
check('a different exclusion is a different idea', hashPolicy(base) !== hashPolicy({ ...base, excluded: ['TSLAx'] }))
check('a hash is 32 bytes of hex', /^[0-9a-f]{64}$/.test(hashPolicy(base)))

// The allocator's own output must hash to what it reports, or the chain records a lie.
const a = rulesAllocator.allocate({ prompt: 'Apple, Nvidia and the S&P 500' })
check('the allocator reports its own hash', a.policyHash === hashPolicy(a.policy))
check('the same sentence twice is the same idea', a.policyHash === rulesAllocator.allocate({ prompt: 'Apple, Nvidia and the S&P 500' }).policyHash)

console.log(`\n${8 - failed}/8 passed`)
process.exit(failed ? 1 : 0)
