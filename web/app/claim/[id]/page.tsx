'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import type { Hex } from 'viem'
import { useExecutor, isUserRejection } from '@/lib/use-executor'
import { useCurrency } from '@/components/currency-context'
import { ConnectButton } from '@/components/connect-button'
import { Kicker, MonoLabel, Spinner } from '@/components/ui'
import { formatLocal, formatShares, formatUsd } from '@/lib/assets'
import { claimCall } from '@/lib/vault'
import { VAULT_ADDRESS } from '@/lib/deployment'
import type { FolioView } from '@/lib/folio-reader'

/**
 * Screen 11. A recipient lands here from a link, possibly having never used a wallet.
 * They should understand what they have been given before being asked to sign anything,
 * so the certificate comes first and the wallet question comes last.
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
      }, 3000)
    } catch (e) {
      setError(isUserRejection(e) ? 'You cancelled the confirmation. The gift is still waiting.' : (e as Error).message)
      setClaiming(false)
    }
  }

  if (!folio) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ground-inset">
        <Spinner />
      </div>
    )
  }

  const stocks = folio.holdings.filter((h) => h.isStock)
  const alreadyClaimed = !folio.escrowed
  const unlockDate = folio.unlockAt
    ? new Date(folio.unlockAt * 1000)
        .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        .toUpperCase()
    : null

  return (
    <div className="min-h-screen bg-ground-inset px-4 py-8">
      <div className="animate-rise mx-auto max-w-[398px]">
        {/* The certificate. A 6px accent bar bleeds across the top of the plate. */}
        <div className="border-2 border-ink bg-ground">
          <div className="h-1.5 bg-accent" />

          <div className="px-5 pb-6 pt-5">
            <Kicker>{alreadyClaimed ? 'Already claimed' : 'Set aside for you'}</Kicker>

            <p className="t-mono-label mt-4">
              From {folio.creator.slice(0, 6)}…{folio.creator.slice(-4)}
            </p>
            <h1 className="mt-1.5 font-sans text-[34px] font-bold uppercase leading-[1.0] tracking-screen">
              {folio.name}
            </h1>

            <hr className="my-5 border-0 border-t-2 border-ink" />

            <MonoLabel>Worth today</MonoLabel>
            <p className="figure mt-2 text-[46px] font-medium leading-none tracking-figure">
              {formatLocal(usdToLocal(folio.totalUsd), code)}
            </p>
            <p className="figure mt-2 text-[11px] text-body-mute">
              {formatUsd(folio.totalUsd)} · {stocks.length}{' '}
              {stocks.length === 1 ? 'company' : 'companies'}
            </p>

            <div className="mt-6">
              {stocks.map((h) => (
                <div
                  key={h.address}
                  className="flex items-baseline justify-between gap-4 border-t border-rule-hair py-3"
                >
                  <span className="t-cardtitle">{h.display}</span>
                  <span className="figure text-[12px] text-body-soft">
                    {formatShares(h.shares)} sh
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* The reassurance that matters most sits on the void ground. */}
          <div className="bg-ink-void px-5 py-4">
            <p className="font-sans text-[13px] leading-[1.6] text-body-dark">
              <span className="text-accent-dark">It is already yours.</span>{' '}
              {unlockDate
                ? `You can watch it from today. The shares can be taken out from ${unlockDate}.`
                : 'Claim it and the shares move into your name straight away.'}
            </p>
          </div>

          <div className="px-5 pb-6 pt-5">
            <p className="t-reassure text-body">
              These are real shares in real companies, bought in your name and held in a vault only
              you can open. Not points, not a voucher.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 border border-accent bg-ground p-3.5">
            <p className="t-body-sm">
              <span className="text-accent">● </span>
              {error}
            </p>
          </div>
        )}

        <div className="mt-5">
          {alreadyClaimed ? (
            <p className="t-body-sm text-center">This folio has already been claimed.</p>
          ) : !secret ? (
            <div className="border border-accent bg-ground p-3.5">
              <p className="t-body-sm">
                <span className="text-accent">● </span>
                This link is missing its key, so it cannot be claimed. Ask whoever sent it for the
                full link.
              </p>
            </div>
          ) : !isConnected ? (
            <>
              <ConnectButton full label="Make it mine" />
              <p className="t-disclaimer mt-3 text-center">
                Takes about a minute. A passkey is enough — no app, no seed phrase.
              </p>
            </>
          ) : (
            <>
              <button onClick={claim} disabled={claiming} className="btn-primary !min-h-[54px]">
                {claiming ? 'Claiming…' : 'Make it mine'}
              </button>
              <p className="t-disclaimer mt-3 text-center">
                It moves into {address?.slice(0, 6)}…{address?.slice(-4)}
              </p>
            </>
          )}
        </div>

        <p className="t-disclaimer mt-8 text-center">
          Folio is an interface and a vault. It is not a broker or an issuer.
        </p>
      </div>
    </div>
  )
}
