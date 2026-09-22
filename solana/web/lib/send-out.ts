import 'server-only'
import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { FEE_PAYER, PROGRAMS, stablecoin, tokenProgramId } from './assets'
import { budget, compile } from './buy'
import { ata, createAtaIdempotentIx } from './folio-program'
import { connection, getMarket } from './market'

/**
 * Sends stablecoins out of the user's account to a Solana address. When the address has
 * never held that coin, Folio opens an account for it — a deposit we pay and never get
 * back — so those sends carry a higher minimum to keep it from being farmed.
 */

const MIN_SEND_USD = 1
const MIN_SEND_NEW_ACCOUNT_USD = 5
const TOKEN_TRANSFER_CHECKED = 12

export type SendPreview = { symbol: string; amount: number; usd: number; destination: string; opensAccount: boolean }

/** Decimal string to raw units without floating-point drift. */
function toRaw(amount: number, decimals: number): bigint {
  const [whole, frac = ''] = amount.toFixed(decimals).split('.')
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals))
}

export async function buildSendOut(a: {
  owner: string
  symbol: string
  amount: number
  destination: string
}): Promise<{ transaction: string; preview: SendPreview; lastValidBlockHeight: number }> {
  const coin = stablecoin(a.symbol)
  const tokenProgram = new PublicKey(tokenProgramId(coin.tokenProgram))
  const owner = new PublicKey(a.owner)
  const destination = new PublicKey(a.destination)
  const mint = new PublicKey(coin.mint)
  if (destination.equals(owner)) throw new Error('That is your own address')
  if (!(a.amount > 0)) throw new Error('Enter an amount')

  const raw = toRaw(a.amount, coin.decimals)
  const source = ata(owner, mint, tokenProgram)
  const destinationAccount = ata(destination, mint, tokenProgram)

  const [sourceBalance, destInfo, destTokenInfo, market] = await Promise.all([
    connection.getTokenAccountBalance(source, 'confirmed').catch(() => null),
    connection.getAccountInfo(destination, 'confirmed'),
    connection.getAccountInfo(destinationAccount, 'confirmed'),
    getMarket(),
  ])

  if (!sourceBalance || BigInt(sourceBalance.value.amount) < raw) throw new Error(`You do not have that much ${coin.symbol}`)

  // People paste token-account addresses by mistake; money sent "to" one lands in an
  // account owned by that account, which nobody can reach.
  const tokenPrograms = [PROGRAMS.token, PROGRAMS.token2022]
  if (destInfo && tokenPrograms.includes(destInfo.owner.toBase58())) {
    throw new Error('That is a token account, not a wallet address. Paste the wallet address instead.')
  }

  const usd = a.amount * (market.stablecoinUsd[coin.symbol] ?? 1)
  const opensAccount = !destTokenInfo
  if (usd < MIN_SEND_USD) throw new Error(`The smallest send is $${MIN_SEND_USD}`)
  if (opensAccount && usd < MIN_SEND_NEW_ACCOUNT_USD) {
    throw new Error(`This address has never held ${coin.symbol}. Sends to a new address start at $${MIN_SEND_NEW_ACCOUNT_USD}.`)
  }

  const feePayer = new PublicKey(FEE_PAYER)
  const amountLe = Buffer.alloc(8)
  amountLe.writeBigUInt64LE(raw)
  const transfer = new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destinationAccount, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([TOKEN_TRANSFER_CHECKED]), amountLe, Buffer.from([coin.decimals])]),
  })

  const ixs = [
    ...budget(opensAccount ? 70_000 : 40_000),
    ...(opensAccount ? [createAtaIdempotentIx({ payer: feePayer, owner: destination, mint, tokenProgram })] : []),
    transfer,
  ]
  const latest = await connection.getLatestBlockhash('confirmed')
  const built = compile(ixs, latest.blockhash, [])

  return {
    transaction: built.base64,
    preview: { symbol: coin.symbol, amount: a.amount, usd, destination: destination.toBase58(), opensAccount },
    lastValidBlockHeight: latest.lastValidBlockHeight,
  }
}
