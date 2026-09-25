/**
 * Checks the hand-written instruction encoders in lib/folio-program.ts against the IDL the
 * program actually compiles to: discriminator, account count, and each account's signer /
 * writable flags, position by position. Also checks the Folio account layout.
 *
 *   npx -y tsx --conditions=react-server scripts/check-idl.ts
 */
import { readFileSync } from 'node:fs'
import { Keypair, PublicKey, type TransactionInstruction } from '@solana/web3.js'
import * as fp from '../lib/folio-program'

type IdlAccount = { name: string; writable?: boolean; signer?: boolean; optional?: boolean }
type IdlIx = { name: string; discriminator: number[]; accounts: IdlAccount[]; args: { name: string; type: unknown }[] }
type Idl = {
  instructions: IdlIx[]
  accounts: { name: string; discriminator: number[] }[]
  types: { name: string; type: { kind: string; fields?: { name: string; type: unknown }[] } }[]
}

const idl: Idl = JSON.parse(readFileSync(new URL('../lib/folio_vault.idl.json', import.meta.url), 'utf8'))
const k = () => Keypair.generate().publicKey
const [creator, payer, owner, mint, dest, claimKey, claimant, recipient, newOwner, rentPayer] = Array.from({ length: 10 }, k)
const folio = fp.folioPda(creator, 7n)

const built: Record<string, TransactionInstruction> = {
  create_folio: fp.createFolioIx({
    creator,
    payer,
    nonce: 7n,
    name: 'x',
    unlockAt: 0,
    reclaimAfter: 0,
    claimKey,
    policyHash: Buffer.alloc(32),
    recipient,
  }),
  deposit: fp.depositIx({ folio, mint, depositor: owner, payer, amount: 1n }),
  sync_vault: fp.syncVaultIx({ folio, mint }),
  claim: fp.claimIx({ folio, claimKey, claimant }),
  reclaim: fp.reclaimIx({ folio, creator }),
  transfer_folio: fp.transferFolioIx({ folio, owner, newOwner }),
  extend_lock: fp.extendLockIx({ folio, owner, newUnlockAt: 1 }),
  withdraw: fp.withdrawIx({ folio, mint, owner, destination: dest, amount: 1n }),
  close_vault: fp.closeVaultIx({ folio, mint, owner, rentPayer }),
  close_folio: fp.closeFolioIx({ folio, owner, rentPayer }),
  list_folio: fp.listFolioIx({ folio, owner, payer, note: 'x' }),
  unlist_folio: fp.unlistFolioIx({ folio, owner, rentPayer }),
}

let failed = 0
const fail = (msg: string) => {
  failed++
  console.log(`FAIL  ${msg}`)
}

for (const [name, ix] of Object.entries(built)) {
  const spec = idl.instructions.find((i) => i.name === name)
  if (!spec) {
    fail(`${name}: not in the IDL`)
    continue
  }
  if (!ix.programId.equals(fp.PROGRAM_ID)) fail(`${name}: wrong program id`)
  if (!Buffer.from(spec.discriminator).equals(ix.data.subarray(0, 8))) fail(`${name}: discriminator differs`)
  if (spec.accounts.length !== ix.keys.length) {
    fail(`${name}: IDL has ${spec.accounts.length} accounts, encoder has ${ix.keys.length}`)
  }
  spec.accounts.forEach((a, i) => {
    const key = ix.keys[i]
    if (!key) return
    if (Boolean(a.signer) !== key.isSigner) fail(`${name}[${i}] ${a.name}: signer ${Boolean(a.signer)} vs encoder ${key.isSigner}`)
    if (Boolean(a.writable) !== key.isWritable) fail(`${name}[${i}] ${a.name}: writable ${Boolean(a.writable)} vs encoder ${key.isWritable}`)
  })
  console.log(`      ${name}: ${spec.accounts.map((a) => a.name).join(', ')}  |  args: ${spec.args.map((a) => a.name).join(', ') || '—'}`)
}

for (const spec of idl.instructions) {
  if (!built[spec.name] && !['initialize', 'set_asset', 'set_paused'].includes(spec.name)) fail(`${spec.name}: no encoder`)
}

// Folio account: discriminator and the field order decodeFolio assumes.
const acct = idl.accounts.find((a) => a.name === 'Folio')
if (!acct || !Buffer.from(acct.discriminator).equals(fp.FOLIO_DISC)) fail('Folio account discriminator differs')
const fields = idl.types.find((t) => t.name === 'Folio')?.type.fields?.map((f) => f.name) ?? []
const expected = [
  'owner', 'creator', 'rent_payer', 'claim_key', 'policy_hash', 'created_at', 'unlock_at',
  'reclaim_after', 'nonce', 'escrowed', 'bump', 'asset_count', 'assets', 'name',
]
if (fields.join() !== expected.join()) fail(`Folio fields are [${fields.join(', ')}], decoder assumes [${expected.join(', ')}]`)

console.log(failed ? `\n${failed} mismatch(es)` : '\nEncoders match the IDL')
process.exit(failed ? 1 : 0)
