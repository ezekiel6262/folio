'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useCurrency } from '@/components/currency-context'
import { lockLabel } from '@/components/folio-row'
import { AppHeader, Kicker, Screen, SideNote, Spinner, StatusChip, Stop } from '@/components/ui'
import { formatLocal, formatMove } from '@/lib/currencies'
import type { ExploreCard } from '@/lib/explore'

/** The order the handoff gives for basket segments. Label colour flips on the dark ones. */
const SEGMENTS = ['#111111', '#1a2fd6', '#8f9dff', '#5a5858', '#b5b2b2', '#2a2929', '#d4d2d2']

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

/**
 * Where copying leads. On a test cluster there is no exchange to buy from, so a copy is made
 * from the test shares the demo hands out; on mainnet it goes to the ordinary buying flow with
 * the companies already written in.
 */
const copyHref = (card: ExploreCard) =>
  process.env.NEXT_PUBLIC_CLUSTER === 'devnet'
    ? `/demo?pick=${encodeURIComponent(card.holdings.map((h) => h.symbol).join(','))}&name=${encodeURIComponent(card.name)}`
    : `/create?prompt=${encodeURIComponent(card.holdings.map((h) => h.display).join(', '))}`
const madeOn = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

/**
 * Folios other people chose to show. What travels is the idea, not the person: copying one
 * opens the create flow with its companies, and the copy is bought at today's prices into
 * a vault in the copier's own name. Nobody here is paid for copies, and nothing about an
 * owner's other holdings is on this page.
 */
export default function ExplorePage() {
  const { code, usdToLocal } = useCurrency()
  const { data, isLoading } = useQuery<{ cards: ExploreCard[]; error?: string }>({
    queryKey: ['explore'],
    queryFn: async () => (await fetch('/api/explore')).json(),
    refetchInterval: 60_000,
  })
  const cards = data?.cards ?? []

  return (
    <>
      <AppHeader />
      <Screen wide>
        <Kicker>Explore</Kicker>
        <h1 className="t-screen mt-4">
          Folios other people <span className="t-serif text-[34px]">made</span>
          <Stop />
        </h1>
        <p className="t-body mt-4 max-w-[620px]">
          Copy the sentence, not the person. You get your own folio, in your own name, priced in {code}. Make any of
          yours public from its own page.
        </p>

        {isLoading ? (
          <div className="mt-10">
            <Spinner />
          </div>
        ) : cards.length ? (
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <article key={card.folio} className="flex flex-col border border-ink">
                <div className="flex h-1.5">
                  {card.holdings.map((h, i) => (
                    <div key={h.symbol} style={{ width: `${h.weightPct}%`, background: SEGMENTS[i % SEGMENTS.length] }} />
                  ))}
                </div>
                <div className="flex flex-1 flex-col gap-2.5 p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="t-mono-label">by {short(card.owner)}</span>
                    <span className="figure text-[10.5px] text-accent">made {madeOn(card.madeAt)}</span>
                  </div>
                  <h2 className="font-sans text-[20px] font-bold uppercase leading-[1.04] tracking-screen">
                    <Link href={`/folio/${card.folio}`} className="text-ink no-underline hover:text-accent">
                      {card.name || 'Untitled'}
                    </Link>
                  </h2>
                  {card.unlockAt > 0 && (
                    <span>
                      <StatusChip>{lockLabel(card.unlockAt)}</StatusChip>
                    </span>
                  )}
                  {card.note && <p className="font-serif text-[17px] leading-[1.3] text-body">“{card.note}”</p>}
                  <p className="t-body-sm">{card.holdings.map((h) => h.display).join(', ')}</p>
                  <p className="figure text-[11px] text-body-mute">
                    {formatLocal(usdToLocal(card.totalUsd), code)} held in it
                    {card.change24hPct != null && (
                      <span className={card.change24hPct >= 0 ? 'text-accent' : 'text-ink'}> · {formatMove(card.change24hPct)} today</span>
                    )}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                    <span className="figure text-[10.5px] text-body-mute">
                      {card.copies === 1 ? 'first of its kind' : `${card.copies} folios from this idea`}
                    </span>
                    <Link
                      href={copyHref(card)}
                      className="border border-ink bg-ink px-3 py-2 font-sans text-[10.5px] font-bold uppercase tracking-monolabel text-ground no-underline transition-colors hover:border-accent hover:bg-accent"
                    >
                      Copy this folio
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-10 max-w-[560px] border-2 border-ink p-5">
            <p className="t-body-sm">
              {data?.error ?? 'Nobody has made a folio public yet. Open one of yours and choose “Show it publicly” to be first.'}
            </p>
            <Link href="/" className="btn-secondary mt-4 no-underline">
              Your folios
            </Link>
          </div>
        )}

        <div className="mt-8 max-w-[680px]">
          <SideNote>
            A public folio shows its basket, its sentence, its size, how its companies moved today and when it was
            made — never the owner&apos;s other holdings, and never what they paid or made.
            Copying buys at today&apos;s prices, so what you get is not what they got, and nobody is paid for copies.
            Past holdings say nothing about what happens next.
          </SideNote>
        </div>
      </Screen>
    </>
  )
}
