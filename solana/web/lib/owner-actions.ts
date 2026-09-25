import 'server-only'
import { PublicKey } from '@solana/web3.js'
import { FEE_PAYER } from './assets'
import { budget, compile } from './buy'
import { closeFolioIx, extendLockIx, listFolioIx, transferFolioIx, unlistFolioIx } from './folio-program'
import { listingFor } from './explore'
import { readFolio } from './folio-reader'
import { connection } from './market'

/**
 * The things an owner can do to a folio itself rather than to its contents: hand it to
 * someone, hold it shut for longer, or close it once it is empty. All three exist in the
 * program; these put them in reach.
 */

async function ownedBy(address: string, owner: string) {
  const folio = await readFolio(address)
  if (!folio) throw new Error('No folio at that address')
  if (folio.escrowed) throw new Error('This folio has not been claimed yet')
  if (folio.owner !== owner) throw new Error('Only the owner can do that')
  return folio
}

const one = async (instruction: Parameters<typeof compile>[0][number]) => {
  const latest = await connection.getLatestBlockhash('confirmed')
  const built = compile([...budget(40_000), instruction], latest.blockhash, [])
  return { transaction: built.base64, lastValidBlockHeight: latest.lastValidBlockHeight }
}

/** Give the whole folio to another account. Any lock travels with it. */
export async function buildHandOn(a: { owner: string; folio: string; newOwner: string }) {
  await ownedBy(a.folio, a.owner)
  const newOwner = new PublicKey(a.newOwner)
  if (newOwner.toBase58() === a.owner) throw new Error('That is already your address')
  return one(transferFolioIx({ folio: new PublicKey(a.folio), owner: new PublicKey(a.owner), newOwner }))
}

/** Locks only ever move further out: a promise you cannot quietly take back. */
export async function buildExtendLock(a: { owner: string; folio: string; newUnlockAt: number }) {
  const folio = await ownedBy(a.folio, a.owner)
  if (!(a.newUnlockAt > folio.unlockAt)) throw new Error('A lock can only be moved further out')
  if (a.newUnlockAt * 1000 < Date.now()) throw new Error('Choose a date in the future')
  return one(extendLockIx({ folio: new PublicKey(a.folio), owner: new PublicKey(a.owner), newUnlockAt: a.newUnlockAt }))
}

/**
 * Show a folio publicly. The listing is its own account, so a folio nobody published has
 * none: privacy is the default state rather than a setting somebody has to find.
 */
export async function buildPublish(a: { owner: string; folio: string; note: string }) {
  await ownedBy(a.folio, a.owner)
  const note = a.note.trim().slice(0, 100)
  if (!note) throw new Error('Say in a line what this folio is')
  return one(
    listFolioIx({
      folio: new PublicKey(a.folio),
      owner: new PublicKey(a.owner),
      payer: new PublicKey(FEE_PAYER),
      note,
    }),
  )
}

/** Take it off the shelf. The deposit goes back to whoever paid it. */
export async function buildUnpublish(a: { owner: string; folio: string }) {
  await ownedBy(a.folio, a.owner)
  const listing = await listingFor(a.folio)
  if (!listing) throw new Error('That folio is not public')
  return one(
    unlistFolioIx({
      folio: new PublicKey(a.folio),
      owner: new PublicKey(a.owner),
      rentPayer: new PublicKey(listing.rentPayer),
    }),
  )
}

/** Closing an empty folio returns its deposit to whoever paid it — Folio, not the owner. */
export async function buildCloseFolio(a: { owner: string; folio: string }) {
  const folio = await ownedBy(a.folio, a.owner)
  if (folio.holdings.some((h) => Number(h.rawAmount) > 0)) throw new Error('Take everything out or sell it first')
  return one(
    closeFolioIx({
      folio: new PublicKey(a.folio),
      owner: new PublicKey(a.owner),
      rentPayer: new PublicKey(folio.rentPayer || FEE_PAYER),
    }),
  )
}
