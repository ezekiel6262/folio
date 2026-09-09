'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CURRENCIES, currency as lookup, type Currency } from '@/lib/assets'

type PricesPayload = {
  prices: { symbol: string; usd: number; updatedAt: number; ageSeconds: number; stale: boolean; multiplierWad: string }[]
  fx: Record<string, number>
  asOf: number
}

type Ctx = {
  code: string
  currency: Currency
  setCode: (code: string) => void
  fx: Record<string, number>
  /** USD -> the active currency. */
  rate: number
  prices: Record<string, number>
  multipliers: Record<string, bigint>
  stale: string[]
  /** Age of the oldest feed backing the shown prices, in hours. */
  staleHours: number
  pricesStale: boolean
  loading: boolean
  usdToLocal: (usd: number) => number
  localToUsd: (local: number) => number
}

const CurrencyContext = createContext<Ctx | null>(null)
const STORAGE_KEY = 'folio.currency'

export function CurrencyProvider({ children }: { children: ReactNode }) {
  // Brazil leads: BRZ is the deepest local corridor on Base (about 0.10% price impact),
  // so the default currency is one that actually executes onchain end to end.
  const [code, setCodeState] = useState('BRL')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved && CURRENCIES.some((c) => c.code === saved)) setCodeState(saved)
    } catch {
      // storage can be unavailable; the default currency still works
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

  const { data, isLoading } = useQuery<PricesPayload>({
    queryKey: ['prices'],
    queryFn: async () => {
      const res = await fetch('/api/prices')
      if (!res.ok) throw new Error('Could not load prices')
      return res.json()
    },
    refetchInterval: 45_000,
  })

  const value = useMemo<Ctx>(() => {
    const fx = data?.fx ?? {}
    const rate = fx[code] ?? 1
    const prices = Object.fromEntries((data?.prices ?? []).map((p) => [p.symbol, p.usd]))
    const multipliers = Object.fromEntries(
      (data?.prices ?? []).map((p) => [p.symbol, BigInt(p.multiplierWad)]),
    )
    return {
      code,
      currency: lookup(code),
      setCode,
      fx,
      rate,
      prices,
      multipliers,
      stale: (data?.prices ?? []).filter((p) => p.stale).map((p) => p.symbol),
      staleHours: Math.round(Math.max(0, ...(data?.prices ?? []).map((p) => p.ageSeconds / 3600), 0)),
      pricesStale: Math.max(0, ...(data?.prices ?? []).map((p) => p.ageSeconds / 3600), 0) >= 24,
      loading: isLoading,
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
