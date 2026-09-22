'use client'

import { useEffect, useState } from 'react'
import { Kicker } from './ui'

/**
 * The claim link carries the folio's claim key in its fragment, which browsers never send
 * to a server. Folio cannot claim a gift on anyone's behalf and cannot send the link again
 * — which is exactly why this plate is given real weight rather than tucked below the fold.
 */
export function ShareLink({ folio, secret, name }: { folio: string; secret: string; name: string }) {
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => setUrl(`${window.location.origin}/claim/${folio}#k=${secret}`), [folio, secret])
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <div className="border-2 border-accent p-4">
      <Kicker>Hand this over</Kicker>
      <p className="mt-3 font-serif text-[22px] leading-[1.25] text-ink">
        This link is the only <span className="italic">key</span>.
      </p>
      <p className="t-body-sm mt-3">
        Whoever opens it can claim <span className="text-ink">{name}</span>. Send it to one person,
        and save it before you leave this page — Folio cannot send it again.
      </p>
      <div className="mt-4 bg-ground-inset p-3">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full border-0 bg-transparent p-0 font-mono text-[10.5px] text-body outline-none"
        />
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url)
              setCopied(true)
            } catch {
              /* the field above is selectable */
            }
          }}
          className="btn-primary !min-h-[44px] flex-1 !text-[11px]"
        >
          {copied ? 'Link copied' : 'Copy link'}
        </button>
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <button onClick={() => navigator.share?.({ title: name, url })} className="btn-secondary !min-h-[44px] flex-1 !text-[11px]">
            Share
          </button>
        )}
      </div>
    </div>
  )
}
