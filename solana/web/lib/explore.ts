import 'server-only'
import { PublicKey } from '@solana/web3.js'
import { PROGRAMS } from './assets'
import { decodeListing, FOLIO_ACCOUNT_SIZE, LISTING_ACCOUNT_SIZE, type ListingAccount } from './folio-program'
import { readFolio, type FolioView } from './folio-reader'
import { connection } from './market'

/**
 * The public shelf.
 *
 * Only folios whose owners listed them appear here — the listing is a separate account, so
 * a folio nobody published simply has none. What a visitor copies is the idea, not the
 * person: they get their own folio, bought at today's prices, in their own name.
 *
 * Copies are countable without a database, because a basket carries the hash of the
 * allocation that made it: folios sharing a listing's policy hash came from the same
 * sentence.
 */

/** The policy hash sits after four pubkeys in the Folio account. */
const FOLIO_POLICY_OFFSET = 8 + 32 * 4
const TTL_MS = 60_000

export type ExploreCard = {
  folio: string
  name: string
  note: string
  owner: string
  listedAt: number
  madeAt: number
  totalUsd: number
  /** What the companies in it did today, weighted. Never presented as the owner's return. */
  change24hPct?: number
  /** When the owner may take it apart, if they chose to hold it shut. 0 means no lock. */
  unlockAt: number
  copies: number
  holdings: { symbol: string; display: string; weightPct: number; shares: number }[]
}

let cache: { at: number; value: ExploreCard[] } | null = null

async function listings(): Promise<ListingAccount[]> {
  const accounts = await connection.getProgramAccounts(new PublicKey(PROGRAMS.folioVault), {
    filters: [{ dataSize: LISTING_ACCOUNT_SIZE }],
    commitment: 'confirmed',
  })
  return accounts
    .map((a) => decodeListing(a.pubkey, a.account.data as Buffer))
    .filter((l): l is ListingAccount => Boolean(l))
    .sort((a, b) => b.listedAt - a.listedAt)
}

/** How many folios were built from the same sentence, this one included. */
async function copiesOf(policyHash: string): Promise<number> {
  const accounts = await connection.getProgramAccounts(new PublicKey(PROGRAMS.folioVault), {
    filters: [{ dataSize: FOLIO_ACCOUNT_SIZE }, { memcmp: { offset: FOLIO_POLICY_OFFSET, bytes: hexToBase58(policyHash) } }],
    dataSlice: { offset: 0, length: 0 },
    commitment: 'confirmed',
  })
  return accounts.length
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** getProgramAccounts compares bytes given in base58. */
function hexToBase58(hex: string): string {
  let value = BigInt(`0x${hex}`)
  let out = ''
  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out
    value /= 58n
  }
  // Leading zero bytes are '1's in base58.
  for (let i = 0; i < hex.length && hex.slice(i, i + 2) === '00'; i += 2) out = `1${out}`
  return out || '1'
}

/**
 * One card per thing said. Two people who published the same basket with the same sentence
 * are the same idea twice over, so the shelf keeps whoever said it first and lets the copy
 * count speak for the rest. Say it differently and you get your own card.
 */
function sameIdeaOnce(shelf: ListingAccount[]): ListingAccount[] {
  const first = new Map<string, ListingAccount>()
  for (const listing of shelf) {
    const idea = `${listing.policyHash}:${listing.note.trim().toLowerCase()}`
    const held = first.get(idea)
    if (!held || listing.listedAt < held.listedAt) first.set(idea, listing)
  }
  return [...first.values()].sort((a, b) => b.listedAt - a.listedAt)
}

async function countInto(counted: Map<string, number>, policyHash: string): Promise<number> {
  const n = await copiesOf(policyHash).catch(() => 1)
  counted.set(policyHash, n)
  return n
}

export async function exploreCards(limit = 24): Promise<ExploreCard[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value

  const shelf = sameIdeaOnce(await listings()).slice(0, limit)
  const cards: ExploreCard[] = []
  const counted = new Map<string, number>()

  for (const listing of shelf) {
    const folio: FolioView | null = await readFolio(listing.folio).catch(() => null)
    // A listing whose folio was emptied or closed is simply not shown.
    if (!folio || folio.escrowed || !folio.holdings.length) continue
    cards.push({
      folio: folio.address,
      name: folio.name,
      note: listing.note,
      owner: listing.owner,
      listedAt: listing.listedAt,
      madeAt: folio.createdAt,
      totalUsd: folio.totalUsd,
      change24hPct: folio.change24hPct,
      unlockAt: folio.locked ? folio.unlockAt : 0,
      copies: counted.get(listing.policyHash) ?? (await countInto(counted, listing.policyHash)),
      holdings: folio.holdings.map((h) => ({ symbol: h.symbol, display: h.display, weightPct: h.weightPct, shares: h.shares })),
    })
  }

  cache = { at: Date.now(), value: cards }
  return cards
}

/** Whether one folio is on the shelf, for its own page. */
export async function listingFor(folio: string): Promise<ListingAccount | null> {
  const { listingPda } = await import('./folio-program')
  const address = listingPda(new PublicKey(folio))
  const info = await connection.getAccountInfo(address, 'confirmed')
  return info ? decodeListing(address, info.data) : null
}
