import { canonicalJson } from './canonical'
import type { Policy } from './allocator'

/**
 * The sentence that built a folio, kept on the device that made it.
 *
 * The chain stores only a hash of the policy, which is enough to prove a policy is the
 * right one but not enough to read it back. Folio has no database to keep the rest in, so
 * the browser keeps it and the hash decides whether to trust it: a stored policy is used
 * only when it hashes to exactly what the folio recorded. Clear the browser and the folio
 * is untouched — it simply stops offering to put itself back in balance.
 */

const KEY = 'folio.policies.v1'

type Stored = Record<string, { policy: Policy; savedAt: number }>

function read(): Stored {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Stored) : {}
  } catch {
    return {}
  }
}

export function rememberPolicy(folio: string, policy: Policy) {
  if (typeof window === 'undefined') return
  try {
    const all = read()
    all[folio] = { policy, savedAt: Math.floor(Date.now() / 1000) }
    window.localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // A folio without its sentence still works; only rebalancing needs it.
  }
}

export function forgetPolicy(folio: string) {
  if (typeof window === 'undefined') return
  try {
    const all = read()
    delete all[folio]
    window.localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* nothing to undo */
  }
}

export async function hashOf(policy: Policy): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(policy))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** The policy this folio was built from, but only if it still hashes to what the chain says. */
export async function policyFor(folio: string, policyHash: string): Promise<Policy | null> {
  const held = read()[folio]?.policy
  if (!held) return null
  try {
    return (await hashOf(held)) === policyHash ? held : null
  } catch {
    return null
  }
}

/** The split it asked for, as whole percentages, largest first. */
export function targetsOf(policy: Policy) {
  return Object.entries(policy.weights)
    .map(([symbol, weightBps]) => ({ symbol, weightBps }))
    .sort((a, b) => b.weightBps - a.weightBps)
}
