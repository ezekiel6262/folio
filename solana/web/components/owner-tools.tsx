'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { MonoLabel } from './ui'
import { isSolanaAddress } from './gift-options'
import { isUserRejection, signAndSubmit } from '@/lib/execute'
import { useFolioWallet } from '@/lib/wallet'
import type { FolioView } from '@/lib/folio-reader'

/**
 * The quieter powers of ownership: hand the whole folio to someone, hold it shut for
 * longer, or close it once it is empty. Kept together, below the everyday actions, because
 * each one is a decision rather than a habit.
 */
export function OwnerTools({ folio }: { folio: FolioView }) {
  const wallet = useFolioWallet()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState<'hand' | 'lock' | null>(null)
  const [recipient, setRecipient] = useState('')
  const [until, setUntil] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const empty = folio.holdings.every((h) => Number(h.rawAmount) === 0)

  async function run(body: Record<string, unknown>, after: string, thenHome = false) {
    setError(null)
    setDone(null)
    setBusy(true)
    try {
      const res = await fetch('/api/build/owner', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: wallet.address, folio: folio.address, ...body }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not prepare it')
      await signAndSubmit([json.transaction], wallet.signTransaction, { accessToken: wallet.getAccessToken })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['folio', folio.address] }),
        queryClient.invalidateQueries({ queryKey: ['activity', folio.address] }),
        queryClient.invalidateQueries({ queryKey: ['folios', wallet.address] }),
      ])
      setDone(after)
      setOpen(null)
      if (thenHome) router.replace('/')
    } catch (e) {
      setError(isUserRejection(e) ? 'You cancelled. Nothing changed.' : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-7 border border-rule-mid p-4">
      <MonoLabel>Owner&apos;s tools</MonoLabel>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          onClick={() => setOpen(open === 'hand' ? null : 'hand')}
          className="border border-rule-mid px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-monolabel text-body-soft hover:border-ink"
        >
          Hand it to someone
        </button>
        <button
          onClick={() => setOpen(open === 'lock' ? null : 'lock')}
          className="border border-rule-mid px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-monolabel text-body-soft hover:border-ink"
        >
          {folio.unlockAt ? 'Lock it for longer' : 'Lock it'}
        </button>
        {empty && (
          <button
            onClick={() => run({ action: 'close' }, 'Closed.', true)}
            disabled={busy}
            className="border border-rule-mid px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-monolabel text-body-soft hover:border-ink"
          >
            Close this empty folio
          </button>
        )}
      </div>

      {open === 'hand' && (
        <div className="mt-4">
          <MonoLabel>Their Folio or Solana address</MonoLabel>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value.trim())}
            placeholder="Address"
            className={`field mt-2 font-mono text-[12px] ${recipient && !isSolanaAddress(recipient) ? '!border-accent' : ''}`}
          />
          <p className="t-body-sm mt-2">
            The whole folio becomes theirs, with everything in it. Any lock travels with it, and this cannot
            be undone.
          </p>
          <button
            onClick={() => run({ action: 'hand-on', newOwner: recipient }, 'Handed on. It is theirs now.')}
            disabled={busy || !isSolanaAddress(recipient)}
            className="btn-primary mt-3 !min-h-[44px]"
          >
            {busy ? 'Handing it over…' : 'Hand it over'}
          </button>
        </div>
      )}

      {open === 'lock' && (
        <div className="mt-4">
          <MonoLabel>Keep it shut until</MonoLabel>
          <input
            type="date"
            value={until}
            min={new Date(Math.max(Date.now(), folio.unlockAt * 1000) + 86_400_000).toISOString().slice(0, 10)}
            onChange={(e) => setUntil(e.target.value)}
            className="field mt-2 font-mono text-[12.5px]"
          />
          <p className="t-body-sm mt-2">
            A lock only ever moves further out. You keep every other right in the meantime — it is still
            yours, still growing, just not withdrawable.
          </p>
          <button
            onClick={() => run({ action: 'extend-lock', newUnlockAt: Math.floor(new Date(until).getTime() / 1000) }, 'Locked for longer.')}
            disabled={busy || !until}
            className="btn-primary mt-3 !min-h-[44px]"
          >
            {busy ? 'Locking…' : 'Lock it'}
          </button>
        </div>
      )}

      {error && (
        <p className="t-body-sm mt-3">
          <span className="text-accent">● </span>
          {error}
        </p>
      )}
      {done && <p className="t-body-sm mt-3 !text-ink">{done}</p>}
    </div>
  )
}
