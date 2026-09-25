/**
 * Proves the public shelf on devnet: make a folio, put it on the shelf with a sentence,
 * read it back from the listing account, then take it off again.
 *
 *   npx -y tsx --conditions=react-server scripts/demo-listing.ts [options]
 *
 *   --keep              leave it on the shelf instead of taking it off
 *   --name "..."        what the folio is called
 *   --note "..."        the one line the shelf shows
 *   --picks AAPLx,SPYx  which demo companies go in it
 *   --lock 5            hold it shut for this many years
 *
 * The policy hash is the sentence, hashed — the same thing the real create flow records —
 * so two folios built from one idea can find each other without a database.
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js'
import { buildDemoFolio, demoHoldings } from '../lib/demo'
import { listFolioIx, listingPda, unlistFolioIx } from '../lib/folio-program'
import { budget, compile } from '../lib/buy'
import { exploreCards, listingFor } from '../lib/explore'
import { connection } from '../lib/market'

const root = resolve(__dirname, '../../..')
const feePayer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(resolve(root, 'solana/.keys/fee-payer.json'), 'utf8'))),
)
const link = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`

async function send(base64: string, signers: Keypair[]) {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, 'base64'))
  tx.sign(signers)
  const sig = await connection.sendRawTransaction(tx.serialize())
  await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash('confirmed')) }, 'confirmed')
  return sig
}

async function one(instruction: Parameters<typeof compile>[0][number], signers: Keypair[]) {
  const latest = await connection.getLatestBlockhash('confirmed')
  return send(compile([...budget(40_000), instruction], latest.blockhash, []).base64, signers)
}

const flag = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`)
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback
}

async function main() {
  const name = flag('name', 'Chips and the index')
  const note = flag('note', 'The companies that make the chips, plus the whole market as ballast.')
  const lockYears = Number(flag('lock', '0'))
  const picks = flag('picks', '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const owner = Keypair.generate()
  console.log(`owner ${owner.publicKey.toBase58()}\n`)

  console.log('1. Make a folio')
  execSync(`npm run -s demo -- fund ${owner.publicKey.toBase58()} --send`, { cwd: resolve(__dirname, '..'), stdio: 'ignore' })
  const held = await demoHoldings(owner.publicKey.toBase58())
  const chosen = picks.length ? held.filter((h) => picks.includes(h.symbol)) : held.slice(0, 2)
  if (!chosen.length) throw new Error(`none of ${picks.join(', ') || 'the demo companies'} are held`)
  const built = await buildDemoFolio({
    user: owner.publicKey.toBase58(),
    name,
    unlockAt: lockYears > 0 ? Math.floor(Date.now() / 1000) + Math.round(lockYears * 365.25 * 86_400) : 0,
    claimKey: null,
    recipient: null,
    policyHashHex: createHash('sha256').update(note.trim().toLowerCase()).digest('hex'),
    picks: chosen.map((h) => ({ symbol: h.symbol, rawAmount: h.rawAmount })),
  })
  console.log(`   ${link(await send(built.transaction, [feePayer, owner]))}`)
  console.log(`   private by default: ${(await listingFor(built.folio)) === null}\n`)

  console.log('2. Put it on the public shelf')
  const sig = await one(
    listFolioIx({ folio: new PublicKey(built.folio), owner: owner.publicKey, payer: feePayer.publicKey, note }),
    [feePayer, owner],
  )
  console.log(`   ${link(sig)}`)
  console.log(`   listing ${listingPda(new PublicKey(built.folio)).toBase58()}`)
  const listing = await listingFor(built.folio)
  console.log(`   note reads back: "${listing?.note}"\n`)

  console.log('3. It shows up on the shelf')
  const cards = await exploreCards()
  const mine = cards.find((c) => c.folio === built.folio)
  console.log(`   ${cards.length} folio(s) listed; this one: ${mine?.name} · ${mine?.holdings.map((h) => h.display).join(', ')} · copies ${mine?.copies}\n`)

  if (process.argv.includes('--keep')) {
    console.log('Leaving it on the shelf (--keep).')
    return
  }

  console.log('4. Take it off again')
  console.log(
    `   ${link(await one(unlistFolioIx({ folio: new PublicKey(built.folio), owner: owner.publicKey, rentPayer: feePayer.publicKey }), [feePayer, owner]))}`,
  )
  console.log(`   private again: ${(await listingFor(built.folio)) === null}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
