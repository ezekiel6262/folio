import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from '@solana/web3.js'
import { PROGRAMS } from './assets'

/**
 * Client for the folio_vault program. Account order and mutability mirror the Rust
 * `#[derive(Accounts)]` structs exactly; a mismatch is a failed transaction, so this file
 * is checked against the program's IDL. Server-only: every transaction is built here and
 * the browser only ever signs its own slot.
 */

export const PROGRAM_ID = new PublicKey(PROGRAMS.folioVault)
export const TOKEN_2022 = new PublicKey(PROGRAMS.token2022)
export const TOKEN = new PublicKey(PROGRAMS.token)
export const ATA_PROGRAM = new PublicKey(PROGRAMS.associatedToken)
export const SYSTEM = SystemProgram.programId

/** Anchor's instruction discriminator: the first 8 bytes of sha256("global:<name>"). */
const disc = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)
export const FOLIO_DISC = createHash('sha256').update('account:Folio').digest().subarray(0, 8)

/** 8-byte discriminator + Folio::INIT_SPACE. Unique among this program's accounts. */
export const FOLIO_ACCOUNT_SIZE = 503
/** 8-byte discriminator + Listing::INIT_SPACE (folio, owner, rent payer, policy hash, time, bump, note). */
export const LISTING_ACCOUNT_SIZE = 8 + 32 * 3 + 32 + 8 + 1 + 4 + 100
export const LISTING_DISC = createHash('sha256').update('account:Listing').digest().subarray(0, 8)

// ------------------------------------------------------------------ addresses

export const configPda = () => PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)[0]
export const listingPda = (folio: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from('listing'), folio.toBuffer()], PROGRAM_ID)[0]
export const assetPda = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from('asset'), mint.toBuffer()], PROGRAM_ID)[0]
export function folioPda(creator: PublicKey, nonce: bigint) {
  const n = Buffer.alloc(8)
  n.writeBigUInt64LE(nonce)
  return PublicKey.findProgramAddressSync([Buffer.from('folio'), creator.toBuffer(), n], PROGRAM_ID)[0]
}
export const ata = (owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey = TOKEN_2022) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0]

export const newNonce = (): bigint => randomBytes(8).readBigUInt64LE()

// ---------------------------------------------------------------- encoding

const u64 = (v: bigint) => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(v)
  return b
}
const i64 = (v: number | bigint) => {
  const b = Buffer.alloc(8)
  b.writeBigInt64LE(BigInt(v))
  return b
}
const str = (s: string) => {
  const bytes = Buffer.from(s, 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32LE(bytes.length)
  return Buffer.concat([len, bytes])
}
const optionPubkey = (k: PublicKey | null) => (k ? Buffer.concat([Buffer.from([1]), k.toBuffer()]) : Buffer.from([0]))

const m = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean): AccountMeta => ({ pubkey, isSigner, isWritable })
const ix = (keys: AccountMeta[], data: Buffer) => new TransactionInstruction({ programId: PROGRAM_ID, keys, data })

// ------------------------------------------------------------ instructions

export function createFolioIx(a: {
  creator: PublicKey
  payer: PublicKey
  nonce: bigint
  name: string
  unlockAt: number
  reclaimAfter: number
  /** Public half of a claim link's key; null when giving directly or keeping. */
  claimKey: PublicKey | null
  policyHash: Buffer
  /** null escrows the folio behind the claim key. */
  recipient: PublicKey | null
}) {
  if (Buffer.byteLength(a.name, 'utf8') > 40) throw new Error('Folio names are at most 40 bytes')
  if (a.policyHash.length !== 32) throw new Error('policy hash must be 32 bytes')
  return ix(
    [
      m(configPda(), false, false),
      m(folioPda(a.creator, a.nonce), false, true),
      m(a.creator, true, false),
      m(a.payer, true, true),
      m(SYSTEM, false, false),
    ],
    Buffer.concat([
      disc('create_folio'),
      u64(a.nonce),
      str(a.name),
      i64(a.unlockAt),
      i64(a.reclaimAfter),
      (a.claimKey ?? PublicKey.default).toBuffer(),
      a.policyHash,
      optionPubkey(a.recipient),
    ]),
  )
}

/** Records what a swap paid straight into the vault, and enforces the cap. */
export function syncVaultIx(a: { folio: PublicKey; mint: PublicKey }) {
  return ix(
    [
      m(configPda(), false, false),
      m(a.folio, false, true),
      m(assetPda(a.mint), false, false),
      m(a.mint, false, false),
      m(ata(a.folio, a.mint), false, false),
      m(TOKEN_2022, false, false),
    ],
    disc('sync_vault'),
  )
}

/** Moves tokens the user already holds into a folio (top-ups, gifting existing holdings). */
export function depositIx(a: { folio: PublicKey; mint: PublicKey; depositor: PublicKey; payer: PublicKey; amount: bigint }) {
  return ix(
    [
      m(configPda(), false, false),
      m(a.folio, false, true),
      m(assetPda(a.mint), false, false),
      m(a.mint, false, false),
      m(ata(a.depositor, a.mint), false, true),
      m(ata(a.folio, a.mint), false, true),
      m(a.depositor, true, false),
      m(a.payer, true, true),
      m(TOKEN_2022, false, false),
      m(ATA_PROGRAM, false, false),
      m(SYSTEM, false, false),
    ],
    Buffer.concat([disc('deposit'), u64(a.amount)]),
  )
}

export function claimIx(a: { folio: PublicKey; claimKey: PublicKey; claimant: PublicKey }) {
  return ix([m(a.folio, false, true), m(a.claimKey, true, false), m(a.claimant, true, false)], disc('claim'))
}

export function reclaimIx(a: { folio: PublicKey; creator: PublicKey }) {
  return ix([m(a.folio, false, true), m(a.creator, true, false)], disc('reclaim'))
}

export function transferFolioIx(a: { folio: PublicKey; owner: PublicKey; newOwner: PublicKey }) {
  return ix([m(a.folio, false, true), m(a.owner, true, false)], Buffer.concat([disc('transfer_folio'), a.newOwner.toBuffer()]))
}

export function extendLockIx(a: { folio: PublicKey; owner: PublicKey; newUnlockAt: number }) {
  return ix([m(a.folio, false, true), m(a.owner, true, false)], Buffer.concat([disc('extend_lock'), i64(a.newUnlockAt)]))
}

export function withdrawIx(a: { folio: PublicKey; mint: PublicKey; owner: PublicKey; destination: PublicKey; amount: bigint }) {
  return ix(
    [
      m(a.folio, false, false),
      m(a.mint, false, false),
      m(ata(a.folio, a.mint), false, true),
      m(a.destination, false, true),
      m(a.owner, true, false),
      m(TOKEN_2022, false, false),
    ],
    Buffer.concat([disc('withdraw'), u64(a.amount)]),
  )
}

export function closeVaultIx(a: { folio: PublicKey; mint: PublicKey; owner: PublicKey; rentPayer: PublicKey }) {
  return ix(
    [
      m(a.folio, false, true),
      m(a.mint, false, false),
      m(ata(a.folio, a.mint), false, true),
      m(a.rentPayer, false, true),
      m(a.owner, true, false),
      m(TOKEN_2022, false, false),
    ],
    disc('close_vault'),
  )
}

export function closeFolioIx(a: { folio: PublicKey; owner: PublicKey; rentPayer: PublicKey }) {
  return ix([m(a.folio, false, true), m(a.rentPayer, false, true), m(a.owner, true, false)], disc('close_folio'))
}

/** Put a folio on the public shelf. Opt-in, and reversible by `unlistFolioIx`. */
export function listFolioIx(a: { folio: PublicKey; owner: PublicKey; payer: PublicKey; note: string }) {
  if (Buffer.byteLength(a.note, 'utf8') > 400) throw new Error('That note is too long')
  return ix(
    [
      m(a.folio, false, false),
      m(listingPda(a.folio), false, true),
      m(a.owner, true, false),
      m(a.payer, true, true),
      m(SYSTEM, false, false),
    ],
    Buffer.concat([disc('list_folio'), str(a.note)]),
  )
}

export function unlistFolioIx(a: { folio: PublicKey; owner: PublicKey; rentPayer: PublicKey }) {
  return ix(
    [m(a.folio, false, false), m(listingPda(a.folio), false, true), m(a.rentPayer, false, true), m(a.owner, true, false)],
    disc('unlist_folio'),
  )
}

export type ListingAccount = { address: string; folio: string; owner: string; rentPayer: string; policyHash: string; listedAt: number; note: string }

/** Byte layout of the Rust `Listing` struct, after its 8-byte discriminator. */
export function decodeListing(address: PublicKey, data: Buffer): ListingAccount | null {
  if (data.length < LISTING_ACCOUNT_SIZE || !data.subarray(0, 8).equals(LISTING_DISC)) return null
  let o = 8
  const key = () => {
    const k = new PublicKey(data.subarray(o, o + 32))
    o += 32
    return k.toBase58()
  }
  const folio = key()
  const owner = key()
  const rentPayer = key()
  const policyHash = data.subarray(o, o + 32).toString('hex')
  o += 32
  const listedAt = Number(data.readBigInt64LE(o))
  o += 8
  o += 1 // bump
  const noteLen = data.readUInt32LE(o)
  o += 4
  const note = data.subarray(o, o + noteLen).toString('utf8')
  return { address: address.toBase58(), folio, owner, rentPayer, policyHash, listedAt, note }
}

/** Associated token account, created only if missing, funded by `payer`. */
export function createAtaIdempotentIx(a: { payer: PublicKey; owner: PublicKey; mint: PublicKey; tokenProgram: PublicKey }) {
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      m(a.payer, true, true),
      m(ata(a.owner, a.mint, a.tokenProgram), false, true),
      m(a.owner, false, false),
      m(a.mint, false, false),
      m(SYSTEM, false, false),
      m(a.tokenProgram, false, false),
    ],
    data: Buffer.from([1]),
  })
}

// ---------------------------------------------------------------- decoding

export type FolioAccount = {
  address: string
  owner: string | null
  creator: string
  rentPayer: string
  claimKey: string | null
  policyHash: string
  createdAt: number
  unlockAt: number
  reclaimAfter: number
  nonce: string
  escrowed: boolean
  assets: string[]
  name: string
}

/** Byte layout of the Rust `Folio` struct, after its 8-byte discriminator. */
export function decodeFolio(address: PublicKey, data: Buffer): FolioAccount | null {
  if (data.length < FOLIO_ACCOUNT_SIZE || !data.subarray(0, 8).equals(FOLIO_DISC)) return null
  let o = 8
  const key = () => {
    const k = new PublicKey(data.subarray(o, o + 32))
    o += 32
    return k
  }
  const owner = key()
  const creator = key()
  const rentPayer = key()
  const claimKey = key()
  const policyHash = data.subarray(o, o + 32).toString('hex')
  o += 32
  const createdAt = Number(data.readBigInt64LE(o))
  const unlockAt = Number(data.readBigInt64LE(o + 8))
  const reclaimAfter = Number(data.readBigInt64LE(o + 16))
  const nonce = data.readBigUInt64LE(o + 24).toString()
  o += 32
  const escrowed = data[o] === 1
  const count = data[o + 2]
  o += 3
  const assets: string[] = []
  for (let i = 0; i < 8; i++) {
    if (i < count) assets.push(new PublicKey(data.subarray(o, o + 32)).toBase58())
    o += 32
  }
  const nameLen = data.readUInt32LE(o)
  const name = data.toString('utf8', o + 4, o + 4 + nameLen)

  const none = PublicKey.default
  return {
    address: address.toBase58(),
    owner: owner.equals(none) ? null : owner.toBase58(),
    creator: creator.toBase58(),
    rentPayer: rentPayer.toBase58(),
    claimKey: claimKey.equals(none) ? null : claimKey.toBase58(),
    policyHash,
    createdAt,
    unlockAt,
    reclaimAfter,
    nonce,
    escrowed,
    assets,
    name,
  }
}
