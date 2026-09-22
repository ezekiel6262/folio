'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DISPLAY_BY_CODE, displayCurrency, type DisplayCurrency } from '@/lib/currencies'

type MarketPayload = {
  stocks: Record<string, { symbol: string; tokenUsd: number; shareUsd: number; multiplier: number; scheduled?: { multiplier: number; effectiveAt: number } }>
  stablecoinUsd: Record<string, number>
  fx: Record<string, number>
  asOf: number
  source: string
}

type Ctx = {
  code: string
  currency: DisplayCurrency
  setCode: (code: string) => void
  fx: Record<string, number>
  /** USD -> the active display currency. */
  rate: number
  /** Price of one share-equivalent, USD. */
  shareUsd: Record<string, number>
  multipliers: Record<string, number>
  stablecoinUsd: Record<string, number>
  loading: boolean
  asOf: number | null
  usdToLocal: (usd: number) => number
  localToUsd: (local: number) => number
}

const CurrencyContext = createContext<Ctx | null>(null)
const STORAGE_KEY = 'folio.sol.currency'

/** A first guess from the browser's own locale, so most people never touch the picker. */
const REGION_CURRENCY: Record<string, string> = {
  NG: 'NGN', KE: 'KES', GH: 'GHS', ZA: 'ZAR', EG: 'EGP', BR: 'BRL', MX: 'MXN', AR: 'ARS', IN: 'INR',
  PK: 'PKR', ID: 'IDR', PH: 'PHP', VN: 'VND', TR: 'TRY', GB: 'GBP', US: 'USD',
  DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', PT: 'EUR', IE: 'EUR', BE: 'EUR', AT: 'EUR', FI: 'EUR', GR: 'EUR',
}

function guessFromLocale(): string {
  try {
    const locales = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const l of locales) {
      const region = new Intl.Locale(l).maximize().region
      const code = region ? REGION_CURRENCY[region] : undefined
      if (code && DISPLAY_BY_CODE.has(code)) return code
    }
  } catch {
    // fall through
  }
  return 'USD'
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [code, setCodeState] = useState('USD')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      setCodeState(saved && DISPLAY_BY_CODE.has(saved) ? saved : guessFromLocale())
    } catch {
      setCodeState(guessFromLocale())
    }
  }, [])

  const setCode = (next: string) => {
    setCodeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // non-fatal
    }
  }

  const { data, isLoading } = useQuery<MarketPayload>({
    queryKey: ['market'],
    queryFn: async () => {
      const res = await fetch('/api/market')
      if (!res.ok) throw new Error('Could not load prices')
      return res.json()
    },
    refetchInterval: 30_000,
  })

  const value = useMemo<Ctx>(() => {
    const fx = data?.fx ?? {}
    const rate = fx[code] ?? 1
    const stocks = Object.values(data?.stocks ?? {})
    return {
      code,
      currency: displayCurrency(code),
      setCode,
      fx,
      rate,
      shareUsd: Object.fromEntries(stocks.map((s) => [s.symbol, s.shareUsd])),
      multipliers: Object.fromEntries(stocks.map((s) => [s.symbol, s.multiplier])),
      stablecoinUsd: data?.stablecoinUsd ?? {},
      loading: isLoading,
      asOf: data?.asOf ?? null,
      usdToLocal: (usd: number) => usd * rate,
      localToUsd: (local: number) => (rate ? local / rate : 0),
    }
  }, [code, data, isLoading])

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext)
  if (!ctx) throw new Error('useCurrency must be used inside CurrencyProvider')
  return ctx
}
