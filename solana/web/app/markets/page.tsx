'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCurrency } from '@/components/currency-context'
import { AppHeader, HardRule, Kicker, MonoLabel, Screen, SideNote, Spinner, Stop } from '@/components/ui'
import { STOCKS, type Stock } from '@/lib/assets'
import { formatLocal, formatMove } from '@/lib/currencies'

type MarketResponse = {
  stocks: Record<string, { shareUsd: number; referenceUsd?: number; premiumPct?: number; growthPct?: number; change24hPct?: number }>
  valuations: Record<string, { markValuation: number; impliedValuation: number; markPrice: number }>
  lending: Record<string, { maxLtv: number; borrowApy: number }>
}

type Filter = 'all' | 'listed' | 'private' | 'collateral'
type Sort = 'default' | 'discount' | 'price'

const FILTERS: [Filter, string][] = [
  ['all', 'Everything'],
  ['listed', 'Listed'],
  ['private', 'Before IPO'],
  ['collateral', 'Can back a loan'],
]

function compactUsd(n: number) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  return `$${Math.round(n / 1e6)}M`
}

/**
 * One market, not two lists. Listed companies and private ones sit in the same table
 * because a buyer is choosing between them, and each row answers the same three
 * questions: what does it cost, how far is that from what it tracks, and what can it do
 * for me once I own it.
 */
export default function MarketsPage() {
  const { code, usdToLocal } = useCurrency()
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('default')

  const { data, isLoading } = useQuery<MarketResponse>({
    queryKey: ['market'],
    queryFn: async () => (await fetch('/api/market')).json(),
    refetchInterval: 20_000,
  })

  const rows = useMemo(() => {
    const list = STOCKS.filter((s) => {
      if (filter === 'listed') return s.kind === 'listed'
      if (filter === 'private') return s.kind === 'private'
      if (filter === 'collateral') return Boolean(data?.lending?.[s.symbol])
      return true
    })
    if (sort === 'discount') {
      return [...list].sort((a, b) => (data?.stocks[a.symbol]?.premiumPct ?? 0) - (data?.stocks[b.symbol]?.premiumPct ?? 0))
    }
    if (sort === 'price') {
      return [...list].sort((a, b) => (data?.stocks[b.symbol]?.shareUsd ?? 0) - (data?.stocks[a.symbol]?.shareUsd ?? 0))
    }
    return list
  }, [filter, sort, data])

  const cheapest = useMemo(() => {
    const entries = STOCKS.map((s) => ({ s, p: data?.stocks[s.symbol]?.premiumPct })).filter((x) => typeof x.p === 'number')
    return entries.sort((a, b) => (a.p as number) - (b.p as number))[0]
  }, [data])
  const bestCollateral = useMemo(() => {
    // Companies only: a stablecoin backing a loan is not the point here.
    const companies = new Set(STOCKS.map((s) => s.symbol))
    return Object.entries(data?.lending ?? {})
      .filter(([symbol]) => companies.has(symbol))
      .sort((a, b) => b[1].maxLtv - a[1].maxLtv)[0]
  }, [data])

  return (
    <>
      <AppHeader />
      <Screen wide>
        <Kicker>Markets</Kicker>
        <h1 className="t-screen mt-4">
          What you can <span className="t-serif text-[34px]">own</span>
          <Stop />
        </h1>
        <p className="t-body mt-5 max-w-[620px]">
          Listed US companies and private ones before they go public, priced live in {code}. Every row shows how far
          the token trades from the thing it tracks — and what it can do once you own it.
        </p>

        <div className="mt-8 grid gap-px border border-ink bg-rule-mid sm:grid-cols-3">
          <Tile label="Cash earns" value={<Link href="/earn" className="no-underline">4%+ a year →</Link>} note="On stablecoins you have not invested" />
          <Tile
            label="Furthest below its mark"
            value={cheapest && typeof cheapest.p === 'number' ? `${cheapest.s.display} ${cheapest.p.toFixed(0)}%` : '—'}
            note={cheapest?.s.kind === 'private' ? 'vs its last private valuation' : 'vs its share price'}
          />
          <Tile
            label="Best loan backing"
            value={bestCollateral ? `${bestCollateral[0].replace(/x$/, '')} ${(bestCollateral[1].maxLtv * 100).toFixed(0)}%` : '—'}
            note="Cash you can borrow against it"
          />
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-1.5">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-monolabel transition-colors ${
                filter === key ? 'border-ink bg-ink text-ground' : 'border-rule-mid text-body-soft hover:border-ink'
              }`}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-1.5">
            <MonoLabel>Sort</MonoLabel>
            {(
              [
                ['default', 'Listed first'],
                ['discount', 'Cheapest vs mark'],
                ['price', 'Price'],
              ] as [Sort, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSort(key)}
                className={`border px-2 py-1 font-mono text-[9px] uppercase tracking-monolabel transition-colors ${
                  sort === key ? 'border-accent text-accent' : 'border-rule-mid text-body-mute hover:border-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </span>
        </div>

        <HardRule className="mt-4" />
        <div className="hidden items-baseline gap-4 border-b border-rule-hair py-2 lg:flex">
          <span className="t-mono-label flex-1">Company</span>
          <span className="t-mono-label w-32 text-right">Price</span>
          <span className="t-mono-label w-52 text-right">Against what it tracks</span>
          <span className="t-mono-label w-40 text-right">Borrow against it</span>
        </div>

        {isLoading ? (
          <div className="pt-6">
            <Spinner />
          </div>
        ) : (
          rows.map((s) => <Row key={s.symbol} stock={s} data={data} code={code} usdToLocal={usdToLocal} />)
        )}

        {!isLoading && !rows.length && <p className="t-body-sm mt-5">Nothing matches that filter yet.</p>}

        <div className="mt-8 max-w-[680px]">
          <SideNote>
            Listed companies are xStocks by Backed; private ones are PreStocks, backed 1:1 by exposure through a
            special-purpose vehicle and carrying a 1% fee on every transfer. Dividends are reinvested into the token —
            your share count grows rather than cash arriving — and splits are applied the same way. Neither carries
            voting rights. Both issuers can freeze, pause or move tokens. Borrowing terms come from the Kamino lending
            market and can change.
          </SideNote>
        </div>
      </Screen>
    </>
  )
}

function Tile({ label, value, note }: { label: string; value: React.ReactNode; note: string }) {
  return (
    <div className="bg-ground px-4 py-3.5">
      <MonoLabel>{label}</MonoLabel>
      <p className="figure mt-1.5 text-[17px] text-ink">{value}</p>
      <p className="t-disclaimer mt-1">{note}</p>
    </div>
  )
}

function Row({
  stock,
  data,
  code,
  usdToLocal,
}: {
  stock: Stock
  data?: MarketResponse
  code: string
  usdToLocal: (usd: number) => number
}) {
  const m = data?.stocks?.[stock.symbol]
  const v = data?.valuations?.[stock.symbol]
  const lend = data?.lending?.[stock.symbol]
  const premium = m?.premiumPct
  const privateCo = stock.kind === 'private'

  return (
    <Link
      // A private company gets its own page: there is no exchange price to check it against,
      // so the gap to its last round needs explaining before anyone buys.
      href={privateCo ? `/pre-ipo/${stock.symbol}` : `/create?prompt=${encodeURIComponent(stock.display)}`}
      className="row-hover flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-rule-hair py-3.5 no-underline lg:flex-nowrap"
    >
      <span className="min-w-0 flex-1">
        <span className="t-cardtitle truncate">
          {stock.display}
          {privateCo && (
            <span className="ml-2 border border-accent px-1.5 py-0.5 align-middle font-mono text-[8.5px] font-normal uppercase tracking-monolabel text-accent">
              Pre-IPO
            </span>
          )}
        </span>
        <span className="figure mt-0.5 block text-[10.5px] text-body-mute">
          {privateCo && v ? `valued ${compactUsd(v.markValuation)} at its last round` : stock.sector.replace(/-/g, ' ')}
          {!privateCo && (m?.growthPct ?? 0) > 0.005 && ` · dividends +${m!.growthPct!.toFixed(2)}% so far`}
        </span>
      </span>

      <span className="w-24 text-right lg:w-32">
        <span className="figure block text-[13.5px] text-ink">
          {m ? formatLocal(usdToLocal(m.shareUsd), code) : <span className="inline-block h-3 w-14 bg-rule-mid/50" />}
        </span>
        {m?.change24hPct != null && (
          <span className={`figure mt-0.5 block text-[10px] ${m.change24hPct >= 0 ? 'text-accent' : 'text-body-soft'}`}>
            {formatMove(m.change24hPct)} today
          </span>
        )}
      </span>

      <span className="w-full text-right lg:w-52">
        {premium == null ? (
          <span className="figure text-[10.5px] text-body-mute">no reference price</span>
        ) : (
          <span className={`figure text-[11px] ${Math.abs(premium) < 1 ? 'text-body-soft' : premium > 0 ? 'text-accent' : 'text-ink'}`}>
            {Math.abs(premium) < 0.05
              ? 'at its reference'
              : `${premium > 0 ? '+' : '−'}${Math.abs(premium).toFixed(1)}% ${premium > 0 ? 'above' : 'below'} ${privateCo ? 'last valuation' : 'share price'}`}
          </span>
        )}
      </span>

      <span className="w-full text-right lg:w-40">
        {lend ? (
          <span className="figure text-[11px] text-ink">
            up to {(lend.maxLtv * 100).toFixed(0)}% · {lend.borrowApy.toFixed(1)}% a year
          </span>
        ) : (
          <span className="figure text-[10.5px] text-body-mute">not yet</span>
        )}
      </span>
    </Link>
  )
}
