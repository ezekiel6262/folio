'use client'

import { useState } from 'react'
import { useCurrency } from './currency-context'
import { useSponsorship } from '@/lib/use-executor'
import { HardRule, MonoLabel, Stop } from './ui'
import { formatLocal, formatShares, formatUsd } from '@/lib/assets'
import type { Allocation } from '@/lib/allocator'
import type { PurchasePlan } from '@/lib/quote'

type PlanResponse = {
  plan: PurchasePlan
  reference: { usd: number; premiumPct: number; prices: Record<string, number>; stale: string[] }
}

/**
 * Screen 07. This is where the product earns trust, and it is the hardest density
 * problem in the app: eight separate disclosures that must all be reachable without
 * becoming a spreadsheet. The resolution is an accordion — one leg open at a time — so
 * the summary stays scannable and the detail is one tap away rather than always on.
 */
export function AllocationPreview({
  allocation,
  planned,
}: {
  allocation: Allocation
  planned: PlanResponse
}) {
  const { code, usdToLocal, staleHours, pricesStale } = useCurrency()
  const sponsorship = useSponsorship()
  const [openLeg, setOpenLeg] = useState<number | null>(null)
  const { plan, reference } = planned

  return (
    <div>
      {/* Stale reference prices get a void-ground banner, not a footnote. */}
      {pricesStale && (
        <div className="-mx-5 bg-ink-void px-5 py-4">
          <p className="font-sans text-[12.5px] leading-[1.6] text-body-dark">
            <span className="text-accent-dark">
              Reference prices are {staleHours} hours old.
            </span>{' '}
            The US market has been closed. What you pay is set by the live market below, not by
            these.
          </p>
        </div>
      )}

      <div className="pt-7">
        <MonoLabel>What we understood</MonoLabel>
        <p className="t-quote mt-3">{allocation.interpretation}</p>

        <div className="mt-6 flex items-baseline justify-between border-t border-rule-hair pt-4">
          <MonoLabel>You spend</MonoLabel>
          <span className="figure text-[22px] font-medium text-ink">
            {formatLocal(plan.amountLocal, code)}
          </span>
        </div>
      </div>

      <HardRule className="mt-5" />

      {/* Per-leg rows. */}
      <div>
        {plan.legs.map((leg, i) => {
          const line = allocation.lines.find((l) => l.symbol === leg.symbol)
          const refUsd = reference.prices[leg.symbol] ?? 0
          const liveUsd = leg.shares > 0 ? leg.amountInUsd / leg.shares : 0
          const gapPct = refUsd > 0 ? ((liveUsd - refUsd) / refUsd) * 100 : 0
          const isOpen = openLeg === i
          const thin = Math.abs(leg.priceImpactPct) > 2.5

          return (
            <div key={leg.symbol} className="border-b border-rule-hair py-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="t-cardtitle">
                  {leg.display}{' '}
                  <span className="font-mono text-[10px] font-normal tracking-monolabel text-body-mute">
                    {(leg.weightBps / 100).toFixed(0)}%
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="figure block text-[14px] text-ink">
                    {formatLocal(usdToLocal(leg.amountInUsd), code)}
                  </span>
                  <span className="figure mt-0.5 block text-[10.5px] text-body-mute">
                    {formatShares(leg.shares)} sh
                  </span>
                </span>
              </div>

              <div className="mt-2 flex items-end justify-between gap-4">
                <p className="t-body-sm max-w-[62%]">{line?.reason ?? 'Included'}</p>
                <button
                  onClick={() => setOpenLeg(isOpen ? null : i)}
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
                  <Detail label="Live market price" value={formatUsd(liveUsd)} />
                  <Detail
                    label={`Reference price · ${staleHours}h old`}
                    value={refUsd ? formatUsd(refUsd) : '—'}
                  />
                  <Detail
                    label="Gap against reference"
                    value={`${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(2)}% ${gapPct >= 0 ? 'over' : 'under'} ref`}
                    accent
                  />
                  <div className="mt-2 border-t border-rule-hair pt-2">
                    <Detail
                      label="Guaranteed worst case"
                      value={`${formatShares(leg.minShares)} sh`}
                    />
                  </div>
                  <p className="t-disclaimer mt-2">
                    Routed through {leg.venues.join(' → ')}. If the market moves against you in
                    flight, you get the worst case or the leg does not fill at all.
                  </p>
                </div>
              )}

              {thin && (
                <div className="mt-3 border border-accent p-3">
                  <p className="t-body-sm">
                    <span className="text-accent">● </span>
                    {leg.display} is pricing {Math.abs(leg.priceImpactPct).toFixed(1)}%{' '}
                    {leg.priceImpactPct < 0 ? 'below' : 'above'} its reference. That pool is thin,
                    so the fill can move.
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Exclusions are a feature: they prove the app listened. */}
      {allocation.excluded.length > 0 && (
        <div className="mt-7">
          <MonoLabel>Left out, on purpose</MonoLabel>
          <div className="mt-2">
            {allocation.excluded.map((x) => (
              <div
                key={x.symbol}
                className="flex items-baseline justify-between gap-4 border-t border-rule-hair py-2.5"
              >
                <span className="font-sans text-[13px] text-ink">{x.display}</span>
                <span className="font-sans text-[12px] text-body-soft">{x.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Costs, stated before the button that incurs them. */}
      <div className="mt-7 grid grid-cols-2 border border-ink">
        <div className="border-r border-ink p-3.5">
          <MonoLabel>Cost to get in</MonoLabel>
          <p className="figure mt-1.5 text-[18px] text-ink">
            {Math.abs(plan.totalCostPct).toFixed(2)}%
          </p>
        </div>
        <div className="p-3.5">
          <MonoLabel>Network fee</MonoLabel>
          <p className="figure mt-1.5 text-[18px] text-ink">
            {sponsorship.available
              ? 'Free'
              : formatLocal(usdToLocal(plan.totalGasUsd), code, { compact: true })}
          </p>
          {sponsorship.available && (
            <p className="t-disclaimer mt-1">We cover it on this wallet</p>
          )}
        </div>
      </div>

      {plan.settlesInDifferentCurrency && (
        <p className="t-disclaimer mt-4">
          {code} has no on-chain market on Base, so this order settles in {plan.settlementSymbol} at{' '}
          {plan.fxRate.toLocaleString()} {code} per USD.
        </p>
      )}

      <p className="t-disclaimer mt-4">
        Share counts are share-equivalents, adjusted for dividends and splits. One token is not
        permanently one share, so everything here already reflects the current multiplier.
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

export function PreviewHeadline() {
  return (
    <h1 className="t-screen">
      Your <span className="t-serif text-[34px]">basket</span>
      <Stop />
    </h1>
  )
}
