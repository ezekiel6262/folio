import 'server-only'
import { PublicKey } from '@solana/web3.js'
import { budget, compile } from './buy'
import { claimIx, reclaimIx } from './folio-program'
import { readFolio } from './folio-reader'
import { connection } from './market'

/**
 * Builds a claim. Three signers: our fee payer, the claim link's key (signed in the
 * recipient's browser — the secret never reaches us), and the recipient's wallet. The
 * link key's signature covers who is claiming, so a copied transaction cannot be
 * redirected to someone else.
 */
export async function buildClaim(a: { folio: string; claimKey: string; claimant: string }) {
  const f = await readFolio(a.folio)
  if (!f) throw new Error('There is no gift at that address.')
  if (!f.escrowed) throw new Error('This gift has already been claimed.')
  if (f.claimKey !== a.claimKey) throw new Error('This link does not belong to this gift.')

  const latest = await connection.getLatestBlockhash('confirmed')
  const built = compile(
    [
      ...budget(40_000),
      claimIx({ folio: new PublicKey(a.folio), claimKey: new PublicKey(a.claimKey), claimant: new PublicKey(a.claimant) }),
    ],
    latest.blockhash,
    [],
  )
  return { transaction: built.base64, lastValidBlockHeight: latest.lastValidBlockHeight }
}

/** The sender takes back a gift nobody claimed, once the window they chose has passed. */
export async function buildReclaim(a: { folio: string; creator: string }) {
  const f = await readFolio(a.folio)
  if (!f) throw new Error('There is no gift at that address.')
  if (!f.escrowed) throw new Error('This gift has already been claimed.')
  if (f.creator !== a.creator) throw new Error('Only the person who sent this gift can take it back.')
  if (!f.reclaimAfter) throw new Error('This gift was sent without a take-back date.')
  if (f.reclaimAfter * 1000 > Date.now()) throw new Error('The take-back window has not opened yet.')

  const latest = await connection.getLatestBlockhash('confirmed')
  const built = compile(
    [...budget(30_000), reclaimIx({ folio: new PublicKey(a.folio), creator: new PublicKey(a.creator) })],
    latest.blockhash,
    [],
  )
  return { transaction: built.base64, lastValidBlockHeight: latest.lastValidBlockHeight }
}
