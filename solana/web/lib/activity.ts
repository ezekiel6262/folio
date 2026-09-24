import 'server-only'
import { createHash } from 'node:crypto'
import { PublicKey } from '@solana/web3.js'
import { PROGRAMS } from './assets'
import { connection } from './market'

/**
 * A folio's story, read from the chain rather than from a database Folio would have to be
 * trusted about. Every entry is a real transaction anyone can open in an explorer, which is
 * the same reason the custody receipt exists: the app should never be the only witness.
 */

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** Small base58 decoder: the RPC hands unparsed instruction data in base58. */
function fromBase58(text: string): Buffer {
  const bytes: number[] = [0]
  for (const char of text) {
    const value = BASE58.indexOf(char)
    if (value < 0) return Buffer.alloc(0)
    let carry = value
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  // Leading zeros are encoded as '1'.
  for (const char of text) {
    if (char !== '1') break
    bytes.push(0)
  }
  return Buffer.from(bytes.reverse())
}

const disc = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8).toString('hex')

/** What each of our instructions meant, in the owner's words. */
const LABELS: Record<string, string> = {
  [disc('create_folio')]: 'Folio made',
  [disc('deposit')]: 'Shares added',
  [disc('sync_vault')]: 'Shares bought in',
  [disc('claim')]: 'Claimed by its recipient',
  [disc('reclaim')]: 'Taken back by the sender',
  [disc('transfer_folio')]: 'Handed to someone else',
  [disc('extend_lock')]: 'Lock extended',
  [disc('withdraw')]: 'Shares taken out',
  [disc('close_vault')]: 'A holding was emptied',
  [disc('close_folio')]: 'Folio closed',
}

export type ActivityEntry = { at: number; label: string; signature: string; failed: boolean }

const TTL_MS = 30_000
const cache = new Map<string, { at: number; value: ActivityEntry[] }>()

export async function folioActivity(address: string, limit = 16): Promise<ActivityEntry[]> {
  const hit = cache.get(address)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  const folio = new PublicKey(address)
  const signatures = await connection.getSignaturesForAddress(folio, { limit }, 'confirmed')
  if (!signatures.length) return []

  // One at a time, a few at once: batched RPC is a paid feature on most providers.
  const parsed: Awaited<ReturnType<typeof connection.getParsedTransaction>>[] = []
  for (let i = 0; i < signatures.length; i += 4) {
    const group = signatures.slice(i, i + 4)
    parsed.push(
      ...(await Promise.all(
        group.map((s) =>
          connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).catch(() => null),
        ),
      )),
    )
  }

  const entries: ActivityEntry[] = []
  parsed.forEach((tx, i) => {
    const sig = signatures[i]
    if (!tx) return
    const instructions = [
      ...tx.transaction.message.instructions,
      ...(tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions),
    ]
    // One line per thing that happened, not per instruction: a purchase opens a vault and
    // records it, and the owner only cares that shares arrived.
    const seen = new Set<string>()
    for (const ix of instructions) {
      if (ix.programId.toBase58() !== PROGRAMS.folioVault) continue
      // Instructions the RPC cannot parse come back with base58 data.
      const data = 'data' in ix && typeof ix.data === 'string' ? fromBase58(ix.data) : null
      const label = data ? LABELS[data.subarray(0, 8).toString('hex')] : undefined
      if (!label || seen.has(label)) continue
      seen.add(label)
      entries.push({
        at: (sig.blockTime ?? tx.blockTime ?? 0) * 1000,
        label,
        signature: sig.signature,
        failed: Boolean(sig.err),
      })
    }
  })

  // A purchase shows as "made" and "bought in" in one transaction; keep the clearer one.
  const value = entries
    .filter((e, i, all) => !(e.label === 'Shares bought in' && all.some((x) => x.signature === e.signature && x.label === 'Folio made')))
    .sort((a, b) => b.at - a.at)
  cache.set(address, { at: Date.now(), value })
  if (cache.size > 500) cache.clear()
  return value
}
