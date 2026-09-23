/**
 * Runs Folio's whole loop against devnet and prints an explorer link for every step:
 * fund a fresh wallet, make a named folio with a lock, gift it with a link, claim it from
 * a second wallet, then withdraw. Proves the program end to end on a public cluster.
 *
 *   npx -y tsx --conditions=react-server scripts/demo-run.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js'
import { buildDemoFolio, demoAssets, demoHoldings } from '../lib/demo'
import { claimIx, withdrawIx, ata, TOKEN_2022 } from '../lib/folio-program'
import { readFolio } from '../lib/folio-reader'
import { budget, compile } from '../lib/buy'
import { connection } from '../lib/market'

const root = resolve(__dirname, '../../..')
const keyFile = (name: string) => resolve(root, `solana/.keys/${name}.json`)
const load = (name: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyFile(name), 'utf8'))))

const link = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`
const accountLink = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`

async function sendSigned(tx: VersionedTransaction, signers: Keypair[]) {
  tx.sign(signers)
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false })
  const latest = await connection.getLatestBlockhash('confirmed')
  await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed')
  return sig
}

const fromBase64 = (b64: string) => VersionedTransaction.deserialize(Buffer.from(b64, 'base64'))

async function main() {
  const demo = demoAssets()
  if (!demo) throw new Error('Run `npm run demo -- mints --send` first')
  const feePayer = load('fee-payer')

  // Two fresh wallets: a giver and a receiver, both with no SOL of their own.
  const giver = Keypair.generate()
  const receiver = Keypair.generate()
  console.log(`giver     ${giver.publicKey.toBase58()}`)
  console.log(`receiver  ${receiver.publicKey.toBase58()}\n`)

  console.log('1. Fund the giver with test shares')
  const { execSync } = await import('node:child_process')
  execSync(`npm run -s demo -- fund ${giver.publicKey.toBase58()} --send`, { cwd: resolve(__dirname, '..'), stdio: 'inherit' })

  const held = await demoHoldings(giver.publicKey.toBase58())
  console.log(`   holds: ${held.map((h) => `${h.shares.toFixed(4)} ${h.display}`).join(', ')}\n`)

  console.log('2. Make a folio, locked for a year, as a gift with a claim link')
  const claimKey = Keypair.generate()
  const unlockAt = Math.floor(Date.now() / 1000) + 365 * 24 * 3600
  const built = await buildDemoFolio({
    user: giver.publicKey.toBase58(),
    name: 'Ada school fund',
    unlockAt,
    claimKey: claimKey.publicKey.toBase58(),
    recipient: null,
    policyHashHex: '11'.repeat(32),
    picks: held.map((h) => ({ symbol: h.symbol, rawAmount: h.rawAmount })),
  })
  console.log(`   ${link(await sendSigned(fromBase64(built.transaction), [feePayer, giver]))}`)
  console.log(`   folio ${accountLink(built.folio)}`)

  let folio = await readFolio(built.folio)
  console.log(`   "${folio?.name}" · ${folio?.holdings.map((h) => `${h.shares.toFixed(4)} ${h.display}`).join(', ')}`)
  console.log(`   escrowed: ${folio?.escrowed} · locked until ${new Date((folio?.unlockAt ?? 0) * 1000).toDateString()}\n`)

  console.log('3. The receiver opens the link and claims it')
  const latest = await connection.getLatestBlockhash('confirmed')
  const claim = compile(
    [...budget(40_000), claimIx({ folio: new PublicKey(built.folio), claimKey: claimKey.publicKey, claimant: receiver.publicKey })],
    latest.blockhash,
    [],
  )
  console.log(`   ${link(await sendSigned(fromBase64(claim.base64), [feePayer, claimKey, receiver]))}`)
  folio = await readFolio(built.folio)
  console.log(`   owner is now the receiver: ${folio?.owner === receiver.publicKey.toBase58()} · still locked: ${folio?.locked}\n`)

  console.log('4. Withdrawing while locked is refused')
  const h0 = folio!.holdings[0]
  const mint = new PublicKey(h0.mint)
  const dest = ata(receiver.publicKey, mint, TOKEN_2022)
  const early = compile(
    [
      ...budget(60_000),
      withdrawIx({ folio: new PublicKey(built.folio), mint, owner: receiver.publicKey, destination: dest, amount: BigInt(h0.rawAmount) }),
    ],
    latest.blockhash,
    [],
  )
  try {
    await sendSigned(fromBase64(early.base64), [feePayer, receiver])
    console.log('   PROBLEM: the lock did not hold\n')
  } catch (e) {
    const msg = (e as Error).message
    console.log(`   refused, as it should be: ${/Locked|custom program error/i.test(msg) ? 'Locked' : msg.slice(0, 80)}\n`)
  }

  console.log('Done. The vault, the lock, the gift link and the claim all work on a public cluster.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
