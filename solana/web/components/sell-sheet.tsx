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

const FRACTIONS = [
  { label: 'A quarter', v: 0.25 },
  { label: 'Half', v: 0.5 },
  { label: 'All of it', v: 1 },
]

/**
 * Selling turns a holding back into dollars in the owner's account, in one step. The
 * number shown is what arrives, with the guaranteed floor beside it — never a promise
 * the chain might not keep.
 */
export function SellSheet({ folio, holding, onDone }: { folio: string; holding: Holding; onDone: () => void }) {
  const wallet = useFolioWallet()
  const queryClient = useQueryClient()
  const { code, usdToLocal } = useCurrency()
  const [fraction, setFraction] = useState<number | null>(null)
  const [preview, setPreview] = useState<SellPreview | null>(null)
  const [stage, setStage] = useState<'choose' | 'pricing' | 'review' | 'selling' | 'sold'>('choose')
  const [error, setError] = useState<string | null>(null)

  async function build(v: number, reviewedMinUsdc?: number) {
    const res = await fetch('/api/build/sell', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: wallet.address, folio, symbol: holding.symbol, fraction: v, reviewedMinUsdc }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? 'Could not price the sale')
    return json as { transaction: string; preview: SellPreview }
  }

  async function price(v: number) {
    setFraction(v)
    setError(null)
    setStage('pricing')
    try {
      setPreview((await build(v)).preview)
      setStage('review')
    } catch (e) {
      setError((e as Error).message)
      setStage('choose')
    }
  }

  async function sell() {
    if (fraction == null || !preview) return
    setError(null)
    setStage('selling')
    try {
      const { transaction } = await build(fraction, preview.minUsdcOut)
      await signAndSubmit([transaction], wallet.signTransaction, { accessToken: wallet.getAccessToken })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['folio', folio] }),
        queryClient.invalidateQueries({ queryKey: ['balances', wallet.address] }),
        queryClient.invalidateQueries({ queryKey: ['folios', wallet.address] }),
      ])
      setStage('sold')
    } catch (e) {
      setError(isUserRejection(e) ? 'You cancelled. Nothing was sold.' : (e as Error).message)
      setStage('review')
    }
  }

  return (
    <div className="mt-3 border-l-2 border-accent pl-3">
      {stage === 'sold' && preview ? (
        <>
          <p className="t-body-sm !text-ink">
            Sold. About {formatLocal(usdToLocal(preview.usdcOut), code)} is back in your account as USDC.
          </p>
          <button onClick={onDone} className="btn-secondary mt-3 !min-h-[40px] !text-[11px]">
            Done
          </button>
        </>
      ) : (
        <>
          <MonoLabel>How much to sell</MonoLabel>
          <div className="mt-2 flex gap-1.5">
            {FRACTIONS.map((f) => (
              <button
                key={f.v}
                onClick={() => price(f.v)}
                disabled={stage === 'pricing' || stage === 'selling'}
                className={`border px-2 py-1 font-mono text-[9.5px] uppercase tracking-monolabel transition-colors ${
                  fraction === f.v ? 'border-ink bg-ink text-ground' : 'border-rule-mid text-body-soft hover:border-ink'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {stage === 'pricing' && (
            <div className="mt-4">
              <Spinner />
            </div>
          )}

          {preview && (stage === 'review' || stage === 'selling') && (
            <div className="mt-4">
              <Line label="Selling" value={`${formatShares(preview.shares)} sh ${preview.display}`} />
              <Line label="You receive" value={`${formatLocal(usdToLocal(preview.usdcOut), code)} · ${formatUsd(preview.usdcOut)} USDC`} />
              <Line label="At least" value={formatUsd(preview.minUsdcOut)} />
              <Line
                label="Against market"
                value={`${preview.gapPct >= 0 ? '+' : ''}${preview.gapPct.toFixed(2)}%`}
                accent={Math.abs(preview.gapPct) > 2.5}
              />
              <Line label="Network fee" value="Free — Folio pays it" />
              <button onClick={sell} disabled={stage === 'selling'} className="btn-primary mt-4 !min-h-[46px]">
                {stage === 'selling' ? 'Selling…' : `Sell for ${formatLocal(usdToLocal(preview.usdcOut), code)}`}
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
        </>
      )}
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
