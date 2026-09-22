'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useCurrency } from '@/components/currency-context'
import { AppHeader, HardRule, Kicker, MonoLabel, Screen, SideNote, Stop } from '@/components/ui'
import { LISTED, PRIVATE, type Stock } from '@/lib/assets'
import { formatLocal } from '@/lib/currencies'

type MarketResponse = {
  stocks: Record<string, { shareUsd: number; referenceUsd?: number; premiumPct?: number }>
  valuations: Record<string, { markValuation: number; impliedValuation: number; markPrice: number }>
}

function compactUsd(n: number) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  return `$${(n / 1e6).toFixed(0)}M`
}

/**
 * Every company Folio can hold, and the one number other apps leave out: how far the
 * token's price sits from what it tracks. For a listed company that is the share price on
 * its exchange; for a private company it is the price at its last valuation.
 */
export default function MarketsPage() {
  const { code, usdToLocal } = useCurrency()
  const { data, isLoading } = useQuery<MarketResponse>({
    queryKey: ['market'],
    queryFn: async () => (await fetch('/api/market')).json(),
    refetchInterval: 20_000,
  })

  return (
    <>
      <AppHeader />
      <Screen wide>
        <Kicker>Markets</Kicker>
        <h1 className="t-screen mt-4">
          What you can <span className="t-serif text-[34px]">own</span>
          <Stop />
        </h1>
        <p className="t-body mt-5 max-w-[640px]">
          Listed US companies, and private companies before they go public. Prices are live, in {code}.
          Tap any company to start a folio with it.
        </p>

        <div className="mt-10 lg:grid lg:grid-cols-2 lg:gap-14">
          <section>
            <p className="t-label">Listed companies</p>
            <p className="t-disclaimer mt-1">xStocks by Backed · compared with the share price on its exchange</p>
            <HardRule className="mt-2.5" />
            {LISTED.map((s) => (
              <Row key={s.symbol} stock={s} data={data} loading={isLoading} code={code} usdToLocal={usdToLocal} />
            ))}
          </section>

          <section className="mt-12 lg:mt-0">
            <p className="t-label">Before they go public</p>
            <p className="t-disclaimer mt-1">PreStocks · compared with the price at the last valuation</p>
            <HardRule className="mt-2.5" />
            {PRIVATE.map((s) => (
              <Row key={s.symbol} stock={s} data={data} loading={isLoading} code={code} usdToLocal={usdToLocal} privateCo />
            ))}
            <div className="mt-5">
              <SideNote>
                Pre-IPO tokens are backed 1:1 by exposure through a special-purpose vehicle, not by shares held
                in your name at the company. The issuer charges a 1% fee on every transfer — in, out and on sale —
                and can freeze, pause or move tokens. Prices can sit well above or below the last valuation.
              </SideNote>
            </div>
          </section>
        </div>
      </Screen>
    </>
  )
}

function Row({
  stock,
  data,
  loading,
  code,
  usdToLocal,
  privateCo = false,
}: {
  stock: Stock
  data?: MarketResponse
  loading: boolean
  code: string
  usdToLocal: (usd: number) => number
  privateCo?: boolean
}) {
  const m = data?.stocks?.[stock.symbol]
  const v = data?.valuations?.[stock.symbol]
  const premium = m?.premiumPct
  const tone = premium == null ? '' : Math.abs(premium) < 1 ? 'text-body-soft' : premium > 0 ? 'text-accent' : 'text-ink'

  return (
    <Link
      href={`/create?prompt=${encodeURIComponent(stock.display)}`}
      className="row-hover flex items-baseline justify-between gap-4 border-b border-rule-hair py-3.5 no-underline"
    >
      <span className="min-w-0">
        <span className="t-cardtitle block truncate">{stock.display}</span>
        <span className="figure mt-0.5 block text-[10.5px] text-body-mute">
          {privateCo && v ? `valued ${compactUsd(v.markValuation)} at last round` : stock.sector.replace(/-/g, ' ')}
        </span>
      </span>
      <span className="shrink-0 text-right">
        {loading || !m ? (
          <span className="inline-block h-3 w-16 bg-rule-mid/50" />
        ) : (
          <span className="figure block text-[13.5px] text-ink">{formatLocal(usdToLocal(m.shareUsd), code)}</span>
        )}
        {premium != null && (
          <span className={`figure mt-0.5 block text-[10.5px] ${tone}`}>
            {Math.abs(premium) < 0.05
              ? 'at its reference'
              : `${premium > 0 ? '+' : '−'}${Math.abs(premium).toFixed(1)}% ${premium > 0 ? 'above' : 'below'} ${privateCo ? 'valuation' : 'share price'}`}
          </span>
        )}
      </span>
    </Link>
  )
}
