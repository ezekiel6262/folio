'use client'

import { useEffect, useState } from 'react'
import { MonoLabel } from './ui'

/**
 * "Own what I own": a Blink that lets anyone buy the same mix into their own folio, from
 * X, Discord or any Solana wallet. It shares the basket's make-up, never the owner's
 * amounts or keys.
 */
export function ShareBasket({ folio }: { folio: string }) {
  const [links, setLinks] = useState<{ blink: string; web: string } | null>(null)
  const [copied, setCopied] = useState<'blink' | 'web' | null>(null)

  useEffect(() => {
    const action = `${window.location.origin}/api/actions/basket?folio=${folio}`
    setLinks({
      blink: `https://dial.to/?action=${encodeURIComponent(`solana-action:${action}`)}`,
      web: `${window.location.origin}/basket?folio=${folio}`,
    })
  }, [folio])

  async function copy(kind: 'blink' | 'web') {
    if (!links) return
    try {
      await navigator.clipboard.writeText(links[kind])
      setCopied(kind)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      /* nothing to do: the link is also shown */
    }
  }

  return (
    <div className="mt-7 border border-rule-mid p-4">
      <MonoLabel>Let others own the same mix</MonoLabel>
      <p className="t-body-sm mt-2">
        A buy link for this basket. Posted on X or Discord it becomes a buy button that works from any Solana
        wallet. Your amounts stay private.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => copy('blink')} disabled={!links} className="btn-primary !min-h-[42px] !text-[11px]">
          {copied === 'blink' ? 'Copied' : 'Copy Blink'}
        </button>
        <button onClick={() => copy('web')} disabled={!links} className="btn-secondary !min-h-[42px] !text-[11px]">
          {copied === 'web' ? 'Copied' : 'Copy web link'}
        </button>
      </div>
    </div>
  )
}
