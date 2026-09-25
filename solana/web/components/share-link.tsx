'use client'

import { useEffect, useState } from 'react'
import { Kicker } from './ui'

/**
 * The claim link carries the folio's claim key in its fragment, which browsers never send
 * to a server. Folio cannot claim a gift on anyone's behalf and cannot send the link again
 * — which is exactly why this plate is given real weight rather than tucked below the fold.
 *
 * Whose it is and what the sender wants to say ride in the same fragment, for the same
 * reason: they are written on the envelope, not kept in anyone's database.
 */
export function ShareLink({ folio, secret, name }: { folio: string; secret: string; name: string }) {
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    const extra = [to.trim() && `to=${encodeURIComponent(to.trim())}`, note.trim() && `m=${encodeURIComponent(note.trim())}`]
      .filter(Boolean)
      .join('&')
    setUrl(`${window.location.origin}/claim/${folio}#k=${secret}${extra ? `&${extra}` : ''}`)
  }, [folio, secret, to, note])
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
      <div className="mt-4 grid gap-2 sm:grid-cols-[130px_minmax(0,1fr)]">
        <input
          value={to}
          onChange={(e) => setTo(e.target.value.slice(0, 24))}
          placeholder="Who it is for"
          className="field !text-[14px]"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 120))}
          placeholder="Say something to them"
          className="field !text-[14px]"
        />
      </div>
      <p className="t-disclaimer mt-1.5">
        Both are written into the link itself, so only whoever holds it can read them. Folio never
        sees either one.
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
