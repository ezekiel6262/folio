'use client'

import Link from 'next/link'
import { useCurrency } from './currency-context'
import { StatusChip } from './ui'
import { formatShares } from '@/lib/assets'
import { formatLocal, formatMove } from '@/lib/currencies'
import type { FolioView } from '@/lib/folio-reader'

/** The order a basket's slices are drawn in, largest holding first. */
export const SEGMENTS = ['#111111', '#1a2fd6', '#8f9dff', '#5a5858', '#b5b2b2', '#2a2929', '#d4d2d2']

export function dateLabel(unix: number) {
  return new Date(unix * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
}

export function lockLabel(unlockAt: number) {
  if (!unlockAt) return null
  return unlockAt * 1000 > Date.now() ? `Locked until ${dateLabel(unlockAt)}` : `Unlocked ${dateLabel(unlockAt)}`
}

/**
 * A folio as a card: the basket is drawn along the top, so a glance says what is in it
 * before any words do. Used wherever folios are shown several at a time.
 */
export function FolioCard({ folio }: { folio: FolioView }) {
  const { code, usdToLocal } = useCurrency()
  const h = folio.holdings

  return (
    <Link
      href={`/folio/${folio.address}`}
      className="group flex flex-col border border-ink no-underline transition-transform hover:-translate-y-0.5 hover:border-accent"
    >
      <div className="flex h-1.5">
        {h.length ? (
          h.map((x, i) => <div key={x.mint} style={{ width: `${x.weightPct}%`, background: SEGMENTS[i % SEGMENTS.length] }} />)
        ) : (
          <div className="w-full bg-rule-mid" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0">
            {folio.escrowed ? (
              <StatusChip tone="solid">Waiting to be claimed</StatusChip>
            ) : folio.locked ? (
              <StatusChip>{lockLabel(folio.unlockAt)}</StatusChip>
            ) : (
              <StatusChip tone="mute">Yours · no lock</StatusChip>
            )}
          </span>
          {folio.change24hPct != null && (
            <span className={`figure shrink-0 text-[10.5px] ${folio.change24hPct >= 0 ? 'text-accent' : 'text-body-soft'}`}>
              {formatMove(folio.change24hPct)} today
            </span>
          )}
        </div>
        <h3 className="font-sans text-[20px] font-bold uppercase leading-[1.04] tracking-screen text-ink">
          {folio.name || 'Untitled'}
        </h3>
        <p className="figure text-[19px] text-ink">{formatLocal(usdToLocal(folio.totalUsd), code)}</p>
        <p className="mt-auto truncate font-sans text-[12.5px] text-body-soft">
          {h.length ? h.map((x) => x.display).join(', ') : 'Empty'}
        </p>
      </div>
    </Link>
  )
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
