'use client'

import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCurrency } from './currency-context'
import { MonoLabel } from './ui'
import { formatLocal } from '@/lib/currencies'
import { isUserRejection, signAndSubmit } from '@/lib/execute'
import { policyFor } from '@/lib/policies'
import { useFolioWallet } from '@/lib/wallet'
import type { Policy } from '@/lib/allocator'
import type { FolioView } from '@/lib/folio-reader'

type Drift = {
  symbol: string
  display: string
  nowPct: number
  targetPct: number
  nowUsd: number
  targetUsd: number
  gapUsd: number
}
type Plan = { totalUsd: number; driftPct: number; drifts: Drift[]; sells: unknown[]; buys: unknown[]; settled: boolean }

/** Below this a basket is doing what it was asked to; saying otherwise would invent work. */
const WORTH_MENTIONING_PCT = 2

/**
 * A basket drifts on its own: one company rises, another falls, and 45/35/20 quietly
 * becomes something else. Folio never corrects that by itself — it shows the drift and
 * waits. The split it is measured against is the one this device kept when the folio was
 * made, and it is only trusted when it still hashes to what the chain recorded.
 */
export function RebalanceCard({ folio }: { folio: FolioView }) {
  const wallet = useFolioWallet()
  const { code, usdToLocal } = useCurrency()
  const queryClient = useQueryClient()
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState<'selling' | 'buying' | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    policyFor(folio.address, folio.policyHash).then((p) => alive && setPolicy(p))
    return () => {
      alive = false
    }
  }, [folio.address, folio.policyHash])

  const ask = useCallback(
    async (phase?: 'sell' | 'buy') => {
      const res = await fetch('/api/build/rebalance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: wallet.address, folio: folio.address, policy, phase }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not work out the drift')
      return json as { plan: Plan; transactions?: string[] }
    },
    [wallet.address, folio.address, policy],
  )

  useEffect(() => {
    if (!policy || !wallet.address) return
    let alive = true
    ask()
      .then((r) => alive && setPlan(r.plan))
      .catch(() => alive && setPlan(null))
    return () => {
      alive = false
    }
  }, [policy, wallet.address, ask])

  async function run() {
    setError(null)
    setDone(null)
    try {
      setBusy('selling')
      const sells = await ask('sell')
      if (sells.transactions?.length) {
        await signAndSubmit(sells.transactions, wallet.signTransaction, { accessToken: wallet.getAccessToken })
      }
      setBusy('buying')
      const buys = await ask('buy')
      if (buys.transactions?.length) {
        await signAndSubmit(buys.transactions, wallet.signTransaction, { accessToken: wallet.getAccessToken })
      }
      const after = await ask()
      setPlan(after.plan)
      setDone('Back in balance.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['folio', folio.address] }),
        queryClient.invalidateQueries({ queryKey: ['activity', folio.address] }),
        queryClient.invalidateQueries({ queryKey: ['balances', wallet.address] }),
      ])
    } catch (e) {
      setError(isUserRejection(e) ? 'You stopped. Anything already confirmed has happened; the rest has not.' : (e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!policy || !plan || folio.locked || folio.escrowed) return null
  if (plan.settled && plan.driftPct < WORTH_MENTIONING_PCT && !done) return null

  return (
    <div className="mt-7 border border-rule-mid p-4">
      <MonoLabel>Against the sentence that made it</MonoLabel>
      <p className="t-body-sm mt-2">
        {plan.settled
          ? 'It is holding the split you asked for.'
          : `It has drifted ${plan.driftPct.toFixed(1)} points from the split you asked for. Nothing is wrong — some companies rose faster than others.`}
      </p>

      <div className="mt-4">
        {plan.drifts.map((d) => (
          <div key={d.symbol} className="border-t border-rule-hair py-3 first:border-t-0">
            <div className="flex items-baseline justify-between gap-4">
              <span className="t-cardtitle">{d.display}</span>
              <span className="figure text-[11px] text-body-mute">
                <span className="text-ink">{d.nowPct.toFixed(0)}%</span> now · {d.targetPct.toFixed(0)}% asked for
              </span>
            </div>
            {/* The bar is where it is; the tick is where it was meant to be. */}
            <div className="relative mt-2 h-2.5 bg-ground-inset">
              <div className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${Math.min(100, d.nowPct)}%` }} />
              <div className="absolute inset-y-0 w-[2px] bg-accent" style={{ left: `${Math.min(100, d.targetPct)}%` }} />
            </div>
            {Math.abs(d.gapUsd) >= 1 && (
              <p className="figure mt-1.5 text-[10.5px] text-body-mute">
                {d.gapUsd > 0 ? 'sell' : 'buy'} {formatLocal(usdToLocal(Math.abs(d.gapUsd)), code)} to match it
              </p>
            )}
          </div>
        ))}
      </div>

      {!plan.settled && (
        <>
          <button onClick={run} disabled={busy !== null} className="btn-primary mt-4 !min-h-[46px]">
            {busy === 'selling' ? 'Selling what is over…' : busy === 'buying' ? 'Buying what is under…' : 'Put it back in balance'}
          </button>
          <p className="t-disclaimer mt-2">
            Two confirmations: what is over is sold first, then what came back buys what is under. Prices are quoted
            live at each step, and the second is priced from what the first actually fetched.
          </p>
        </>
      )}

      {done && <p className="t-body-sm mt-3 !text-ink">{done}</p>}
      {error && (
        <p className="t-body-sm mt-3">
          <span className="text-accent">● </span>
          {error}
        </p>
      )}
    </div>
  )
}
