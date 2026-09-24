import 'server-only'
import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { FEE_PAYER, stock, toShares } from './assets'
import { budget, compile, MAX_TX_BYTES } from './buy'
import { ata, closeVaultIx, createAtaIdempotentIx, TOKEN_2022, withdrawIx } from './folio-program'
import { readFolio } from './folio-reader'
import { connection, getMarket } from './market'
import { harvestWithheldIx, transferFee } from './transfer-fee'

/**
 * Taking shares out of the vault into the owner's own wallet.
 *
 * Selling is not the only exit, and a vault nobody can leave is not custody. This moves
 * the tokens themselves, so they can go to another wallet, another app, or simply be held.
 * Folio still pays the fee and opens the account.
 */

export type TakeOutPreview = { symbol: string; display: string; shares: number; destination: string; emptiesVault: boolean }

export async function buildTakeOut(a: {
  owner: string
  folio: string
  symbol: string
  fraction: number
}): Promise<{ transaction: string; preview: TakeOutPreview; lastValidBlockHeight: number }> {
  if (!(a.fraction > 0 && a.fraction <= 1)) throw new Error('Choose how much to take out')

  const folio = await readFolio(a.folio)
  if (!folio) throw new Error('No folio at that address')
  if (folio.escrowed) throw new Error('This folio has not been claimed yet')
  if (folio.owner !== a.owner) throw new Error('Only the owner can take shares out')
  if (folio.unlockAt * 1000 > Date.now()) throw new Error('This folio is locked until its date')

  const holding = folio.holdings.find((h) => h.symbol === a.symbol)
  const raw = BigInt(holding?.rawAmount ?? '0')
  if (!holding || raw === 0n) throw new Error('Nothing of that company to take out')

  const all = a.fraction >= 1
  const amount = all ? raw : (raw * BigInt(Math.floor(a.fraction * 10_000))) / 10_000n
  if (amount === 0n) throw new Error('That is too small to take out')

  const s = stock(a.symbol)
  const market = await getMarket()
  const owner = new PublicKey(a.owner)
  const feePayer = new PublicKey(FEE_PAYER)
  // The vault's own mint, not the address book's: on a test cluster they differ.
  const mintAddress = holding.mint
  const mint = new PublicKey(mintAddress)
  const destination = ata(owner, mint, TOKEN_2022)
  const hasFee = (await transferFee(mintAddress, amount)) > 0n

  const ixs: TransactionInstruction[] = []
  if (!(await connection.getAccountInfo(destination, 'confirmed'))) {
    ixs.push(createAtaIdempotentIx({ payer: feePayer, owner, mint, tokenProgram: TOKEN_2022 }))
  }
  ixs.push(withdrawIx({ folio: new PublicKey(folio.address), mint, owner, destination, amount }))
  if (all) {
    // Withheld issuer fees have to go back to the mint before the empty vault can close.
    const vault = ata(new PublicKey(folio.address), mint, TOKEN_2022)
    if (hasFee) ixs.push(harvestWithheldIx(mint, [vault]))
    ixs.push(closeVaultIx({ folio: new PublicKey(folio.address), mint, owner, rentPayer: new PublicKey(folio.rentPayer) }))
  }

  const latest = await connection.getLatestBlockhash('confirmed')
  const built = compile([...budget(90_000 + (all ? 55_000 : 0)), ...ixs], latest.blockhash, [])
  if (built.size > MAX_TX_BYTES) throw new Error('That does not fit in one transaction right now')

  return {
    transaction: built.base64,
    preview: {
      symbol: s.symbol,
      display: s.display,
      // What lands after any issuer fee on the way out.
      shares: toShares(amount - (await transferFee(mintAddress, amount)), s.decimals, market.stocks[a.symbol]?.multiplier ?? 1),
      destination: destination.toBase58(),
      emptiesVault: all,
    },
    lastValidBlockHeight: latest.lastValidBlockHeight,
  }
}
