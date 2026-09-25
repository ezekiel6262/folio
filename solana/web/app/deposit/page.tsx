'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AddressQr } from '@/components/address-qr'
import { useCurrency } from '@/components/currency-context'
import { FlowHeader, Kicker, MonoLabel, Screen, SideNote, Spinner, Stop } from '@/components/ui'
import { STABLECOINS } from '@/lib/assets'
import { formatLocal } from '@/lib/currencies'
import { useFolioWallet } from '@/lib/wallet'
import type { WalletBalances } from '@/lib/balances'

/** One numbered thing to get right, with everything it needs underneath it. */
function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-t border-rule-hair pt-5 first-of-type:border-t-0">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[10px] tracking-monolabel text-accent">{n}</span>
        <h2 className="t-cardtitle">{title}</h2>
      </div>
      {children}
    </section>
  )
}

/**
 * Add money. For now the door is stablecoins sent on Solana; cards and bank transfers
 * come later. The one thing that goes wrong here is the network, so it is stated as
 * plainly as the address itself.
 */
export default function DepositPage() {
  const { address, authenticated, login, ready } = useFolioWallet()
  const { code, usdToLocal } = useCurrency()
  const [copied, setCopied] = useState(false)
  const baseline = useRef<number | null>(null)
  const [arrived, setArrived] = useState<number | null>(null)

  const balances = useQuery<WalletBalances>({
    queryKey: ['balances', address],
    queryFn: async () => (await fetch(`/api/balances?owner=${address}`)).json(),
    enabled: Boolean(address),
    // Watch closely while someone is waiting for money to land.
    refetchInterval: 6_000,
  })

  const investable = balances.data?.investableUsd
  useEffect(() => {
    if (investable == null) return
    if (baseline.current == null) baseline.current = investable
    else if (investable > baseline.current + 0.01) setArrived(investable - baseline.current)
  }, [investable])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  if (ready && !authenticated) {
    return (
      <>
        <FlowHeader title="Add money" />
        <Screen>
          <h1 className="t-screen">
            Sign in to add <span className="t-serif text-[34px]">money</span>
            <Stop />
          </h1>
          <button onClick={login} className="btn-primary mt-7">
            Sign up or sign in
          </button>
        </Screen>
      </>
    )
  }

  return (
    <>
      <FlowHeader title="Add money" />
      <Screen>
        {arrived != null && (
          <div className="-mx-5 -mt-7 mb-7 bg-ink-void px-5 py-4">
            <p className="font-sans text-[13px] leading-[1.55] text-body-dark">
              <span className="text-accent-dark">Arrived.</span> {formatLocal(usdToLocal(arrived), code)} is ready to invest.
            </p>
          </div>
        )}

        <Kicker>Stablecoins, on Solana</Kicker>
        <h1 className="t-screen mt-4">
          Send it <span className="t-serif text-[34px]">here</span>
          <Stop />
        </h1>
        <p className="t-body mt-5">
          Three things have to match: the coin, the network, and the address. Get the network wrong
          and the money does not arrive here — that is the one mistake worth slowing down for.
        </p>

        <Step n="01" title="Pick a stablecoin">
          <div className="mt-3 flex flex-wrap gap-1.5">
            {STABLECOINS.map((s) => (
              <span
                key={s.symbol}
                className={`flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] uppercase tracking-monolabel ${
                  s.primary ? 'border-ink text-ink' : 'border-rule-mid text-body-soft'
                }`}
              >
                {s.symbol}
                {s.primary && <span className="text-accent">· most used</span>}
              </span>
            ))}
          </div>
          <p className="t-disclaimer mt-3">
            Anything else sent to this address is not counted and may not be recoverable through Folio.
          </p>
        </Step>

        <Step n="02" title="Send it on Solana">
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="border border-ink bg-ink px-2.5 py-1 font-mono text-[10px] uppercase tracking-monolabel text-ground">
              Solana
            </span>
            {['Ethereum', 'Base', 'Tron', 'BNB Chain', 'Polygon'].map((n) => (
              <span key={n} className="font-mono text-[10px] uppercase tracking-monolabel text-body-mute line-through">
                {n}
              </span>
            ))}
          </div>
          <p className="t-body-sm mt-3">
            Exchanges ask which network to withdraw on. The same coin sent on any of the crossed-out
            ones will not arrive here, and Folio cannot fetch it back.
          </p>
        </Step>

        <Step n="03" title="Send to this address">
        <div className="mt-3 border-2 border-ink p-4">
          <MonoLabel>Your address</MonoLabel>
          {address ? (
            <>
              <div className="mt-3 flex justify-center">
                <AddressQr address={address} />
              </div>
              <p className="figure mt-3 break-all text-[13px] leading-[1.6] text-ink">{address}</p>
            </>
          ) : (
            <div className="mt-3">
              <Spinner />
            </div>
          )}
          <button
            onClick={async () => {
              if (!address) return
              try {
                await navigator.clipboard.writeText(address)
                setCopied(true)
              } catch {
                /* the address above is selectable */
              }
            }}
            disabled={!address}
            className="btn-primary mt-4 !min-h-[46px]"
          >
            {copied ? 'Address copied' : 'Copy address'}
          </button>
        </div>

        </Step>

        <div className="mt-8 border border-rule-mid p-4">
          <span className="flex items-center gap-2">
            <span className="flex h-2 w-2 animate-pulse bg-accent" />
            <MonoLabel>Watching for money</MonoLabel>
          </span>
          <p className="figure mt-2 text-[22px] font-medium text-ink">
            {investable == null ? '··' : formatLocal(usdToLocal(investable), code)}
          </p>
          <p className="t-disclaimer mt-1">In your account now, checked every few seconds.</p>
        </div>

        <div className="mt-5">
          <SideNote>
            Folio never holds your money on your behalf: this address is your own account, and what
            arrives there stays yours whatever happens to Folio.
          </SideNote>
        </div>

        {(investable ?? 0) > 0 && (
          <Link href="/create" className="btn-primary mt-7 no-underline">
            Build a folio
          </Link>
        )}
      </Screen>
    </>
  )
}
