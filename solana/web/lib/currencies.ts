/**
 * What the user is shown, which is separate from what settles. Any of these can be the
 * display currency; the money itself moves as whichever stablecoin the user holds.
 */

export type DisplayCurrency = {
  code: string
  symbol: string
  locale: string
  /** How a person would say it: "Pay in naira", not "Pay in NGN". */
  word: string
  /** Minor units are noise in high-denomination currencies. */
  wholeUnits?: boolean
}

export const DISPLAY_CURRENCIES: DisplayCurrency[] = [
  { code: 'USD', symbol: '$', locale: 'en-US', word: 'dollars' },
  { code: 'EUR', symbol: '€', locale: 'de-DE', word: 'euros' },
  { code: 'GBP', symbol: '£', locale: 'en-GB', word: 'pounds' },
  { code: 'NGN', symbol: '₦', locale: 'en-NG', word: 'naira', wholeUnits: true },
  { code: 'KES', symbol: 'KSh', locale: 'en-KE', word: 'shillings', wholeUnits: true },
  { code: 'GHS', symbol: 'GH₵', locale: 'en-GH', word: 'cedis' },
  { code: 'ZAR', symbol: 'R', locale: 'en-ZA', word: 'rand' },
  { code: 'EGP', symbol: 'E£', locale: 'en-EG', word: 'pounds' },
  { code: 'BRL', symbol: 'R$', locale: 'pt-BR', word: 'reais' },
  { code: 'MXN', symbol: 'MX$', locale: 'es-MX', word: 'pesos' },
  { code: 'ARS', symbol: 'AR$', locale: 'es-AR', word: 'pesos', wholeUnits: true },
  { code: 'INR', symbol: '₹', locale: 'en-IN', word: 'rupees', wholeUnits: true },
  { code: 'PKR', symbol: 'Rs', locale: 'en-PK', word: 'rupees', wholeUnits: true },
  { code: 'IDR', symbol: 'Rp', locale: 'id-ID', word: 'rupiah', wholeUnits: true },
  { code: 'PHP', symbol: '₱', locale: 'en-PH', word: 'pesos' },
  { code: 'VND', symbol: '₫', locale: 'vi-VN', word: 'dong', wholeUnits: true },
  { code: 'TRY', symbol: '₺', locale: 'tr-TR', word: 'lira' },
]

export const DISPLAY_BY_CODE = new Map(DISPLAY_CURRENCIES.map((c) => [c.code, c]))
export const DISPLAY_CODES = DISPLAY_CURRENCIES.map((c) => c.code)

export function displayCurrency(code: string): DisplayCurrency {
  return DISPLAY_BY_CODE.get(code) ?? DISPLAY_CURRENCIES[0]
}

/**
 * Magnitude decides the decimals, not the caller: minor units are dropped for
 * high-denomination currencies and above a thousand anywhere, and kept below that, where
 * they are the difference between "3,94" and a wrong-looking "4".
 */
export function formatLocal(amount: number, code: string) {
  const c = displayCurrency(code)
  const drop = c.wholeUnits || Math.abs(amount) >= 1000
  return new Intl.NumberFormat(c.locale, {
    style: 'currency',
    currency: c.code,
    maximumFractionDigits: drop ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(amount)
}

export function formatUsd(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: Math.abs(amount) < 1 ? 4 : 2,
  }).format(amount)
}

/** A price move, said the same way everywhere: a true minus sign, two decimals. */
export function formatMove(pct: number) {
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%`
}
