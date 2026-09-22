'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrency } from '@/components/currency-context'
import { isSolanaAddress } from '@/components/gift-options'
import { FlowHeader, Kicker, MonoLabel, Screen, SideNote, Spinner, Stop } from '@/components/ui'
import { formatLocal } from '@/lib/currencies'
import { isUserRejection, signAndSubmit } from '@/lib/execute'
import { useFolioWallet } from '@/lib/wallet'
import type { WalletBalances } from '@/lib/balances'

type SendPreview = { symbol: string; amount: number; usd: number; destination: string; opensAccount: boolean }

/**
 * Money out, for now as stablecoins to a Solana address — an exchange deposit address or
 * another wallet. Cash-out to a bank comes later. As on the way in, the network is the
 * thing that goes wrong, so it is stated before the address is asked for.
 */
export default function WithdrawPage() {
  const wallet = useFolioWallet()
  const queryClient = useQueryClient()
  const { code, usdToLocal } = useCurrency()
  const [symbol, setSymbol] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [destination, setDestination] = useState('')
  const [preview, setPreview] = useState<SendPreview | null>(null)
  const [stage, setStage] = useState<'form' | 'checking' | 'review' | 'sending' | 'sent'>('form')
  const [error, setError] = useState<string | null>(null)

  const balances = useQuery<WalletBalances>({
    queryKey: ['balances', wallet.address],
    queryFn: async () => (await fetch(`/api/balances?owner=${wallet.address}`)).json(),
    enabled: Boolean(wallet.address),
  })
  const held = balances.data?.stablecoins ?? []
  const chosen = held.find((s) => s.symbol === (symbol ?? held[0]?.symbol))
  const amountNum = Number(amount)
  const valid =
    Boolean(chosen) && Number.isFinite(amountNum) && amountNum > 0 && amountNum <= (chosen?.units ?? 0) && isSolanaAddress(destination)

  async function build() {
    const res = await fetch('/api/build/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: wallet.address, symbol: chosen?.symbol, amount: amountNum, destination }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? 'Could not prepare it')
    return json as { transaction: string; preview: SendPreview }
  }

  async function check() {
    setError(null)
    setStage('checking')
    try {
      setPreview((await build()).preview)
      setStage('review')
    } catch (e) {
      setError((e as Error).message)
      setStage('form')
    }
  }

  async function send() {
    setError(null)
    setStage('sending')
    try {
      const { transaction } = await build()
      await signAndSubmit([transaction], wallet.signTransaction, { accessToken: wallet.getAccessToken })
      await queryClient.invalidateQueries({ queryKey: ['balances', wallet.address] })
      setStage('sent')
    } catch (e) {
      setError(isUserRejection(e) ? 'You cancelled. Nothing was sent.' : (e as Error).message)
      setStage('review')
    }
  }

  if (wallet.ready && !wallet.authenticated) {
    return (
      <>
        <FlowHeader title="Send money out" />
        <Screen>
          <button onClick={wallet.login} className="btn-primary">
            Sign in
          </button>
        </Screen>
      </>
    )
  }

  if (stage === 'sent' && preview) {
    return (
      <>
        <FlowHeader title="Send money out" />
        <Screen>
          <Kicker>Sent</Kicker>
          <h1 className="t-screen mt-4">
            On its way<Stop />
          </h1>
          <p className="t-body mt-5">
            {preview.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {preview.symbol} went to{' '}
            <span className="figure break-all text-[12px]">{preview.destination}</span>. It usually shows up within a minute.
          </p>
        </Screen>
      </>
    )
  }

  return (
    <>
      <FlowHeader title="Send money out" />
      <Screen>
        <h1 className="t-screen">
          Send <span className="t-serif text-[34px]">out</span>
          <Stop />
        </h1>
        <p className="t-body mt-5">Move stablecoins to an exchange or another wallet. To get cash, sell shares first — the money lands here as USDC.</p>

        <div className="mt-6">
          <SideNote>
            The address must be on the <strong className="text-ink">Solana</strong> network. Sending to an Ethereum, Base or
            Tron address loses the money.
          </SideNote>
        </div>

        <MonoLabel className="mt-8">From</MonoLabel>
        {balances.isLoading ? (
          <div className="mt-3">
            <Spinner />
          </div>
        ) : held.length ? (
          <div className="mt-2">
            {held.map((s) => (
              <button
                key={s.symbol}
                onClick={() => setSymbol(s.symbol)}
                className="flex w-full items-baseline justify-between border-t border-rule-hair py-3 text-left"
              >
                <span className="flex items-center gap-3">
                  <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center border border-ink bg-white">
                    {chosen?.symbol === s.symbol && <span className="block h-2 w-2 bg-accent" />}
                  </span>
                  <span className="t-cardtitle">{s.symbol}</span>
                </span>
                <span className="figure text-[12px] text-body-soft">
                  {s.units.toLocaleString(undefined, { maximumFractionDigits: 2 })} · {formatLocal(usdToLocal(s.usd), code)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="t-body-sm mt-2">Nothing to send yet.</p>
        )}

        <div className="mt-6 flex items-baseline justify-between">
          <MonoLabel>Amount{chosen ? ` in ${chosen.symbol}` : ''}</MonoLabel>
          {chosen && (
            <button onClick={() => setAmount(String(chosen.units))} className="font-mono text-[10px] uppercase tracking-monolabel text-accent">
              Everything
            </button>
          )}
        </div>
        <input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value)
            setStage('form')
          }}
          placeholder="0"
          className="field mt-2 figure text-[18px]"
        />

        <MonoLabel className="mt-6">To this Solana address</MonoLabel>
        <input
          type="text"
          value={destination}
          onChange={(e) => {
            setDestination(e.target.value.trim())
            setStage('form')
          }}
          placeholder="Paste the address"
          className={`field mt-2 font-mono text-[12px] ${destination && !isSolanaAddress(destination) ? '!border-accent' : ''}`}
        />
        {destination && !isSolanaAddress(destination) && <p className="t-body-sm mt-2">That is not a Solana address.</p>}

        {preview && (stage === 'review' || stage === 'sending') && (
          <div className="mt-7 border border-ink p-4">
            <Line label="Sending" value={`${preview.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${preview.symbol}`} />
            <Line label="Worth" value={formatLocal(usdToLocal(preview.usd), code)} />
            <Line label="To" value={`${preview.destination.slice(0, 6)}…${preview.destination.slice(-6)}`} />
            <Line label="Network fee" value="Free — Folio pays it" />
            {preview.opensAccount && (
              <p className="t-disclaimer mt-2">This address has never held {preview.symbol}; Folio opens an account for it.</p>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 border border-accent p-3.5">
            <p className="t-body-sm">
              <span className="text-accent">● </span>
              {error}
            </p>
          </div>
        )}

        {stage === 'review' || stage === 'sending' ? (
          <button onClick={send} disabled={stage === 'sending'} className="btn-primary mt-6 !min-h-[54px]">
            {stage === 'sending' ? 'Sending…' : 'Send it'}
          </button>
        ) : (
          <button onClick={check} disabled={!valid || stage === 'checking'} className="btn-primary mt-6">
            {stage === 'checking' ? 'Checking…' : 'Review'}
          </button>
        )}
      </Screen>
    </>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-rule-hair py-2 first:border-t-0">
      <span className="t-mono-label">{label}</span>
      <span className="figure text-right text-[11.5px] text-ink">{value}</span>
    </div>
  )
}
