import 'server-only'
import { PublicKey } from '@solana/web3.js'
import { PROGRAMS, STABLECOINS, STABLE_BY_MINT, STOCK_BY_MINT, toShares } from './assets'
import { connection, getMarket } from './market'

/**
 * What is in a user's embedded wallet, valued in dollars: the stablecoins they deposited
 * (the money they can invest) and any shares they took out of a folio. SOL is reported
 * only for completeness — Folio pays fees, so a user never needs it.
 */

export type StableBalance = { symbol: string; pegged: string; units: number; usd: number; mint: string }
export type LooseStock = { symbol: string; display: string; shares: number; usd: number; mint: string }

export type WalletBalances = {
  owner: string
  stablecoins: StableBalance[]
  stocks: LooseStock[]
  investableUsd: number
  sol: number
}

export async function walletBalances(owner: string): Promise<WalletBalances> {
  const key = new PublicKey(owner)
  const [classic, t22, lamports, market] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(key, { programId: new PublicKey(PROGRAMS.token) }),
    connection.getParsedTokenAccountsByOwner(key, { programId: new PublicKey(PROGRAMS.token2022) }),
    connection.getBalance(key),
    getMarket(),
  ])

  const held = new Map<string, bigint>()
  for (const acc of [...classic.value, ...t22.value]) {
    const info = acc.account.data.parsed?.info
    if (!info?.mint) continue
    held.set(info.mint, (held.get(info.mint) ?? 0n) + BigInt(info.tokenAmount?.amount ?? '0'))
  }

  const stablecoins: StableBalance[] = STABLECOINS.map((s) => {
    const units = Number(held.get(s.mint) ?? 0n) / 10 ** s.decimals
    return { symbol: s.symbol, pegged: s.pegged, units, usd: units * (market.stablecoinUsd[s.symbol] ?? 0), mint: s.mint }
  }).filter((b) => b.units > 0)

  const stocks: LooseStock[] = []
  for (const [mint, raw] of held) {
    const s = STOCK_BY_MINT.get(mint)
    const m = s ? market.stocks[s.symbol] : undefined
    if (!s || !m || raw === 0n) continue
    const shares = toShares(raw, s.decimals, m.multiplier)
    stocks.push({ symbol: s.symbol, display: s.display, shares, usd: shares * m.shareUsd, mint })
  }

  // Unknown mints are ignored rather than guessed at.
  void STABLE_BY_MINT

  return {
    owner,
    stablecoins: stablecoins.sort((a, b) => b.usd - a.usd),
    stocks: stocks.sort((a, b) => b.usd - a.usd),
    investableUsd: stablecoins.reduce((a, b) => a + b.usd, 0),
    sol: lamports / 1e9,
  }
}
