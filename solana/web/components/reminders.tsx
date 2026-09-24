'use client'

import Link from 'next/link'
import { useCurrency } from './currency-context'
import { STOCK_BY_SYMBOL } from '@/lib/assets'
import { formatLocal, formatUsd } from '@/lib/currencies'
import { due, triggered, usePlans } from '@/lib/plans'

/**
 * What the app owes you the moment you open it: a price you asked to hear about, or a
 * standing plan that has come round. Each one turns into a single tap, already filled in.
 */
export function Reminders() {
  const { code, usdToLocal, shareUsd } = useCurrency()
  const { entries, markFired, markDone, snooze } = usePlans()

  const hits = triggered(entries, shareUsd)
  const dueNow = due(entries)
  if (!hits.length && !dueNow.length) return null

  return (
    <div className="mb-8">
      {hits.map((w) => {
        const name = STOCK_BY_SYMBOL.get(w.symbol)?.display ?? w.symbol
        const now = shareUsd[w.symbol]
        return (
          <div key={w.id} className="mb-2 border-2 border-accent p-4">
            <p className="t-body-sm !text-ink">
              <span className="text-accent">● </span>
              {name} is {w.direction === 'above' ? 'above' : 'below'} {formatLocal(usdToLocal(w.priceUsd), code)} — it is{' '}
              {formatLocal(usdToLocal(now), code)} now ({formatUsd(now)}).
            </p>
            <div className="mt-3 flex gap-2">
              <Link
                href={`/create?prompt=${encodeURIComponent(name)}`}
                onClick={() => markFired(w.id)}
                className="btn-primary !min-h-[40px] flex-1 !text-[11px] no-underline"
              >
                Buy {name}
              </Link>
              <button onClick={() => markFired(w.id)} className="btn-secondary !min-h-[40px] flex-1 !text-[11px]">
                Noted
              </button>
            </div>
          </div>
        )
      })}

      {dueNow.map((p) => (
        <div key={p.id} className="mb-2 border-2 border-ink p-4">
          <p className="t-body-sm !text-ink">
            Your {p.everyDays >= 28 ? 'monthly' : `${p.everyDays}-day`} plan is due: {formatLocal(p.amountLocal, p.currency)} into{' '}
            <span className="text-ink">{p.prompt}</span>.
            {p.lastDoneAt && ` Last done ${new Date(p.lastDoneAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.`}
          </p>
          <div className="mt-3 flex gap-2">
            <Link
              href={`/create?prompt=${encodeURIComponent(p.prompt)}&amount=${p.amountLocal}`}
              onClick={() => markDone(p.id)}
              className="btn-primary !min-h-[40px] flex-1 !text-[11px] no-underline"
            >
              Buy it now
            </Link>
            <button onClick={() => snooze(p.id)} className="btn-secondary !min-h-[40px] flex-1 !text-[11px]">
              Tomorrow
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
