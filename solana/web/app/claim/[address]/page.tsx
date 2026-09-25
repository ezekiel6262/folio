'use client'

import { use, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Keypair } from '@solana/web3.js'
import { useCurrency } from '@/components/currency-context'
import { dateLabel } from '@/components/folio-row'
import { Kicker, Logo, MonoLabel, Spinner } from '@/components/ui'
import { formatShares } from '@/lib/assets'
import { formatLocal, formatUsd } from '@/lib/currencies'
import { fromBase64Url, isUserRejection, signAndSubmit } from '@/lib/execute'
import { useFolioWallet } from '@/lib/wallet'
import type { FolioView } from '@/lib/folio-reader'

/**
 * The gift, received. A recipient lands here from a link, possibly never having used a
 * wallet, and should understand what they have been given before being asked to sign in.
 */
export default function ClaimPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params)
  const router = useRouter()
  const wallet = useFolioWallet()
  const { code, usdToLocal } = useCurrency()
  const [secret, setSecret] = useState<string | null>(null)
  const [envelope, setEnvelope] = useState<{ to?: string; note?: string }>({})
  const [opened, setOpened] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Everything personal about a gift travels in the fragment, which browsers never send to a
  // server: the claim key, who it is for, and whatever the sender wanted to say.
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    const m = hash.match(/k=([A-Za-z0-9_-]+)/)
    if (m) setSecret(m[1])
    const params = new URLSearchParams(hash)
    setEnvelope({ to: params.get('to')?.slice(0, 24) || undefined, note: params.get('m')?.slice(0, 120) || undefined })
  }, [])

  const linkKey = useMemo(() => {
    if (!secret) return null
    try {
      return Keypair.fromSecretKey(fromBase64Url(secret))
    } catch {
      return null
    }
  }, [secret])

  const { data } = useQuery<{ folio?: FolioView; error?: string }>({
    queryKey: ['folio', address],
    queryFn: async () => (await fetch(`/api/folio/${address}`)).json(),
    refetchInterval: 20_000,
  })
  const folio = data?.folio
  const linkMatches = Boolean(folio && linkKey && folio.claimKey === linkKey.publicKey.toBase58())

  async function claim() {
    if (!folio || !linkKey || !wallet.address) return
    setError(null)
    setClaiming(true)
    try {
      const res = await fetch('/api/build/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ folio: folio.address, claimKey: linkKey.publicKey.toBase58(), claimant: wallet.address }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not prepare the claim')
      await signAndSubmit([json.transaction], wallet.signTransaction, { extraSigners: [linkKey], accessToken: wallet.getAccessToken })
      router.replace(`/folio/${folio.address}`)
    } catch (e) {
      setError(isUserRejection(e) ? 'You cancelled. The gift is still waiting for you.' : (e as Error).message)
      setClaiming(false)
    }
  }

  if (!folio) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ground-inset">
        {data?.error ? <p className="t-body px-6 text-center">{data.error}</p> : <Spinner />}
      </div>
    )
  }

  // An envelope before a certificate: a recipient should get a moment that is theirs before
  // a page of figures. Only for a gift still waiting — a claimed one opens straight up.
  if (folio.escrowed && !opened) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ground-inset px-4 py-8">
        <div className="animate-rise w-full max-w-[398px]">
          <div className="border-2 border-ink bg-ground">
            <div className="h-1.5 bg-accent" />
            <div
              className="flex h-[132px] items-center justify-center border-b border-rule-hair"
              style={{
                backgroundImage:
                  'linear-gradient(to bottom right, transparent calc(50% - 0.5px), #d8d8d8 50%, transparent calc(50% + 0.5px)), linear-gradient(to bottom left, transparent calc(50% - 0.5px), #d8d8d8 50%, transparent calc(50% + 0.5px))',
              }}
            >
              <span className="flex h-14 w-14 items-center justify-center bg-ground">
                <Logo size={34} />
              </span>
            </div>
            <div className="px-5 pb-6 pt-5 text-center">
              <Kicker>{envelope.to ? `For ${envelope.to}` : 'Set aside for you'}</Kicker>
              {envelope.note ? (
                <p className="mt-4 font-serif text-[22px] leading-[1.3] text-ink">“{envelope.note}”</p>
              ) : (
                <p className="mt-4 font-serif text-[22px] leading-[1.3] text-ink">
                  Someone bought you shares in real companies.
                </p>
              )}
              <button onClick={() => setOpened(true)} className="btn-primary mt-6 !min-h-[54px]">
                Open it
              </button>
              <p className="t-disclaimer mt-3">No account needed to look.</p>
            </div>
          </div>
          <p className="t-disclaimer mt-8 text-center">Folio is an interface and a vault. It is not a broker or an issuer.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-ground-inset px-4 py-8">
      <div className="animate-rise mx-auto max-w-[398px]">
        <div className="border-2 border-ink bg-ground">
          <div className="h-1.5 bg-accent" />
          <div className="px-5 pb-6 pt-5">
            <Kicker>{folio.escrowed ? (envelope.to ? `For ${envelope.to}` : 'Set aside for you') : 'Already claimed'}</Kicker>
            <h1 className="mt-4 font-sans text-[34px] font-bold uppercase leading-[1.0] tracking-screen">{folio.name || 'A gift'}</h1>
            {envelope.note && <p className="mt-3 font-serif text-[18px] leading-[1.35] text-body">“{envelope.note}”</p>}
            <hr className="my-5 border-0 border-t-2 border-ink" />
            <MonoLabel>Worth today</MonoLabel>
            <p className="figure mt-2 text-[46px] font-medium leading-none tracking-figure">{formatLocal(usdToLocal(folio.totalUsd), code)}</p>
            <p className="figure mt-2 text-[11px] text-body-mute">
              {formatUsd(folio.totalUsd)} · {folio.holdings.length} {folio.holdings.length === 1 ? 'company' : 'companies'}
            </p>
            <div className="mt-6">
              {folio.holdings.map((h) => (
                <div key={h.mint} className="flex items-baseline justify-between gap-4 border-t border-rule-hair py-3">
                  <span className="t-cardtitle">{h.display}</span>
                  <span className="figure text-[12px] text-body-soft">{formatShares(h.shares)} sh</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-ink-void px-5 py-4">
            <p className="font-sans text-[13px] leading-[1.6] text-body-dark">
              <span className="text-accent-dark">It is already yours.</span>{' '}
              {folio.unlockAt * 1000 > Date.now()
                ? `You can watch it from today. The shares can be taken out from ${dateLabel(folio.unlockAt)}.`
                : 'Claim it and the shares move into your name straight away.'}
            </p>
          </div>
          <div className="px-5 pb-6 pt-5">
            <p className="t-reassure text-body">
              These are real shares in real companies, held in a vault only you will be able to open.
              Not points, not a voucher.
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
          {!folio.escrowed ? (
            <p className="t-body-sm text-center">This gift has already been claimed.</p>
          ) : !linkKey || !linkMatches ? (
            <div className="border border-accent bg-ground p-3.5">
              <p className="t-body-sm">
                <span className="text-accent">● </span>
                This link is missing its key or belongs to a different gift. Ask whoever sent it for the full link.
              </p>
            </div>
          ) : !wallet.authenticated ? (
            <>
              <button onClick={wallet.login} className="btn-primary !min-h-[54px]">
                Make it mine
              </button>
              <p className="t-disclaimer mt-3 text-center">About a minute. Email, phone, Google or Apple — no app, no seed phrase.</p>
            </>
          ) : !wallet.address ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : (
            <>
              <button onClick={claim} disabled={claiming} className="btn-primary !min-h-[54px]">
                {claiming ? 'Claiming…' : 'Make it mine'}
              </button>
              <p className="t-disclaimer mt-3 text-center">No fees. Folio pays the network.</p>
            </>
          )}
        </div>

        <p className="t-disclaimer mt-8 text-center">Folio is an interface and a vault. It is not a broker or an issuer.</p>
      </div>
    </div>
  )
}
