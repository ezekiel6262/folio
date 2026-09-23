'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Keypair } from '@solana/web3.js'
import { AppHeader, HardRule, Kicker, MonoLabel, Screen, SideNote, Spinner, Stop } from '@/components/ui'
import { formatShares } from '@/lib/assets'
import { isUserRejection, signAndSubmit, toBase64Url } from '@/lib/execute'
import { useFolioWallet } from '@/lib/wallet'

type DemoHolding = { symbol: string; display: string; mint: string; decimals: number; multiplier: number; rawAmount: string; shares: number }
type DemoData = { enabled: boolean; cluster?: string; holdings: DemoHolding[]; error?: string }

const LOCKS: [string, number][] = [
  ['No lock', 0],
  ['1 year', 12],
  ['5 years', 60],
]

const monthsFromNow = (months: number) => {
  if (!months) return 0
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return Math.floor(d.getTime() / 1000)
}

/**
 * The demo, on a test cluster. There is no exchange here, so instead of buying, Folio puts
 * test shares the wallet already holds into a real vault — the same program, locks, gifts
 * and withdrawals as mainnet, with tokens that are worth nothing.
 */
export default function DemoPage() {
  const wallet = useFolioWallet()
  const router = useRouter()
  const [chosen, setChosen] = useState<Record<string, boolean>>({})
  const [name, setName] = useState('Ada school fund')
  const [lock, setLock] = useState(0)
  const [gift, setGift] = useState(false)
  const [busy, setBusy] = useState(false)
  const [funding, setFunding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const demo = useQuery<DemoData>({
    queryKey: ['demo', wallet.address],
    queryFn: async () => (await fetch(`/api/demo${wallet.address ? `?owner=${wallet.address}` : ''}`)).json(),
    refetchInterval: 15_000,
  })

  const holdings = demo.data?.holdings ?? []
  const picks = holdings.filter((h) => chosen[h.symbol])

  async function getShares() {
    if (!wallet.address) return
    setError(null)
    setFunding(true)
    try {
      const res = await fetch('/api/demo/fund', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: wallet.address }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not hand out test shares')
      await demo.refetch()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setFunding(false)
    }
  }

  async function create() {
    if (!picks.length || !wallet.address) return
    setError(null)
    setBusy(true)
    const link = gift ? Keypair.generate() : null
    try {
      const res = await fetch('/api/demo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          user: wallet.address,
          name,
          unlockAt: lock,
          claimKey: link ? link.publicKey.toBase58() : null,
          picks: picks.map((p) => ({ symbol: p.symbol, rawAmount: p.rawAmount })),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not prepare it')
      await signAndSubmit([json.transaction], wallet.signTransaction, { accessToken: wallet.getAccessToken })
      router.replace(link ? `/folio/${json.folio}#k=${toBase64Url(link.secretKey)}` : `/folio/${json.folio}?created=1`)
    } catch (e) {
      setError(isUserRejection(e) ? 'You cancelled. Nothing moved.' : (e as Error).message)
      setBusy(false)
    }
  }

  if (demo.data && !demo.data.enabled) {
    return (
      <>
        <AppHeader />
        <Screen>
          <Kicker>Demo</Kicker>
          <h1 className="t-screen mt-4">
            Not on this cluster<Stop />
          </h1>
          <p className="t-body mt-5">
            This page only exists on a test cluster. On mainnet, folios are made by buying shares on the
            Build a folio screen.
          </p>
        </Screen>
      </>
    )
  }

  return (
    <>
      <AppHeader />
      <Screen wide>
        <Kicker>Demo · {demo.data?.cluster ?? 'test cluster'}</Kicker>
        <h1 className="t-screen mt-4">
          Make a folio from <span className="t-serif text-[34px]">test shares</span>
          <Stop />
        </h1>
        <p className="t-body mt-5 max-w-[620px]">
          There is no stock exchange on a test network, so these shares were handed to your wallet instead
          of bought. Everything after this point is the real thing: a real program, a real vault in your
          name, real locks, gifts and withdrawals.
        </p>

        {!wallet.authenticated ? (
          <button onClick={wallet.login} className="btn-primary mt-7 lg:max-w-[360px]">
            Sign up or sign in
          </button>
        ) : (
          <div className="mt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14">
            <div>
              <p className="t-label">Your test shares</p>
              <HardRule className="mt-2.5" />
              {demo.isLoading ? (
                <div className="pt-5">
                  <Spinner />
                </div>
              ) : holdings.length ? (
                holdings.map((h) => (
                  <button
                    key={h.symbol}
                    onClick={() => setChosen((c) => ({ ...c, [h.symbol]: !c[h.symbol] }))}
                    className="flex w-full items-baseline justify-between gap-4 border-b border-rule-hair py-3.5 text-left"
                  >
                    <span className="flex items-center gap-3">
                      <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center border border-ink bg-white">
                        {chosen[h.symbol] && <span className="block h-2 w-2 bg-accent" />}
                      </span>
                      <span>
                        <span className="t-cardtitle block">{h.display}</span>
                        <span className="figure mt-0.5 block text-[10.5px] text-body-mute">
                          {formatShares(h.shares)} shares
                          {h.multiplier !== 1 && ` · ${h.multiplier}× multiplier, like the real token`}
                        </span>
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <p className="t-body-sm mt-3">This wallet has no test shares yet.</p>
              )}

              <button onClick={getShares} disabled={funding} className="btn-secondary mt-4 !min-h-[44px]">
                {funding ? 'Handing them over…' : holdings.length ? 'Get more test shares' : 'Get test shares'}
              </button>
            </div>

            <div className="mt-10 lg:mt-0">
              <div className="border-2 border-ink p-4">
                <MonoLabel>Name it</MonoLabel>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 40))}
                  className="field mt-2 !text-[15px]"
                  placeholder="Ada school fund"
                />

                <MonoLabel className="mt-5">Lock it until</MonoLabel>
                <div className="mt-2 flex gap-1.5">
                  {LOCKS.map(([label, months]) => (
                    <button
                      key={label}
                      onClick={() => setLock(monthsFromNow(months))}
                      className={`border px-2 py-1 font-mono text-[9.5px] uppercase tracking-monolabel transition-colors ${
                        (lock === 0) === (months === 0) ? 'border-ink bg-ink text-ground' : 'border-rule-mid text-body-soft'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <label className="mt-5 flex items-start gap-3">
                  <input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} className="mt-1" />
                  <span className="t-body-sm">Make it a gift — you get a link, and whoever opens it claims the folio.</span>
                </label>

                {error && (
                  <p className="t-body-sm mt-3">
                    <span className="text-accent">● </span>
                    {error}
                  </p>
                )}

                <button onClick={create} disabled={!picks.length || busy} className="btn-primary mt-5 !min-h-[48px]">
                  {busy ? 'Making it…' : picks.length ? `Make folio with ${picks.length} ${picks.length === 1 ? 'company' : 'companies'}` : 'Choose a company'}
                </button>
                <p className="t-disclaimer mt-2 text-center">One confirmation. Folio pays the network fee.</p>
              </div>

              <div className="mt-6">
                <SideNote>
                  Test tokens on a test network: they have no value and cannot be sold. The program, the vault
                  and every signature are real.
                </SideNote>
              </div>
            </div>
          </div>
        )}
      </Screen>
    </>
  )
}
