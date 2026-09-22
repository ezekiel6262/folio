'use client'

import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrency } from '@/components/currency-context'
import { dateLabel, lockLabel } from '@/components/folio-row'
import { SellSheet } from '@/components/sell-sheet'
import { ShareLink } from '@/components/share-link'
import { AppHeader, HardRule, Kicker, MonoLabel, Screen, SideNote, Spinner, StatusChip, Stop } from '@/components/ui'
import { formatShares } from '@/lib/assets'
import { formatLocal, formatUsd } from '@/lib/currencies'
import { isUserRejection, signAndSubmit } from '@/lib/execute'
import { useFolioWallet } from '@/lib/wallet'
import type { FolioView } from '@/lib/folio-reader'

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

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

  const { data, isLoading } = useQuery<{ folio?: FolioView; error?: string }>({
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
      <Screen>
        {created && (
          <div className="-mx-5 -mt-7 mb-7 bg-ink-void px-5 py-4">
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
        <div className="mt-4 flex flex-wrap gap-1.5">
          {folio.escrowed && <StatusChip tone="solid">Waiting to be claimed</StatusChip>}
          {folio.locked && <StatusChip>{lockLabel(folio.unlockAt)}</StatusChip>}
          {!folio.locked && !folio.escrowed && <StatusChip tone="mute">No lock</StatusChip>}
        </div>

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
                </span>
                <span className="figure text-[10px] text-body-mute">{h.weightPct.toFixed(0)}%</span>
              </div>
              {canSell && selling !== h.symbol && (
                <button
                  onClick={() => setSelling(h.symbol)}
                  className="mt-2 border border-accent px-2 py-1 font-mono text-[9.5px] uppercase tracking-monolabel text-accent"
                >
                  Sell
                </button>
              )}
              {canSell && selling === h.symbol && <SellSheet folio={folio.address} holding={h} onDone={() => setSelling(null)} />}
            </div>
          ))}
        </div>

        {isOwner && !folio.escrowed && (
          <Link href={`/create?folio=${folio.address}`} className="btn-secondary mt-6 no-underline">
            Add to this folio
          </Link>
        )}

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

        {/* Proof: anyone can check this without taking Folio's word for it. */}
        <div className="mt-9 border-2 border-ink">
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
                ['Chain', 'Solana mainnet'],
                ['Made', dateLabel(folio.createdAt)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 border-t border-rule-hair py-2 first:border-t-0">
                  <span className="t-mono-label">{k}</span>
                  <span className="figure text-[11.5px] text-ink">{v}</span>
                </div>
              ))}
            </div>
            <a href={`https://solscan.io/account/${folio.address}`} target="_blank" rel="noreferrer" className="btn-secondary mt-4 no-underline">
              Open on Solscan ↗
            </a>
          </div>
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

        <Link href="/" className="btn-ghost mt-8 block text-center no-underline">
          Back
        </Link>
      </Screen>
    </>
  )
}
