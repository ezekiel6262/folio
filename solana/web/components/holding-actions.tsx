'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCurrency } from './currency-context'
import { MonoLabel, Spinner } from './ui'
import { formatShares } from '@/lib/assets'
import { formatLocal, formatUsd } from '@/lib/currencies'
import { isUserRejection, signAndSubmit } from '@/lib/execute'
import { useFolioWallet } from '@/lib/wallet'
import type { Holding } from '@/lib/folio-reader'
import type { TakeOutPreview } from '@/lib/take-out'

export type SellPreview = {
  symbol: string
  display: string
  shares: number
  usdcOut: number
  minUsdcOut: number
  marketUsd: number
  gapPct: number
  closesVault: boolean
}

const FRACTIONS: [string, number][] = [
  ['A quarter', 0.25],
  ['Half', 0.5],
  ['All of it', 1],
]

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

/**
 * The two ways out of a holding, side by side, because a vault you can only sell from is
 * not custody: turn it into dollars, or move the shares into your own wallet and do as you
 * like with them. Both say what actually lands before anything is signed.
 */
export function HoldingActions({ folio, holding, onDone }: { folio: string; holding: Holding; onDone: () => void }) {
  const wallet = useFolioWallet()
  const queryClient = useQueryClient()
  const { code, usdToLocal } = useCurrency()
  const [mode, setMode] = useState<'sell' | 'take'>('sell')
  const [fraction, setFraction] = useState<number | null>(null)
  const [sell, setSell] = useState<SellPreview | null>(null)
  const [take, setTake] = useState<TakeOutPreview | null>(null)
  const [stage, setStage] = useState<'choose' | 'pricing' | 'review' | 'working' | 'done'>('choose')
  const [error, setError] = useState<string | null>(null)

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['folio', folio] }),
      queryClient.invalidateQueries({ queryKey: ['activity', folio] }),
      queryClient.invalidateQueries({ queryKey: ['balances', wallet.address] }),
      queryClient.invalidateQueries({ queryKey: ['folios', wallet.address] }),
    ])

  async function build(v: number, reviewedMinUsdc?: number) {
    const body =
      mode === 'sell'
        ? { owner: wallet.address, folio, symbol: holding.symbol, fraction: v, reviewedMinUsdc }
        : { action: 'take-out', owner: wallet.address, folio, symbol: holding.symbol, fraction: v }
    const res = await fetch(mode === 'sell' ? '/api/build/sell' : '/api/build/owner', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? 'Could not prepare it')
    return json as { transaction: string; preview: SellPreview & TakeOutPreview }
  }

  async function price(v: number) {
    setFraction(v)
    setError(null)
    setStage('pricing')
    try {
      const { preview } = await build(v)
      if (mode === 'sell') setSell(preview as SellPreview)
      else setTake(preview as TakeOutPreview)
      setStage('review')
    } catch (e) {
      setError((e as Error).message)
      setStage('choose')
    }
  }

  async function go() {
    if (fraction == null) return
    setError(null)
    setStage('working')
    try {
      const { transaction } = await build(fraction, mode === 'sell' ? sell?.minUsdcOut : undefined)
      await signAndSubmit([transaction], wallet.signTransaction, { accessToken: wallet.getAccessToken })
      await refresh()
      setStage('done')
    } catch (e) {
      setError(isUserRejection(e) ? 'You cancelled. Nothing moved.' : (e as Error).message)
      setStage('review')
    }
  }

  if (stage === 'done') {
    return (
      <div className="mt-3 border-l-2 border-accent pl-3">
        <p className="t-body-sm !text-ink">
          {mode === 'sell' && sell
            ? `Sold. About ${formatLocal(usdToLocal(sell.usdcOut), code)} is back in your account as USDC.`
            : take
              ? `Moved. ${formatShares(take.shares)} ${take.display} shares are in your own wallet now.`
              : 'Done.'}
        </p>
        <button onClick={onDone} className="btn-secondary mt-3 !min-h-[40px] !text-[11px]">
          Done
        </button>
      </div>
    )
  }

  return (
    <div className="mt-3 border-l-2 border-accent pl-3">
      <div className="flex gap-1.5">
        {(
          [
            ['sell', 'Sell for cash'],
            ['take', 'Move to my wallet'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setMode(key)
              setStage('choose')
              setFraction(null)
              setError(null)
            }}
            className={`border px-2 py-1 font-mono text-[9.5px] uppercase tracking-monolabel transition-colors ${
              mode === key ? 'border-ink bg-ink text-ground' : 'border-rule-mid text-body-soft'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <MonoLabel className="mt-4">How much</MonoLabel>
      <div className="mt-2 flex gap-1.5">
        {FRACTIONS.map(([label, v]) => (
          <button
            key={label}
            onClick={() => price(v)}
            disabled={stage === 'pricing' || stage === 'working'}
            className={`border px-2 py-1 font-mono text-[9.5px] uppercase tracking-monolabel transition-colors ${
              fraction === v ? 'border-ink bg-ink text-ground' : 'border-rule-mid text-body-soft hover:border-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {stage === 'pricing' && (
        <div className="mt-4">
          <Spinner />
        </div>
      )}

      {stage !== 'choose' && stage !== 'pricing' && mode === 'sell' && sell && (
        <div className="mt-4">
          <Line label="Selling" value={`${formatShares(sell.shares)} sh ${sell.display}`} />
          <Line label="You receive" value={`${formatLocal(usdToLocal(sell.usdcOut), code)} · ${formatUsd(sell.usdcOut)} USDC`} />
          <Line label="At least" value={formatUsd(sell.minUsdcOut)} />
          <Line
            label="Against market"
            value={`${sell.gapPct >= 0 ? '+' : ''}${sell.gapPct.toFixed(2)}%`}
            accent={Math.abs(sell.gapPct) > 2.5}
          />
          <Line label="Network fee" value="Free — Folio pays it" />
          <button onClick={go} disabled={stage === 'working'} className="btn-primary mt-4 !min-h-[46px]">
            {stage === 'working' ? 'Selling…' : `Sell for ${formatLocal(usdToLocal(sell.usdcOut), code)}`}
          </button>
        </div>
      )}

      {stage !== 'choose' && stage !== 'pricing' && mode === 'take' && take && (
        <div className="mt-4">
          <Line label="Moving" value={`${formatShares(take.shares)} sh ${take.display}`} />
          <Line label="To your wallet" value={short(take.destination)} />
          <Line label="Network fee" value="Free — Folio pays it" />
          {take.emptiesVault && <Line label="Afterwards" value="This holding leaves the folio" />}
          <p className="t-disclaimer mt-2">
            The shares become ordinary tokens in your own account: no lock, no vault, yours to move anywhere.
          </p>
          <button onClick={go} disabled={stage === 'working'} className="btn-primary mt-4 !min-h-[46px]">
            {stage === 'working' ? 'Moving…' : 'Move to my wallet'}
          </button>
        </div>
      )}

      {error && (
        <p className="t-body-sm mt-3">
          <span className="text-accent">● </span>
          {error}
        </p>
      )}
      <button onClick={onDone} className="btn-ghost mt-2 !text-[11px]">
        Cancel
      </button>
    </div>
  )
}

function Line({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-rule-hair py-2 first:border-t-0">
      <span className="t-mono-label">{label}</span>
      <span className={`figure text-right text-[11.5px] ${accent ? 'text-accent' : 'text-ink'}`}>{value}</span>
    </div>
  )
}
