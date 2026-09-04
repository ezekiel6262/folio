'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useExecutor, isUserRejection } from '@/lib/use-executor'
import { useQuery } from '@tanstack/react-query'
import { useCurrency } from '@/components/currency-context'
import { ShareLink } from '@/components/share-link'
import { unlockText } from '@/components/folio-card'
import { formatLocal, formatShares, formatUsd } from '@/lib/assets'
import { withdrawAllCall } from '@/lib/vault'
import { VAULT_ADDRESS } from '@/lib/deployment'
import type { FolioView } from '@/lib/folio-reader'

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
      const m = (e as Error).message
      setError(isUserRejection(e) ? 'You cancelled the confirmation.' : m)
    } finally {
      setWithdrawing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3 pt-4">
        <div className="skeleton h-28 rounded-2xl" />
        <div className="skeleton h-48 rounded-2xl" />
      </div>
    )
  }

  if (!folio) {
    return (
      <div className="pt-10 text-center">
        <p className="text-[16px] font-semibold">Folio not found</p>
        <p className="mt-1.5 text-[13px] text-ink/50">{data?.error ?? 'It may not exist yet.'}</p>
        <Link href="/" className="btn-ghost mt-5">
          Back home
        </Link>
      </div>
    )
  }

  const stocks = folio.holdings.filter((h) => h.isStock)

  return (
    <div className="pt-2">
      {justCreated && (
        <div className="mb-4 rounded-xl bg-gain/[0.08] px-4 py-3 text-[13px] font-medium text-gain">
          Done. You own {stocks.map((s) => s.display).join(' and ')}.
        </div>
      )}

      {claimSecret && <ShareLink folioId={folio.id} secret={claimSecret} name={folio.name} />}

      <div className="card p-5">
        <p className="label">{folio.name}</p>
        <p className="figure mt-1 text-[34px] font-semibold leading-none">
          {formatLocal(usdToLocal(folio.totalUsd), code)}
        </p>
        <p className="mt-1.5 text-[13px] text-ink/45">{formatUsd(folio.totalUsd)}</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {folio.locked && (
            <span className="pill bg-accent-soft text-accent">{unlockText(folio.unlockAt)}</span>
          )}
          {folio.escrowed && <span className="pill bg-black/[0.06] text-ink/60">Waiting to be claimed</span>}
          {!folio.locked && !folio.escrowed && (
            <span className="pill bg-gain/10 text-gain">Unlocked</span>
          )}
        </div>
      </div>

      <div className="card mt-4 overflow-hidden">
        <p className="label px-5 pb-1 pt-4">Holdings</p>
        <div className="divide-y divide-black/[0.05]">
          {folio.holdings.map((h) => (
            <div key={h.address} className="flex items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <p className="text-[14.5px] font-semibold">{h.display}</p>
                <p className="mt-0.5 text-[12.5px] text-ink/50">
                  {h.isStock ? (
                    <>
                      <span className="figure">{formatShares(h.shares)}</span> shares ·{' '}
                      {formatLocal(usdToLocal(h.priceUsd), code, { compact: true })} each
                    </>
                  ) : (
                    <>cash sleeve</>
                  )}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="figure text-[14.5px] font-semibold">
                  {formatLocal(usdToLocal(h.valueUsd), code, { compact: true })}
                </p>
                <p className="text-[12px] text-ink/45">{h.weightPct.toFixed(0)}%</p>
              </div>
            </div>
          ))}
        </div>
        <p className="border-t border-black/[0.06] px-5 py-3 text-[11.5px] leading-relaxed text-ink/40">
          Share counts apply the current B20 multiplier, so reinvested dividends and splits are
          already reflected in what you see.
        </p>
      </div>

      {error && (
        <p className="mt-3 rounded-xl bg-loss/[0.06] px-4 py-3 text-[13px] text-loss">{error}</p>
      )}

      {isOwner && (
        <div className="mt-4 space-y-2">
          {folio.locked ? (
            <button disabled className="btn-ghost w-full">
              Locked until{' '}
              {new Date(folio.unlockAt * 1000).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </button>
          ) : (
            <button onClick={withdraw} disabled={withdrawing} className="btn-ghost w-full">
              {withdrawing ? 'Confirming…' : 'Withdraw everything to my wallet'}
            </button>
          )}
        </div>
      )}

      <Link href="/" className="mt-6 block text-center text-[13px] text-ink/45">
        Back
      </Link>
    </div>
  )
}
