'use client'

import { useState } from 'react'
import { useCurrency } from './currency-context'
import { HardRule, MonoLabel } from './ui'
import { formatShares } from '@/lib/assets'
import { formatLocal, formatUsd } from '@/lib/currencies'
import type { Allocation } from '@/lib/allocator'
import type { PurchasePlan } from '@/lib/quote'

/**
 * The preview is where the product earns trust. Every disclosure is reachable — what we
 * understood, each company's cost and share count, the fill against the market price,
 * the guaranteed worst case, what was left out and why, and the cost — but one company
 * opens at a time, so it never becomes a wall of caveats.
 */
export function AllocationPreview({ allocation, plan }: { allocation: Allocation; plan: PurchasePlan }) {
  const { code, usdToLocal } = useCurrency()
  const [open, setOpen] = useState<number | null>(null)

  return (
    <div>
      <MonoLabel>What we understood</MonoLabel>
      <p className="t-quote mt-3">{allocation.interpretation}</p>

      <div className="mt-6 flex items-baseline justify-between border-t border-rule-hair pt-4">
        <MonoLabel>You spend</MonoLabel>
        <span className="text-right">
          <span className="figure block text-[22px] font-medium text-ink">{formatLocal(plan.amountLocal, code)}</span>
          <span className="figure mt-0.5 block text-[10.5px] text-body-mute">
            {plan.amountPayUnits.toLocaleString(undefined, { maximumFractionDigits: 2 })} {plan.payWith}
          </span>
        </span>
      </div>

      <HardRule className="mt-5" />

      {plan.legs.map((leg, i) => {
        const line = allocation.lines.find((l) => l.symbol === leg.symbol)
        const isOpen = open === i
        return (
          <div key={leg.symbol} className="border-b border-rule-hair py-4">
            <div className="flex items-baseline justify-between gap-4">
              <span className="t-cardtitle">
                {leg.display}{' '}
                <span className="font-mono text-[10px] font-normal tracking-monolabel text-body-mute">{(leg.weightBps / 100).toFixed(0)}%</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="figure block text-[14px] text-ink">{formatLocal(usdToLocal(leg.spendUsd), code)}</span>
                <span className="figure mt-0.5 block text-[10.5px] text-body-mute">{formatShares(leg.shares)} sh</span>
              </span>
            </div>
            <div className="mt-2 flex items-end justify-between gap-4">
              <p className="t-body-sm max-w-[62%]">{line?.reason ?? 'Included'}</p>
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className={`shrink-0 border px-2 py-1 font-mono text-[9.5px] uppercase tracking-monolabel transition-colors ${
                  isOpen ? 'border-accent bg-accent text-white' : 'border-accent text-accent'
                }`}
              >
                {isOpen ? 'Close —' : 'More +'}
              </button>
            </div>

            {isOpen && (
              <div className="mt-3 border-l-2 border-accent pl-3">
                <Detail label="Your fill, per share" value={formatUsd(leg.fillShareUsd)} />
                <Detail label="Market price, per share" value={formatUsd(leg.marketShareUsd)} />
                <Detail
                  label="Gap"
                  value={`${leg.gapPct >= 0 ? '+' : ''}${leg.gapPct.toFixed(2)}% ${leg.gapPct >= 0 ? 'over' : 'under'} market`}
                  accent
                />
                <div className="mt-2 border-t border-rule-hair pt-2">
                  <Detail label="Guaranteed worst case" value={`${formatShares(leg.minShares)} sh`} />
                </div>
                <p className="t-disclaimer mt-2">
                  Routed through {leg.venues.join(' → ')}. If the market moves against you in flight,
                  you get at least the worst case, or nothing is bought at all.
                </p>
              </div>
            )}
          </div>
        )
      })}

      {allocation.excluded.length > 0 && (
        <div className="mt-7">
          <MonoLabel>Left out, on purpose</MonoLabel>
          <div className="mt-2">
            {allocation.excluded.map((x) => (
              <div key={x.symbol} className="flex items-baseline justify-between gap-4 border-t border-rule-hair py-2.5">
                <span className="font-sans text-[13px] text-ink">{x.display}</span>
                <span className="font-sans text-[12px] text-body-soft">{x.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-7 grid grid-cols-2 border border-ink">
        <div className="border-r border-ink p-3.5">
          <MonoLabel>Cost to get in</MonoLabel>
          <p className="figure mt-1.5 text-[18px] text-ink">{Math.max(0, plan.totalCostPct).toFixed(2)}%</p>
        </div>
        <div className="p-3.5">
          <MonoLabel>Network fee</MonoLabel>
          <p className="figure mt-1.5 text-[18px] text-ink">Free</p>
          <p className="t-disclaimer mt-1">Folio pays it</p>
        </div>
      </div>

      {plan.warnings.map((w) => (
        <div key={w} className="mt-4 border border-accent p-3.5">
          <p className="t-body-sm">
            <span className="text-accent">● </span>
            {w}
          </p>
        </div>
      ))}

      <p className="t-disclaimer mt-4">
        Share counts are share-equivalents, adjusted for dividends and splits with each stock&apos;s
        live multiplier. Market prices come from Solana trading venues via Jupiter, not an
        independent reference.
      </p>
    </div>
  )
}

function Detail({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="t-mono-label">{label}</span>
      <span className={`figure text-[11.5px] ${accent ? 'text-accent' : 'text-ink'}`}>{value}</span>
    </div>
  )
}
