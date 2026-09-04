'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useExecutor, isUserRejection } from '@/lib/use-executor'
import { useQuery } from '@tanstack/react-query'
import type { Hex } from 'viem'
import { useCurrency } from '@/components/currency-context'
import { ConnectButton } from '@/components/connect-button'
import { formatLocal, formatShares } from '@/lib/assets'
import { claimCall } from '@/lib/vault'
import { VAULT_ADDRESS } from '@/lib/deployment'
import type { FolioView } from '@/lib/folio-reader'

/**
 * The gift card. A recipient lands here from a link and should understand what they have
 * been given before they know or care what a wallet is.
 */
export default function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const { code, usdToLocal } = useCurrency()
  const { execute } = useExecutor()

  const [secret, setSecret] = useState<Hex | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The secret lives in the fragment and never leaves the browser.
  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, '')
    if (/^0x[0-9a-fA-F]{64}$/.test(raw)) setSecret(raw as Hex)
  }, [])

  const { data, refetch } = useQuery<{ folio: FolioView; error?: string }>({
    queryKey: ['folio', id],
    queryFn: async () => (await fetch(`/api/folio/${id}`)).json(),
    refetchInterval: 20_000,
  })
  const folio = data?.folio

  async function claim() {
    if (!secret || !folio) return
    setError(null)
    setClaiming(true)
    try {
      await execute([claimCall(BigInt(folio.id), secret, VAULT_ADDRESS)])
      setTimeout(async () => {
        await refetch()
        router.push(`/folio/${folio.id}`)
      }, 3500)
    } catch (e) {
      const m = (e as Error).message
      setError(isUserRejection(e) ? 'You cancelled the confirmation.' : m)
      setClaiming(false)
    }
  }

  if (!folio) {
    return (
      <div className="pt-16 text-center">
        <div className="skeleton mx-auto h-40 w-full rounded-2xl" />
      </div>
    )
  }

  const stocks = folio.holdings.filter((h) => h.isStock)
  const alreadyClaimed = !folio.escrowed

  return (
    <div className="pt-6">
      <div className="card overflow-hidden">
        <div className="bg-ink px-6 py-7 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">
            {alreadyClaimed ? 'Already claimed' : 'A gift for you'}
          </p>
          <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-tight">{folio.name}</h1>
          <p className="figure mt-3 text-[30px] font-semibold leading-none">
            {formatLocal(usdToLocal(folio.totalUsd), code)}
          </p>
          <p className="mt-2 text-[13px] text-white/55">
            {stocks.map((s) => s.display).join(' and ')}
          </p>
        </div>

        <div className="divide-y divide-black/[0.05]">
          {stocks.map((h) => (
            <div key={h.address} className="flex items-center justify-between px-5 py-3">
              <span className="text-[14px] font-medium">{h.display}</span>
              <span className="figure text-[13.5px] text-ink/70">{formatShares(h.shares)} shares</span>
            </div>
          ))}
        </div>

        {folio.locked && (
          <div className="border-t border-black/[0.06] bg-accent-soft/50 px-5 py-3.5">
            <p className="text-[13px] leading-relaxed text-ink/70">
              This is yours from the moment you claim it, but it unlocks on{' '}
              <span className="font-semibold text-ink">
                {new Date(folio.unlockAt * 1000).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
              . Until then you can watch it, but not sell it.
            </p>
          </div>
        )}
      </div>

      {error && <p className="mt-3 rounded-xl bg-loss/[0.06] px-4 py-3 text-[13px] text-loss">{error}</p>}

      <div className="mt-5">
        {alreadyClaimed ? (
          <p className="text-center text-[13.5px] text-ink/50">
            This folio has already been claimed.
          </p>
        ) : !secret ? (
          <p className="rounded-xl bg-loss/[0.06] px-4 py-3 text-center text-[13px] leading-relaxed text-loss">
            This link is missing its claim key. Ask the sender for the full link.
          </p>
        ) : !isConnected ? (
          <>
            <ConnectButton full />
            <p className="mt-3 text-center text-[12.5px] text-ink/45">
              Sign in to accept it — a passkey takes seconds, or use a wallet you already have.
            </p>
          </>
        ) : (
          <>
            <button onClick={claim} disabled={claiming} className="btn-primary w-full">
              {claiming ? 'Claiming…' : 'Claim this folio'}
            </button>
            <p className="mt-3 text-center text-[12.5px] text-ink/45">
              It will move into your wallet at {address?.slice(0, 6)}…{address?.slice(-4)}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
