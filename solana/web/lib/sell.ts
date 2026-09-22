import 'server-only'
import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { FEE_PAYER, stablecoin, stock, toShares } from './assets'
import { budget, compile, lookupTables, MAX_TX_BYTES, swapInstructions, toIx } from './buy'
import { ata, closeVaultIx, createAtaIdempotentIx, TOKEN_2022, withdrawIx } from './folio-program'
import { readFolio } from './folio-reader'
import { connection, getMarket } from './market'
import { DEFAULT_SLIPPAGE_BPS, jupiterQuote } from './quote'

/**
 * Sells part or all of one holding back to USDC in the owner's account, in one
 * all-or-nothing transaction:
 *   1. open the owner's account for the stock, if missing (our fee payer funds it)
 *   2. withdraw the shares from the folio's vault into it
 *   3. if that emptied the vault, close it — its deposit returns to the folio's rent payer
 *   4. Jupiter swaps the shares to USDC in the owner's account
 *   5. if we opened the stock account in step 1, close it again, refunding us
 *
 * Step 5 is why the co-signer allows a token close that pays Folio: the account never
 * outlives the transaction, so there is nothing left for anyone to close for profit.
 */

const CU_WITHDRAW = 60_000
const CU_CLOSE = 25_000
const CU_ATA = 30_000

export class PriceMoved extends Error {
  status = 409
}

export type SellPreview = {
  symbol: string
  display: string
  shares: number
  usdcOut: number
  minUsdcOut: number
  marketUsd: number
  gapPct: number
  closesVault: boolean
}

function closeTokenAccountIx(account: PublicKey, destination: PublicKey, owner: PublicKey) {
  return new TransactionInstruction({
    programId: TOKEN_2022,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([9]),
  })
}

export async function buildSell(a: {
  owner: string
  folio: string
  symbol: string
  fraction: number
  reviewedMinUsdc?: number
}): Promise<{ transaction: string; preview: SellPreview; lastValidBlockHeight: number }> {
  if (!(a.fraction > 0 && a.fraction <= 1)) throw new Error('Choose how much to sell')

  const folio = await readFolio(a.folio)
  if (!folio) throw new Error('No folio at that address')
  if (folio.escrowed) throw new Error('This folio has not been claimed yet')
  if (folio.owner !== a.owner) throw new Error('Only the owner can sell from this folio')
  if (folio.unlockAt * 1000 > Date.now()) throw new Error('This folio is still locked')

  const holding = folio.holdings.find((h) => h.symbol === a.symbol)
  const raw = BigInt(holding?.rawAmount ?? '0')
  if (!holding || raw === 0n) throw new Error('Nothing of that company to sell')

  const all = a.fraction >= 1
  const amount = all ? raw : (raw * BigInt(Math.floor(a.fraction * 10_000))) / 10_000n
  if (amount === 0n) throw new Error('That is too small to sell')

  const s = stock(a.symbol)
  const usdc = stablecoin('USDC')
  const [quote, market] = await Promise.all([jupiterQuote(s.mint, usdc.mint, amount, DEFAULT_SLIPPAGE_BPS), getMarket()])

  const m = market.stocks[a.symbol]
  const shares = toShares(amount, s.decimals, m?.multiplier ?? 1)
  const usdcOut = Number(quote.outAmount) / 10 ** usdc.decimals
  const minUsdcOut = Number(quote.otherAmountThreshold) / 10 ** usdc.decimals
  const marketUsd = shares * (m?.shareUsd ?? 0)
  const preview: SellPreview = {
    symbol: s.symbol,
    display: s.display,
    shares,
    usdcOut,
    minUsdcOut,
    marketUsd,
    gapPct: marketUsd ? (usdcOut / marketUsd - 1) * 100 : 0,
    closesVault: all,
  }

  if (a.reviewedMinUsdc != null && usdcOut < a.reviewedMinUsdc) {
    throw new PriceMoved(`The price of ${s.display} moved since you reviewed it. Check it again.`)
  }

  const owner = new PublicKey(a.owner)
  const folioKey = new PublicKey(folio.address)
  const mint = new PublicKey(s.mint)
  const feePayer = new PublicKey(FEE_PAYER)
  const ownerStock = ata(owner, mint, TOKEN_2022)
  const opened = !(await connection.getAccountInfo(ownerStock, 'confirmed'))

  const jup = await swapInstructions(quote, owner)

  const ixs: TransactionInstruction[] = []
  if (opened) ixs.push(createAtaIdempotentIx({ payer: feePayer, owner, mint, tokenProgram: TOKEN_2022 }))
  ixs.push(withdrawIx({ folio: folioKey, mint, owner, destination: ownerStock, amount }))
  if (all) ixs.push(closeVaultIx({ folio: folioKey, mint, owner, rentPayer: new PublicKey(folio.rentPayer) }))
  for (const setup of jup.setupInstructions ?? []) ixs.push(toIx(setup))
  ixs.push(toIx(jup.swapInstruction))
  if (jup.cleanupInstruction) ixs.push(toIx(jup.cleanupInstruction))
  if (opened) ixs.push(closeTokenAccountIx(ownerStock, feePayer, owner))

  const units = (jup.computeUnitLimit ?? 300_000) + CU_WITHDRAW + (all ? CU_CLOSE : 0) + (opened ? CU_ATA + CU_CLOSE : 0) + 20_000
  const [tables, latest] = await Promise.all([
    lookupTables(jup.addressLookupTableAddresses ?? []),
    connection.getLatestBlockhash('confirmed'),
  ])
  const built = compile([...budget(units), ...ixs], latest.blockhash, tables)
  if (built.size > MAX_TX_BYTES) throw new Error('This sale does not fit in one transaction. Try again in a moment.')

  return { transaction: built.base64, preview, lastValidBlockHeight: latest.lastValidBlockHeight }
}
