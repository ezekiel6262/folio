'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { useExecutor, isUserRejection } from '@/lib/use-executor'
import { useCurrency } from '@/components/currency-context'
import { ShareLink } from '@/components/share-link'
import { unlockText } from '@/components/folio-card'
import { AppHeader, HardRule, Kicker, MonoLabel, Screen, Spinner, StatusChip, Stop } from '@/components/ui'
import { formatLocal, formatShares, formatUsd } from '@/lib/assets'
import { withdrawAllCall } from '@/lib/vault'
import { VAULT_ADDRESS } from '@/lib/deployment'
import type { FolioView } from '@/lib/folio-reader'

/** Screen 10. A folio you own, or one you have sent and not yet had claimed. */
export default function FolioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const search = useSearchParams()
  const claimSecret = search.get('claim')
  const justCreated = search.get('created') === '1'

  const { address } = useAccount()
  const { code, usdToLocal } = useCurrency()
  const { execute } = useExecutor()
  const [withdrawing, setWithdrawing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading, refetch } = useQuery<{ folio: FolioView; error?: string }>({
    queryKey: ['folio', id],
    queryFn: async () => (await fetch(`/api/folio/${id}`)).json(),
    refetchInterval: 30_000,
  })

  const folio = data?.folio
  const isOwner = Boolean(address && folio && folio.owner.toLowerCase() === address.toLowerCase())

  async function withdraw() {
    if (!address || !folio) return
    setError(null)
    setWithdrawing(true)
    try {
      await execute([withdrawAllCall(BigInt(folio.id), address, VAULT_ADDRESS)])
      setTimeout(() => refetch(), 3000)
    } catch (e) {
      setError(isUserRejection(e) ? 'You cancelled the confirmation.' : (e as Error).message)
    } finally {
      setWithdrawing(false)
    }
  }

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
            No folio here
            <Stop />
          </h1>
          <p className="t-body mt-5">{data?.error ?? 'It may not exist yet.'}</p>
          <Link href="/" className="btn-secondary mt-7 no-underline">
            Back
          </Link>
        </Screen>
      </>
    )
  }

  const stocks = folio.holdings.filter((h) => h.isStock)
  const created = new Date(folio.createdAt * 1000)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase()

  return (
    <>
      <AppHeader />
      <Screen>
        {justCreated && (
          <div className="-mx-5 mb-7 bg-ink-void px-5 py-4">
            <p className="font-sans text-[13px] leading-[1.55] text-body-dark">
              <span className="text-accent-dark">Done.</span> You own{' '}
              {stocks.map((s) => s.display).join(' and ')}, in your own name.
            </p>
          </div>
        )}

        {claimSecret && (
          <div className="mb-7">
            <ShareLink folioId={folio.id} secret={claimSecret} name={folio.name} />
          </div>
        )}

        <Kicker>{folio.escrowed ? 'Sent · not yet claimed' : 'Yours'}</Kicker>

        <h1 className="mt-3 font-sans text-[32px] font-bold uppercase leading-[1.02] tracking-screen">
          {folio.name}
        </h1>

        <p className="figure mt-5 text-[40px] font-medium leading-none tracking-figure">
          {formatLocal(usdToLocal(folio.totalUsd), code)}
        </p>
        <p className="figure mt-2 text-[11px] text-body-mute">
          {formatUsd(folio.totalUsd)} · {stocks.length} {stocks.length === 1 ? 'company' : 'companies'} ·
          made {created}
        </p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {folio.escrowed && <StatusChip tone="solid">Waiting to be claimed</StatusChip>}
          {folio.locked && <StatusChip>{unlockText(folio.unlockAt)}</StatusChip>}
          {!folio.locked && !folio.escrowed && <StatusChip tone="mute">No lock</StatusChip>}
        </div>

        <HardRule className="mt-7" />

        <p className="t-label mt-5">What is inside</p>
        <div className="mt-3">
          {folio.holdings.map((h) => (
            <div key={h.address} className="border-b border-rule-hair py-3.5">
              <div className="flex items-baseline justify-between gap-4">
                <span className="t-cardtitle">{h.display}</span>
                <span className="figure text-[13.5px] text-ink">
                  {formatLocal(usdToLocal(h.valueUsd), code, { compact: true })}
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-4">
                <span className="figure text-[10.5px] text-body-mute">
                  {h.isStock ? `${formatShares(h.shares)} sh · ${formatUsd(h.priceUsd)} each` : 'cash sleeve'}
                </span>
                <span className="figure text-[10px] text-body-mute">{h.weightPct.toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>

        <p className="t-disclaimer mt-4">
          Share counts are share-equivalents, adjusted for dividends and splits. The shares sit in a
          vault in your name — Folio cannot move them, only the owner address can.
        </p>

        {error && (
          <div className="mt-5 border border-accent p-3.5">
            <p className="t-body-sm">
              <span className="text-accent">● </span>
              {error}
            </p>
          </div>
        )}

        {isOwner && (
          <div className="mt-7">
            {folio.locked ? (
              <>
                <div className="-mx-5 bg-ink-void px-5 py-4">
                  <p className="font-sans text-[13px] leading-[1.55] text-body-dark">
                    <span className="text-accent-dark">Locked</span> until{' '}
                    {new Date(folio.unlockAt * 1000)
                      .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                      .toUpperCase()}
                    . It is already yours and already invested — the lock only holds the taking out.
                  </p>
                </div>
              </>
            ) : (
              <button onClick={withdraw} disabled={withdrawing} className="btn-secondary">
                {withdrawing ? 'Confirming…' : 'Take the shares out'}
              </button>
            )}
          </div>
        )}

        <Link href="/" className="btn-ghost mt-8 block text-center no-underline">
          Back
        </Link>
      </Screen>
    </>
  )
}
