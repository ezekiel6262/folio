'use client'

import { PublicKey } from '@solana/web3.js'
import { MonoLabel } from './ui'

export type GiftSettings = {
  mode: 'keep' | 'send'
  /** A Solana address, or empty to send as a claim link. */
  recipient: string
  /** Unix seconds; 0 for no lock. */
  unlockAt: number
  /** Unix seconds after which an unclaimed link returns to the sender; 0 for never. */
  reclaimAfter: number
}

export function isSolanaAddress(v: string) {
  try {
    return Boolean(v) && PublicKey.isOnCurve(new PublicKey(v).toBytes()) !== undefined
  } catch {
    return false
  }
}

const monthsFromNow = (months: number) => {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return Math.floor(d.getTime() / 1000)
}

export function GiftOptions({ value, onChange }: { value: GiftSettings; onChange: (v: GiftSettings) => void }) {
  const set = (patch: Partial<GiftSettings>) => onChange({ ...value, ...patch })
  const recipientValid = !value.recipient || isSolanaAddress(value.recipient)
  const dateValue = value.unlockAt ? new Date(value.unlockAt * 1000).toISOString().slice(0, 10) : ''

  return (
    <div className="mt-9">
      <MonoLabel>Who is it for</MonoLabel>
      <div className="mt-2">
        <Radio checked={value.mode === 'keep'} onSelect={() => set({ mode: 'keep', recipient: '', reclaimAfter: 0 })} title="Keep it" note="It goes into your name and stays there." />
        <Radio checked={value.mode === 'send'} onSelect={() => set({ mode: 'send' })} title="Send it to someone" note="They get the whole folio, not a copy of it." />
      </div>

      {value.mode === 'send' && (
        <div className="mt-4 border border-accent bg-ground-inset p-4">
          <MonoLabel>Their Folio or Solana address — or leave blank for a link</MonoLabel>
          <input
            type="text"
            value={value.recipient}
            onChange={(e) => set({ recipient: e.target.value.trim() })}
            placeholder="Address, or leave empty"
            className={`field mt-2 font-mono text-[12px] ${recipientValid ? '' : '!border-accent'}`}
          />
          <p className="t-body-sm mt-2">
            {value.recipient
              ? recipientValid
                ? 'It is theirs the moment it is made, even while it is locked.'
                : 'That is not a Solana address.'
              : 'We make a link. Whoever opens it claims the folio, so send it to one person.'}
          </p>

          {!value.recipient && (
            <div className="mt-4 border-t border-rule-mid pt-4">
              <MonoLabel>If nobody claims it</MonoLabel>
              <div className="mt-2 flex gap-1.5">
                {[
                  { label: 'Stays claimable', v: 0 },
                  { label: 'Back to me in 3 months', v: monthsFromNow(3) },
                ].map((o) => (
                  <button
                    key={o.label}
                    onClick={() => set({ reclaimAfter: o.v })}
                    className={`border px-2 py-1 font-mono text-[9.5px] uppercase tracking-monolabel transition-colors ${
                      (value.reclaimAfter === 0) === (o.v === 0) ? 'border-ink bg-ink text-ground' : 'border-rule-mid text-body-soft hover:border-ink'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <MonoLabel className="mt-7">Lock it until</MonoLabel>
      <div className="mt-2 flex gap-1.5">
        {[
          { label: 'No lock', months: 0 },
          { label: '1 year', months: 12 },
          { label: '5 years', months: 60 },
        ].map((p) => (
          <button
            key={p.label}
            onClick={() => set({ unlockAt: p.months ? monthsFromNow(p.months) : 0 })}
            className="border border-rule-mid px-2 py-1 font-mono text-[9.5px] uppercase tracking-monolabel text-body-soft transition-colors hover:border-ink hover:bg-ink hover:text-ground"
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        type="date"
        value={dateValue}
        min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
        onChange={(e) => set({ unlockAt: e.target.value ? Math.floor(new Date(e.target.value).getTime() / 1000) : 0 })}
        className="field mt-2 font-mono text-[12.5px]"
      />
      {value.unlockAt > 0 && (
        <p className="t-body-sm mt-2">
          Owned and visible the whole time; the shares can be taken out from{' '}
          {new Date(value.unlockAt * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.
        </p>
      )}
    </div>
  )
}

function Radio({ checked, onSelect, title, note }: { checked: boolean; onSelect: () => void; title: string; note: string }) {
  return (
    <button onClick={onSelect} role="radio" aria-checked={checked} className="flex w-full items-start gap-3 border-t border-rule-hair py-3.5 text-left">
      <span aria-hidden="true" className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center border border-ink bg-white">
        {checked && <span className="block h-2 w-2 bg-accent" />}
      </span>
      <span>
        <span className="t-cardtitle block">{title}</span>
        <span className="t-body-sm mt-1 block">{note}</span>
      </span>
    </button>
  )
}
