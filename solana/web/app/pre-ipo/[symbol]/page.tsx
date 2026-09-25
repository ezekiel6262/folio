'use client'

import Link from 'next/link'
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCurrency } from '@/components/currency-context'
import { AppHeader, HardRule, Kicker, MonoLabel, Screen, SideNote, Spinner, StatusChip, Stop } from '@/components/ui'
import { STOCK_BY_SYMBOL } from '@/lib/assets'
import { formatLocal, formatMove, formatUsd } from '@/lib/currencies'

type MarketResponse = {
  stocks: Record<string, { shareUsd: number; referenceUsd?: number; premiumPct?: number; change24hPct?: number }>
  valuations: Record<string, { markValuation: number; impliedValuation: number; markPrice: number }>
  lending: Record<string, { maxLtv: number; borrowApy: number }>
}

/** On a test cluster there is no exchange to buy from; the demo holds the same company. */
const onTestCluster = process.env.NEXT_PUBLIC_CLUSTER === 'devnet'

const compactUsd = (n: number) =>
  n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${Math.round(n / 1e6)}M`

/**
 * One private company, in full. A listed share can be checked against its exchange price in
 * a second; a private one cannot, so the only honest comparison is the last round its
 * investors paid — and that number is months old by definition. This page shows the gap
 * rather than the price alone, and says plainly what the token does and does not carry.
 */
export default function PreIpoPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params)
  const { code, usdToLocal } = useCurrency()
  const stock = STOCK_BY_SYMBOL.get(symbol.toUpperCase())

  const { data, isLoading } = useQuery<MarketResponse>({
    queryKey: ['market'],
    queryFn: async () => (await fetch('/api/market')).json(),
    refetchInterval: 30_000,
  })

  if (!stock || stock.kind !== 'private') {
    return (
      <>
        <AppHeader />
        <Screen>
          <Kicker>Not found</Kicker>
          <h1 className="t-screen mt-4">
            No private company here<Stop />
          </h1>
          <Link href="/markets" className="btn-secondary mt-7 no-underline">
            Back to markets
          </Link>
        </Screen>
      </>
    )
  }

  const m = data?.stocks?.[stock.symbol]
  const v = data?.valuations?.[stock.symbol]
  const lend = data?.lending?.[stock.symbol]
  // Where the token prices the whole company against what its last investors paid.
  const gapPct = v && v.markValuation > 0 ? (v.impliedValuation / v.markValuation - 1) * 100 : null
  const tokenAt = gapPct == null ? 50 : 50 + Math.max(-45, Math.min(45, gapPct))

  return (
    <>
      <AppHeader />
      <Screen wide>
        <Kicker>Before IPO</Kicker>
        <h1 className="mt-3 font-sans text-[32px] font-bold uppercase leading-[1.02] tracking-screen">{stock.display}</h1>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <StatusChip>Private company</StatusChip>
          <StatusChip tone="mute">{stock.issuer}</StatusChip>
        </div>

        {isLoading || !m ? (
          <div className="mt-10">
            <Spinner />
          </div>
        ) : (
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-14">
            <div>
              <p className="figure mt-6 text-[40px] font-medium leading-none tracking-figure">
                {formatLocal(usdToLocal(m.shareUsd), code)}
              </p>
              <p className="figure mt-2 text-[11px] text-body-mute">
                {formatUsd(m.shareUsd)} a share
                {m.change24hPct != null && (
                  <span className={m.change24hPct >= 0 ? 'text-accent' : 'text-ink'}> · {formatMove(m.change24hPct)} today</span>
                )}
              </p>

              {v && gapPct != null && (
                <>
                  <HardRule className="mt-7" />
                  <p className="t-label mt-5">Price against its last private round</p>
                  <div className="relative mt-8 h-9">
                    <div className="absolute inset-x-0 top-4 h-[2px] bg-ink" />
                    {/* Where its investors last paid. */}
                    <div className="absolute top-1.5 h-6 w-[2px] bg-ink" style={{ left: '50%' }} />
                    {/* Where the token puts it now. */}
                    <div className="absolute top-2.5 h-4 w-4 -translate-x-1/2 bg-accent" style={{ left: `${tokenAt}%` }} />
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="figure text-[11px] text-accent">token implies {compactUsd(v.impliedValuation)}</span>
                    <span className="figure text-[11px] text-ink">last round {compactUsd(v.markValuation)}</span>
                  </div>
                  <p className="t-body mt-4">
                    Buyers are paying{' '}
                    <span className="text-ink">
                      {Math.abs(gapPct) < 0.5
                        ? 'about what its last investors paid'
                        : `${Math.abs(gapPct).toFixed(1)}% ${gapPct > 0 ? 'above' : 'below'} what its last investors paid`}
                    </span>
                    . That round was priced months ago and the company has not been valued publicly since, so treat
                    the gap as a difference of opinion, not a discount someone is handing you.
                  </p>
                </>
              )}

              <HardRule className="mt-7" />
              <p className="t-label mt-5">What this token is</p>
              <div className="mt-3">
                {[
                  ['Kind', 'A private company. No exchange lists it.'],
                  ['Dividends', 'None. Private companies do not pay them.'],
                  ['Votes', 'None. The token carries no shareholder rights.'],
                  ['Can back a loan', lend ? `Up to ${(lend.maxLtv * 100).toFixed(0)}% of its value` : 'Not yet — no lending market takes it'],
                  ['Issued by', `${stock.issuer}, on Solana`],
                  ['Cost to move it', "1% to the issuer on every transfer, already inside the quote you're shown"],
                ].map(([k, value]) => (
                  <div key={k} className="flex items-baseline justify-between gap-6 border-t border-rule-hair py-2.5 first:border-t-0">
                    <span className="t-mono-label shrink-0">{k}</span>
                    <span className="t-body-sm !text-ink text-right">{value}</span>
                  </div>
                ))}
              </div>

              <Link
                href={onTestCluster ? `/demo?pick=${stock.symbol}` : `/create?prompt=${encodeURIComponent(stock.display)}`}
                className="btn-primary mt-7 !min-h-[52px] no-underline"
              >
                Add {stock.display} to a folio
              </Link>
              <Link href="/markets" className="btn-ghost mt-2 block text-center no-underline">
                Back to markets
              </Link>
            </div>

            <div>
              <div className="-mx-5 mt-9 bg-ink-void px-5 py-5 lg:mx-0 lg:mt-7">
                <p className="font-sans text-[13px] leading-[1.6] text-body-dark">
                  <span className="text-accent-dark">If it lists.</span> Nothing happens to your folio on the day
                  {' '}{stock.display} goes public. The token keeps tracking the company, and what changes is that a
                  public price finally exists to check it against.
                </p>
              </div>

              <div className="mt-7">
                <SideNote>
                  A private company publishes no accounts, and there is no exchange to sell into — only the buyers who
                  happen to be there. Prices here can move a long way on very little trading, and a round that never
                  comes can leave this worth far less than you paid. Size it accordingly.
                </SideNote>
              </div>

              <MonoLabel className="mt-6">
                Valuations come from {stock.issuer}&apos;s public data; the price is what buyers pay on Solana right now.
              </MonoLabel>
            </div>
          </div>
        )}
      </Screen>
    </>
  )
}
