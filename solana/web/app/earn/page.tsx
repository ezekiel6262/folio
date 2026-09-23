'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrency } from '@/components/currency-context'
import { AppHeader, HardRule, Kicker, MonoLabel, Screen, SideNote, Spinner, Stop } from '@/components/ui'
import { formatLocal } from '@/lib/currencies'
import type { EarnPosition, EarnToken } from '@/lib/earn'
import { isUserRejection, signAndSubmit } from '@/lib/execute'
import { useFolioWallet } from '@/lib/wallet'
import type { WalletBalances } from '@/lib/balances'

type EarnData = { tokens: EarnToken[]; positions: EarnPosition[]; earningUsd: number; error?: string }

/**
 * Cash waiting to be invested should not sit still. Folio lends it through Jupiter Lend
 * and shows one number — the rate — instead of a protocol. The deposit receipt stays in
 * the user's own wallet, and it can be taken back at any moment.
 */
export default function EarnPage() {
  const wallet = useFolioWallet()
  const queryClient = useQueryClient()
  const { code, usdToLocal } = useCurrency()
  const [symbol, setSymbol] = useState<string | null>(null)
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const earn = useQuery<EarnData>({
    queryKey: ['earn', wallet.address],
    queryFn: async () => (await fetch(`/api/earn${wallet.address ? `?owner=${wallet.address}` : ''}`)).json(),
    refetchInterval: 60_000,
  })
  const balances = useQuery<WalletBalances>({
    queryKey: ['balances', wallet.address],
    queryFn: async () => (await fetch(`/api/balances?owner=${wallet.address}`)).json(),
    enabled: Boolean(wallet.address),
  })

  const tokens = earn.data?.tokens ?? []
  const positions = earn.data?.positions ?? []
  const chosen = tokens.find((t) => t.symbol === (symbol ?? tokens[0]?.symbol))
  const held = balances.data?.stablecoins.find((s) => s.symbol === chosen?.symbol)?.units ?? 0
  const earning = positions.find((p) => p.symbol === chosen?.symbol)?.units ?? 0
  const max = mode === 'deposit' ? held : earning
  const amountNum = Number(amount)
  const valid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= max + 1e-9

  async function submit() {
    if (!chosen || !valid) return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/build/earn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: wallet.address, symbol: chosen.symbol, amount: amountNum, action: mode }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not prepare it')
      await signAndSubmit([json.transaction], wallet.signTransaction, { accessToken: wallet.getAccessToken })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['earn', wallet.address] }),
        queryClient.invalidateQueries({ queryKey: ['balances', wallet.address] }),
      ])
      setDone(
        mode === 'deposit'
          ? `${amountNum.toLocaleString()} ${chosen.symbol} is now earning ${chosen.apy.toFixed(2)}% a year.`
          : `${amountNum.toLocaleString()} ${chosen.symbol} is back in your account.`,
      )
      setAmount('')
    } catch (e) {
      setError(isUserRejection(e) ? 'You cancelled. Nothing moved.' : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const yearly = positions.reduce((a, p) => a + (p.usd * p.apy) / 100, 0)

  return (
    <>
      <AppHeader />
      <Screen wide>
        <Kicker>Earn</Kicker>
        <h1 className="t-screen mt-4">
          Cash that <span className="t-serif text-[34px]">works</span> while it waits
          <Stop />
        </h1>
        <p className="t-body mt-5 max-w-[620px]">
          Money you have not invested yet can earn interest instead of sitting still. It stays yours, you can take it
          back whenever you want, and Folio pays the network fee.
        </p>

        <div className="mt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14">
          <div>
            {wallet.authenticated && (
              <div className="border-y border-ink bg-ground-inset px-4 py-4">
                <MonoLabel>Earning now</MonoLabel>
                {earn.isLoading ? (
                  <div className="mt-2 h-9 w-40 bg-rule-mid/40" />
                ) : (
                  <>
                    <p className="figure mt-2 text-[30px] font-medium leading-none tracking-figure">
                      {formatLocal(usdToLocal(earn.data?.earningUsd ?? 0), code)}
                    </p>
                    <p className="t-body-sm mt-2">
                      {positions.length
                        ? `About ${formatLocal(usdToLocal(yearly), code)} a year at today's rates.`
                        : 'Nothing earning yet.'}
                    </p>
                  </>
                )}
              </div>
            )}

            <p className="t-label mt-8">What each pays</p>
            <HardRule className="mt-2.5" />
            {earn.isLoading ? (
              <div className="pt-5">
                <Spinner />
              </div>
            ) : earn.data?.error ? (
              <p className="t-body-sm mt-4">{earn.data.error}</p>
            ) : (
              tokens.map((t) => {
                const mine = positions.find((p) => p.symbol === t.symbol)
                return (
                  <button
                    key={t.symbol}
                    onClick={() => {
                      setSymbol(t.symbol)
                      setDone(null)
                    }}
                    className="flex w-full items-baseline justify-between gap-4 border-b border-rule-hair py-3.5 text-left"
                  >
                    <span>
                      <span className="t-cardtitle block">{t.symbol}</span>
                      <span className="figure mt-0.5 block text-[10.5px] text-body-mute">
                        {mine ? `you have ${mine.units.toLocaleString(undefined, { maximumFractionDigits: 2 })} earning` : `$${Math.round(t.liquidityUsd).toLocaleString()} available`}
                      </span>
                    </span>
                    <span className="figure shrink-0 text-[15px] text-accent">{t.apy.toFixed(2)}%</span>
                  </button>
                )
              })
            )}
            <p className="t-disclaimer mt-3">
              Rates change every block and are not guaranteed. Lending is done through Jupiter Lend; your deposit
              receipt is held in your own account. A borrower default or a fault in that protocol could cost you money.
            </p>
          </div>

          <div className="mt-10 lg:mt-0">
            {!wallet.authenticated ? (
              <div className="border-2 border-ink p-4">
                <p className="t-body-sm">Sign in to put your cash to work.</p>
                <button onClick={wallet.login} className="btn-primary mt-3 !min-h-[44px]">
                  Sign up or sign in
                </button>
              </div>
            ) : (
              <div className="border-2 border-ink p-4">
                <div className="flex gap-1.5">
                  {(['deposit', 'withdraw'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setMode(m)
                        setAmount('')
                        setDone(null)
                      }}
                      className={`border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-monolabel transition-colors ${
                        mode === m ? 'border-ink bg-ink text-ground' : 'border-rule-mid text-body-soft'
                      }`}
                    >
                      {m === 'deposit' ? 'Start earning' : 'Take back'}
                    </button>
                  ))}
                </div>

                <div className="mt-4 flex items-baseline justify-between">
                  <MonoLabel>{chosen ? `Amount in ${chosen.symbol}` : 'Amount'}</MonoLabel>
                  <button onClick={() => setAmount(String(max))} className="font-mono text-[10px] uppercase tracking-monolabel text-accent">
                    Max {max.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </button>
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value)
                    setDone(null)
                  }}
                  placeholder="0"
                  className="field figure mt-2 text-[18px]"
                />

                {chosen && (
                  <div className="mt-4">
                    <Row label="Rate today" value={`${chosen.apy.toFixed(2)}% a year`} />
                    <Row
                      label={mode === 'deposit' ? 'Earns about' : 'Stops earning'}
                      value={`${formatLocal(usdToLocal((Number(amount) || 0) * (chosen.apy / 100)), code)} a year`}
                    />
                    <Row label="Network fee" value="Free — Folio pays it" />
                    <Row label="Lock-up" value="None, take it back anytime" />
                  </div>
                )}

                {error && (
                  <p className="t-body-sm mt-3">
                    <span className="text-accent">● </span>
                    {error}
                  </p>
                )}
                {done && <p className="t-body-sm mt-3 !text-ink">{done}</p>}

                <button onClick={submit} disabled={!valid || busy} className="btn-primary mt-4 !min-h-[48px]">
                  {busy ? 'Working…' : mode === 'deposit' ? 'Start earning' : 'Take it back'}
                </button>
              </div>
            )}

            <div className="mt-6">
              <SideNote>
                This is lending, not a savings account. Nobody guarantees the rate, and no deposit insurance applies.
              </SideNote>
            </div>
          </div>
        </div>
      </Screen>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-rule-hair py-2 first:border-t-0">
      <span className="t-mono-label">{label}</span>
      <span className="figure text-right text-[11.5px] text-ink">{value}</span>
    </div>
  )
}
