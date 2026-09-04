'use client'

import Link from 'next/link'
import { useCurrency } from './currency-context'
import { formatLocal, formatShares } from '@/lib/assets'

export type FolioSummary = {
  id: string
  name: string
  totalUsd: number
  locked: boolean
  unlockAt: number
  escrowed: boolean
  holdings: { symbol: string; display: string; shares: number; weightPct: number; isStock: boolean }[]
}

export function unlockText(unlockAt: number) {
  if (!unlockAt) return null
  const date = new Date(unlockAt * 1000)
  const locked = date.getTime() > Date.now()
  const formatted = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return locked ? `Unlocks ${formatted}` : `Unlocked ${formatted}`
}

export function FolioCard({ folio }: { folio: FolioSummary }) {
  const { code, usdToLocal } = useCurrency()
  const stocks = folio.holdings.filter((h) => h.isStock)

  return (
    <Link href={`/folio/${folio.id}`} className="card block p-4 transition hover:border-black/15">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold tracking-tight">{folio.name}</p>
          <p className="mt-0.5 truncate text-[12.5px] text-ink/50">
            {stocks.length ? stocks.map((h) => h.display).join(' · ') : 'Empty'}
          </p>
        </div>
        <p className="figure shrink-0 text-[15px] font-semibold">
          {formatLocal(usdToLocal(folio.totalUsd), code, { compact: true })}
        </p>
      </div>

      {stocks.length > 0 && (
        <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
          {stocks.map((h, i) => (
            <span
              key={h.symbol}
              style={{ width: `${h.weightPct}%`, opacity: 1 - i * 0.16 }}
              className="bg-accent"
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {stocks.slice(0, 3).map((h) => (
          <span key={h.symbol} className="pill bg-black/[0.04] text-ink/70">
            {formatShares(h.shares)} {h.display}
          </span>
        ))}
        {folio.locked && (
          <span className="pill bg-accent-soft text-accent">
            <LockIcon />
            {unlockText(folio.unlockAt)}
          </span>
        )}
        {folio.escrowed && <span className="pill bg-black/[0.06] text-ink/60">Unclaimed gift</span>}
      </div>
    </Link>
  )
}

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  )
}
