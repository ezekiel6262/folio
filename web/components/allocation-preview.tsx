'use client'

import { useCurrency } from './currency-context'
import { formatLocal, formatShares } from '@/lib/assets'
import type { Allocation } from '@/lib/allocator'
import type { PurchasePlan } from '@/lib/quote'

type PlanResponse = {
  plan: PurchasePlan
  reference: { usd: number; premiumPct: number; prices: Record<string, number>; stale: string[] }
}

/**
 * The preview is where the product earns trust. It shows what each line is, what it
 * costs in the user's own currency, what was left out and why, and - crucially - how
 * the fill compares to the Chainlink reference. A number the user cannot check is a
 * number they should not have to accept.
 */
export function AllocationPreview({ allocation, planned }: { allocation: Allocation; planned: PlanResponse }) {
  const { code, usdToLocal } = useCurrency()
  const { plan, reference } = planned

  const premium = reference.premiumPct
  const premiumLabel = Math.abs(premium) < 0.05 ? 'at reference' : premium > 0 ? 'above reference' : 'below reference'

  return (
    <div className="card mt-4 overflow-hidden">
      <div className="border-b border-black/[0.06] px-5 py-4">
        <p className="label">What we read</p>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink/80">{allocation.interpretation}</p>
      </div>

      <div className="divide-y divide-black/[0.05]">
        {plan.legs.map((leg) => {
          const line = allocation.lines.find((l) => l.symbol === leg.symbol)
          return (
            <div key={leg.symbol} className="px-5 py-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14.5px] font-semibold">{leg.display}</p>
                  <p className="mt-0.5 text-[12px] text-ink/50">{line?.reason ?? ''}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="figure text-[14.5px] font-semibold">
                    {formatLocal(usdToLocal(leg.amountInUsd), code, { compact: true })}
                  </p>
                  <p className="text-[12px] text-ink/45">{(leg.weightBps / 100).toFixed(0)}%</p>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between gap-3 text-[12px]">
                <span className="text-ink/60">
                  ≈ <span className="figure font-medium text-ink/80">{formatShares(leg.shares)}</span> shares
                </span>
                <span className={leg.priceImpactPct < -1 ? 'text-loss' : 'text-ink/40'}>
                  {leg.venues.join(' → ')}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {allocation.excluded.length > 0 && (
        <div className="border-t border-black/[0.06] bg-black/[0.015] px-5 py-3.5">
          <p className="label">Left out</p>
          <div className="mt-2 space-y-1">
            {allocation.excluded.map((x) => (
              <p key={x.symbol} className="text-[12.5px] text-ink/55">
                <span className="font-medium text-ink/75">{x.display}</span> — {x.reason}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-black/[0.06] px-5 py-4">
        <Row label={`You pay`} value={formatLocal(plan.amountLocal, code)} strong />
        <Row
          label="Cost to get in"
          value={`${plan.totalCostPct.toFixed(2)}%`}
          hint="spread, price impact and fees"
        />
        <Row
          label="Fill vs Chainlink"
          value={`${premium > 0 ? '+' : ''}${premium.toFixed(2)}% ${premiumLabel}`}
          tone={Math.abs(premium) > 2 ? 'warn' : 'normal'}
        />
        <Row label="Network fee" value={`≈ ${formatLocal(usdToLocal(plan.totalGasUsd), code, { compact: true })}`} />
        <Row
          label="Worst case"
          value={`${plan.legs.map((l) => formatShares(l.minShares)).join(' / ')} shares`}
          hint={`if the market moves against you by ${(plan.slippageBps / 100).toFixed(1)}%`}
        />
      </div>

      {(plan.warnings.length > 0 || reference.stale.length > 0) && (
        <div className="border-t border-black/[0.06] bg-accent-soft/50 px-5 py-3.5">
          {plan.warnings.map((w) => (
            <p key={w} className="text-[12.5px] leading-relaxed text-ink/70">
              {w}
            </p>
          ))}
          {reference.stale.length > 0 && (
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink/70">
              Reference price for {reference.stale.join(', ')} has not updated recently — the market
              may be closed or a corporate action is in progress.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Row({
  label,
  value,
  hint,
  strong,
  tone = 'normal',
}: {
  label: string
  value: string
  hint?: string
  strong?: boolean
  tone?: 'normal' | 'warn'
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <div>
        <span className={`text-[13px] ${strong ? 'font-semibold text-ink' : 'text-ink/55'}`}>{label}</span>
        {hint && <p className="text-[11.5px] text-ink/35">{hint}</p>}
      </div>
      <span
        className={`figure shrink-0 text-[13.5px] ${
          strong ? 'font-semibold' : tone === 'warn' ? 'font-medium text-loss' : 'text-ink/75'
        }`}
      >
        {value}
      </span>
    </div>
  )
}
