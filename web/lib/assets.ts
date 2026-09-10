import raw from './base-assets.json'

export type Stock = {
  symbol: string
  name: string
  display: string
  address: `0x${string}`
  decimals: number
  feed: `0x${string}`
  sector: string
  tags: string[]
}

export type Currency = {
  code: string
  symbol: string
  token: string
  address: `0x${string}`
  decimals: number
  /** False when the token exists on Base but has no DEX liquidity to trade through. */
  tradeable: boolean
  /** For non-tradeable currencies, the currency orders actually settle in. */
  settlesVia?: string
  locale: string
  note?: string
}

export const CHAIN_ID = raw.chainId
export const VERIFIED_AT_BLOCK = raw.verifiedAtBlock
export const STOCKS = raw.stocks as Stock[]
export const CURRENCIES = raw.currencies as Currency[]

export const STOCK_BY_SYMBOL = new Map(STOCKS.map((s) => [s.symbol, s]))
export const STOCK_BY_ADDRESS = new Map(STOCKS.map((s) => [s.address.toLowerCase(), s]))
export const CURRENCY_BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]))

/** The only assets an allocation is ever allowed to name. Enforced, not suggested. */
export const ALLOWED_SYMBOLS = STOCKS.map((s) => s.symbol)

export function stock(symbol: string): Stock {
  const s = STOCK_BY_SYMBOL.get(symbol)
  if (!s) throw new Error(`${symbol} is not a listed Coinbase tokenized stock`)
  return s
}

export function currency(code: string): Currency {
  const c = CURRENCY_BY_CODE.get(code)
  if (!c) throw new Error(`Unsupported currency ${code}`)
  return c
}

/** The token a given currency actually settles in, following the settlesVia fallback. */
export function settlementCurrency(code: string): Currency {
  const c = currency(code)
  return c.tradeable ? c : currency(c.settlesVia ?? 'USD')
}

/**
 * Minor units are noise in high-denomination currencies, and above a thousand anywhere.
 * Below that they are the difference between "R$ 3,94" and a wrong-looking "R$ 4" that
 * makes two holdings appear not to sum to their own total. Magnitude decides, not the
 * caller — `compact` only ever shortens what is already safe to shorten.
 */
export function formatLocal(amount: number, code: string, _opts: { compact?: boolean } = {}) {
  const c = CURRENCY_BY_CODE.get(code)
  if (!c) return amount.toFixed(2)
  const dropDecimals = code === 'NGN' || code === 'IDR' || Math.abs(amount) >= 1000
  return new Intl.NumberFormat(c.locale, {
    style: 'currency',
    currency: c.code,
    maximumFractionDigits: dropDecimals ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(amount)
}

export function formatUsd(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount < 1 ? 4 : 2,
  }).format(amount)
}

/**
 * Share-equivalents. A B20 token is not permanently one share: the multiplier rises as
 * dividends are reinvested and moves on splits. Everything the user reads is expressed
 * through this, so a corporate action never silently changes what their holding means.
 */
export function toShares(rawUnits: bigint, decimals: number, multiplierWad: bigint): number {
  const WAD = 10n ** 18n
  const scaled = (rawUnits * multiplierWad) / WAD
  return Number(scaled) / 10 ** decimals
}

export function formatShares(shares: number) {
  if (shares === 0) return '0'
  if (shares < 0.0001) return '<0.0001'
  return shares.toLocaleString('en-US', { maximumFractionDigits: 4, minimumFractionDigits: 2 })
}
