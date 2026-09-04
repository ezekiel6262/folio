'use client'

import { useEffect, useState } from 'react'

/**
 * The claim link carries the secret in the URL fragment, which browsers never send to a
 * server. Folio therefore cannot claim a gift on the recipient's behalf, and neither can
 * anyone reading our logs.
 */
export function ShareLink({ folioId, secret, name }: { folioId: string; secret: string; name: string }) {
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setUrl(`${window.location.origin}/claim/${folioId}#${secret}`)
  }, [folioId, secret])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard can be blocked; the input below is selectable as a fallback
    }
  }

  return (
    <div className="card mb-4 border-accent/25 bg-accent-soft/40 p-5">
      <p className="label text-accent">Send this link</p>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink/70">
        Whoever opens it claims <span className="font-semibold text-ink">{name}</span>. The link holds
        the only key, so save it before you leave this page.
      </p>

      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="mt-3 !bg-white font-mono text-[12px]"
      />

      <div className="mt-2.5 flex gap-2">
        <button onClick={copy} className="btn-primary flex-1 !py-2.5 text-[13px]">
          {copied ? 'Copied' : 'Copy link'}
        </button>
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <button
            onClick={() => navigator.share?.({ title: name, url })}
            className="btn-ghost !py-2.5 text-[13px]"
          >
            Share
          </button>
        )}
      </div>
    </div>
  )
}
