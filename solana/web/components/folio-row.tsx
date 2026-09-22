'use client'

import Link from 'next/link'
import { useCurrency } from './currency-context'
import { StatusChip } from './ui'
import { formatShares } from '@/lib/assets'
import { formatLocal } from '@/lib/currencies'
import type { FolioView } from '@/lib/folio-reader'

export function dateLabel(unix: number) {
  return new Date(unix * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
}

export function lockLabel(unlockAt: number) {
  if (!unlockAt) return null
  return unlockAt * 1000 > Date.now() ? `Locked until ${dateLabel(unlockAt)}` : `Unlocked ${dateLabel(unlockAt)}`
}

/** A hairline-separated row, not a card. Structure comes from rules, never fills. */
export function FolioRow({ folio }: { folio: FolioView }) {
  const { code, usdToLocal } = useCurrency()
  const h = folio.holdings
  const contents =
    h.length === 0
      ? 'Empty'
      : h.length === 1
        ? `${h[0].display} only · ${formatShares(h[0].shares)} shares`
        : h.map((x) => x.display).join(', ')

  return (
    <Link href={`/folio/${folio.address}`} className="row-hover block border-b border-rule-hair py-4 no-underline">
      <div className="flex items-baseline justify-between gap-4">
        <span className="t-cardtitle truncate">{folio.name || 'Untitled'}</span>
        <span className="figure shrink-0 text-[14px] text-ink">{formatLocal(usdToLocal(folio.totalUsd), code)}</span>
      </div>
      <p className="mt-1.5 truncate font-sans text-[12.5px] text-body-soft">{contents}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {folio.escrowed && <StatusChip tone="solid">Waiting to be claimed</StatusChip>}
        {folio.locked && <StatusChip>{lockLabel(folio.unlockAt)}</StatusChip>}
        {!folio.locked && !folio.escrowed && <StatusChip tone="mute">Yours · no lock</StatusChip>}
      </div>
    </Link>
  )
}
