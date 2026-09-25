/**
 * Offline checks for the co-signer's rules. Every case is a crafted transaction and the
 * verdict it must get. No network: `inspect` is the part that runs before simulation.
 *
 *   npx -y tsx --conditions=react-server scripts/check-cosign.ts
 */
import { createHash } from 'node:crypto'
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { inspect } from '../lib/cosign'
import assets from '../lib/solana-assets.json'

const P = assets.programs
const FEE_PAYER = new PublicKey(assets.keys.feePayer)
const user = Keypair.generate()
const attacker = Keypair.generate().publicKey
const any = () => Keypair.generate().publicKey
const disc = (n: string) => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8)

const acct = (pubkey: PublicKey, isSigner = false, isWritable = true) => ({ pubkey, isSigner, isWritable })
const ixOf = (program: string, keys: ReturnType<typeof acct>[], data: Buffer | number[]) =>
  new TransactionInstruction({ programId: new PublicKey(program), keys, data: Buffer.from(data) })

function tx(instructions: TransactionInstruction[], { payer = FEE_PAYER, sign = true } = {}) {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: '11111111111111111111111111111111',
    instructions,
  }).compileToV0Message()
  const t = new VersionedTransaction(message)
  const signers = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures)
  if (sign && signers.some((k) => k.equals(user.publicKey))) t.sign([user])
  return t
}

const budget = (units = 200_000, micro = 20_000) => [
  ComputeBudgetProgram.setComputeUnitLimit({ units }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: micro }),
]
const ataCreate = (payer: PublicKey) =>
  ixOf(P.associatedToken, [acct(payer, true), acct(any()), acct(user.publicKey, false, false), acct(any(), false, false)], [1])
const tokenClose = (destination: PublicKey) =>
  ixOf(P.token2022, [acct(any()), acct(destination), acct(user.publicKey, true, false)], [9])
const userSigns = acct(user.publicKey, true, false)

const cases: [string, VersionedTransaction, boolean][] = [
  ['plain ATA creation funded by Folio', tx([...budget(), ataCreate(FEE_PAYER)]), true],
  ['fee payer is someone else', tx([...budget(), ataCreate(user.publicKey)], { payer: user.publicKey }), false],
  ['user has not signed', tx([...budget(), ixOf(P.token2022, [acct(any()), userSigns], [3])], { sign: false }), false],
  [
    'top-level System transfer out of Folio',
    tx([...budget(), SystemProgram.transfer({ fromPubkey: FEE_PAYER, toPubkey: attacker, lamports: 1 }), ixOf(P.token2022, [userSigns], [3])]),
    false,
  ],
  ['close a token account, refund to attacker', tx([...budget(), tokenClose(attacker)]), false],
  ['close a token account, refund to Folio', tx([...budget(), tokenClose(FEE_PAYER)]), true],
  ['close with Folio named as the owner', tx([...budget(), ixOf(P.token2022, [acct(any()), acct(attacker), acct(FEE_PAYER, true, false)], [9]), ixOf(P.token2022, [userSigns], [3])]), false],
  ['set a token authority', tx([...budget(), ixOf(P.token2022, [acct(any()), userSigns], [6, 2, 0])]), false],
  ['Folio inside a Jupiter swap', tx([...budget(), ixOf(P.jupiterV6, [userSigns, acct(any()), acct(FEE_PAYER)], [0])]), false],
  ['unknown program', tx([...budget(), ixOf(any().toBase58(), [userSigns], [0])]), false],
  ['priority fee over the cap', tx([...budget(1_400_000, 1_000_000), ataCreate(FEE_PAYER)]), false],
  ['seven account creations', tx([...budget(), ...Array.from({ length: 7 }, () => ataCreate(FEE_PAYER))]), false],
  ['admin set_asset', tx([...budget(), ixOf(P.folioVault, [acct(any()), userSigns], disc('set_asset'))]), false],
  ['create_folio with Folio as payer (position 3)', tx([...budget(), ixOf(P.folioVault, [acct(any()), acct(any()), userSigns, acct(FEE_PAYER, true)], disc('create_folio'))]), true],
  ['create_folio with Folio as creator (position 2)', tx([...budget(), ixOf(P.folioVault, [acct(any()), acct(any()), acct(FEE_PAYER, true), userSigns], disc('create_folio'))]), false],
  ['close_vault refunding Folio (position 3)', tx([...budget(), ixOf(P.folioVault, [acct(any()), acct(any(), false, false), acct(any()), acct(FEE_PAYER), userSigns], disc('close_vault'))]), true],
  ['close_vault with Folio as owner (position 4)', tx([...budget(), ixOf(P.folioVault, [acct(any()), acct(any(), false, false), acct(any()), acct(attacker), acct(FEE_PAYER, true, false)], disc('close_vault'))]), false],
  ['list_folio with Folio as payer (position 3)', tx([...budget(), ixOf(P.folioVault, [acct(any()), acct(any()), userSigns, acct(FEE_PAYER, true)], disc('list_folio'))]), true],
  ['list_folio with Folio as the owner', tx([...budget(), ixOf(P.folioVault, [acct(any()), acct(any()), acct(FEE_PAYER, true), userSigns], disc('list_folio'))]), false],
  ['unlist_folio refunding Folio (position 2)', tx([...budget(), ixOf(P.folioVault, [acct(any()), acct(any()), acct(FEE_PAYER), userSigns], disc('unlist_folio'))]), true],
  ['unlist_folio with Folio as the owner', tx([...budget(), ixOf(P.folioVault, [acct(any()), acct(any()), acct(attacker), acct(FEE_PAYER, true, false)], disc('unlist_folio'))]), false],
  ['withdraw naming Folio as destination', tx([...budget(), ixOf(P.folioVault, [acct(any()), acct(any(), false, false), acct(any()), acct(FEE_PAYER), userSigns], disc('withdraw'))]), false],
]

// Sponsorship is tied to the signed-in account: the route passes that account's wallets.
const plain = () => tx([...budget(), ataCreate(FEE_PAYER), ixOf(P.token2022, [userSigns], [3])])
const withAccount: [string, VersionedTransaction, boolean, string[]][] = [
  ['signed by the signed-in account', plain(), true, [user.publicKey.toBase58()]],
  ['signed by someone else’s wallet', plain(), false, [attacker.toBase58()]],
  ['account has no Solana wallet yet', plain(), false, []],
]

let failed = 0
for (const [name, t, expectOk, wallets] of [
  ...cases.map(([n, t, ok]) => [n, t, ok, undefined] as const),
  ...withAccount,
]) {
  let verdict: { ok: boolean; reason?: string }
  try {
    verdict = inspect(t, [], wallets ? [...wallets] : undefined)
  } catch (e) {
    verdict = { ok: false, reason: (e as Error).message }
  }
  const pass = verdict.ok === expectOk
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${expectOk ? 'allow ' : 'refuse'}  ${name}${verdict.ok ? '' : `  — ${verdict.reason}`}`)
}
const total = cases.length + withAccount.length
console.log(`\n${total - failed}/${total} passed`)
process.exit(failed ? 1 : 0)
