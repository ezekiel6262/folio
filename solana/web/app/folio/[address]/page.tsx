'use client'

import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrency } from '@/components/currency-context'
import { dateLabel, lockLabel, SEGMENTS } from '@/components/folio-row'
import { FolioActivity } from '@/components/folio-activity'
import { HoldingActions } from '@/components/holding-actions'
import { OwnerTools } from '@/components/owner-tools'
import { RebalanceCard } from '@/components/rebalance-card'
import { ShareBasket } from '@/components/share-basket'
import { ShareLink } from '@/components/share-link'
import { AppHeader, HardRule, Kicker, MonoLabel, Screen, SideNote, Spinner, StatusChip, Stop } from '@/components/ui'
import { formatShares } from '@/lib/assets'
import { formatLocal, formatMove, formatUsd } from '@/lib/currencies'
import { isUserRejection, signAndSubmit } from '@/lib/execute'
import { useFolioWallet } from '@/lib/wallet'
import type { FolioView } from '@/lib/folio-reader'

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

/** On a test cluster there is no exchange, so adding to a folio has nowhere to buy from. */
const onTestCluster = process.env.NEXT_PUBLIC_CLUSTER === 'devnet'

/**
 * The handful of things to do with a folio, side by side rather than scattered down the
 * page. Each cell is a real capability: what is missing here (selling, moving shares out,
 * handing it on) belongs to a single holding or is a decision, and lives further down.
 */
function ActionBar({
  folio,
  isOwner,
  isSender,
  reclaimOpen,
  onReclaim,
  busy,
}: {
  folio: FolioView
  isOwner: boolean
  isSender: boolean
  reclaimOpen: boolean
  onReclaim: () => void
  busy: boolean
}) {
  const cell = 'flex-1 border-r border-rule-mid px-3 py-3 text-center font-mono text-[9.5px] uppercase tracking-monolabel last:border-r-0'
  const live = `${cell} text-ink transition-colors hover:bg-ink hover:text-ground no-underline`
  const dead = `${cell} text-body-mute`

  if (isSender && folio.escrowed) {
    return (
      <div className="mt-6 flex border border-ink">
        <Link href={`/claim/${folio.address}`} className={live}>
          See what they see
        </Link>
        {reclaimOpen ? (
          <button onClick={onReclaim} disabled={busy} className={live}>
            {busy ? 'Taking it back…' : 'Take it back'}
          </button>
        ) : (
          <span className={dead}>{folio.reclaimAfter ? `Yours again ${dateLabel(folio.reclaimAfter)}` : 'Theirs to claim'}</span>
        )}
      </div>
    )
  }

  if (!isOwner) return null

  return (
    <div className="mt-6 flex border border-ink">
      {!onTestCluster && (
        <Link href={`/create?folio=${folio.address}`} className={live}>
          Add to it
        </Link>
      )}
      {folio.locked ? (
        <span className={dead} title="A locked folio cannot be pledged: the lock holds the taking out.">
          Borrow · locked
        </span>
      ) : (
        <Link href="/borrow" className={live}>
          Borrow against it
        </Link>
      )}
      <a href="#share" className={live}>
        Share the recipe
      </a>
    </div>
  )
}

/**
 * How far a lock has left to run. The folio is already owned and already invested the whole
 * way along; the only thing the lock holds is the taking out.
 */
function LockTimeline({ madeAt, unlockAt }: { madeAt: number; unlockAt: number }) {
  const now = Math.floor(Date.now() / 1000)
  const span = Math.max(1, unlockAt - madeAt)
  const done = Math.min(100, Math.max(0, ((now - madeAt) / span) * 100))
  const yearsLeft = (unlockAt - now) / (365.25 * 86_400)

  return (
    <div className="-mx-5 mt-7 bg-ink-void px-5 py-5 lg:mx-0">
      <p className="font-mono text-[10px] uppercase tracking-monolabel text-accent-dark">Held shut</p>
      <div className="relative mt-5 h-6">
        <div className="absolute inset-x-0 top-2.5 h-[2px] bg-[#3a3a3a]" />
        <div className="absolute left-0 top-2.5 h-[2px] bg-[#8f9dff]" style={{ width: `${done}%` }} />
        <div className="absolute top-0 h-6 w-[2px] bg-ground" style={{ left: `${done}%` }} />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <span className="figure text-[10px] text-body-dark">made {dateLabel(madeAt)}</span>
        <span className="figure text-[10px] text-body-dark">opens {dateLabel(unlockAt)}</span>
      </div>
      <p className="mt-4 font-sans text-[13px] leading-[1.6] text-body-dark">
        {yearsLeft >= 1
          ? `About ${yearsLeft.toFixed(1)} years still to run.`
          : `Under a year to go — ${Math.max(0, Math.round((unlockAt - now) / 86_400))} days.`}{' '}
        It is already yours and already invested; dividends land in it the whole way through.
      </p>
    </div>
  )
}

export default function FolioPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params)
  const created = useSearchParams().get('created') === '1'
  const { code, usdToLocal } = useCurrency()
  const wallet = useFolioWallet()
  const [linkSecret, setLinkSecret] = useState<string | null>(null)
  const [selling, setSelling] = useState<string | null>(null)
  const [reclaiming, setReclaiming] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  async function reclaim() {
    setActionError(null)
    setReclaiming(true)
    try {
      const res = await fetch('/api/build/reclaim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ folio: address, creator: wallet.address }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not prepare it')
      await signAndSubmit([json.transaction], wallet.signTransaction, { accessToken: wallet.getAccessToken })
      await queryClient.invalidateQueries({ queryKey: ['folio', address] })
    } catch (e) {
      setActionError(isUserRejection(e) ? 'You cancelled. The gift is still waiting.' : (e as Error).message)
    } finally {
      setReclaiming(false)
    }
  }

  // A claim link's secret arrives in the fragment, straight from the purchase. Read it,
  // show it once, and never send it anywhere.
  useEffect(() => {
    const m = window.location.hash.match(/k=([A-Za-z0-9_-]+)/)
    if (m) setLinkSecret(m[1])
  }, [])

  const { data, isLoading } = useQuery<{ folio?: FolioView; listing?: { note: string } | null; error?: string }>({
    queryKey: ['folio', address],
    queryFn: async () => (await fetch(`/api/folio/${address}`)).json(),
    refetchInterval: 30_000,
  })
  const folio = data?.folio

  if (isLoading) {
    return (
      <>
        <AppHeader />
        <Screen>
          <div className="flex min-h-[50vh] items-center justify-center">
            <Spinner />
          </div>
        </Screen>
      </>
    )
  }

  if (!folio) {
    return (
      <>
        <AppHeader />
        <Screen>
          <Kicker>Not found</Kicker>
          <h1 className="t-screen mt-4">
            No folio here<Stop />
          </h1>
          <p className="t-body mt-5">{data?.error ?? 'It may not exist yet.'}</p>
          <Link href="/" className="btn-secondary mt-7 no-underline">
            Back
          </Link>
        </Screen>
      </>
    )
  }

  const isOwner = Boolean(wallet.address && folio.owner === wallet.address)
  const canSell = isOwner && !folio.escrowed && !folio.locked
  const isSender = Boolean(wallet.address && folio.escrowed && folio.creator === wallet.address)
  const reclaimOpen = isSender && folio.reclaimAfter > 0 && folio.reclaimAfter * 1000 <= Date.now()

  return (
    <>
      <AppHeader />
      <Screen wide>
        {created && (
          <div className="-mx-5 -mt-7 mb-7 bg-ink-void px-5 py-4 lg:mx-0 lg:mt-0">
            <p className="font-sans text-[13px] leading-[1.55] text-body-dark">
              <span className="text-accent-dark">Done.</span> You own {folio.holdings.map((h) => h.display).join(' and ')}, in your own name.
            </p>
          </div>
        )}

        {linkSecret && folio.escrowed && (
          <div className="mb-7">
            <ShareLink folio={folio.address} secret={linkSecret} name={folio.name} />
          </div>
        )}

        <Kicker>{folio.escrowed ? 'Sent · not yet claimed' : isOwner ? 'Yours' : 'A folio'}</Kicker>
        <h1 className="mt-3 font-sans text-[32px] font-bold uppercase leading-[1.02] tracking-screen">{folio.name || 'Untitled'}</h1>
        <p className="figure mt-5 text-[40px] font-medium leading-none tracking-figure">{formatLocal(usdToLocal(folio.totalUsd), code)}</p>
        <p className="figure mt-2 text-[11px] text-body-mute">
          {formatUsd(folio.totalUsd)} · {folio.holdings.length} {folio.holdings.length === 1 ? 'company' : 'companies'} · made {dateLabel(folio.createdAt)}
        </p>
        {folio.change24hPct != null && (
          <p className="figure mt-1.5 text-[11px]">
            <span className={folio.change24hPct >= 0 ? 'text-accent' : 'text-ink'}>{formatMove(folio.change24hPct)}</span>
            <span className="text-body-mute"> — what these companies did today, not what you have made</span>
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {folio.escrowed && <StatusChip tone="solid">Waiting to be claimed</StatusChip>}
          {folio.locked && <StatusChip>{lockLabel(folio.unlockAt)}</StatusChip>}
          {!folio.locked && !folio.escrowed && <StatusChip tone="mute">No lock</StatusChip>}
        </div>

        {folio.holdings.length > 0 && (
          <div className="mt-5 flex h-2.5 w-full">
            {folio.holdings.map((h, i) => (
              <div key={h.mint} style={{ width: `${h.weightPct}%`, background: SEGMENTS[i % SEGMENTS.length] }} />
            ))}
          </div>
        )}

        {(isOwner || isSender) && <ActionBar folio={folio} isOwner={isOwner} isSender={isSender} reclaimOpen={reclaimOpen} onReclaim={reclaim} busy={reclaiming} />}

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14">
        <div>
        <HardRule className="mt-7" />
        <p className="t-label mt-5">What is inside</p>
        <div className="mt-3">
          {folio.holdings.map((h) => (
            <div key={h.mint} className="border-b border-rule-hair py-3.5">
              <div className="flex items-baseline justify-between gap-4">
                <span className="t-cardtitle">{h.display}</span>
                <span className="figure text-[13.5px] text-ink">{formatLocal(usdToLocal(h.valueUsd), code)}</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-4">
                <span className="figure text-[10.5px] text-body-mute">
                  {formatShares(h.shares)} sh · {formatUsd(h.shareUsd)} each
                  {h.change24hPct != null && ` · ${formatMove(h.change24hPct)} today`}
                </span>
                <span className="figure text-[10px] text-body-mute">{h.weightPct.toFixed(0)}%</span>
              </div>
              {h.growthPct > 0.005 && (
                <p className="figure mt-1 text-[10.5px] text-accent">
                  {h.growthPct < 5
                    ? `+${h.growthPct.toFixed(2)}% of these shares came from reinvested dividends`
                    : `includes a ${(1 + h.growthPct / 100).toFixed(2)}× split by the issuer`}
                  {h.lastChange &&
                    ` · last ${h.lastChange.pct >= 5 ? `${(1 + h.lastChange.pct / 100).toFixed(2)}× split` : `+${h.lastChange.pct.toFixed(3)}%`} on ${new Date(
                      h.lastChange.at * 1000,
                    ).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                </p>
              )}
              {canSell && selling !== h.symbol && (
                <button
                  onClick={() => setSelling(h.symbol)}
                  className="mt-2 border border-accent px-2 py-1 font-mono text-[9.5px] uppercase tracking-monolabel text-accent"
                >
                  Sell or move
                </button>
              )}
              {canSell && selling === h.symbol && <HoldingActions folio={folio.address} holding={h} onDone={() => setSelling(null)} />}
            </div>
          ))}
        </div>

        {isOwner && !folio.escrowed && (
          <Link href={`/create?folio=${folio.address}`} className="btn-secondary mt-6 no-underline">
            Add to this folio
          </Link>
        )}

        {folio.holdings.length > 0 && (
          <div id="share">
            <ShareBasket folio={folio.address} />
          </div>
        )}

        {isOwner && !folio.escrowed && <RebalanceCard folio={folio} />}

        {isOwner && !folio.escrowed && <OwnerTools folio={folio} listing={data?.listing} />}

        <FolioActivity folio={folio.address} />

        {isSender && (
          <div className="mt-7 border border-rule-mid p-4">
            <MonoLabel>You sent this gift</MonoLabel>
            <p className="t-body-sm mt-2">
              {reclaimOpen
                ? 'Nobody has claimed it, and the take-back date has passed. You can take it back into your name.'
                : folio.reclaimAfter
                  ? `If nobody claims it, you can take it back from ${dateLabel(folio.reclaimAfter)}.`
                  : 'It stays claimable by whoever holds the link.'}
            </p>
            {reclaimOpen && (
              <button onClick={reclaim} disabled={reclaiming} className="btn-primary mt-3 !min-h-[44px]">
                {reclaiming ? 'Taking it back…' : 'Take it back'}
              </button>
            )}
            {actionError && (
              <p className="t-body-sm mt-2">
                <span className="text-accent">● </span>
                {actionError}
              </p>
            )}
          </div>
        )}

        {folio.locked && (
          <div className="-mx-5 mt-7 bg-ink-void px-5 py-4">
            <p className="font-sans text-[13px] leading-[1.55] text-body-dark">
              <span className="text-accent-dark">Locked</span> until {dateLabel(folio.unlockAt)}. It is already owned and already
              invested — the lock only holds the taking out.
            </p>
          </div>
        )}

        </div>

        <div>
        {/* Proof: anyone can check this without taking Folio's word for it. */}
        <div className="mt-9 border-2 border-ink lg:mt-7">
          <div className="h-1.5 bg-accent" />
          <div className="p-4">
            <Kicker>Custody receipt</Kicker>
            <p className="t-reassure mt-3 text-body">
              Held in a vault in the owner&apos;s name. Anyone can check this — <span className="italic">no one has to take our word</span>.
            </p>
            <div className="mt-4">
              {[
                ['Owner', folio.owner ? short(folio.owner) : 'Waiting for a claim'],
                ['Folio', short(folio.address)],
                ['Chain', onTestCluster ? 'Solana devnet · a test cluster' : 'Solana mainnet'],
                ['Made', dateLabel(folio.createdAt)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 border-t border-rule-hair py-2 first:border-t-0">
                  <span className="t-mono-label">{k}</span>
                  <span className="figure text-[11.5px] text-ink">{v}</span>
                </div>
              ))}
            </div>
            <a
              href={`https://solscan.io/account/${folio.address}${onTestCluster ? '?cluster=devnet' : ''}`}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary mt-4 no-underline"
            >
              Open on Solscan ↗
            </a>
          </div>
        </div>

        {folio.locked && <LockTimeline madeAt={folio.createdAt} unlockAt={folio.unlockAt} />}

        <div className="mt-7 border border-rule-mid p-4">
          <MonoLabel>Dividends and company actions</MonoLabel>
          <p className="t-body-sm mt-2">
            Dividends are not paid out as cash — the issuer reinvests them, and your share count
            grows instead. Splits work the same way. Both are applied to every number on this page as
            soon as they happen, so a holding never quietly changes meaning. These tokens carry no
            voting rights, and private companies pay no dividends.
          </p>
        </div>

        <div className="mt-6">
          <SideNote>
            The shares are xStocks issued by Backed. The issuer keeps the power to freeze, pause and
            move them — even out of this vault. Folio cannot move them; only the owner can, once any
            lock has passed.
          </SideNote>
        </div>

        <MonoLabel className="mt-6">
          Share counts are share-equivalents, adjusted for dividends and splits.
        </MonoLabel>
        </div>
        </div>

        <Link href="/" className="btn-ghost mt-8 block text-center no-underline">
          Back
        </Link>
      </Screen>
    </>
  )
}
