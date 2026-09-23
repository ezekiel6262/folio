import 'server-only'
import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { budget, compile } from './buy'
import { ata, createAtaIdempotentIx, createFolioIx, depositIx, folioPda, newNonce, TOKEN_2022 } from './folio-program'
import { FEE_PAYER } from './assets'
import { connection } from './market'

/**
 * The demo, for clusters where the real assets do not exist.
 *
 * Devnet has no xStocks and no exchange, so a demo wallet is funded with stand-in tokens
 * (same Token-2022 shape, same decimals, same dividend multiplier) and Folio moves those
 * into a vault with the program's own `deposit` instruction. Everything after that — the
 * folio, the lock, the gift link, the claim, the withdrawal — is the code that runs on
 * mainnet, against a real cluster, with real signatures.
 */

export type DemoAssets = {
  cluster: string
  usdc: string
  stocks: { symbol: string; display: string; mint: string; decimals: number; multiplier: number }[]
}

const FILE = resolve(process.cwd(), 'lib/demo-assets.json')

export const demoAssets = (): DemoAssets | null => (existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as DemoAssets) : null)

export const isDemo = () => process.env.NEXT_PUBLIC_CLUSTER === 'devnet' && Boolean(demoAssets())

/** Everything a wallet holds of the demo tokens, in whole shares. */
export async function demoHoldings(owner: string) {
  const demo = demoAssets()
  if (!demo) return []
  const ownerKey = new PublicKey(owner)
  const accounts = demo.stocks.map((s) => ata(ownerKey, new PublicKey(s.mint), TOKEN_2022))
  const infos = await connection.getMultipleParsedAccounts(accounts, { commitment: 'confirmed' })
  return demo.stocks
    .map((s, i) => {
      const data = infos.value[i]?.data
      const raw: string = data && 'parsed' in data ? (data.parsed?.info?.tokenAmount?.amount ?? '0') : '0'
      const shares = (Number(raw) / 10 ** s.decimals) * s.multiplier
      return { ...s, rawAmount: raw, shares }
    })
    .filter((s) => Number(s.rawAmount) > 0)
}

/**
 * One transaction: make the folio and move the chosen shares into its vaults. All of it
 * lands or none of it does, exactly as a purchase would.
 */
export async function buildDemoFolio(a: {
  user: string
  name: string
  unlockAt: number
  claimKey: string | null
  recipient: string | null
  policyHashHex: string
  picks: { symbol: string; rawAmount: string }[]
}) {
  const demo = demoAssets()
  if (!demo) throw new Error('The demo is not set up on this cluster')
  if (!a.picks.length) throw new Error('Choose at least one company')

  const user = new PublicKey(a.user)
  const feePayer = new PublicKey(FEE_PAYER)
  const nonce = newNonce()
  const folio = folioPda(user, nonce)

  const ixs: TransactionInstruction[] = [
    createFolioIx({
      creator: user,
      payer: feePayer,
      nonce,
      name: a.name,
      unlockAt: a.unlockAt,
      reclaimAfter: 0,
      claimKey: a.claimKey ? new PublicKey(a.claimKey) : null,
      policyHash: Buffer.from(a.policyHashHex, 'hex'),
      recipient: a.recipient != null ? new PublicKey(a.recipient) : a.claimKey ? null : user,
    }),
  ]

  for (const pick of a.picks) {
    const s = demo.stocks.find((x) => x.symbol === pick.symbol)
    if (!s) throw new Error(`${pick.symbol} is not part of the demo`)
    const mint = new PublicKey(s.mint)
    const amount = BigInt(pick.rawAmount)
    if (amount <= 0n) continue
    ixs.push(createAtaIdempotentIx({ payer: feePayer, owner: folio, mint, tokenProgram: TOKEN_2022 }))
    ixs.push(depositIx({ folio, mint, depositor: user, payer: feePayer, amount }))
  }

  const latest = await connection.getLatestBlockhash('confirmed')
  const built = compile([...budget(60_000 + a.picks.length * 90_000), ...ixs], latest.blockhash, [])
  return { transaction: built.base64, folio: folio.toBase58(), lastValidBlockHeight: latest.lastValidBlockHeight }
}
