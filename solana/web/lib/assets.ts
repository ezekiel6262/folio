import raw from './solana-assets.json'

/**
 * Folio on Solana: what exists, verified. Everything here was read from mainnet — see the
 * `_comment` in solana-assets.json. The allocator may only ever name these stocks; the
 * co-signer may only ever sponsor these programs.
 */

export type TokenProgramKind = 'token' | 'token2022'

export type Stock = {
  symbol: string
  display: string
  name: string
  mint: string
  decimals: number
  tokenProgram: TokenProgramKind
  sector: string
  tags: string[]
  /** Listed on an exchange (xStocks) or a private company before its IPO (PreStocks). */
  kind: 'listed' | 'private'
  issuer: string
}

export type Stablecoin = {
  symbol: string
  /** The currency it tracks. What it settles in, not what the user is shown. */
  pegged: string
  mint: string
  decimals: number
  tokenProgram: TokenProgramKind
  primary?: boolean
  note?: string
}

export const PROGRAMS = raw.programs
export const FEE_PAYER = raw.keys.feePayer

export const STOCKS = raw.stocks as Stock[]
export const STABLECOINS = raw.stablecoins as Stablecoin[]

/** One atomic purchase fits at most this many companies (measured on mainnet). */
export const MAX_COMPANIES: number = raw.vault.maxCompaniesPerPurchase
export const STOCK_CAP_SHARES: number = raw.vault.stockCapShares

export const LISTED = STOCKS.filter((s) => s.kind === 'listed')
export const PRIVATE = STOCKS.filter((s) => s.kind === 'private')

export const STOCK_BY_SYMBOL = new Map(STOCKS.map((s) => [s.symbol, s]))
export const STOCK_BY_MINT = new Map(STOCKS.map((s) => [s.mint, s]))
export const STABLE_BY_SYMBOL = new Map(STABLECOINS.map((s) => [s.symbol, s]))
export const STABLE_BY_MINT = new Map(STABLECOINS.map((s) => [s.mint, s]))

/** The only assets an allocation is ever allowed to name. Enforced, not suggested. */
export const ALLOWED_SYMBOLS = STOCKS.map((s) => s.symbol)

export function stock(symbol: string): Stock {
  const s = STOCK_BY_SYMBOL.get(symbol)
  if (!s) throw new Error(`${symbol} is not one of Folio's listed stocks`)
  return s
}

export function stablecoin(symbol: string): Stablecoin {
  const s = STABLE_BY_SYMBOL.get(symbol)
  if (!s) throw new Error(`${symbol} is not a stablecoin Folio accepts`)
  return s
}

export const tokenProgramId = (kind: TokenProgramKind) => (kind === 'token2022' ? PROGRAMS.token2022 : PROGRAMS.token)

/**
 * Share-equivalents. An xStock token is not permanently one share: the issuer's
 * scaled-UI-amount multiplier rises as dividends are reinvested and moves on splits. It
 * is live on Solana (AAPLx was 1.00266 on 14 Sep 2026), so every quantity a user reads
 * goes through here and a corporate action never silently changes what a holding means.
 */
export function toShares(rawUnits: bigint | string | number, decimals: number, multiplier: number): number {
  return (Number(rawUnits) / 10 ** decimals) * multiplier
}

export function formatShares(shares: number) {
  if (shares === 0) return '0'
  if (shares < 0.0001) return '<0.0001'
  return shares.toLocaleString('en-US', { maximumFractionDigits: 4, minimumFractionDigits: 2 })
}
