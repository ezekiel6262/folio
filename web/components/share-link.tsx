'use client'

import { useEffect, useState } from 'react'
import { Kicker } from './ui'

/**
 * The claim secret rides in the URL fragment, which browsers never send to a server.
 * Folio therefore cannot claim a gift on the recipient's behalf, and neither can anyone
 * reading our logs — which is exactly why losing the link is unrecoverable, and why this
 * plate is given real weight rather than being tucked under the fold.
 */
export function ShareLink({ folioId, secret, name }: { folioId: string; secret: string; name: string }) {
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setUrl(`${window.location.origin}/claim/${folioId}#${secret}`)
  }, [folioId, secret])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      /* clipboard can be blocked; the field below is selectable as a fallback */
    }
  }

  return (
    <div className="border-2 border-accent p-4">
      <Kicker>Hand this over</Kicker>

      <p className="mt-3 font-serif text-[22px] leading-[1.25] text-ink">
        This link is the only <span className="italic">key</span>.
      </p>

      <p className="t-body-sm mt-3">
        Whoever opens it can claim <span className="text-ink">{name}</span>. Send it to one person,
        and save it before you leave this page — we cannot send it again.
      </p>

      <div className="mt-4 bg-ground-inset p-3">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full break-all border-0 bg-transparent p-0 font-mono text-[10.5px] text-body outline-none"
        />
      </div>

      <div className="mt-3 flex gap-2">
        <button onClick={copy} className="btn-primary !min-h-[44px] flex-1 !text-[11px]">
          {copied ? 'Link copied' : 'Copy link'}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary !min-h-[44px] flex-1 !text-[11px] no-underline"
        >
          Preview it
        </a>
      </div>
    </div>
  )
}
