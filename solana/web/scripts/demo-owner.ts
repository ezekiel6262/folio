/**
 * Exercises the owner's powers against devnet: take shares out of the vault into your own
 * wallet, hold the folio shut for longer, then hand the whole thing to someone else.
 *
 *   npx -y tsx --conditions=react-server scripts/demo-owner.ts
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js'
import { buildDemoFolio, demoHoldings } from '../lib/demo'
import { buildExtendLock, buildHandOn } from '../lib/owner-actions'
import { buildTakeOut } from '../lib/take-out'
import { readFolio } from '../lib/folio-reader'
import { connection } from '../lib/market'
import { ata, TOKEN_2022 } from '../lib/folio-program'

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

async function main() {
  const owner = Keypair.generate()
  const friend = Keypair.generate()
  console.log(`owner  ${owner.publicKey.toBase58()}`)
  console.log(`friend ${friend.publicKey.toBase58()}\n`)

  console.log('1. Fund the owner and make an unlocked folio')
  execSync(`npm run -s demo -- fund ${owner.publicKey.toBase58()} --send`, { cwd: resolve(__dirname, '..'), stdio: 'ignore' })
  const held = await demoHoldings(owner.publicKey.toBase58())
  const built = await buildDemoFolio({
    user: owner.publicKey.toBase58(),
    name: 'My own shares',
    unlockAt: 0,
    claimKey: null,
    recipient: null,
    policyHashHex: '22'.repeat(32),
    picks: held.map((h) => ({ symbol: h.symbol, rawAmount: h.rawAmount })),
  })
  console.log(`   ${link(await send(built.transaction, [feePayer, owner]))}`)
  let folio = await readFolio(built.folio)
  console.log(`   holds ${folio?.holdings.map((h) => `${h.shares.toFixed(4)} ${h.display}`).join(', ')}\n`)

  console.log('2. Take half of one holding out into the owner’s own wallet')
  const first = folio!.holdings[0]
  const takeOut = await buildTakeOut({ owner: owner.publicKey.toBase58(), folio: built.folio, symbol: first.symbol, fraction: 0.5 })
  console.log(`   ${link(await send(takeOut.transaction, [feePayer, owner]))}`)
  const wallet = await connection.getTokenAccountBalance(
    ata(owner.publicKey, new PublicKey(first.mint), TOKEN_2022),
    'confirmed',
  )
  folio = await readFolio(built.folio)
  console.log(`   in the wallet: ${wallet.value.uiAmountString} ${first.display}`)
  console.log(`   left in the folio: ${folio?.holdings.find((h) => h.symbol === first.symbol)?.shares.toFixed(4)}\n`)

  console.log('3. Lock the folio for a year')
  const until = Math.floor(Date.now() / 1000) + 365 * 24 * 3600
  const lock = await buildExtendLock({ owner: owner.publicKey.toBase58(), folio: built.folio, newUnlockAt: until })
  console.log(`   ${link(await send(lock.transaction, [feePayer, owner]))}`)

  try {
    const blocked = await buildTakeOut({ owner: owner.publicKey.toBase58(), folio: built.folio, symbol: first.symbol, fraction: 1 })
    await send(blocked.transaction, [feePayer, owner])
    console.log('   PROBLEM: the lock did not hold\n')
  } catch (e) {
    console.log(`   taking more out is refused: ${(e as Error).message.slice(0, 60)}\n`)
  }

  console.log('4. Hand the folio to a friend')
  const hand = await buildHandOn({ owner: owner.publicKey.toBase58(), folio: built.folio, newOwner: friend.publicKey.toBase58() })
  console.log(`   ${link(await send(hand.transaction, [feePayer, owner]))}`)
  folio = await readFolio(built.folio)
  console.log(`   owner is the friend now: ${folio?.owner === friend.publicKey.toBase58()} · still locked: ${folio?.locked}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
