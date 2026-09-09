'use client'

import Link from 'next/link'
import { useCurrency } from './currency-context'
import { StatusChip } from './ui'
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
  const formatted = date
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase()
  return date.getTime() > Date.now() ? `Locked until ${formatted}` : `Unlocked ${formatted}`
}

/** A hairline-separated row, not a card. Structure comes from rules, never fills. */
export function FolioRow({ folio }: { folio: FolioSummary }) {
  const { code, usdToLocal } = useCurrency()
  const stocks = folio.holdings.filter((h) => h.isStock)

  const contents =
    stocks.length === 0
      ? 'Empty'
      : stocks.length === 1
        ? `${stocks[0].display} only · ${formatShares(stocks[0].shares)} shares`
        : stocks.map((h) => h.display).join(', ')

  return (
    <Link href={`/folio/${folio.id}`} className="row-hover block border-b border-rule-hair py-4 no-underline">
      <div className="flex items-baseline justify-between gap-4">
        <span className="t-cardtitle truncate">{folio.name}</span>
        <span className="figure shrink-0 text-[14px] text-ink">
          {formatLocal(usdToLocal(folio.totalUsd), code, { compact: true })}
        </span>
      </div>

      <p className="mt-1.5 truncate font-sans text-[12.5px] text-body-soft">{contents}</p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {folio.escrowed && <StatusChip tone="solid">Waiting to be claimed</StatusChip>}
        {folio.locked && <StatusChip>{unlockText(folio.unlockAt)}</StatusChip>}
        {!folio.locked && !folio.escrowed && <StatusChip tone="mute">Yours · no lock</StatusChip>}
      </div>
    </Link>
  )
}
